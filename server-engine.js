const fs = require('fs');
const fsp = fs.promises;
const path = require('path');
const https = require('https');
const crypto = require('crypto');
const net = require('net');
const os = require('os');
const { spawn, spawnSync } = require('child_process');
const { isCalendarRelease, isStableSupportedVersion } = require('./version-policy');

const ID = /^[a-f0-9]{16}$/;
const MAX_LOG_BYTES = 512 * 1024;
const MAX_DOWNLOAD_BYTES = 512 * 1024 * 1024;
const MODRINTH_API = 'https://api.modrinth.com/v2';

class IcecreamServerEngine {
  constructor(appData, resolveRuntime, emit = () => {}) {
    this.root = path.join(appData, '.icecream_client', 'servers');
    this.resolveRuntime = resolveRuntime;
    this.emit = emit;
    this.running = new Map();
    this.states = new Map();
    this.operationQueues = new Map();
    this.logQueues = new Map();
    this.consoleBuffers = new Map();
    this.backupRetention = 5;
  }

  file() { return path.join(this.root, 'servers.json'); }
  dir(id) { if (!ID.test(String(id))) throw new Error('Invalid server id.'); return path.join(this.root, id); }
  modsDir(id) { return path.join(this.dir(id), 'mods'); }
  backupRoot(id) { return path.join(this.root, 'backups', id); }
  modsManifest(id) { return path.join(this.modsDir(id), 'swirl-server-mods.json'); }
  lockFile(id) { return path.join(this.dir(id), 'swirl-server.lock.json'); }
  logFile(id) { return path.join(this.dir(id), 'logs', 'icecream-host.log'); }
  state(id, state, message = '') {
    this.states.set(id, { state, message, updatedAt: new Date().toISOString() });
    this.emit({ type: 'status', id, state, message });
  }
  async withQueue(key, work) {
    const previous = this.operationQueues.get(key) || Promise.resolve();
    let release;
    const current = new Promise(resolve => { release = resolve; });
    const tail = previous.then(() => current);
    this.operationQueues.set(key, tail);
    await previous;
    try { return await work(); }
    finally { release(); if (this.operationQueues.get(key) === tail) this.operationQueues.delete(key); }
  }
  withRegistryLock(work) { return this.withQueue('registry', work); }
  withServerLock(id, work) { return this.withQueue(`server:${id}`, work); }
  async atomicWrite(file, data) {
    await fsp.mkdir(path.dirname(file), { recursive: true });
    const temporary = `${file}.${process.pid}.${crypto.randomBytes(5).toString('hex')}.tmp`;
    const handle = await fsp.open(temporary, 'wx');
    try { await handle.writeFile(data, 'utf8'); await handle.sync(); }
    finally { await handle.close(); }
    try { await fsp.rename(temporary, file); }
    catch (error) { await fsp.rm(temporary, { force: true }).catch(() => {}); throw error; }
  }
  async ensureDiskSpace(directory, neededBytes, purpose) { if (typeof fsp.statfs !== 'function') return; try { await fsp.mkdir(directory, { recursive: true }); const stats = await fsp.statfs(directory); const free = Number(stats.bavail) * Number(stats.bsize); if (Number.isFinite(free) && free < neededBytes) throw new Error(`Not enough free disk space to ${purpose}. Free at least ${Math.ceil((neededBytes - free) / 1024 / 1024)} MB and try again.`); } catch (error) { if (/Not enough free disk space/.test(error.message)) throw error; } }
  offlineUuid(name) {
    const bytes = crypto.createHash('md5').update(`OfflinePlayer:${name}`, 'utf8').digest();
    bytes[6] = (bytes[6] & 0x0f) | 0x30; bytes[8] = (bytes[8] & 0x3f) | 0x80;
    const hex = bytes.toString('hex'); return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20)}`;
  }

  async json(url, redirects = 0) {
    if (redirects > 4) throw new Error('Too many redirects while downloading server metadata.');
    return new Promise((resolve, reject) => {
      const request = https.get(url, { headers: { 'User-Agent': 'Swirl-Launcher/1.0' } }, response => {
        if (response.statusCode >= 300 && response.statusCode < 400 && response.headers.location) {
          response.resume(); resolve(this.json(new URL(response.headers.location, url).toString(), redirects + 1)); return;
        }
        if (response.statusCode !== 200) { response.resume(); reject(new Error(`Server metadata failed (${response.statusCode}).`)); return; }
        let data = '';
        response.setEncoding('utf8');
        response.on('data', chunk => { data += chunk; if (data.length > 2 * 1024 * 1024) request.destroy(new Error('Server metadata was too large.')); });
        response.on('end', () => { try { resolve(JSON.parse(data)); } catch { reject(new Error('Server metadata was invalid.')); } });
      });
      request.setTimeout(30_000, () => request.destroy(new Error('Server metadata timed out.')));
      request.on('error', reject);
    });
  }

  async download(url, destination, redirects = 0) {
    if (redirects > 4) throw new Error('Too many redirects while downloading the Fabric server launcher.');
    await fsp.mkdir(path.dirname(destination), { recursive: true });
    const temp = `${destination}.part`;
    await fsp.rm(temp, { force: true });
    return new Promise((resolve, reject) => {
      const fail = async error => { await fsp.rm(temp, { force: true }).catch(() => {}); reject(error); };
      const request = https.get(url, { headers: { 'User-Agent': 'Swirl-Launcher/1.0' } }, response => {
        if (response.statusCode >= 300 && response.statusCode < 400 && response.headers.location) {
          response.resume(); resolve(this.download(new URL(response.headers.location, url).toString(), destination, redirects + 1)); return;
        }
        if (response.statusCode !== 200) { response.resume(); fail(new Error(`Server download failed (${response.statusCode}).`)); return; }
        const declared = Number(response.headers['content-length'] || 0);
        if (declared > MAX_DOWNLOAD_BYTES) { response.resume(); fail(new Error('The Fabric server download was unexpectedly large.')); return; }
        const hash = crypto.createHash('sha256'); let received = 0;
        const out = fs.createWriteStream(temp, { flags: 'wx' });
        response.on('data', chunk => { received += chunk.length; if (received > MAX_DOWNLOAD_BYTES) request.destroy(new Error('The Fabric server download exceeded its safety limit.')); else hash.update(chunk); });
        response.pipe(out);
        out.on('error', fail);
        response.on('error', fail);
        out.on('finish', async () => {
          try {
            await new Promise((done, failed) => out.close(error => error ? failed(error) : done()));
            const signature = Buffer.alloc(4);
            const handle = await fsp.open(temp, 'r'); await handle.read(signature, 0, 4, 0); await handle.close();
            if (signature.readUInt32LE(0) !== 0x04034b50) throw new Error('Fabric returned an invalid server launcher file.');
            await fsp.rename(temp, destination);
            await fsp.writeFile(`${destination}.sha256`, `${hash.digest('hex')}\n`, 'utf8');
            resolve();
          } catch (error) { fail(error); }
        });
      });
      request.setTimeout(90_000, () => request.destroy(new Error('Server download timed out.')));
      request.on('error', fail);
    });
  }
  async validDownloadedJar(file) {
    try {
      const expected = (await fsp.readFile(`${file}.sha256`, 'utf8')).trim().toLowerCase(); if (!/^[a-f0-9]{64}$/.test(expected)) return false;
      const hash = crypto.createHash('sha256'); await new Promise((resolve, reject) => fs.createReadStream(file).on('data', chunk => hash.update(chunk)).on('error', reject).on('end', resolve));
      return hash.digest('hex') === expected;
    } catch { return false; }
  }
  async hashFile(file, algorithm = 'sha512') { const hash = crypto.createHash(algorithm); await new Promise((resolve, reject) => fs.createReadStream(file).on('data', chunk => hash.update(chunk)).on('error', reject).on('end', resolve)); return hash.digest('hex'); }
  async downloadMod(url, destination, expectedSha512, expectedSize = 0, redirects = 0) {
    if (redirects > 5) throw new Error('Too many redirects while downloading a server mod.');
    await fsp.mkdir(path.dirname(destination), { recursive: true }); const temporary = `${destination}.part`; await fsp.rm(temporary, { force: true });
    return new Promise((resolve, reject) => { const request = https.get(url, { headers: { 'User-Agent': 'Swirl-Launcher/1.0', 'Accept-Encoding': 'identity' } }, response => {
      if (response.statusCode >= 300 && response.statusCode < 400 && response.headers.location) { response.resume(); this.downloadMod(new URL(response.headers.location, url).toString(), destination, expectedSha512, expectedSize, redirects + 1).then(resolve, reject); return; }
      if (response.statusCode !== 200) { response.resume(); reject(new Error(`Server mod download failed (${response.statusCode}).`)); return; }
      const declared = Number(response.headers['content-length'] || 0); const limit = Math.min(MAX_DOWNLOAD_BYTES, Math.max(16 * 1024 * 1024, Number(expectedSize) * 2 || 0));
      if (declared && declared > limit) { response.resume(); reject(new Error('The server mod download was unexpectedly large.')); return; }
      const hash = crypto.createHash('sha512'); let received = 0; const output = fs.createWriteStream(temporary, { flags: 'wx' }); response.on('data', chunk => { received += chunk.length; if (received > limit) request.destroy(new Error('The server mod exceeded its safety limit.')); else hash.update(chunk); }); response.pipe(output); output.on('error', reject); response.on('error', reject); output.on('finish', async () => { try { await new Promise((done, failed) => output.close(error => error ? failed(error) : done())); if (expectedSize && received !== Number(expectedSize)) throw new Error('The downloaded server mod had the wrong size.'); const actual = hash.digest('hex'); if (expectedSha512 && actual !== expectedSha512) throw new Error('The downloaded server mod failed its SHA-512 check.'); await fsp.rm(destination, { force: true }); await fsp.rename(temporary, destination); resolve(actual); } catch (error) { await fsp.rm(temporary, { force: true }); reject(error); } });
    }); request.setTimeout(90_000, () => request.destroy(new Error('Server mod download timed out.'))); request.on('error', reject); });
  }
  async installedMods(id) { const server = (await this.rawList()).find(item => item.id === id); if (!server) throw new Error('Server not found.'); try { const value = JSON.parse(await fsp.readFile(this.modsManifest(id), 'utf8')); if (!Array.isArray(value)) throw new Error('not-array'); return value; } catch (error) { if (error.code === 'ENOENT') return []; throw new Error('The server mod list is damaged. Restore a backup before changing mods.'); } }
  async searchMods(id, query) { const server = (await this.rawList()).find(item => item.id === id); if (!server) throw new Error('Server not found.'); const facets = JSON.stringify([[`versions:${server.version}`], ['categories:fabric'], ['project_type:mod']]); const response = await this.json(`${MODRINTH_API}/search?query=${encodeURIComponent(String(query || '').slice(0, 100))}&limit=24&facets=${encodeURIComponent(facets)}`); return (response.hits || []).filter(hit => hit.server_side !== 'unsupported').map(hit => ({ id: hit.project_id, title: hit.title, description: hit.description, icon: hit.icon_url, downloads: hit.downloads })); }
  async modVersions(projectId, gameVersion) { const versions = await this.json(`${MODRINTH_API}/project/${encodeURIComponent(projectId)}/version?loaders=${encodeURIComponent('["fabric"]')}&game_versions=${encodeURIComponent(JSON.stringify([gameVersion]))}`); return [...versions].sort((a, b) => Date.parse(b.date_published || 0) - Date.parse(a.date_published || 0)); }
  async installMod(id, projectId, requestedVersionId = '', visited = new Set(), locked = false) {
    if (this.running.has(id)) throw new Error('Stop the server before changing mods.');
    if (!locked) return this.withServerLock(id, async () => { const snapshot = await this.backup(id, this.backupRetention, true); try { return await this.installMod(id, projectId, requestedVersionId, visited, true); } catch (error) { await this.restoreBackup(id, path.basename(snapshot.destination), true).catch(() => {}); throw new Error(`Nothing was changed because installation failed: ${error.message}`); } });
    if (visited.has(projectId)) return []; visited.add(projectId); const server = (await this.rawList()).find(item => item.id === id); if (!server) throw new Error('Server not found.');
    const [project, candidates] = await Promise.all([this.json(`${MODRINTH_API}/project/${encodeURIComponent(projectId)}`), this.modVersions(projectId, server.version)]); if (project.server_side === 'unsupported') throw new Error(`${project.title || projectId} is client-only and cannot be added to a server.`);
    const version = requestedVersionId ? await this.json(`${MODRINTH_API}/version/${encodeURIComponent(requestedVersionId)}`) : candidates.find(item => item.version_type === 'release') || candidates[0]; if (!version || version.project_id !== projectId || !(version.game_versions || []).includes(server.version) || !(version.loaders || []).includes('fabric')) throw new Error(`No compatible Fabric ${server.version} server version exists for ${project.title || projectId}.`);
    const installed = []; for (const dependency of version.dependencies || []) { if (dependency.dependency_type !== 'required') continue; if (dependency.version_id) { const dependency = await this.json(`${MODRINTH_API}/version/${encodeURIComponent(dependency.version_id)}`); installed.push(...await this.installMod(id, dependency.project_id, dependency.id, visited, true)); } else if (dependency.project_id) installed.push(...await this.installMod(id, dependency.project_id, '', visited, true)); }
    const manifest = await this.installedMods(id); const byProject = new Map(manifest.map(item => [item.projectId, item]));
    for (const dependency of version.dependencies || []) if (dependency.dependency_type === 'incompatible') { const conflict = dependency.project_id && byProject.get(dependency.project_id); if (conflict) throw new Error(`${project.title || projectId} is incompatible with ${conflict.name || conflict.projectId}.`); }
    const file = (version.files || []).find(item => item.primary) || version.files?.[0]; if (!file?.url || !file.hashes?.sha512) throw new Error('Modrinth did not provide a verifiable server mod file.'); const safeName = `${projectId}-${path.basename(new URL(file.url).pathname)}`.replace(/[^a-zA-Z0-9._+-]/g, '_'); const destination = path.join(this.modsDir(id), safeName); const previous = manifest.find(item => item.projectId === projectId); const sha512 = await this.downloadMod(file.url, destination, file.hashes.sha512, file.size); if (previous && previous.file !== safeName) await fsp.rm(path.join(this.modsDir(id), previous.file), { force: true }); const next = manifest.filter(item => item.projectId !== projectId); next.push({ projectId, versionId: version.id, versionNumber: version.version_number || version.name, name: project.title || version.name || projectId, file: safeName, sha512, clientSide: project.client_side || 'unknown', serverSide: project.server_side || 'unknown', dependencies: (version.dependencies || []).filter(item => item.dependency_type === 'required').map(item => ({ projectId: item.project_id || '', versionId: item.version_id || '' })) }); await this.atomicWrite(this.modsManifest(id), JSON.stringify(next, null, 2)); await this.writeLock(id); installed.push({ projectId, name: project.title || projectId }); return installed;
  }
  async removeMod(id, projectId) { if (this.running.has(id)) throw new Error('Stop the server before changing mods.'); return this.withServerLock(id, async () => { const manifest = await this.installedMods(id); const selected = manifest.find(item => item.projectId === projectId); if (!selected) throw new Error('That mod is not installed on this server.'); const dependent = manifest.find(item => item.projectId !== projectId && (item.dependencies || []).some(dep => dep.projectId === projectId || (dep.versionId && dep.versionId === selected.versionId))); if (dependent) throw new Error(`${selected.name} is required by ${dependent.name}. Remove the dependent mod first.`); await this.backup(id, this.backupRetention, true); await fsp.rm(path.join(this.modsDir(id), selected.file), { force: true }); await this.atomicWrite(this.modsManifest(id), JSON.stringify(manifest.filter(item => item.projectId !== projectId), null, 2)); await this.writeLock(id); return selected; }); }
  async updateMods(id) { if (this.running.has(id)) throw new Error('Stop the server before updating mods.'); return this.withServerLock(id, async () => { const server = (await this.rawList()).find(item => item.id === id); const installed = await this.installedMods(id); const plan = []; for (const mod of installed) { const versions = await this.modVersions(mod.projectId, server.version); const latest = versions.find(item => item.version_type === 'release') || versions[0]; if (latest && latest.id !== mod.versionId) plan.push({ mod, latest }); } if (!plan.length) return []; const snapshot = await this.backup(id, this.backupRetention, true); try { const updated = []; for (const item of plan) { await this.installMod(id, item.mod.projectId, item.latest.id, new Set(), true); updated.push(item.mod.name); } return updated; } catch (error) { await this.restoreBackup(id, path.basename(snapshot.destination), true).catch(() => {}); throw new Error(`Updates were rolled back: ${error.message}`); } }); }
  async writeLock(id) { const server = (await this.rawList()).find(item => item.id === id); if (!server) throw new Error('Server not found.'); const mods = await this.installedMods(id); const locked = []; for (const mod of mods) { const file = path.join(this.modsDir(id), mod.file); if (!fs.existsSync(file)) throw new Error(`Missing server mod file: ${mod.file}`); locked.push({ ...mod, sha512: mod.sha512 || await this.hashFile(file) }); } let loader = {}; try { loader = JSON.parse(await fsp.readFile(path.join(this.dir(id), 'swirl-loader.json'), 'utf8')); } catch {} const lock = { format: 2, serverId: id, gameVersion: server.version, loaderVersion: loader.loaderVersion || '', generatedAt: new Date().toISOString(), mods: locked.sort((a, b) => a.projectId.localeCompare(b.projectId)) }; await this.atomicWrite(this.lockFile(id), JSON.stringify(lock, null, 2)); return lock; }
  async verifyLock(id) { if (!fs.existsSync(this.lockFile(id))) return this.writeLock(id); const lock = JSON.parse(await fsp.readFile(this.lockFile(id), 'utf8')); const server = (await this.rawList()).find(item => item.id === id); const mods = await this.installedMods(id); if (lock.gameVersion !== server.version || lock.mods?.length !== mods.length) throw new Error('The server mod lockfile does not match this server.'); let loader = {}; try { loader = JSON.parse(await fsp.readFile(path.join(this.dir(id), 'swirl-loader.json'), 'utf8')); } catch {} if (lock.loaderVersion && loader.loaderVersion && lock.loaderVersion !== loader.loaderVersion) throw new Error('The Fabric Loader pin does not match the server lockfile. Restore the original loader or a backup.'); const managed = new Set(mods.map(mod => mod.file)); const unmanaged = (await fsp.readdir(this.modsDir(id)).catch(() => [])).filter(name => name.toLowerCase().endsWith('.jar') && !managed.has(name)); if (unmanaged.length) throw new Error(`Unmanaged server mod files are not allowed: ${unmanaged.join(', ')}. Add them through Manage mods.`); for (const mod of mods) { const pinned = lock.mods.find(item => item.projectId === mod.projectId); if (!pinned || pinned.versionId !== mod.versionId || await this.hashFile(path.join(this.modsDir(id), mod.file)) !== pinned.sha512) throw new Error(`${mod.name || mod.projectId} does not match the server lockfile.`); } if (!lock.loaderVersion && loader.loaderVersion) { lock.loaderVersion = loader.loaderVersion; await this.atomicWrite(this.lockFile(id), JSON.stringify(lock, null, 2)); } return lock; }

  async list() {
    try {
      const data = JSON.parse(await fsp.readFile(this.file(), 'utf8'));
      if (!Array.isArray(data)) throw new Error('not-array');
      return data.map(server => ({ ...server, runtime: this.states.get(server.id) || { state: 'stopped', message: 'Ready to start.' } }));
    } catch (error) {
      if (error.code === 'ENOENT') return [];
      const backup = `${this.file()}.damaged-${Date.now()}.json`;
      await fsp.rename(this.file(), backup).catch(() => {});
      throw new Error('Your server list was damaged and was backed up. Create a server again.');
    }
  }

  async rawList() { const list = await this.list(); return list.map(({ runtime, ...server }) => server); }
  async save(list) {
    await fsp.mkdir(this.root, { recursive: true });
    await this.atomicWrite(this.file(), JSON.stringify(list, null, 2));
  }

  async directorySize(directory) { let total = 0; const queue = [directory]; while (queue.length) { const current = queue.pop(); for (const entry of await fsp.readdir(current, { withFileTypes: true }).catch(() => [])) { const file = path.join(current, entry.name); if (entry.isDirectory()) queue.push(file); else if (entry.isFile()) total += Number((await fsp.stat(file).catch(() => null))?.size || 0); } } return total; }
  async listBackups(id) { const server = (await this.rawList()).find(item => item.id === id); if (!server) throw new Error('Server not found.'); const entries = await fsp.readdir(this.backupRoot(id), { withFileTypes: true }).catch(() => []); const backups = []; for (const entry of entries.filter(item => item.isDirectory())) { const directory = path.join(this.backupRoot(id), entry.name); if (!fs.existsSync(path.join(directory, 'server.properties'))) continue; const stat = await fsp.stat(directory); backups.push({ id: entry.name, createdAt: stat.birthtime.toISOString(), modifiedAt: stat.mtime.toISOString(), size: await this.directorySize(directory) }); } return backups.sort((a, b) => b.id.localeCompare(a.id)); }
  async pruneBackups(id, retention = 5) { const keep = Math.max(1, Math.min(20, Number(retention) || 5)); const backups = await this.listBackups(id); for (const backup of backups.slice(keep)) await fsp.rm(path.join(this.backupRoot(id), backup.id), { recursive: true, force: true }); }
  async backup(id, retention = 5, locked = false) { if (this.running.has(id)) throw new Error('Stop the server before making a backup.'); if (!locked) return this.withServerLock(id, () => this.backup(id, retention, true)); const server = (await this.rawList()).find(item => item.id === id); if (!server) throw new Error('Server not found.'); await this.verifyLock(id); const estimated = await this.directorySize(this.dir(id)); await this.ensureDiskSpace(this.root, Math.ceil(estimated * 1.1) + 128 * 1024 * 1024, 'make the server backup'); const stamp = `${new Date().toISOString().replace(/[:.]/g, '-')}-${crypto.randomBytes(2).toString('hex')}`; const destination = path.join(this.backupRoot(id), stamp); await fsp.mkdir(path.dirname(destination), { recursive: true }); await fsp.cp(this.dir(id), destination, { recursive: true, errorOnExist: true, filter: source => !source.endsWith('icecream-host.log') && !source.endsWith('.part') && !source.endsWith('fabric-server-launch.jar') }); await this.pruneBackups(id, retention); return { destination, createdAt: stamp }; }
  async restoreBackup(id, backupId, locked = false) { if (this.running.has(id)) throw new Error('Stop the server before restoring a backup.'); if (!locked) return this.withServerLock(id, () => this.restoreBackup(id, backupId, true)); const backup = (await this.listBackups(id)).find(item => item.id === backupId); if (!backup) throw new Error('That server backup no longer exists.'); const current = this.dir(id); const safety = path.join(this.root, 'trash', `${id}-before-restore-${Date.now()}`); await fsp.mkdir(path.dirname(safety), { recursive: true }); if (fs.existsSync(current)) await fsp.rename(current, safety); try { await fsp.cp(path.join(this.backupRoot(id), backup.id), current, { recursive: true }); await this.verifyLock(id); return { restoredFrom: backup.id, safety }; } catch (error) { await fsp.rm(current, { recursive: true, force: true }); if (fs.existsSync(safety)) await fsp.rename(safety, current); throw new Error(`The backup was not restored because its integrity check failed: ${error.message}`); } }
  async deleteBackup(id, backupId) { const backup = (await this.listBackups(id)).find(item => item.id === backupId); if (!backup) throw new Error('That server backup no longer exists.'); await fsp.rm(path.join(this.backupRoot(id), backup.id), { recursive: true, force: true }); return true; }
  async ensureWorldUpgradeBackup(server) {
    if (!isCalendarRelease(server.version)) return null;
    const world = path.join(this.dir(server.id), 'world'); const marker = path.join(this.dir(server.id), '.swirl-world-upgrade.json');
    if (!fs.existsSync(world) || fs.existsSync(marker)) return null;
    const stamp = new Date().toISOString().replace(/[:.]/g, '-'); const destination = path.join(this.root, 'backups', server.id, `before-${server.version}-${stamp}`);
    await fsp.mkdir(destination, { recursive: true }); await fsp.cp(world, path.join(destination, 'world'), { recursive: true, errorOnExist: true });
    await fsp.writeFile(marker, JSON.stringify({ targetVersion: server.version, backedUpAt: new Date().toISOString(), destination }, null, 2), 'utf8'); return { destination };
  }
  async remove(id) { if (this.running.has(id)) throw new Error('Stop the server before deleting it.'); return this.withRegistryLock(async () => this.withServerLock(id, async () => { const list = await this.rawList(); const server = list.find(item => item.id === id); if (!server) throw new Error('Server not found.'); const destination = path.join(this.root, 'trash', `${id}-${Date.now()}`); await fsp.mkdir(path.dirname(destination), { recursive: true }); if (fs.existsSync(this.dir(id))) await fsp.rename(this.dir(id), destination); await this.save(list.filter(item => item.id !== id)); this.states.delete(id); await this.pruneTrash(); return { name: server.name, recoverableAt: destination }; })); }
  async pruneTrash(maxAgeDays = 14) { const directory = path.join(this.root, 'trash'); const cutoff = Date.now() - maxAgeDays * 86400000; for (const entry of await fsp.readdir(directory, { withFileTypes: true }).catch(() => [])) { const target = path.join(directory, entry.name); const stat = await fsp.stat(target).catch(() => null); if (stat && stat.mtimeMs < cutoff) await fsp.rm(target, { recursive: true, force: true }); } }

  async nextAvailablePort(start = 25565) { const assigned = new Set((await this.rawList()).map(server => server.port)); for (let port = Math.max(1024, Number(start) || 25565); port <= 65535; port += 1) { if (assigned.has(port)) continue; try { await this.ensurePortFree(port); return port; } catch {} } throw new Error('No available server port was found.'); }
  async create(name, version, port = 25565, options = {}) { return this.withRegistryLock(async () => {
    const title = String(name || '').trim().slice(0, 40);
    const number = port === '' || port === 'auto' || port == null ? await this.nextAvailablePort(25565) : Number(port);
    if (!title || !isStableSupportedVersion(String(version)) || !Number.isInteger(number) || number < 1024 || number > 65535) throw new Error('Use a supported stable Minecraft version and a port from 1024 to 65535.');
    if (options.acceptEula !== true) throw new Error('Accept the Minecraft EULA before creating a server.');
    const list = await this.rawList();
    if (list.some(server => server.port === number)) throw new Error(`Port ${number} is already assigned to another Swirl server.`);
    const id = crypto.randomBytes(8).toString('hex');
    const directory = this.dir(id);
    const whitelist = options.whitelist === true; const hostName = /^[a-zA-Z0-9_]{3,16}$/.test(String(options.hostName || '')) ? String(options.hostName) : '';
    const memoryMb = Math.max(1024, Math.min(8192, Number(options.memoryMb) || (isCalendarRelease(version) ? 4096 : 2048)));
    try {
      await Promise.all([fsp.mkdir(path.join(directory, 'logs'), { recursive: true }), fsp.mkdir(path.join(directory, 'mods'), { recursive: true })]);
      await fsp.writeFile(path.join(directory, 'eula.txt'), 'eula=true\n', 'utf8');
      await fsp.writeFile(path.join(directory, 'mods', 'README.txt'), `Fabric server mods for Minecraft ${version} only. Do not add client-only mods or files for another Minecraft version.\n`, 'utf8');
      await fsp.writeFile(path.join(directory, 'mods', 'swirl-server-mods.json'), '[]', 'utf8');
      await fsp.writeFile(path.join(directory, 'server.properties'), [
        'motd=Swirl private server', `server-port=${number}`, 'online-mode=false', `white-list=${whitelist}`, `enforce-whitelist=${whitelist}`,
        'enforce-secure-profile=false', 'max-players=12', 'gamemode=survival', 'difficulty=easy', 'pvp=true', 'enable-command-block=false', 'view-distance=10', 'simulation-distance=8', 'sync-chunk-writes=true', 'network-compression-threshold=256'
      ].join('\n') + '\n', 'utf8');
      if (whitelist && hostName) await this.atomicWrite(path.join(directory, 'whitelist.json'), JSON.stringify([{ uuid: this.offlineUuid(hostName), name: hostName }], null, 2));
      const { publicKey, privateKey } = crypto.generateKeyPairSync('ed25519');
      await this.atomicWrite(path.join(directory, '.swirl-invite-private.pem'), privateKey.export({ type: 'pkcs8', format: 'pem' }));
      await this.atomicWrite(path.join(directory, 'swirl-invite-public.pem'), publicKey.export({ type: 'spki', format: 'pem' }));
      const server = { id, name: title, version: String(version), port: number, privateTestMode: true, whitelist, hostName, memoryMb, loaderVersion: '', createdAt: new Date().toISOString() };
      list.push(server); await this.save(list); await this.writeLock(id); this.state(id, 'stopped', 'Ready to start.'); return { ...server, runtime: this.states.get(id) };
    } catch (error) { await fsp.rm(directory, { recursive: true, force: true }).catch(() => {}); throw error; }
  }); }

  async ensurePortFree(port) {
    await new Promise((resolve, reject) => {
      const probe = net.createServer();
      probe.once('error', error => reject(new Error(error.code === 'EADDRINUSE' ? `Port ${port} is already in use by another app.` : `Could not use port ${port}: ${error.message}`)));
      probe.listen(port, '0.0.0.0', () => probe.close(resolve));
    });
  }

  serverJava(java) {
    return process.platform === 'win32' ? java.replace(/javaw\.exe$/i, 'java.exe') : java;
  }
  async ensureLoaderPin(server) {
    const file = path.join(this.dir(server.id), 'swirl-loader.json');
    try { const pinned = JSON.parse(await fsp.readFile(file, 'utf8')); if (pinned.gameVersion === server.version && pinned.loaderVersion && pinned.installerVersion) return pinned; } catch {}
    const [loaders, installers] = await Promise.all([this.json(`https://meta.fabricmc.net/v2/versions/loader/${server.version}`), this.json('https://meta.fabricmc.net/v2/versions/installer')]);
    const loader = loaders.find(item => item.loader?.stable) || loaders[0]; const installer = installers.find(item => item.stable) || installers[0];
    if (!loader || !installer) throw new Error(`Fabric server components are not available for ${server.version}.`);
    const pinned = { gameVersion: server.version, loaderVersion: loader.loader.version, installerVersion: installer.version, pinnedAt: new Date().toISOString() };
    await this.atomicWrite(file, JSON.stringify(pinned, null, 2)); return pinned;
  }
  async appendLog(id, line) {
    const previous = this.logQueues.get(id) || Promise.resolve();
    const current = previous.catch(() => {}).then(async () => { const file = this.logFile(id); await fsp.mkdir(path.dirname(file), { recursive: true }); await fsp.appendFile(file, line, 'utf8'); const stat = await fsp.stat(file).catch(() => null); if (stat?.size > MAX_LOG_BYTES) { const content = await fsp.readFile(file, 'utf8'); await this.atomicWrite(file, content.slice(-MAX_LOG_BYTES)); } });
    this.logQueues.set(id, current); try { await current; } finally { if (this.logQueues.get(id) === current) this.logQueues.delete(id); }
  }
  rememberConsole(id, text) { const next = `${this.consoleBuffers.get(id) || ''}${text}`.slice(-64_000); this.consoleBuffers.set(id, next); return next; }
  console(id) { return this.consoleBuffers.get(id) || ''; }
  allocatedMemory(excludeId = '') { let total = 0; for (const id of this.running.keys()) if (id !== excludeId) { const server = this.cachedServers?.find(item => item.id === id); total += Number(server?.memoryMb || 0); } return total; }

  async start(id, locked = false) { if (!locked) return this.withServerLock(id, () => this.start(id, true));
    if (this.running.has(id)) throw new Error('That server is already running.');
    const allServers = await this.rawList(); this.cachedServers = allServers; const server = allServers.find(item => item.id === id);
    if (!server) throw new Error('Server not found.');
    if (server.whitelist && !(await this.approvedPlayers(id)).length) throw new Error('This server uses an approved-name list, but the list is empty. Open Players and add your name before starting.');
    await this.ensureDiskSpace(this.dir(id), 1024 * 1024 * 1024, 'prepare and run the server');
    const safeBudget = Math.max(2048, Math.floor(os.totalmem() / 1024 / 1024) - 2048); if (this.allocatedMemory(id) + Number(server.memoryMb || 0) > safeBudget) throw new Error(`Starting this server would reserve more than the safe memory budget (${Math.floor(safeBudget / 1024)} GB). Stop another server or lower its memory.`);
    await this.ensurePortFree(server.port); const pinned = await this.ensureLoaderPin(server); await this.verifyLock(id);
    const directory = this.dir(id); this.state(id, 'downloading', 'Checking Fabric server files…');
    try {
      const upgradeBackup = await this.ensureWorldUpgradeBackup(server);
      if (upgradeBackup) this.emit({ type: 'console', id, line: `World backup created before ${server.version}: ${upgradeBackup.destination}\n` });
      const jar = path.join(directory, 'fabric-server-launch.jar');
      if (!await this.validDownloadedJar(jar)) {
        await fsp.rm(jar, { force: true }); await fsp.rm(`${jar}.sha256`, { force: true });
        this.state(id, 'downloading', 'Downloading Fabric server files…');
        await this.download(`https://meta.fabricmc.net/v2/versions/loader/${server.version}/${pinned.loaderVersion}/${pinned.installerVersion}/server/jar`, jar);
      }
      const runtime = await this.resolveRuntime(server.version); const java = this.serverJava(runtime.java);
      const useZgc = runtime.major >= 25 && spawnSync(java, ['-XX:+UseZGC', '-version'], { windowsHide: true, stdio: 'ignore' }).status === 0;
      const memory = Math.max(1024, Number(server.memoryMb) || 2048);
      this.state(id, 'starting', 'Starting Minecraft server…');
      const child = spawn(java, [`-Xms${Math.min(1024, memory)}M`, `-Xmx${memory}M`, useZgc && memory >= 4096 ? '-XX:+UseZGC' : '-XX:+UseG1GC', '-XX:+ExitOnOutOfMemoryError', '-Dlog4j2.formatMsgNoLookups=true', '-jar', jar, 'nogui'], { cwd: directory, stdio: ['pipe', 'pipe', 'pipe'], windowsHide: true });
      this.running.set(id, child);
      const readinessTimer = setTimeout(() => { if (this.states.get(id)?.state === 'starting') this.state(id, 'starting', 'Still starting. Check the console for a mod error or first-run world generation.'); }, 120_000);
      let readinessText = '';
      const consume = chunk => {
        const text = String(chunk).replace(/\r/g, '');
        this.rememberConsole(id, text); this.emit({ type: 'console', id, line: text }); this.appendLog(id, text).catch(() => {}); readinessText = `${readinessText}${text}`.slice(-2048);
        if (/Done \([^)]*\)! For help, type "help"/i.test(readinessText)) this.state(id, 'ready', `Ready. Join at this computer's LAN address and port ${server.port}.`);
        if (/Can't keep up!|Is the server overloaded/i.test(text)) this.emit({ type: 'warning', id, message: 'The server is falling behind. Lower view distance, reduce mods, or allocate more memory.' });
      };
      child.stdout.on('data', consume); child.stderr.on('data', consume);
      child.on('error', error => { this.emit({ type: 'console', id, line: `Host error: ${error.message}` }); this.state(id, 'error', `Server could not start: ${error.message}`); });
      child.on('exit', code => { clearTimeout(readinessTimer); this.running.delete(id); const previous = this.states.get(id)?.state; this.state(id, code === 0 || previous === 'stopping' ? 'stopped' : 'error', code === 0 || previous === 'stopping' ? 'Server stopped.' : `Server stopped unexpectedly (code ${code ?? 'unknown'}). Check the console log.`); });
      return { ...server, runtime: this.states.get(id) };
    } catch (error) { this.state(id, 'error', error.message); throw error; }
  }

  command(id, command) {
    const child = this.running.get(id); if (!child || !child.stdin.writable) throw new Error('Start the server before sending commands.');
    const text = String(command || '').trim(); if (!text || text.length > 500 || /[\r\n]/.test(text)) throw new Error('Enter one server command.');
    child.stdin.write(`${text}\n`);
  }
  async stop(id, locked = false) { if (!locked) return this.withServerLock(id, () => this.stop(id, true));
    const child = this.running.get(id); if (!child) { this.state(id, 'stopped', 'Server is not running.'); return { stopped: true }; }
    this.state(id, 'stopping', 'Saving the world and stopping safely…'); try { this.command(id, 'stop'); } catch (error) { this.emit({ type: 'console', id, line: `Graceful stop failed: ${error.message}\n` }); }
    await new Promise(resolve => { let finished = false; const done = () => { if (finished) return; finished = true; clearTimeout(timer); resolve(); }; const timer = setTimeout(() => { if (!child.killed) child.kill(); done(); }, 20_000); child.once('exit', done); });
    if (this.running.get(id) === child && !child.killed) child.kill(); return { stopped: true };
  }
  async stopAll() { await Promise.all([...this.running.keys()].map(id => this.stop(id).catch(() => {}))); }
  async canConnect(host, port, timeout = 1500) { return new Promise(resolve => { const socket = net.createConnection({ host, port }); const done = value => { socket.destroy(); resolve(value); }; socket.setTimeout(timeout, () => done(false)); socket.once('connect', () => done(true)); socket.once('error', () => done(false)); }); }
  encodeVarInt(value) { const bytes = []; let current = value >>> 0; do { let byte = current & 0x7f; current >>>= 7; if (current) byte |= 0x80; bytes.push(byte); } while (current); return Buffer.from(bytes); }
  readVarInt(buffer, offset = 0) { let value = 0; let position = 0; let cursor = offset; while (cursor < buffer.length && position < 35) { const current = buffer[cursor++]; value |= (current & 0x7f) << position; if (!(current & 0x80)) return { value, bytes: cursor - offset }; position += 7; } return null; }
  async minecraftStatus(host, port, timeout = 2500) { return new Promise((resolve, reject) => { const socket = net.createConnection({ host, port }); const fail = error => { socket.destroy(); reject(error instanceof Error ? error : new Error(String(error))); }; socket.setTimeout(timeout, () => fail(new Error('Minecraft status timed out.'))); socket.once('error', fail); socket.once('connect', () => { const hostBytes = Buffer.from(host, 'utf8'); const portBytes = Buffer.alloc(2); portBytes.writeUInt16BE(port); const body = Buffer.concat([this.encodeVarInt(0), this.encodeVarInt(-1), this.encodeVarInt(hostBytes.length), hostBytes, portBytes, this.encodeVarInt(1)]); socket.write(Buffer.concat([this.encodeVarInt(body.length), body, Buffer.from([1, 0])])); }); let data = Buffer.alloc(0); socket.on('data', chunk => { data = Buffer.concat([data, chunk]); try { const packetLength = this.readVarInt(data); if (!packetLength || data.length < packetLength.bytes + packetLength.value) return; let offset = packetLength.bytes; const packetId = this.readVarInt(data, offset); if (!packetId || packetId.value !== 0) throw new Error('The open port did not answer like a Minecraft server.'); offset += packetId.bytes; const textLength = this.readVarInt(data, offset); if (!textLength) return; offset += textLength.bytes; if (data.length < offset + textLength.value) return; const result = JSON.parse(data.subarray(offset, offset + textLength.value).toString('utf8')); socket.destroy(); resolve(result); } catch (error) { fail(error); } }); }); }
  lanAddresses() { const values = []; const virtual = /virtual|vmware|hyper-v|vethernet|loopback|teredo|tunnel|bluetooth|docker|wsl/i; for (const [adapter, entries] of Object.entries(os.networkInterfaces())) for (const item of entries || []) { if (!item || item.internal) continue; const family = typeof item.family === 'number' ? (item.family === 4 ? 'IPv4' : 'IPv6') : item.family; if (family === 'IPv4' && (item.address.startsWith('169.254.') || item.address === '0.0.0.0')) continue; if (family === 'IPv6' && (/^fe80:/i.test(item.address) || item.address === '::')) continue; const isPrivate = family === 'IPv4' && (/^10\./.test(item.address) || /^192\.168\./.test(item.address) || /^172\.(1[6-9]|2\d|3[01])\./.test(item.address)); values.push({ address: item.address, family, adapter, preferred: isPrivate && !virtual.test(adapter) }); } return values.sort((a, b) => Number(b.preferred) - Number(a.preferred) || (a.family === 'IPv4' ? -1 : 1) || a.adapter.localeCompare(b.adapter)); }
  validatePlayerName(name) { const value = String(name || '').trim(); if (!/^[A-Za-z0-9_]{3,16}$/.test(value)) throw new Error('Player names need 3-16 letters, numbers, or underscores.'); return value; }
  async approvedPlayers(id) {
    const directory = this.dir(id); let whitelist = []; let operators = [];
    try { whitelist = JSON.parse(await fsp.readFile(path.join(directory, 'whitelist.json'), 'utf8')); } catch {}
    try { operators = JSON.parse(await fsp.readFile(path.join(directory, 'ops.json'), 'utf8')); } catch {}
    const operatorNames = new Set((Array.isArray(operators) ? operators : []).map(item => String(item.name || '').toLowerCase()));
    return (Array.isArray(whitelist) ? whitelist : []).filter(item => item && typeof item.name === 'string').map(item => ({ name: item.name, uuid: item.uuid || this.offlineUuid(item.name), operator: operatorNames.has(item.name.toLowerCase()) })).sort((a, b) => a.name.localeCompare(b.name));
  }
  async setApprovedPlayer(id, name, approved = true, operator = false, locked = false) { if (!locked) return this.withServerLock(id, () => this.setApprovedPlayer(id, name, approved, operator, true));
    const server = (await this.rawList()).find(item => item.id === id); if (!server) throw new Error('Server not found.');
    const player = this.validatePlayerName(name); const child = this.running.get(id);
    if (child) {
      this.command(id, `${approved ? 'whitelist add' : 'whitelist remove'} ${player}`);
      this.command(id, `${operator && approved ? 'op' : 'deop'} ${player}`);
      return { name: player, approved: Boolean(approved), operator: Boolean(operator && approved), pending: true };
    }
    const whitelistFile = path.join(this.dir(id), 'whitelist.json'); const opsFile = path.join(this.dir(id), 'ops.json');
    let whitelist = []; let operators = []; try { whitelist = JSON.parse(await fsp.readFile(whitelistFile, 'utf8')); } catch {} try { operators = JSON.parse(await fsp.readFile(opsFile, 'utf8')); } catch {}
    whitelist = Array.isArray(whitelist) ? whitelist.filter(item => String(item?.name || '').toLowerCase() !== player.toLowerCase()) : [];
    operators = Array.isArray(operators) ? operators.filter(item => String(item?.name || '').toLowerCase() !== player.toLowerCase()) : [];
    const uuid = this.offlineUuid(player); if (approved) whitelist.push({ uuid, name: player }); if (approved && operator) operators.push({ uuid, name: player, level: 4, bypassesPlayerLimit: false });
    await Promise.all([this.atomicWrite(whitelistFile, JSON.stringify(whitelist, null, 2)), this.atomicWrite(opsFile, JSON.stringify(operators, null, 2))]);
    return { name: player, approved: Boolean(approved), operator: Boolean(approved && operator), pending: false };
  }
  async clientRequirements(id) { const mods = await this.installedMods(id); const requirements = []; for (const mod of mods) { let clientSide = mod.clientSide || 'unknown'; if (clientSide === 'unknown') { try { clientSide = (await this.json(`${MODRINTH_API}/project/${encodeURIComponent(mod.projectId)}`)).client_side || 'unknown'; } catch {} } if (clientSide !== 'unsupported') requirements.push({ projectId: mod.projectId, versionId: mod.versionId, sha512: mod.sha512 || '', name: mod.name, required: clientSide === 'required', clientSide }); } return requirements; }
  async exportInvite(id) { const server = (await this.rawList()).find(item => item.id === id); if (!server) throw new Error('Server not found.'); const pinned = await this.ensureLoaderPin(server); const lock = await this.writeLock(id); const addresses = this.lanAddresses().map(item => item.address); if (!addresses.length) throw new Error('No usable LAN address is available. Connect to Wi-Fi or Ethernet first.'); const publicKey = await fsp.readFile(path.join(this.dir(id), 'swirl-invite-public.pem'), 'utf8'); const payload = { format: 1, serverId: id, name: server.name, gameVersion: server.version, loaderVersion: pinned.loaderVersion || lock.loaderVersion || '', addresses, port: server.port, mods: await this.clientRequirements(id), publicKey, createdAt: new Date().toISOString() }; const encoded = Buffer.from(JSON.stringify(payload)).toString('base64url'); const privateKey = await fsp.readFile(path.join(this.dir(id), '.swirl-invite-private.pem'), 'utf8'); const signature = crypto.sign(null, Buffer.from(encoded), privateKey).toString('base64url'); return `SWIRLSERVER1.${encoded}.${signature}`; }
  async diagnose(id, clientVersion = '') {
    const server = (await this.rawList()).find(item => item.id === id); if (!server) throw new Error('Server not found.'); const checks = []; const runtime = this.states.get(id) || { state: 'stopped' };
    if (clientVersion && clientVersion !== server.version) checks.push({ id: 'version', level: 'fail', title: 'Minecraft versions differ', detail: `The server uses ${server.version}, but the selected Play version is ${clientVersion}.` }); else checks.push({ id: 'version', level: 'pass', title: 'Minecraft version matches', detail: `Use a ${server.version} profile to join.` });
    if (server.whitelist) { const players = await this.approvedPlayers(id); checks.push({ id: 'players', level: players.length ? 'pass' : 'fail', title: players.length ? 'Approved-name list is ready' : 'Approved-name list is empty', detail: players.length ? `${players.length} name${players.length === 1 ? '' : 's'} can join. Offline names are not verified identities.` : 'Open Players and add your own name before starting.' }); }
    if (this.running.has(id)) { try { const response = await this.minecraftStatus('127.0.0.1', server.port); checks.push({ id: 'port', level: 'pass', title: 'Minecraft answers locally', detail: `${response.version?.name || server.version}; ${response.players?.online || 0}/${response.players?.max || '?'} players.` }); } catch (error) { checks.push({ id: 'port', level: 'fail', title: 'Minecraft is not answering yet', detail: `${error.message} The process is ${runtime.state}; wait for Ready or inspect the console.` }); } }
    else { try { await this.ensurePortFree(server.port); checks.push({ id: 'port', level: 'pass', title: 'Port is available', detail: `Port ${server.port} is free for this server.` }); } catch (error) { checks.push({ id: 'port', level: 'fail', title: 'Port conflict', detail: error.message }); } }
    const useful = this.lanAddresses();
    if (!useful.length) checks.push({ id: 'network', level: 'fail', title: 'No usable LAN address', detail: 'Connect this computer to the same Wi-Fi or Ethernet network as your friends.' }); else { checks.push({ id: 'network', level: useful.length > 1 ? 'warn' : 'pass', title: useful.length > 1 ? 'Choose the correct network address' : 'LAN address found', detail: useful.map(item => `${item.address}:${server.port} (${item.adapter})`).join(', ') }); checks.push({ id: 'isolation', level: 'warn', title: 'A friend must run the invite test', detail: 'Only a second computer can prove whether the firewall or Wi-Fi blocks device-to-device traffic.' }); }
    if (process.platform === 'win32') { const command = "Get-NetConnectionProfile | Select-Object InterfaceAlias,NetworkCategory,IPv4Connectivity,IPv6Connectivity | ConvertTo-Json -Compress"; const probe = spawnSync('powershell.exe', ['-NoProfile', '-NonInteractive', '-Command', command], { encoding: 'utf8', windowsHide: true }); let profiles = []; try { const parsed = JSON.parse(probe.stdout || '[]'); profiles = Array.isArray(parsed) ? parsed : [parsed]; } catch {} if (profiles.length) { const publicProfile = profiles.some(item => String(item.NetworkCategory).toLowerCase() === 'public'); checks.push({ id: 'firewall', level: publicProfile ? 'warn' : 'info', title: publicProfile ? 'Windows uses a Public network profile' : 'Windows network profile checked', detail: publicProfile ? 'Inbound connections are commonly blocked on Public networks. A school policy may prevent local firewall exceptions.' : profiles.map(item => `${item.InterfaceAlias}: ${item.NetworkCategory}`).join(', ') }); } else checks.push({ id: 'firewall', level: 'warn', title: 'Firewall policy could not be verified', detail: 'Swirl could not read the effective Windows network profile. Test from a second computer.' }); }
    return { server: { id: server.id, name: server.name, version: server.version, port: server.port, state: runtime.state }, checks, ok: !checks.some(check => check.level === 'fail'), localOnly: true };
  }
}
module.exports = IcecreamServerEngine;
