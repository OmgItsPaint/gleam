const fs = require('fs');
const fsp = fs.promises;
const path = require('path');
const os = require('os');
const https = require('https');
const crypto = require('crypto');
const zlib = require('zlib');
const { spawn, spawnSync } = require('child_process');
const { fallbackJavaMajor, isCalendarRelease, isSupportedVersion } = require('./version-policy');
const { version: LAUNCHER_VERSION } = require('./package.json');
const DOWNLOAD_AGENT = new https.Agent({ keepAlive: true, maxSockets: 16, maxFreeSockets: 8, timeout: 30000 });

const MANIFEST_URL = 'https://launchermeta.mojang.com/mc/game/version_manifest_v2.json';
const LAUNCHER_NAME = 'Swirl';
const FABRIC_META = 'https://meta.fabricmc.net/v2/versions/loader';
const MODRINTH_API = 'https://api.modrinth.com/v2';
const ADOPTIUM_ASSETS = (version, platform, architecture) => `https://api.adoptium.net/v3/assets/latest/${version}/hotspot?architecture=${architecture}&image_type=jre&os=${platform}&vendor=eclipse`;

class IcecreamEngine {
  constructor(appData, progress = () => {}) {
    this.root = path.join(appData, '.icecream_client');
    this.progress = progress;
    this.jsonCache = new Map();
    this.jsonInflight = new Map();
    this.settingsCache = null;
    this.profilesCache = null;
    this.profileQueues = new Map();
  }

  emit(stage, message, received = 0, total = 0) { this.progress({ stage, message, received, total, percent: total ? Math.round(received * 100 / total) : 0 }); }
  async ensure(directory) { await fsp.mkdir(directory, { recursive: true }); }
  async exists(file) { try { await fsp.access(file); return true; } catch { return false; } }
  settingsFile() { return path.join(this.root, 'settings.json'); }
  modProfilesFile() { return path.join(this.root, 'mod-profiles.json'); }
  modProfilesBackupFile() { return path.join(this.root, 'mod-profiles.backup.json'); }
  instanceDirectory(gameVersion, profileId = '') { if (!/^[a-f0-9]{16}$/.test(String(profileId))) throw new Error('A valid isolated profile is required.'); return path.join(this.root, 'instances', 'profiles', profileId); }
  profileBackupRoot(profileId) { return path.join(this.root, 'backups', profileId); }
  settingsBackupRoot(profileId) { return path.join(this.root, 'settings-backups', profileId); }
  profileLockFile(gameVersion, profileId) { return path.join(this.instanceDirectory(gameVersion, profileId), 'swirl.lock.json'); }
  async withProfileLock(profileId, work) { const previous = this.profileQueues.get(profileId) || Promise.resolve(); let release; const current = new Promise(resolve => { release = resolve; }); const tail = previous.then(() => current); this.profileQueues.set(profileId, tail); await previous; try { return await work(); } finally { release(); if (this.profileQueues.get(profileId) === tail) this.profileQueues.delete(profileId); } }
  async atomicWrite(file, data) { await this.ensure(path.dirname(file)); const temporary = `${file}.${process.pid}.${crypto.randomBytes(4).toString('hex')}.tmp`; const handle = await fsp.open(temporary, 'w'); try { await handle.writeFile(data); await handle.sync(); } finally { await handle.close(); } await fsp.rename(temporary, file); }
  async getModProfiles() { if (this.profilesCache) return this.profilesCache.map(profile => ({ ...profile, mods: [...(profile.mods || [])] })); const read = async file => { const value = JSON.parse(await fsp.readFile(file, 'utf8')); if (!Array.isArray(value)) throw new Error('Profile store is not an array.'); return value; }; let profiles = []; try { if (await this.exists(this.modProfilesFile())) profiles = await read(this.modProfilesFile()); else if (await this.exists(this.modProfilesBackupFile())) profiles = await read(this.modProfilesBackupFile()); } catch (error) { this.emit('profile', `Profile store recovery: ${error.message}`); try { profiles = await read(this.modProfilesBackupFile()); } catch {} } this.profilesCache = profiles; return profiles.map(profile => ({ ...profile, mods: [...(profile.mods || [])] })); }
  async saveModProfiles(profiles) { if (!Array.isArray(profiles)) throw new Error('Profiles must be an array.'); await this.ensure(this.root); const destination = this.modProfilesFile(); const temporary = `${destination}.${process.pid}.${crypto.randomBytes(4).toString('hex')}.tmp`; const payload = JSON.stringify(profiles, null, 2); if (await this.exists(destination)) await fsp.copyFile(destination, this.modProfilesBackupFile()); const handle = await fsp.open(temporary, 'w'); try { await handle.writeFile(payload, 'utf8'); await handle.sync(); } finally { await handle.close(); } await fsp.rename(temporary, destination); this.profilesCache = profiles.map(profile => ({ ...profile, mods: [...(profile.mods || [])] })); }
  async createModProfile(name, gameVersion, sourceProfileId = '', requestedTransfer = {}) {
    const title = String(name || '').trim().slice(0, 50); if (!title) throw new Error('Enter a name for the mod profile.');
    const profiles = await this.getModProfiles(); const sourceProfile = sourceProfileId ? profiles.find(item => item.id === sourceProfileId) : null;
    if (sourceProfileId && !sourceProfile) throw new Error('The selected source profile no longer exists.');
    const transfer = { mods: requestedTransfer?.mods !== false, settings: requestedTransfer?.settings === true, resourcePacks: requestedTransfer?.resourcePacks === true, shaderPacks: requestedTransfer?.shaderPacks === true, worlds: requestedTransfer?.worlds === true, servers: requestedTransfer?.servers === true };
    const preset = ['vanilla', 'performance', 'custom'].includes(requestedTransfer?.preset) ? requestedTransfer.preset : 'custom';
    const id = crypto.randomBytes(8).toString('hex'); const target = this.instanceDirectory(gameVersion, id);
    const profile = { id, name: title, gameVersion, preset, autoSync: (await this.getSettings()).autoUpdate === true, createdAt: new Date().toISOString(), mods: [] }; const migration = { copied: [], skipped: [], transfer };
    try {
      await Promise.all([this.ensure(path.join(target, 'mods')), this.ensure(path.join(target, 'saves')), this.ensure(path.join(target, 'config'))]);
      if (!sourceProfile || !transfer.mods) await this.atomicWrite(path.join(target, 'mods', 'icecream-mods.json'), '[]');
      else {
        const sourceMods = await this.getInstalledMods(sourceProfile.gameVersion, sourceProfile.id);
        if (sourceProfile.gameVersion === gameVersion) {
          for (const mod of sourceMods) { const sourceFile = path.join(this.instanceDirectory(sourceProfile.gameVersion, sourceProfile.id), 'mods', mod.file); if (await this.exists(sourceFile)) { await fsp.copyFile(sourceFile, path.join(target, 'mods', mod.file)); migration.copied.push(mod.name || mod.projectId); } }
          await this.atomicWrite(path.join(target, 'mods', 'icecream-mods.json'), JSON.stringify(sourceMods, null, 2)); profile.mods = sourceMods.map(mod => ({ projectId: mod.projectId, versionId: mod.versionId }));
        } else {
          await this.atomicWrite(path.join(target, 'mods', 'icecream-mods.json'), '[]');
          for (const mod of sourceMods) { try { await this.installModrinthMod(mod.projectId, gameVersion, new Set(), '', id); migration.copied.push(mod.name || mod.projectId); } catch (error) { migration.skipped.push({ name: mod.name || mod.projectId, reason: error.message }); this.emit('mod', `Skipped incompatible mod ${mod.name || mod.projectId}: ${error.message}`); } }
          profile.mods = (await this.getInstalledMods(gameVersion, id)).map(mod => ({ projectId: mod.projectId, versionId: mod.versionId }));
        }
      }
      if (sourceProfile) {
        const source = this.instanceDirectory(sourceProfile.gameVersion, sourceProfile.id);
        const files = [];
        if (transfer.settings) files.push('options.txt');
        if (transfer.servers) files.push('servers.dat');
        for (const name of files) { const from = path.join(source, name); if (await this.exists(from)) { await fsp.copyFile(from, path.join(target, name)); migration.copied.push(name); } }
        const folders = [];
        if (transfer.resourcePacks) folders.push('resourcepacks');
        if (transfer.shaderPacks) folders.push('shaderpacks');
        if (transfer.worlds) folders.push('saves');
        for (const name of folders) { const from = path.join(source, name); if (await this.exists(from)) { await fsp.cp(from, path.join(target, name), { recursive: true, force: true }); migration.copied.push(name); } }
      }
      if (sourceProfile) profile.lastMigration = { fromProfile: sourceProfile.id, fromVersion: sourceProfile.gameVersion, at: new Date().toISOString(), ...migration }; profiles.push(profile); await this.saveModProfiles(profiles); await this.writeProfileLock(id, gameVersion); return profile;
    } catch (error) { await fsp.rm(target, { recursive: true, force: true }); throw error; }
  }
  async setModProfile(id, changes) { return this.withProfileLock(id, async () => { const profiles = await this.getModProfiles(); const profile = profiles.find(item => item.id === id); if (!profile) throw new Error('That mod profile was not found.'); const allowed = {}; if (typeof changes?.name === 'string') { allowed.name = changes.name.trim().slice(0, 50); if (!allowed.name) throw new Error('Profile names cannot be empty.'); } if (typeof changes?.autoSync === 'boolean') allowed.autoSync = changes.autoSync; if (Array.isArray(changes?.mods)) allowed.mods = changes.mods.filter(mod => mod && typeof mod.projectId === 'string' && typeof mod.versionId === 'string').map(mod => ({ projectId: mod.projectId, versionId: mod.versionId })); Object.assign(profile, allowed); await this.saveModProfiles(profiles); return profile; }); }
  async duplicateModProfile(id, requestedName = '') { const source = (await this.getModProfiles()).find(item => item.id === id); if (!source) throw new Error('That profile was not found.'); return this.createModProfile(requestedName.trim() || `${source.name} Copy`, source.gameVersion, source.id); }
  async repairModProfile(id, rebuildLock = true) {
    const profile = (await this.getModProfiles()).find(item => item.id === id); if (!profile) throw new Error('That profile was not found.');
    const directory = this.instanceDirectory(profile.gameVersion, profile.id); const modsDirectory = path.join(directory, 'mods');
    await Promise.all(['mods', 'saves', 'config', 'resourcepacks', 'shaderpacks', 'screenshots'].map(folder => this.ensure(path.join(directory, folder))));
    const manifestFile = path.join(modsDirectory, 'icecream-mods.json'); if (!await this.exists(manifestFile)) await this.atomicWrite(manifestFile, '[]');
    const mods = await this.getInstalledMods(profile.gameVersion, profile.id); const missing = mods.filter(mod => !fs.existsSync(path.join(modsDirectory, mod.file))).map(mod => mod.name || mod.projectId);
    if (missing.length) throw new Error(`Repair found missing mod files: ${missing.join(', ')}. Remove or reinstall those mods.`);
    if (rebuildLock) {
      const lockFile = this.profileLockFile(profile.gameVersion, id);
      if (await this.exists(lockFile)) await this.verifyProfileLock(id, profile.gameVersion);
      else await this.writeProfileLock(id, profile.gameVersion);
    }
    return { directory, mods: mods.length, repaired: true };
  }
  async backupModProfile(id) {
    const profile = (await this.getModProfiles()).find(item => item.id === id); if (!profile) throw new Error('That profile was not found.'); await this.repairModProfile(id, false); await this.verifyProfileLock(id, profile.gameVersion);
    const stamp = new Date().toISOString().replace(/[:.]/g, '-'); const destination = path.join(this.profileBackupRoot(id), stamp); await this.ensure(path.dirname(destination));
    await fsp.cp(this.instanceDirectory(profile.gameVersion, id), destination, { recursive: true, errorOnExist: true });
    await this.atomicWrite(path.join(destination, 'swirl-profile.json'), JSON.stringify(profile, null, 2)); const settings = await this.getSettings(); await this.pruneProfileBackups(id, settings.backupRetention); return { destination, createdAt: stamp };
  }
  async directorySize(directory) { let total = 0; const queue = [directory]; while (queue.length) { const current = queue.pop(); for (const entry of await fsp.readdir(current, { withFileTypes: true }).catch(() => [])) { const file = path.join(current, entry.name); if (entry.isDirectory()) queue.push(file); else if (entry.isFile()) total += Number((await fsp.stat(file).catch(() => null))?.size || 0); } } return total; }
  async listProfileBackups(id) { const profile = (await this.getModProfiles()).find(item => item.id === id); if (!profile) throw new Error('That profile was not found.'); const entries = await fsp.readdir(this.profileBackupRoot(id), { withFileTypes: true }).catch(() => []); const backups = []; for (const entry of entries.filter(item => item.isDirectory() && item.name !== 'world-upgrades')) { const directory = path.join(this.profileBackupRoot(id), entry.name); const stat = await fsp.stat(directory); backups.push({ id: entry.name, createdAt: stat.birthtime.toISOString(), modifiedAt: stat.mtime.toISOString(), size: await this.directorySize(directory) }); } return backups.sort((a, b) => b.id.localeCompare(a.id)); }
  async pruneProfileBackups(id, retention = 5) { const keep = Math.max(1, Math.min(20, Number(retention) || 5)); const backups = await this.listProfileBackups(id); for (const backup of backups.slice(keep)) await fsp.rm(path.join(this.profileBackupRoot(id), backup.id), { recursive: true, force: true }); return backups.slice(0, keep); }
  async deleteProfileBackup(id, backupId) { const backup = String(backupId || ''); if (!/^\d{4}-\d{2}-\d{2}T[0-9-]+Z$/.test(backup)) throw new Error('Choose a valid profile backup.'); const directory = path.join(this.profileBackupRoot(id), backup); if (!await this.exists(directory)) throw new Error('That backup no longer exists.'); await fsp.rm(directory, { recursive: true, force: true }); return true; }
  async ensureWorldUpgradeBackup(profile) {
    if (!isCalendarRelease(profile.gameVersion)) return null;
    const instance = this.instanceDirectory(profile.gameVersion, profile.id); const saves = path.join(instance, 'saves');
    const worlds = (await fsp.readdir(saves, { withFileTypes: true }).catch(() => [])).filter(entry => entry.isDirectory());
    if (!worlds.length) return null;
    const recordFile = path.join(instance, '.swirl-world-upgrades.json'); let record = { version: 1, worlds: {} };
    try { record = { ...record, ...JSON.parse(await fsp.readFile(recordFile, 'utf8')) }; } catch {}
    const pending = worlds.filter(world => !record.worlds?.[world.name]);
    if (!pending.length) return null;
    const stamp = new Date().toISOString().replace(/[:.]/g, '-'); const destination = path.join(this.root, 'backups', profile.id, 'world-upgrades', stamp);
    await this.ensure(destination);
    for (const world of pending) await fsp.cp(path.join(saves, world.name), path.join(destination, world.name), { recursive: true, errorOnExist: true });
    record.worlds = { ...(record.worlds || {}) }; for (const world of pending) record.worlds[world.name] = { backedUpAt: new Date().toISOString(), targetVersion: profile.gameVersion, destination };
    await this.atomicWrite(recordFile, JSON.stringify(record, null, 2)); this.emit('backup', `Backed up ${pending.length} world${pending.length === 1 ? '' : 's'} before the ${profile.gameVersion} upgrade`); return { destination, worlds: pending.map(world => world.name) };
  }
  async installBundledClientMod(gameVersion, profileId) {
    const source = path.join(__dirname, 'bundled-mods', `swirl-client-${gameVersion}.jar`);
    if (!await this.exists(source)) return false;
    const mods = path.join(this.instanceDirectory(gameVersion, profileId), 'mods'); await this.ensure(mods);
    for (const entry of await fsp.readdir(mods).catch(() => [])) if (/^swirl-client-.*\.jar$/i.test(entry) && entry !== path.basename(source)) await fsp.rm(path.join(mods, entry), { force: true });
    await fsp.copyFile(source, path.join(mods, path.basename(source))); return true;
  }
  async restoreProfileBackup(id, requestedBackup = '') {
    const profile = (await this.getModProfiles()).find(item => item.id === id); if (!profile) throw new Error('That profile was not found.'); const root = path.join(this.root, 'backups', id);
    const backups = await this.listProfileBackups(id); const selected = requestedBackup ? backups.find(item => item.id === requestedBackup) : backups[0]; if (!selected) throw new Error('This profile has no backup to restore.');
    const source = path.join(root, selected.id); const target = this.instanceDirectory(profile.gameVersion, id); const safety = path.join(this.root, 'trash', `${id}-before-restore-${Date.now()}`); await this.ensure(path.dirname(safety));
    if (await this.exists(target)) await fsp.rename(target, safety);
    try {
      await fsp.cp(source, target, { recursive: true });
      await fsp.rm(path.join(target, 'swirl-profile.json'), { force: true });
      await this.verifyProfileLock(id, profile.gameVersion);
      const mods = await this.getInstalledMods(profile.gameVersion, id); const profiles = await this.getModProfiles(); const saved = profiles.find(item => item.id === id); if (saved) saved.mods = mods.map(mod => ({ projectId: mod.projectId, versionId: mod.versionId })); await this.saveModProfiles(profiles);
      return { restoredFrom: selected.id, safety };
    } catch (error) {
      await fsp.rm(target, { recursive: true, force: true });
      if (await this.exists(safety)) await fsp.rename(safety, target);
      throw new Error(`The backup was not restored because its integrity check failed: ${error.message}`);
    }
  }
  async restoreLatestProfileBackup(id) { return this.restoreProfileBackup(id); }
  async syncMinecraftSettings(sourceId) {
    const profiles = await this.getModProfiles(); const source = profiles.find(profile => profile.id === sourceId); if (!source) throw new Error('That source profile was not found.');
    const sourceFile = path.join(this.instanceDirectory(source.gameVersion, source.id), 'options.txt'); if (!await this.exists(sourceFile)) throw new Error('Play this profile once and save your Minecraft settings before syncing them.');
    const data = await fsp.readFile(sourceFile); const settings = await this.getSettings(); const retention = Math.max(1, Number(settings.backupRetention) || 5); const synced = []; const skipped = [];
    for (const target of profiles.filter(profile => profile.id !== source.id)) {
      await this.withProfileLock(target.id, async () => {
        try {
          const targetFile = path.join(this.instanceDirectory(target.gameVersion, target.id), 'options.txt');
          if (await this.exists(targetFile)) {
            const backupRoot = this.settingsBackupRoot(target.id); await this.ensure(backupRoot); const stamp = new Date().toISOString().replace(/[:.]/g, '-'); await fsp.copyFile(targetFile, path.join(backupRoot, `${stamp}-options.txt`));
            const backups = (await fsp.readdir(backupRoot)).filter(name => name.endsWith('-options.txt')).sort().reverse(); for (const old of backups.slice(retention)) await fsp.rm(path.join(backupRoot, old), { force: true });
          }
          await this.atomicWrite(targetFile, data); synced.push({ id: target.id, name: target.name, gameVersion: target.gameVersion });
        } catch (error) { skipped.push({ id: target.id, name: target.name, reason: error.message }); }
      });
    }
    return { source: source.name, synced, skipped };
  }
  async deleteModProfile(id) {
    return this.withProfileLock(id, async () => { const profiles = await this.getModProfiles(); const profile = profiles.find(item => item.id === id); if (!profile) throw new Error('That profile was not found.');
      const source = this.instanceDirectory(profile.gameVersion, id); const destination = path.join(this.root, 'trash', `${id}-${Date.now()}`); await this.ensure(path.dirname(destination)); if (await this.exists(source)) await fsp.rename(source, destination);
      await this.saveModProfiles(profiles.filter(item => item.id !== id)); const settings = await this.getSettings(); const activeProfiles = Object.fromEntries(Object.entries(settings.activeProfiles || {}).filter(([, value]) => value !== id)); await this.setSettings({ activeProfiles, replaceActiveProfiles: true }); return { name: profile.name, recoverableAt: destination }; });
  }
  async removeMod(projectId, gameVersion, profileId) {
    return this.withProfileLock(profileId, async () => { const selectedProfile = (await this.getModProfiles()).find(item => item.id === profileId); if (selectedProfile?.serverRequiredMods?.some(mod => mod.projectId === projectId)) throw new Error('That mod is required by this server profile. Import a new server invite if the host changed it.'); const manifest = await this.getInstalledMods(gameVersion, profileId); const target = manifest.find(mod => mod.projectId === projectId); if (!target) throw new Error('That mod is not installed in this profile.'); await this.backupModProfile(profileId);
      const modsDirectory = path.join(this.instanceDirectory(gameVersion, profileId), 'mods'); const next = manifest.filter(mod => mod.projectId !== projectId); await fsp.rm(path.join(modsDirectory, target.file), { force: true }); await this.atomicWrite(path.join(modsDirectory, 'icecream-mods.json'), JSON.stringify(next, null, 2));
      const profiles = await this.getModProfiles(); const profile = profiles.find(item => item.id === profileId); if (profile) { profile.mods = next.map(mod => ({ projectId: mod.projectId, versionId: mod.versionId })); await this.saveModProfiles(profiles); } await this.writeProfileLock(profileId, gameVersion); return target; });
  }
  async diagnostics() { const profiles = await this.getModProfiles(); const settings = await this.getSettings(); const java = {}; for (const major of [8, 17, 21, 25]) { try { java[major] = { available: true, path: this.findJava(major) }; } catch { java[major] = { available: false }; } } await this.ensure(this.root); let freeDiskGiB = null; try { const disk = await fsp.statfs(this.root); freeDiskGiB = Math.round(Number(disk.bavail) * Number(disk.bsize) / 1024 ** 3 * 10) / 10; } catch {} let dataDirectoryWritable = false; const probe = path.join(this.root, `.write-test-${process.pid}`); try { await fsp.writeFile(probe, 'ok', { flag: 'wx' }); dataDirectoryWritable = true; } catch {} finally { await fsp.rm(probe, { force: true }).catch(() => {}); } return { launcher: LAUNCHER_NAME, version: LAUNCHER_VERSION, platform: process.platform, architecture: process.arch, node: process.version, totalMemoryGiB: Math.round(os.totalmem() / 1024 ** 3), recommendedMemoryGiB: this.memoryGiB(), freeDiskGiB, dataDirectoryWritable, java, profiles: profiles.map(profile => ({ id: profile.id, name: profile.name, gameVersion: profile.gameVersion, requiredJava: fallbackJavaMajor(profile.gameVersion), mods: (profile.mods || []).length, preset: profile.preset || 'custom', autoSync: profile.autoSync === true, instanceExists: fs.existsSync(this.instanceDirectory(profile.gameVersion, profile.id)), lockfileExists: fs.existsSync(this.profileLockFile(profile.gameVersion, profile.id)), bundledClientAvailable: fs.existsSync(path.join(__dirname, 'bundled-mods', `swirl-client-${profile.gameVersion}.jar`)) })), settings: { autoUpdate: settings.autoUpdate, experimentalVersions: settings.experimentalVersions === true, lastVersion: settings.lastVersion || '', backupRetention: settings.backupRetention, fabricLoaderVersions: settings.fabricLoaderVersions || {} }, dataDirectory: this.root }; }
  async writeProfileLock(profileId, gameVersion) { const profile = (await this.getModProfiles()).find(item => item.id === profileId); if (!profile) throw new Error('That profile was not found.'); const mods = await this.getInstalledMods(gameVersion, profileId); const directory = path.join(this.instanceDirectory(gameVersion, profileId), 'mods'); const locked = []; for (const mod of mods) { const file = path.join(directory, mod.file); if (!await this.exists(file)) throw new Error(`Cannot lock missing mod file: ${mod.file}`); locked.push({ projectId: mod.projectId, versionId: mod.versionId, versionNumber: mod.versionNumber || '', file: mod.file, sha512: mod.sha512 || await this.fileHash(file, 'sha512') }); } const lock = { format: 1, profileId, gameVersion, fabricLoaderVersion: profile.fabricLoaderVersion || '', generatedAt: new Date().toISOString(), mods: locked.sort((a, b) => a.projectId.localeCompare(b.projectId)) }; await this.atomicWrite(this.profileLockFile(gameVersion, profileId), JSON.stringify(lock, null, 2)); return lock; }
  async verifyProfileLock(profileId, gameVersion) { const file = this.profileLockFile(gameVersion, profileId); if (!await this.exists(file)) return this.writeProfileLock(profileId, gameVersion); let lock; try { lock = JSON.parse(await fsp.readFile(file, 'utf8')); } catch { throw new Error('This profile lockfile is damaged. Use Check files to rebuild it.'); } if (lock.gameVersion !== gameVersion || !Array.isArray(lock.mods)) throw new Error('This profile lockfile belongs to a different Minecraft version.'); const manifest = await this.getInstalledMods(gameVersion, profileId); const expected = new Map(lock.mods.map(mod => [mod.projectId, mod])); if (manifest.length !== expected.size) throw new Error('The profile mod list does not match swirl.lock.json. Use Check files before playing.'); const modsDirectory = path.join(this.instanceDirectory(gameVersion, profileId), 'mods'); const managedFiles = new Set(manifest.map(mod => mod.file)); const unmanaged = (await fsp.readdir(modsDirectory).catch(() => [])).filter(name => name.toLowerCase().endsWith('.jar') && !managedFiles.has(name) && !/^swirl-client-.*\.jar$/i.test(name)); if (unmanaged.length) throw new Error(`Unmanaged mod files are not allowed in a locked profile: ${unmanaged.join(', ')}. Add them through Swirl or remove them.`); for (const mod of manifest) { const pinned = expected.get(mod.projectId); if (!pinned || pinned.versionId !== mod.versionId || pinned.file !== mod.file) throw new Error(`${mod.name || mod.projectId} does not match the shared profile lockfile.`); const actual = await this.fileHash(path.join(modsDirectory, mod.file), 'sha512'); if (actual !== pinned.sha512) throw new Error(`${mod.file} failed its SHA-512 lockfile check. Reinstall the mod.`); } return lock; }
  async exportModProfile(id) { const profile = (await this.getModProfiles()).find(item => item.id === id); if (!profile) throw new Error('That mod profile was not found.'); const lock = await this.writeProfileLock(id, profile.gameVersion); return `SWIRL2.${Buffer.from(JSON.stringify({ name: profile.name, gameVersion: profile.gameVersion, fabricLoaderVersion: profile.fabricLoaderVersion || '', mods: lock.mods })).toString('base64url')}`; }
  async importModProfile(code) { const text = String(code || '').trim(); const prefix = ['SWIRL2.', 'SWIRL1.', 'ICECREAM1.'].find(item => text.startsWith(item)) || ''; if (!prefix || text.length > 200000) throw new Error('This is not a valid Swirl mod profile code.'); let shared; try { shared = JSON.parse(Buffer.from(text.slice(prefix.length), 'base64url').toString('utf8')); } catch { throw new Error('This mod profile code could not be decoded.'); } const settings = await this.getSettings(); if (!isSupportedVersion(shared.gameVersion, settings.experimentalVersions === true) || !Array.isArray(shared.mods)) throw new Error('This profile does not contain a supported Minecraft version.'); for (const mod of shared.mods) { if (!mod || typeof mod.projectId !== 'string' || typeof mod.versionId !== 'string') throw new Error('This mod profile contains an invalid mod entry.'); }
    const id = crypto.randomBytes(8).toString('hex'); const profile = { id, name: `${String(shared.name || 'Imported profile').slice(0, 40)} (imported)`, gameVersion: shared.gameVersion, fabricLoaderVersion: typeof shared.fabricLoaderVersion === 'string' ? shared.fabricLoaderVersion : '', autoSync: false, createdAt: new Date().toISOString(), mods: [] }; const profiles = await this.getModProfiles(); const target = this.instanceDirectory(profile.gameVersion, id); try { await Promise.all([this.ensure(path.join(target, 'mods')), this.ensure(path.join(target, 'saves')), this.ensure(path.join(target, 'config'))]); await this.atomicWrite(path.join(target, 'mods', 'icecream-mods.json'), '[]'); profiles.push(profile); await this.saveModProfiles(profiles); for (const mod of shared.mods) { await this.installModrinthMod(mod.projectId, profile.gameVersion, new Set(), mod.versionId, id); if (prefix === 'SWIRL2.' && mod.sha512) { const installed = (await this.getInstalledMods(profile.gameVersion, id)).find(item => item.projectId === mod.projectId); const actual = await this.fileHash(path.join(target, 'mods', installed.file), 'sha512'); if (actual !== mod.sha512) throw new Error(`${installed.file} did not match the shared profile hash.`); } } profile.mods = (await this.getInstalledMods(profile.gameVersion, id)).map(mod => ({ projectId: mod.projectId, versionId: mod.versionId })); await this.saveModProfiles(profiles); await this.writeProfileLock(id, profile.gameVersion); return profile; } catch (error) { await fsp.rm(target, { recursive: true, force: true }); await this.saveModProfiles(profiles.filter(item => item.id !== id)).catch(() => {}); throw error; } }
  async parseServerInvite(code) {
    const text = String(code || '').trim();
    if (text.length > 300000) throw new Error('This server invite is too large.');
    const parts = text.split('.');
    if (parts.length !== 3 || parts[0] !== 'SWIRLSERVER1') throw new Error('This is not a valid Swirl server invite.');
    let invite;
    try { invite = JSON.parse(Buffer.from(parts[1], 'base64url').toString('utf8')); } catch { throw new Error('This server invite could not be decoded.'); }
    const settings = await this.getSettings();
    if (!invite || invite.format !== 1 || !isSupportedVersion(invite.gameVersion, settings.experimentalVersions === true)) throw new Error('This invite uses a Minecraft version that this Swirl build does not support.');
    if (!Array.isArray(invite.addresses) || !invite.addresses.length || !Number.isInteger(Number(invite.port)) || Number(invite.port) < 1 || Number(invite.port) > 65535) throw new Error('This invite has no valid server address.');
    if (!Array.isArray(invite.mods) || invite.mods.length > 500) throw new Error('This invite has an invalid mod list.');
    if (typeof invite.publicKey !== 'string' || invite.publicKey.length > 10000) throw new Error('This invite has no signing key.');
    let validSignature = false;
    try { validSignature = crypto.verify(null, Buffer.from(parts[1]), invite.publicKey, Buffer.from(parts[2], 'base64url')); } catch {}
    if (!validSignature) throw new Error('This server invite was changed or damaged. Ask the host for a new invite.');
    const seen = new Set();
    for (const mod of invite.mods) {
      if (!mod || typeof mod.projectId !== 'string' || !/^[A-Za-z0-9_-]{1,128}$/.test(mod.projectId) || typeof mod.versionId !== 'string' || !mod.versionId || seen.has(mod.projectId)) throw new Error('This invite contains an invalid or duplicate mod entry.');
      if (mod.sha512 && !/^[a-f0-9]{128}$/i.test(mod.sha512)) throw new Error('This invite contains an invalid mod hash.');
      seen.add(mod.projectId);
    }
    const addresses = invite.addresses.map(value => String(value || '').trim()).filter(value => value && value.length <= 253 && !/[\s/\\]/.test(value));
    if (!addresses.length) throw new Error('This invite contains no usable server address.');
    const address = addresses[0];
    return { ...invite, addresses, port: Number(invite.port), joinAddress: `${address.includes(':') ? `[${address}]` : address}:${Number(invite.port)}`, fingerprint: crypto.createHash('sha256').update(invite.publicKey).digest('hex').match(/.{1,4}/g).slice(0, 4).join('-') };
  }
  async importServerInvite(code) {
    const invite = await this.parseServerInvite(code);
    const id = crypto.randomBytes(8).toString('hex');
    const profile = { id, name: `${String(invite.name || 'Swirl server').slice(0, 32)} server`, gameVersion: invite.gameVersion, fabricLoaderVersion: typeof invite.loaderVersion === 'string' ? invite.loaderVersion : '', autoSync: false, createdAt: new Date().toISOString(), mods: [], serverAddress: invite.joinAddress, serverId: String(invite.serverId || ''), serverFingerprint: invite.fingerprint, serverRequiredMods: invite.mods.map(mod => ({ projectId: mod.projectId, versionId: mod.versionId, sha512: mod.sha512 || '' })) };
    const profiles = await this.getModProfiles();
    const target = this.instanceDirectory(profile.gameVersion, id);
    try {
      await Promise.all([this.ensure(path.join(target, 'mods')), this.ensure(path.join(target, 'saves')), this.ensure(path.join(target, 'config'))]);
      await this.atomicWrite(path.join(target, 'mods', 'icecream-mods.json'), '[]');
      profiles.push(profile); await this.saveModProfiles(profiles);
      for (const required of invite.mods) {
        await this.installModrinthMod(required.projectId, profile.gameVersion, new Set(), required.versionId, id);
        const installed = (await this.getInstalledMods(profile.gameVersion, id)).find(item => item.projectId === required.projectId);
        if (!installed) throw new Error(`Swirl could not install required mod ${required.projectId}.`);
        if (required.sha512) {
          const actual = await this.fileHash(path.join(target, 'mods', installed.file), 'sha512');
          if (actual !== required.sha512) throw new Error(`${installed.name || installed.file} did not match the server's required file.`);
        }
      }
      profile.mods = (await this.getInstalledMods(profile.gameVersion, id)).map(mod => ({ projectId: mod.projectId, versionId: mod.versionId }));
      await this.saveModProfiles(profiles); await this.writeProfileLock(id, profile.gameVersion);
      return { profile, invite };
    } catch (error) {
      await fsp.rm(target, { recursive: true, force: true });
      await this.saveModProfiles(profiles.filter(item => item.id !== id)).catch(() => {});
      throw error;
    }
  }
  async verifyServerRequirements(profile) {
    if (!profile?.serverAddress || !Array.isArray(profile.serverRequiredMods)) return true;
    const manifest = await this.getInstalledMods(profile.gameVersion, profile.id); const installed = new Map(manifest.map(mod => [mod.projectId, mod])); const modsDirectory = path.join(this.instanceDirectory(profile.gameVersion, profile.id), 'mods');
    for (const required of profile.serverRequiredMods) {
      const mod = installed.get(required.projectId); if (!mod || mod.versionId !== required.versionId) throw new Error(`This server needs an exact version of ${mod?.name || required.projectId}. Import a fresh invite from the host to repair the server profile.`);
      if (required.sha512 && await this.fileHash(path.join(modsDirectory, mod.file), 'sha512') !== required.sha512) throw new Error(`${mod.name || mod.file} does not match the server's required file. Import a fresh invite from the host.`);
    }
    return true;
  }
  async getSettings() {
    if (this.settingsCache) return { ...this.settingsCache };
    const defaults = { autoUpdate: true, fabricLoaderVersion: '', activeProfiles: {}, lastVersion: '26.2', beginnerMode: true, experimentalVersions: false, backupRetention: 5, uiScale: 1, reducedMotion: false, readableFont: false };
    if (!await this.exists(this.settingsFile())) { this.settingsCache = defaults; return { ...defaults }; }
    try { this.settingsCache = { ...defaults, ...JSON.parse(await fsp.readFile(this.settingsFile(), 'utf8')) }; } catch { this.settingsCache = defaults; } return { ...this.settingsCache };
  }
  async setSettings(settings) { const current = await this.getSettings(); const experimentalVersions = typeof settings?.experimentalVersions === 'boolean' ? settings.experimentalVersions : current.experimentalVersions === true; const saved = { ...current, autoUpdate: typeof settings?.autoUpdate === 'boolean' ? settings.autoUpdate : current.autoUpdate, beginnerMode: typeof settings?.beginnerMode === 'boolean' ? settings.beginnerMode : current.beginnerMode, experimentalVersions, backupRetention: Math.max(1, Math.min(20, Number(settings?.backupRetention ?? current.backupRetention) || 5)), uiScale: Math.max(0.8, Math.min(1.4, Number(settings?.uiScale ?? current.uiScale) || 1)), reducedMotion: typeof settings?.reducedMotion === 'boolean' ? settings.reducedMotion : current.reducedMotion === true, readableFont: typeof settings?.readableFont === 'boolean' ? settings.readableFont : current.readableFont === true, lastVersion: typeof settings?.lastVersion === 'string' && isSupportedVersion(settings.lastVersion, experimentalVersions) ? settings.lastVersion : current.lastVersion, fabricLoaderVersions: { ...(current.fabricLoaderVersions || {}), ...(settings?.fabricLoaderVersions && typeof settings.fabricLoaderVersions === 'object' ? settings.fabricLoaderVersions : {}) }, activeProfiles: settings?.replaceActiveProfiles === true ? { ...(settings.activeProfiles || {}) } : { ...(current.activeProfiles || {}), ...(settings?.activeProfiles && typeof settings.activeProfiles === 'object' ? settings.activeProfiles : {}) } }; await this.atomicWrite(this.settingsFile(), JSON.stringify(saved, null, 2)); this.settingsCache = saved; return { ...saved }; }
  async fileHash(file, algorithm = 'sha1') { const hash = crypto.createHash(algorithm); await new Promise((resolve, reject) => fs.createReadStream(file).on('data', data => hash.update(data)).on('error', reject).on('end', resolve)); return hash.digest('hex'); }
  async sha1(file) { return this.fileHash(file, 'sha1'); }
  jsonTtl(url) { if (url.includes('/version/')) return 10 * 60 * 1000; if (url.includes('version_manifest')) return 5 * 60 * 1000; if (url.includes('modrinth.com')) return 90 * 1000; return 5 * 60 * 1000; }
  fetchJson(url, redirects = 0) { if (redirects > 5) return Promise.reject(new Error('Too many redirects.')); return new Promise((resolve, reject) => {
    const request = https.get(url, { agent: DOWNLOAD_AGENT, headers: { 'User-Agent': 'Swirl-Launcher/1.0', 'Accept-Encoding': 'identity' } }, response => {
      if (response.statusCode >= 300 && response.statusCode < 400 && response.headers.location) { response.resume(); resolve(this.fetchJson(new URL(response.headers.location, url).toString(), redirects + 1)); return; }
      if (response.statusCode !== 200) { response.resume(); reject(new Error(`Request failed: ${response.statusCode} ${url}`)); return; }
      let data = ''; response.setEncoding('utf8'); response.on('data', chunk => { data += chunk; if (data.length > 10 * 1024 * 1024) request.destroy(new Error('JSON response was too large.')); }); response.on('end', () => { try { resolve(JSON.parse(data)); } catch (error) { reject(error); } });
    }); request.setTimeout(30_000, () => request.destroy(new Error(`Request timed out: ${url}`))); request.on('error', reject);
  }); }
  getJson(url) { const cached = this.jsonCache.get(url); if (cached && cached.expires > Date.now()) return Promise.resolve(cached.value); if (this.jsonInflight.has(url)) return this.jsonInflight.get(url); const request = this.fetchJson(url).then(value => { this.jsonCache.set(url, { value, expires: Date.now() + this.jsonTtl(url) }); return value; }).finally(() => this.jsonInflight.delete(url)); this.jsonInflight.set(url, request); return request; }
  async download(url, destination, expectedSha1, label, redirects = 0) {
    if (redirects > 5) throw new Error(`Too many redirects: ${label}`);
    await this.ensure(path.dirname(destination));
    const disk = await fsp.statfs(path.dirname(destination)).catch(() => null); if (disk && Number(disk.bavail) * Number(disk.bsize) < 256 * 1024 * 1024) throw new Error('Swirl needs at least 256 MB of free disk space before downloading files.');
    const expectedHash = String(expectedSha1 || '').toLowerCase(); const hashAlgorithm = expectedHash.length === 64 ? 'sha256' : 'sha1';
    if (await this.exists(destination) && (!expectedHash || await this.fileHash(destination, hashAlgorithm) === expectedHash)) return destination;
    const temporary = `${destination}.part`;
    await fsp.rm(temporary, { force: true });
    return new Promise((resolve, reject) => {
      const request = https.get(url, { agent: DOWNLOAD_AGENT, headers: { 'User-Agent': 'Swirl-Launcher/1.0', 'Accept-Encoding': 'identity' } }, response => {
        if (response.statusCode >= 300 && response.statusCode < 400 && response.headers.location) { response.resume(); this.download(new URL(response.headers.location, url).toString(), destination, expectedSha1, label, redirects + 1).then(resolve, reject); return; }
        if (response.statusCode !== 200) { response.resume(); reject(new Error(`Download failed: ${response.statusCode} ${label}`)); return; }
        const total = Number(response.headers['content-length']) || 0; if (total > 2 * 1024 * 1024 * 1024) { response.destroy(new Error(`Download is too large: ${label}`)); return; } let received = 0; const hash = expectedHash ? crypto.createHash(hashAlgorithm) : null; const output = fs.createWriteStream(temporary);
        response.on('data', chunk => { received += chunk.length; if (hash) hash.update(chunk); if (!label.startsWith('Asset ')) this.emit('download', label, received, total); });
        response.pipe(output);
        output.on('error', reject);
        output.on('finish', async () => { try { await new Promise((done, failed) => output.close(error => error ? failed(error) : done())); if (expectedHash && hash.digest('hex') !== expectedHash) throw new Error(`Checksum mismatch: ${label}`); await fsp.rename(temporary, destination); resolve(destination); } catch (error) { await fsp.rm(temporary, { force: true }); reject(error); } });
      }); request.setTimeout(60_000, () => request.destroy(new Error(`Download timed out: ${label}`))); request.on('error', reject);
    });
  }
  rulesAllow(rules, features = {}) {
    if (!rules) return true;
    let allowed = false;
    const platform = process.platform === 'win32' ? 'windows' : process.platform === 'darwin' ? 'osx' : 'linux';
    const architecture = os.arch() === 'x64' ? 'x86_64' : os.arch();
    for (const rule of rules) {
      let osVersionMatches = true; if (rule.os?.version) { try { osVersionMatches = new RegExp(rule.os.version).test(os.release()); } catch { osVersionMatches = false; } }
      const osMatches = !rule.os || ((!rule.os.name || rule.os.name === platform) && (!rule.os.arch || rule.os.arch === architecture) && osVersionMatches);
      const featureMatches = !rule.features || Object.entries(rule.features).every(([name, expected]) => Boolean(features[name]) === Boolean(expected));
      if (osMatches && featureMatches) allowed = rule.action === 'allow';
    }
    return allowed;
  }
  resolveArguments(entries, variables, features = {}) {
    const output = [];
    for (const entry of entries || []) {
      if (typeof entry === 'string') output.push(this.substitute(entry, variables));
      else if (entry && this.rulesAllow(entry.rules, features)) {
        const values = Array.isArray(entry.value) ? entry.value : [entry.value];
        for (const value of values) if (typeof value === 'string') output.push(this.substitute(value, variables));
      }
    }
    return output;
  }
  libraryPath(coordinate) { const [group, artifact, version, classifier] = coordinate.split(':'); const name = `${artifact}-${version}${classifier ? `-${classifier}` : ''}.jar`; return path.join(...group.split('.'), artifact, version, name); }
  nativeDownload(library) {
    const platform = process.platform === 'win32' ? 'windows' : process.platform === 'darwin' ? 'osx' : 'linux';
    const arch = os.arch() === 'x64' ? '64' : os.arch() === 'arm64' ? 'arm64' : '32';
    const classifier = library.natives && library.natives[platform];
    if (!classifier || !library.downloads || !library.downloads.classifiers) return undefined;
    return library.downloads.classifiers[classifier.replace('${arch}', arch)];
  }
  async extractZip(archive, destination, excludes = []) {
    const stat = await fsp.stat(archive); if (stat.size > 1024 * 1024 * 1024) throw new Error(`ZIP archive is too large: ${archive}`); const zip = await fsp.readFile(archive); let end = -1;
    for (let offset = zip.length - 22; offset >= Math.max(0, zip.length - 65557); offset -= 1) if (zip.readUInt32LE(offset) === 0x06054b50) { end = offset; break; }
    if (end < 0) throw new Error(`Invalid ZIP archive: ${archive}`);
    const entries = zip.readUInt16LE(end + 10); if (entries > 20_000) throw new Error(`ZIP archive has too many entries: ${archive}`); let cursor = zip.readUInt32LE(end + 16); let extracted = 0;
    for (let index = 0; index < entries; index += 1) {
      if (zip.readUInt32LE(cursor) !== 0x02014b50) throw new Error(`Invalid ZIP directory: ${archive}`);
      const compression = zip.readUInt16LE(cursor + 10); const compressedSize = zip.readUInt32LE(cursor + 20); const fileNameLength = zip.readUInt16LE(cursor + 28); const extraLength = zip.readUInt16LE(cursor + 30); const commentLength = zip.readUInt16LE(cursor + 32); const localOffset = zip.readUInt32LE(cursor + 42); const fileName = zip.subarray(cursor + 46, cursor + 46 + fileNameLength).toString('utf8');
      cursor += 46 + fileNameLength + extraLength + commentLength;
      if (fileName.endsWith('/') || excludes.some(prefix => fileName.startsWith(prefix))) continue;
      if (fileName.includes('..') || path.isAbsolute(fileName)) throw new Error(`Unsafe archive entry: ${fileName}`);
      if (zip.readUInt32LE(localOffset) !== 0x04034b50) throw new Error(`Invalid ZIP local entry: ${archive}`);
      const nameLength = zip.readUInt16LE(localOffset + 26); const localExtraLength = zip.readUInt16LE(localOffset + 28); const dataStart = localOffset + 30 + nameLength + localExtraLength; if (dataStart + compressedSize > zip.length) throw new Error(`Invalid ZIP entry: ${archive}`); const input = zip.subarray(dataStart, dataStart + compressedSize);
      const content = compression === 0 ? input : compression === 8 ? zlib.inflateRawSync(input) : (() => { throw new Error(`Unsupported ZIP compression method ${compression}`); })();
      extracted += content.length; if (extracted > 2 * 1024 * 1024 * 1024) throw new Error(`ZIP archive expands beyond the safety limit: ${archive}`);
      const output = path.join(destination, fileName); await this.ensure(path.dirname(output)); await fsp.writeFile(output, content);
    }
  }
  async parallelMap(items, limit, work) { const results = new Array(items.length); let next = 0; const workers = Array.from({ length: Math.min(limit, items.length) }, async () => { while (true) { const index = next; next += 1; if (index >= items.length) return; results[index] = await work(items[index], index); } }); await Promise.all(workers); return results; }
  async versionMetadata(versionId) {
    const local = path.join(this.root, 'versions', versionId, `${versionId}.json`);
    if (await this.exists(local)) { try { return JSON.parse(await fsp.readFile(local, 'utf8')); } catch {} }
    const manifest = await this.getJson(MANIFEST_URL); const entry = manifest.versions.find(version => version.id === versionId);
    if (!entry) throw new Error(`Minecraft version ${versionId} was not found in Mojang's manifest.`);
    return this.getJson(entry.url);
  }
  async downloadVersion(versionId) {
    this.emit('metadata', `Finding Minecraft ${versionId}`);
    const version = await this.versionMetadata(versionId); const versionDirectory = path.join(this.root, 'versions', versionId); await this.ensure(versionDirectory);
    await fsp.writeFile(path.join(versionDirectory, `${versionId}.json`), JSON.stringify(version, null, 2));
    const jar = path.join(versionDirectory, `${versionId}.jar`); await this.download(version.downloads.client.url, jar, version.downloads.client.sha1, 'Minecraft client');
    const libraryJobs = []; for (const library of version.libraries || []) { if (!this.rulesAllow(library.rules)) continue; const artifact = library.downloads && library.downloads.artifact; if (artifact) libraryJobs.push({ kind: 'artifact', url: artifact.url, sha1: artifact.sha1, path: artifact.path }); const native = this.nativeDownload(library); if (native) libraryJobs.push({ kind: 'native', url: native.url, sha1: native.sha1, path: native.path }); }
    const libraryFiles = await this.parallelMap(libraryJobs, 8, async job => { const file = path.join(this.root, 'libraries', job.path); await this.download(job.url, file, job.sha1, job.kind === 'native' ? 'Native library' : 'Minecraft library'); return { ...job, file }; });
    const classpath = [jar, ...libraryFiles.filter(job => job.kind === 'artifact').map(job => job.file)]; for (const native of libraryFiles.filter(job => job.kind === 'native')) await this.extractZip(native.file, path.join(versionDirectory, 'natives'), ['META-INF/']);
    const assetIndex = version.assetIndex; const indexFile = path.join(this.root, 'assets', 'indexes', `${assetIndex.id}.json`);
    await this.download(assetIndex.url, indexFile, assetIndex.sha1, `Asset index ${assetIndex.id}`);
    const index = JSON.parse(await fsp.readFile(indexFile, 'utf8')); const objects = Object.entries(index.objects || {}); let done = 0; this.emit('assets', 'Loading assets', 0, objects.length);
    await this.parallelMap(objects, 12, async ([, item]) => { const objectFile = path.join(this.root, 'assets', 'objects', item.hash.slice(0, 2), item.hash); await this.download(`https://resources.download.minecraft.net/${item.hash.slice(0, 2)}/${item.hash}`, objectFile, item.hash, 'Asset object'); done += 1; this.emit('assets', 'Loading assets', done, objects.length); });
    if (version.logging && version.logging.client && version.logging.client.file) { const log = version.logging.client.file; await this.download(log.url, path.join(this.root, 'assets', 'log_configs', log.id), log.sha1, 'Logging config'); }
    return { version, versionDirectory, classpath };
  }
  requiredJava(versionId, metadata = null) { return Number(metadata?.javaVersion?.majorVersion) || fallbackJavaMajor(versionId); }
  javaMajor(candidate) { const probe = spawnSync(candidate, ['-version'], { encoding: 'utf8' }); if (probe.error || probe.status !== 0) return 0; const text = `${probe.stdout || ''}\n${probe.stderr || ''}`; const match = text.match(/version\s+"(?:1\.)?(\d+)/); return match ? Number(match[1]) : 0; }
  findJava(required) {
    const names = process.platform === 'win32' ? ['javaw.exe', 'java.exe'] : ['java']; const homes = [process.env[`JAVA_${required}_HOME`], process.env.JAVA_HOME, path.join(this.root, 'runtime', `java-${required}`)].filter(Boolean); const candidates = [];
    for (const home of homes) for (const name of names) candidates.push(path.join(home, 'bin', name)); for (const name of names) candidates.push(name);
    const bundled = path.join(this.root, 'runtime', `java-${required}`); if (fs.existsSync(bundled)) { const stack = [bundled]; while (stack.length) { const directory = stack.pop(); for (const entry of fs.readdirSync(directory, { withFileTypes: true })) { const full = path.join(directory, entry.name); if (entry.isDirectory()) stack.push(full); else if (names.includes(entry.name)) candidates.push(full); } } }
    for (const candidate of [...new Set(candidates)]) if (this.javaMajor(candidate) >= required) return candidate;
    throw new Error(`Minecraft needs Java ${required} for this version. Install Java ${required} and set JAVA_${required}_HOME to its folder, then restart Swirl.`);
  }
  async ensureJava(required) { try { return this.findJava(required); } catch (firstError) { if (process.platform !== 'win32') throw firstError; const architecture = os.arch() === 'arm64' ? 'aarch64' : 'x64'; const runtimeRoot = path.join(this.root, 'runtime', `java-${required}`); const archive = path.join(this.root, 'runtime', `temurin-${required}-${architecture}.zip`); const assets = await this.getJson(ADOPTIUM_ASSETS(required, 'windows', architecture)); const asset = Array.isArray(assets) ? assets.find(item => item.binary?.package?.link && item.binary?.package?.checksum) : null; if (!asset) throw new Error(`No verified Temurin ${required} runtime is available for this computer.`); this.emit('runtime', `Downloading Java ${required} runtime`); await fsp.rm(runtimeRoot, { recursive: true, force: true }); await this.download(asset.binary.package.link, archive, asset.binary.package.checksum, `Java ${required} runtime`); const handle = await fsp.open(archive, 'r'); const signature = Buffer.alloc(4); await handle.read(signature, 0, 4, 0); await handle.close(); if (signature.readUInt32LE(0) !== 0x04034b50) throw new Error(`Java ${required} runtime archive was not a ZIP file. Install Temurin ${required} manually and set JAVA_${required}_HOME.`); this.emit('runtime', `Installing Java ${required} runtime`); await this.extractZip(archive, runtimeRoot); try { return this.findJava(required); } catch { throw new Error(`Swirl downloaded Java ${required}, but could not locate javaw.exe. Install Temurin ${required} manually and set JAVA_${required}_HOME.`); } } }
  async javaForVersion(versionId) { const metadata = await this.versionMetadata(versionId); const major = this.requiredJava(versionId, metadata); if (!major) throw new Error(`Swirl could not determine the Java version required by Minecraft ${versionId}.`); return { java: await this.ensureJava(major), major, metadata }; }
  javaSupports(java, flags) { const executable = process.platform === 'win32' ? java.replace(/javaw\.exe$/i, 'java.exe') : java; const probe = spawnSync(executable, [...flags, '-version'], { encoding: 'utf8', windowsHide: true }); return !probe.error && probe.status === 0; }
  memoryGiB() { const total = os.totalmem() / 1024 ** 3; if (total < 7) return 2; if (total < 11) return 3; if (total < 25) return 4; return 6; }
  substitute(value, variables) { return String(value).replace(/\$\{([^}]+)\}/g, (_, name) => variables[name] === undefined ? '' : variables[name]); }
  async installFabric(versionId, profileId = '') {
    const vanilla = await this.downloadVersion(versionId);
    this.emit('fabric', 'Installing Fabric Loader');
    const loaders = await this.getJson(`${FABRIC_META}/${versionId}`);
    const settings = await this.getSettings(); const savedProfile = profileId ? (await this.getModProfiles()).find(item => item.id === profileId) : null; const latest = loaders.find(item => item.loader && item.loader.stable) || loaders[0];
    const selectedVersion = savedProfile?.fabricLoaderVersion || settings.fabricLoaderVersions?.[versionId] || settings.fabricLoaderVersion || ''; const selected = loaders.find(item => item.loader && item.loader.version === selectedVersion);
    if (savedProfile?.serverAddress && selectedVersion && !selected) throw new Error(`This server requires Fabric Loader ${selectedVersion}, but Fabric no longer lists it for Minecraft ${versionId}. Ask the host for a new invite.`);
    const chosen = selected || latest;
    if (!chosen || !chosen.loader) throw new Error(`No Fabric Loader is available for Minecraft ${versionId}.`);
    const loaderVersion = chosen.loader.version;
    const profile = await this.getJson(`${FABRIC_META}/${versionId}/${loaderVersion}/profile/json`);
    const fabricJobs = (profile.libraries || []).filter(library => this.rulesAllow(library.rules)).map(library => { const artifact = library.downloads && library.downloads.artifact; const relative = artifact ? artifact.path : this.libraryPath(library.name); return { relative, url: artifact ? artifact.url : `${(library.url || 'https://maven.fabricmc.net/').replace(/\/$/, '')}/${relative.replace(/\\/g, '/')}`, sha1: artifact && artifact.sha1 }; });
    const fabricLibraries = await this.parallelMap(fabricJobs, 8, async job => { const file = path.join(this.root, 'libraries', job.relative); await this.download(job.url, file, job.sha1, 'Fabric library'); return file; });
    await fsp.writeFile(path.join(this.root, 'versions', `${profile.id}.json`), JSON.stringify(profile, null, 2));
    if (savedProfile && savedProfile.fabricLoaderVersion !== loaderVersion) { const profiles = await this.getModProfiles(); const target = profiles.find(item => item.id === profileId); if (target) { target.fabricLoaderVersion = loaderVersion; await this.saveModProfiles(profiles); } }
    return { vanilla, profile, classpath: [...fabricLibraries, ...vanilla.classpath] };
  }
  async searchModrinthMods(query, gameVersion) {
    const facets = JSON.stringify([[`versions:${gameVersion}`], ['categories:fabric'], ['project_type:mod']]);
    const url = `${MODRINTH_API}/search?query=${encodeURIComponent(String(query || ''))}&limit=24&index=relevance&facets=${encodeURIComponent(facets)}`;
    const response = await this.getJson(url);
    return (response.hits || []).map(hit => ({ id: hit.project_id, title: hit.title, description: hit.description, author: hit.author, icon: hit.icon_url, downloads: hit.downloads, categories: hit.categories || [] }));
  }
  async getFabricLoaders(gameVersion) {
    const loaders = await this.getJson(`${FABRIC_META}/${gameVersion}`);
    return loaders.filter(item => item.loader).slice(0, 40).map(item => ({ version: item.loader.version, stable: Boolean(item.loader.stable) }));
  }
  async getFeaturedModrinthMods(gameVersion) {
    const projects = ['sodium', 'lithium', 'ferrite-core', 'immediatelyfast', 'entityculling', 'sodium-extra', 'reeses-sodium-options', 'moreculling', 'modernfix', 'fastquit', 'lazydfu', 'dynamic-fps', 'krypton', 'fabric-api', 'modmenu'];
    const collections = [{ title: 'Recommended Mods', description: `Available performance and useful mods verified for Fabric ${gameVersion}.`, projects }];
    const data = [];
    for (const collection of collections) {
      const mods = (await this.parallelMap(collection.projects, 8, async project => { try { const [details, compatible] = await Promise.all([this.getJson(`${MODRINTH_API}/project/${encodeURIComponent(project)}`), this.modrinthVersion(project, gameVersion)]); return { id: details.id, title: details.title, description: details.description, author: details.author, icon: details.icon_url, downloads: details.downloads, recommendedVersionId: compatible.id }; } catch (error) { this.emit('mod', `Skipping unavailable recommendation for ${gameVersion}: ${project}`); return null; } })).filter(Boolean);
      data.push({ ...collection, mods });
    }
    return data;
  }
  async modrinthVersions(projectId, gameVersion) {
    const url = `${MODRINTH_API}/project/${encodeURIComponent(projectId)}/version?loaders=${encodeURIComponent('["fabric"]')}&game_versions=${encodeURIComponent(JSON.stringify([gameVersion]))}`;
    const versions = await this.getJson(url);
    return [...versions].sort((left, right) => Date.parse(right.date_published || 0) - Date.parse(left.date_published || 0));
  }
  async modrinthVersion(projectId, gameVersion) {
    const versions = await this.modrinthVersions(projectId, gameVersion);
    if (!versions.length) throw new Error(`No compatible Fabric ${gameVersion} version was found for this mod.`);
    return versions.find(version => version.version_type === 'release') || versions[0];
  }
  async getInstalledMods(gameVersion, profileId = '') {
    const manifestFile = path.join(this.instanceDirectory(gameVersion, profileId), 'mods', 'icecream-mods.json');
    if (!await this.exists(manifestFile)) return [];
    try { const mods = JSON.parse(await fsp.readFile(manifestFile, 'utf8')); if (!Array.isArray(mods)) throw new Error('manifest is not an array'); return mods; } catch (error) { throw new Error(`The installed-mod manifest is damaged (${error.message}). Restore it before changing mods.`); }
  }
  async updateAllMods(gameVersion, profileId = '') {
    return this.withProfileLock(profileId, async () => { const plan = await this.planModUpdates(gameVersion, profileId); if (!plan.length) return []; const snapshot = await this.backupModProfile(profileId); try { const updates = []; for (const item of plan) { await this.installModrinthMod(item.projectId, gameVersion, new Set(), item.toVersionId, profileId, true); updates.push(item.name); } return updates; } catch (error) { await this.restoreProfileBackup(profileId, path.basename(snapshot.destination)).catch(() => {}); throw new Error(`Updates were rolled back: ${error.message}`); } });
  }
  async planModUpdates(gameVersion, profileId = '') { const profile = (await this.getModProfiles()).find(item => item.id === profileId); if (!profile) throw new Error('That profile was not found.'); if (profile.serverAddress) throw new Error('Server profiles keep the host\'s exact mod versions. Ask the host for a new invite to update this profile.'); const installed = await this.getInstalledMods(gameVersion, profileId); const plan = []; const failures = []; await this.parallelMap(installed, 8, async mod => { try { const latest = await this.modrinthVersion(mod.projectId, gameVersion); if (latest.id === mod.versionId) return; const preview = await this.previewInstall(mod.projectId, gameVersion, latest.id); if (!preview.valid) failures.push(`${mod.name}: ${preview.errors.join(' ')}`); else plan.push({ projectId: mod.projectId, name: mod.name || latest.name || mod.projectId, fromVersionId: mod.versionId, fromVersion: mod.versionNumber || mod.versionId, toVersionId: latest.id, toVersion: latest.version_number || latest.name || latest.id }); } catch (error) { failures.push(`${mod.name}: ${error.message}`); } }); if (failures.length) throw new Error(`Update check failed. Nothing changed. ${failures.join(' ')}`); return plan.sort((a, b) => a.name.localeCompare(b.name)); }
  async previewInstall(projectId, gameVersion, versionId) { try { const version = await this.getJson(`${MODRINTH_API}/version/${encodeURIComponent(versionId)}`); if (version.project_id !== projectId || !(version.game_versions || []).includes(gameVersion) || !(version.loaders || []).includes('fabric')) return { valid: false, errors: ['A selected update is not compatible with this profile.'] }; return { valid: true, errors: [] }; } catch (error) { return { valid: false, errors: [error.message] }; } }
  async preflightMods(gameVersion, profileId = '') {
    const installed = await this.getInstalledMods(gameVersion, profileId); const errors = []; const warnings = []; const byProject = new Map(installed.map(mod => [mod.projectId, mod])); const byVersion = new Map(installed.map(mod => [mod.versionId, mod])); const versions = new Map();
    const modsDirectory = path.join(this.instanceDirectory(gameVersion, profileId), 'mods'); const managedFiles = new Set(installed.map(mod => mod.file)); const unmanaged = (await fsp.readdir(modsDirectory).catch(() => [])).filter(file => file.toLowerCase().endsWith('.jar') && !managedFiles.has(file) && !/^swirl-client-.*\.jar$/i.test(file));
    if (unmanaged.length) warnings.push(`${unmanaged.length} manually added mod${unmanaged.length === 1 ? '' : 's'} could not be checked: ${unmanaged.slice(0, 5).join(', ')}${unmanaged.length > 5 ? '…' : ''}`);
    await this.parallelMap(installed, 8, async mod => { try { const [version, project] = await Promise.all([this.getJson(`${MODRINTH_API}/version/${encodeURIComponent(mod.versionId)}`), this.getJson(`${MODRINTH_API}/project/${encodeURIComponent(mod.projectId)}`)]); versions.set(mod.projectId, version); if (!(version.game_versions || []).includes(gameVersion)) errors.push(`${mod.name} (${mod.versionNumber || mod.versionId}) does not support Minecraft ${gameVersion}.`); if (!(version.loaders || []).includes('fabric')) errors.push(`${mod.name} (${mod.versionNumber || mod.versionId}) is not a Fabric build.`); if (project.client_side === 'unsupported') errors.push(`${mod.name} is server-only and cannot be installed in a client profile.`); } catch (error) { errors.push(`Swirl could not verify ${mod.name} (${mod.versionId}): ${error.message}`); } });
    for (const mod of installed) {
      const version = versions.get(mod.projectId); if (!version) continue;
      for (const dependency of version.dependencies || []) {
        if (dependency.dependency_type === 'required') {
          if (dependency.project_id && !byProject.has(dependency.project_id)) errors.push(`${mod.name} requires a missing Modrinth dependency (${dependency.project_id}).`);
          if (dependency.version_id && !byVersion.has(dependency.version_id)) errors.push(`${mod.name} requires a specific dependency version (${dependency.version_id}) that is not installed.`);
        }
        if (dependency.dependency_type === 'incompatible') {
          const conflict = (dependency.project_id && byProject.get(dependency.project_id)) || (dependency.version_id && byVersion.get(dependency.version_id));
          if (conflict) errors.push(`${mod.name} is marked incompatible with installed mod ${conflict.name}.`);
        }
        if (dependency.dependency_type === 'optional' && dependency.project_id && !byProject.has(dependency.project_id)) warnings.push(`${mod.name} has an optional integration that is not installed.`);
      }
    }
    return { errors: [...new Set(errors)], warnings: [...new Set(warnings)], checked: installed.length };
  }
  async installModrinthMod(projectId, gameVersion, visited = new Set(), requestedVersionId = '', profileId = '', locked = false) {
    if (!locked) return this.withProfileLock(profileId, () => this.installModrinthMod(projectId, gameVersion, visited, requestedVersionId, profileId, true));
    if (visited.has(projectId)) return []; visited.add(projectId);
    const version = requestedVersionId ? await this.getJson(`${MODRINTH_API}/version/${encodeURIComponent(requestedVersionId)}`) : await this.modrinthVersion(projectId, gameVersion); const installed = [];
    if (version.project_id !== projectId || !(version.game_versions || []).includes(gameVersion) || !(version.loaders || []).includes('fabric')) throw new Error(`This version is not compatible with Fabric ${gameVersion}.`);
    for (const dependency of version.dependencies || []) {
      if (dependency.dependency_type !== 'required') continue;
      if (dependency.version_id) {
        const dependencyVersion = await this.getJson(`${MODRINTH_API}/version/${dependency.version_id}`);
        const dependencyProject = dependencyVersion.project_id;
        installed.push(...await this.installModrinthMod(dependencyProject, gameVersion, visited, dependency.version_id, profileId, true));
      } else if (dependency.project_id) installed.push(...await this.installModrinthMod(dependency.project_id, gameVersion, visited, '', profileId, true));
    }
    const file = (version.files || []).find(candidate => candidate.primary) || version.files[0];
    if (!file) throw new Error('The selected Modrinth version contains no downloadable file.');
    const modsDirectory = path.join(this.instanceDirectory(gameVersion, profileId), 'mods'); await this.ensure(modsDirectory); const manifestFile = path.join(modsDirectory, 'icecream-mods.json'); const manifest = await this.getInstalledMods(gameVersion, profileId); const previous = manifest.find(entry => entry.projectId === projectId);
    const destination = path.join(modsDirectory, path.basename(new URL(file.url).pathname));
    this.emit('mod', `Installing ${version.name || projectId}`); await this.download(file.url, destination, file.hashes && file.hashes.sha1, version.name || projectId);
    if (previous && previous.file !== path.basename(destination)) await fsp.rm(path.join(modsDirectory, previous.file), { force: true });
    const nextManifest = manifest.filter(entry => entry.projectId !== projectId); nextManifest.push({ projectId, versionId: version.id, versionNumber: version.version_number || version.name, file: path.basename(destination), name: version.name || projectId, sha1: file.hashes?.sha1 || '', sha512: file.hashes?.sha512 || await this.fileHash(destination, 'sha512') });
    await this.atomicWrite(manifestFile, JSON.stringify(nextManifest, null, 2)); const profiles = await this.getModProfiles(); const saved = profiles.find(item => item.id === profileId); if (saved) { saved.mods = nextManifest.map(item => ({ projectId: item.projectId, versionId: item.versionId })); await this.saveModProfiles(profiles); } await this.writeProfileLock(profileId, gameVersion); installed.push({ projectId, name: version.name || projectId }); return installed;
  }
  async launchGame(username, versionId, profile = {}, modProfile = null) {
    if (!/^[a-zA-Z0-9_]{3,16}$/.test(username)) throw new Error('Minecraft requires a player name with 3–16 letters, numbers, or underscores.');
    if (!modProfile) throw new Error('Choose or create a profile before launching. Profiles keep saves, mods, and configuration separate.');
    if (modProfile && modProfile.gameVersion !== versionId) throw new Error(`The selected profile is for Minecraft ${modProfile.gameVersion}. Switch the Minecraft version or choose another profile.`);
    const profileId = modProfile?.id || ''; await this.repairModProfile(profileId, false); await this.verifyServerRequirements(modProfile); await this.ensureWorldUpgradeBackup(modProfile); await this.installBundledClientMod(versionId, profileId); const autoSync = modProfile ? modProfile.autoSync === true : false; if (autoSync) { this.emit('mod', 'Checking installed mods for updates'); await this.updateAllMods(versionId, profileId); }
    this.emit('compatibility', 'Checking installed mods for compatibility'); const compatibility = await this.preflightMods(versionId, profileId);
    if (compatibility.errors.length) throw new Error(`Launch blocked by mod incompatibilities: ${compatibility.errors.join(' ')}`);
    if (compatibility.warnings.length) this.emit('compatibility', `Compatibility check passed with warnings: ${compatibility.warnings.join(' ')}`);
    else this.emit('compatibility', `Compatibility check passed for ${compatibility.checked} installed mod${compatibility.checked === 1 ? '' : 's'}.`);
    await this.verifyProfileLock(profileId, versionId); const installed = await this.installFabric(versionId, profileId); const { vanilla, profile: fabric, classpath } = installed; const { version, versionDirectory } = vanilla; await this.writeProfileLock(profileId, versionId);
    const runtime = await this.javaForVersion(versionId); const java = runtime.java; const requiredJava = runtime.major; const gameDir = this.instanceDirectory(versionId, profileId); const assetsDir = path.join(this.root, 'assets'); const nativesDir = path.join(versionDirectory, 'natives'); await this.ensure(gameDir); await this.ensure(nativesDir);
    const directServer = String(modProfile?.serverAddress || '');
    const variables = { auth_player_name: username, version_name: fabric.id, game_directory: gameDir, assets_root: assetsDir, assets_index_name: version.assetIndex.id, auth_uuid: profile.uuid || '00000000000000000000000000000000', auth_access_token: profile.accessToken || 'icecream-local-test-token', auth_xuid: profile.xuid || '', clientid: profile.clientId || '', user_type: 'msa', version_type: version.type, natives_directory: nativesDir, launcher_name: LAUNCHER_NAME, launcher_version: LAUNCHER_VERSION, classpath: classpath.join(path.delimiter), classpath_separator: path.delimiter, library_directory: path.join(this.root, 'libraries'), user_properties: '{}', resolution_width: '1280', resolution_height: '720', quickPlayMultiplayer: directServer, quickPlayPath: '' };
    const features = { is_demo_user: false, has_custom_resolution: false, has_quick_plays_support: Boolean(directServer), is_quick_play_singleplayer: false, is_quick_play_multiplayer: Boolean(directServer), is_quick_play_realms: false };
    const memoryGiB = this.memoryGiB(); const gc = requiredJava >= 25 && this.javaSupports(java, ['-XX:+UseZGC']) ? ['-XX:+UseZGC'] : ['-XX:+UseG1GC'];
    const metadataJvm = [...this.resolveArguments(version.arguments?.jvm, variables, features), ...this.resolveArguments(fabric.arguments?.jvm, variables, features)];
    const jvm = [`-Xms${Math.min(1, memoryGiB)}G`, `-Xmx${memoryGiB}G`, ...gc, '-XX:+DisableExplicitGC', '-Dlog4j2.formatMsgNoLookups=true', ...metadataJvm];
    if (!jvm.some(argument => argument.startsWith('-Djava.library.path='))) jvm.push(`-Djava.library.path=${nativesDir}`);
    if (!jvm.includes('-cp') && !jvm.includes('-classpath')) jvm.push('-cp', variables.classpath);
    if (version.logging?.client?.argument && version.logging.client.file) jvm.push(this.substitute(version.logging.client.argument, { path: path.join(assetsDir, 'log_configs', version.logging.client.file.id) }));
    let game = [...this.resolveArguments(version.arguments?.game, variables, features), ...this.resolveArguments(fabric.arguments?.game, variables, features)];
    if (!game.length) game = ['--username', username, '--version', fabric.id, '--gameDir', gameDir, '--assetsDir', assetsDir, '--assetIndex', version.assetIndex.id, '--uuid', variables.auth_uuid, '--accessToken', variables.auth_access_token, '--userType', 'msa', '--versionType', version.type];
    if (directServer && isCalendarRelease(versionId) && !game.includes('--quickPlayMultiplayer')) game.push('--quickPlayMultiplayer', directServer);
    const crashDirectory = path.join(this.root, 'crash-reports'); await this.ensure(crashDirectory); const stamp = new Date().toISOString().replace(/[:.]/g, '-'); const logFile = path.join(crashDirectory, `${stamp}-${versionId}.log`); const reportFile = path.join(crashDirectory, `${stamp}-${versionId}.json`); const logStream = fs.createWriteStream(logFile, { flags: 'a' }); const command = [...jvm, fabric.mainClass, ...game]; const safeCommand = [java, ...command].map((part, index, all) => all[index - 1] === '--accessToken' ? '<redacted>' : part); await this.atomicWrite(reportFile, JSON.stringify({ startedAt: new Date().toISOString(), minecraftVersion: versionId, fabricVersion: fabric.id, java, javaMajor: requiredJava, memoryGiB, garbageCollector: gc[0], gameDirectory: gameDir, profile: modProfile ? { id: modProfile.id, name: modProfile.name } : null, mods: compatibility.checked, command: safeCommand }, null, 2));
    this.emit('launch', 'Starting Fabric Minecraft'); const child = spawn(java, command, { cwd: gameDir, detached: true, stdio: ['ignore', logStream, logStream] }); child.unref();
    child.on('error', error => this.emit('error', error.message)); child.on('exit', (code, signal) => { logStream.end(); if (code && code !== 0) this.emit('error', `Minecraft closed unexpectedly. Crash details: ${reportFile}`); }); return { pid: child.pid, gameDir, java, crashReport: reportFile };
  }
}
module.exports = IcecreamEngine;
