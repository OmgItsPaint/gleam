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
const MODRINTH_API = 'https://api.modrinth.com/v2';

class IcecreamServerEngine {
  constructor(appData, resolveRuntime, emit = () => {}) {
    this.root = path.join(appData, '.icecream_client', 'servers');
    this.resolveRuntime = resolveRuntime;
    this.emit = emit;
    this.running = new Map();
    this.states = new Map();
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
        const hash = crypto.createHash('sha256');
        const out = fs.createWriteStream(temp, { flags: 'wx' });
        response.on('data', chunk => hash.update(chunk));
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
  async downloadMod(url, destination, expectedSha512, redirects = 0) {
    if (redirects > 5) throw new Error('Too many redirects while downloading a server mod.');
    await fsp.mkdir(path.dirname(destination), { recursive: true }); const temporary = `${destination}.part`; await fsp.rm(temporary, { force: true });
    return new Promise((resolve, reject) => { const request = https.get(url, { headers: { 'User-Agent': 'Swirl-Launcher/1.0', 'Accept-Encoding': 'identity' } }, response => {
      if (response.statusCode >= 300 && response.statusCode < 400 && response.headers.location) { response.resume(); this.downloadMod(new URL(response.headers.location, url).toString(), destination, expectedSha512, redirects + 1).then(resolve, reject); return; }
      if (response.statusCode !== 200) { response.resume(); reject(new Error(`Server mod download failed (${response.statusCode}).`)); return; }
      const hash = crypto.createHash('sha512'); const output = fs.createWriteStream(temporary); response.on('data', chunk => hash.update(chunk)); response.pipe(output); output.on('error', reject); response.on('error', reject); output.on('finish', async () => { try { await new Promise((done, failed) => output.close(error => error ? failed(error) : done())); const actual = hash.digest('hex'); if (expectedSha512 && actual !== expectedSha512) throw new Error('The downloaded server mod failed its SHA-512 check.'); await fsp.rename(temporary, destination); resolve(actual); } catch (error) { await fsp.rm(temporary, { force: true }); reject(error); } });
    }); request.setTimeout(90_000, () => request.destroy(new Error('Server mod download timed out.'))); request.on('error', reject); });
  }
  async installedMods(id) { const server = (await this.rawList()).find(item => item.id === id); if (!server) throw new Error('Server not found.'); try { const value = JSON.parse(await fsp.readFile(this.modsManifest(id), 'utf8')); if (!Array.isArray(value)) throw new Error('not-array'); return value; } catch (error) { if (error.code === 'ENOENT') return []; throw new Error('The server mod list is damaged. Restore a backup before changing mods.'); } }
  async searchMods(id, query) { const server = (await this.rawList()).find(item => item.id === id); if (!server) throw new Error('Server not found.'); const facets = JSON.stringify([[`versions:${server.version}`], ['categories:fabric'], ['project_type:mod']]); const response = await this.json(`${MODRINTH_API}/search?query=${encodeURIComponent(String(query || '').slice(0, 100))}&limit=24&facets=${encodeURIComponent(facets)}`); return (response.hits || []).filter(hit => hit.server_side !== 'unsupported').map(hit => ({ id: hit.project_id, title: hit.title, description: hit.description, icon: hit.icon_url, downloads: hit.downloads })); }
  async modVersions(projectId, gameVersion) { const versions = await this.json(`${MODRINTH_API}/project/${encodeURIComponent(projectId)}/version?loaders=${encodeURIComponent('["fabric"]')}&game_versions=${encodeURIComponent(JSON.stringify([gameVersion]))}`); return [...versions].sort((a, b) => Date.parse(b.date_published || 0) - Date.parse(a.date_published || 0)); }
  async installMod(id, projectId, requestedVersionId = '', visited = new Set(), locked = false) {
    if (this.running.has(id)) throw new Error('Stop the server before changing mods.'); if (!locked) { await this.backup(id, this.backupRetention); return this.installMod(id, projectId, requestedVersionId, visited, true); }
    if (visited.has(projectId)) return []; visited.add(projectId); const server = (await this.rawList()).find(item => item.id === id); if (!server) throw new Error('Server not found.');
    const [project, candidates] = await Promise.all([this.json(`${MODRINTH_API}/project/${encodeURIComponent(projectId)}`), this.modVersions(projectId, server.version)]); if (project.server_side === 'unsupported') throw new Error(`${project.title || projectId} is client-only and cannot be added to a server.`);
    const version = requestedVersionId ? await this.json(`${MODRINTH_API}/version/${encodeURIComponent(requestedVersionId)}`) : candidates.find(item => item.version_type === 'release') || candidates[0]; if (!version || version.project_id !== projectId || !(version.game_versions || []).includes(server.version) || !(version.loaders || []).includes('fabric')) throw new Error(`No compatible Fabric ${server.version} server version exists for ${project.title || projectId}.`);
    const installed = []; for (const dependency of version.dependencies || []) { if (dependency.dependency_type !== 'required') continue; if (dependency.version_id) { const dependency = await this.json(`${MODRINTH_API}/version/${encodeURIComponent(dependency.version_id)}`); installed.push(...await this.installMod(id, dependency.project_id, dependency.id, visited, true)); } else if (dependency.project_id) installed.push(...await this.installMod(id, dependency.project_id, '', visited, true)); }
    const file = (version.files || []).find(item => item.primary) || version.files?.[0]; if (!file?.url || !file.hashes?.sha512) throw new Error('Modrinth did not provide a verifiable server mod file.'); const destination = path.join(this.modsDir(id), path.basename(new URL(file.url).pathname)); const manifest = await this.installedMods(id); const previous = manifest.find(item => item.projectId === projectId); const sha512 = await this.downloadMod(file.url, destination, file.hashes.sha512); if (previous && previous.file !== path.basename(destination)) await fsp.rm(path.join(this.modsDir(id), previous.file), { force: true }); const next = manifest.filter(item => item.projectId !== projectId); next.push({ projectId, versionId: version.id, versionNumber: version.version_number || version.name, name: project.title || version.name || projectId, file: path.basename(destination), sha512 }); await fsp.writeFile(this.modsManifest(id), JSON.stringify(next, null, 2), 'utf8'); await this.writeLock(id); installed.push({ projectId, name: project.title || projectId }); return installed;
  }
  async removeMod(id, projectId) { if (this.running.has(id)) throw new Error('Stop the server before changing mods.'); await this.backup(id, this.backupRetention); const manifest = await this.installedMods(id); const selected = manifest.find(item => item.projectId === projectId); if (!selected) throw new Error('That mod is not installed on this server.'); await fsp.rm(path.join(this.modsDir(id), selected.file), { force: true }); await fsp.writeFile(this.modsManifest(id), JSON.stringify(manifest.filter(item => item.projectId !== projectId), null, 2), 'utf8'); await this.writeLock(id); return selected; }
  async updateMods(id) { if (this.running.has(id)) throw new Error('Stop the server before updating mods.'); const server = (await this.rawList()).find(item => item.id === id); const installed = await this.installedMods(id); const plan = []; for (const mod of installed) { const versions = await this.modVersions(mod.projectId, server.version); const latest = versions.find(item => item.version_type === 'release') || versions[0]; if (latest && latest.id !== mod.versionId) plan.push({ mod, latest }); } if (!plan.length) return []; await this.backup(id, this.backupRetention); const updated = []; for (const item of plan) { await this.installMod(id, item.mod.projectId, item.latest.id, new Set(), true); updated.push(item.mod.name); } return updated; }
  async writeLock(id) { const server = (await this.rawList()).find(item => item.id === id); if (!server) throw new Error('Server not found.'); const mods = await this.installedMods(id); const locked = []; for (const mod of mods) { const file = path.join(this.modsDir(id), mod.file); if (!fs.existsSync(file)) throw new Error(`Missing server mod file: ${mod.file}`); locked.push({ ...mod, sha512: mod.sha512 || await this.hashFile(file) }); } const lock = { format: 1, serverId: id, gameVersion: server.version, generatedAt: new Date().toISOString(), mods: locked.sort((a, b) => a.projectId.localeCompare(b.projectId)) }; await fsp.writeFile(this.lockFile(id), JSON.stringify(lock, null, 2), 'utf8'); return lock; }
  async verifyLock(id) { if (!fs.existsSync(this.lockFile(id))) return this.writeLock(id); const lock = JSON.parse(await fsp.readFile(this.lockFile(id), 'utf8')); const server = (await this.rawList()).find(item => item.id === id); const mods = await this.installedMods(id); if (lock.gameVersion !== server.version || lock.mods?.length !== mods.length) throw new Error('The server mod lockfile does not match this server.'); const managed = new Set(mods.map(mod => mod.file)); const unmanaged = (await fsp.readdir(this.modsDir(id)).catch(() => [])).filter(name => name.toLowerCase().endsWith('.jar') && !managed.has(name)); if (unmanaged.length) throw new Error(`Unmanaged server mod files are not allowed: ${unmanaged.join(', ')}. Add them through Manage mods.`); for (const mod of mods) { const pinned = lock.mods.find(item => item.projectId === mod.projectId); if (!pinned || pinned.versionId !== mod.versionId || await this.hashFile(path.join(this.modsDir(id), mod.file)) !== pinned.sha512) throw new Error(`${mod.name || mod.projectId} does not match the server lockfile.`); } return lock; }

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
    const temp = `${this.file()}.tmp`;
    await fsp.writeFile(temp, JSON.stringify(list, null, 2), 'utf8');
    await fsp.rename(temp, this.file());
  }

  async directorySize(directory) { let total = 0; const queue = [directory]; while (queue.length) { const current = queue.pop(); for (const entry of await fsp.readdir(current, { withFileTypes: true }).catch(() => [])) { const file = path.join(current, entry.name); if (entry.isDirectory()) queue.push(file); else if (entry.isFile()) total += Number((await fsp.stat(file).catch(() => null))?.size || 0); } } return total; }
  async listBackups(id) { const server = (await this.rawList()).find(item => item.id === id); if (!server) throw new Error('Server not found.'); const entries = await fsp.readdir(this.backupRoot(id), { withFileTypes: true }).catch(() => []); const backups = []; for (const entry of entries.filter(item => item.isDirectory())) { const directory = path.join(this.backupRoot(id), entry.name); if (!fs.existsSync(path.join(directory, 'server.properties'))) continue; const stat = await fsp.stat(directory); backups.push({ id: entry.name, createdAt: stat.birthtime.toISOString(), modifiedAt: stat.mtime.toISOString(), size: await this.directorySize(directory) }); } return backups.sort((a, b) => b.id.localeCompare(a.id)); }
  async pruneBackups(id, retention = 5) { const keep = Math.max(1, Math.min(20, Number(retention) || 5)); const backups = await this.listBackups(id); for (const backup of backups.slice(keep)) await fsp.rm(path.join(this.backupRoot(id), backup.id), { recursive: true, force: true }); }
  async backup(id, retention = 5) { if (this.running.has(id)) throw new Error('Stop the server before making a backup.'); const server = (await this.rawList()).find(item => item.id === id); if (!server) throw new Error('Server not found.'); await this.verifyLock(id); const stamp = new Date().toISOString().replace(/[:.]/g, '-'); const destination = path.join(this.backupRoot(id), stamp); await fsp.mkdir(path.dirname(destination), { recursive: true }); await fsp.cp(this.dir(id), destination, { recursive: true, errorOnExist: true }); await this.pruneBackups(id, retention); return { destination, createdAt: stamp }; }
  async restoreBackup(id, backupId) { if (this.running.has(id)) throw new Error('Stop the server before restoring a backup.'); const backup = (await this.listBackups(id)).find(item => item.id === backupId); if (!backup) throw new Error('That server backup no longer exists.'); const current = this.dir(id); const safety = path.join(this.root, 'trash', `${id}-before-restore-${Date.now()}`); await fsp.mkdir(path.dirname(safety), { recursive: true }); if (fs.existsSync(current)) await fsp.rename(current, safety); try { await fsp.cp(path.join(this.backupRoot(id), backup.id), current, { recursive: true }); await this.verifyLock(id); return { restoredFrom: backup.id, safety }; } catch (error) { await fsp.rm(current, { recursive: true, force: true }); if (fs.existsSync(safety)) await fsp.rename(safety, current); throw new Error(`The backup was not restored because its integrity check failed: ${error.message}`); } }
  async deleteBackup(id, backupId) { const backup = (await this.listBackups(id)).find(item => item.id === backupId); if (!backup) throw new Error('That server backup no longer exists.'); await fsp.rm(path.join(this.backupRoot(id), backup.id), { recursive: true, force: true }); return true; }
  async ensureWorldUpgradeBackup(server) {
    if (!isCalendarRelease(server.version)) return null;
    const world = path.join(this.dir(server.id), 'world'); const marker = path.join(this.dir(server.id), '.swirl-world-upgrade.json');
    if (!fs.existsSync(world) || fs.existsSync(marker)) return null;
    const stamp = new Date().toISOString().replace(/[:.]/g, '-'); const destination = path.join(this.root, 'backups', server.id, `before-${server.version}-${stamp}`);
    await fsp.mkdir(destination, { recursive: true }); await fsp.cp(world, path.join(destination, 'world'), { recursive: true, errorOnExist: true });
    await fsp.writeFile(marker, JSON.stringify({ targetVersion: server.version, backedUpAt: new Date().toISOString(), destination }, null, 2), 'utf8'); return { destination };
  }
  async remove(id) { if (this.running.has(id)) throw new Error('Stop the server before deleting it.'); const list = await this.rawList(); const server = list.find(item => item.id === id); if (!server) throw new Error('Server not found.'); const destination = path.join(this.root, 'trash', `${id}-${Date.now()}`); await fsp.mkdir(path.dirname(destination), { recursive: true }); if (fs.existsSync(this.dir(id))) await fsp.rename(this.dir(id), destination); await this.save(list.filter(item => item.id !== id)); this.states.delete(id); return { name: server.name, recoverableAt: destination }; }

  async create(name, version, port = 25565, options = {}) {
    const title = String(name || '').trim().slice(0, 40);
    const number = Number(port);
    if (!title || !isStableSupportedVersion(String(version)) || !Number.isInteger(number) || number < 1024 || number > 65535) throw new Error('Use a supported stable Minecraft version and a port from 1024 to 65535.');
    if (options.acceptEula !== true) throw new Error('Accept the Minecraft EULA before creating a server.');
    const list = await this.rawList();
    if (list.some(server => server.port === number)) throw new Error(`Port ${number} is already assigned to another Swirl server.`);
    const id = crypto.randomBytes(8).toString('hex');
    const directory = this.dir(id);
    const whitelist = options.whitelist === true;
    const memoryMb = Math.max(1024, Math.min(8192, Number(options.memoryMb) || (isCalendarRelease(version) ? 4096 : 2048)));
    try {
      await Promise.all([fsp.mkdir(path.join(directory, 'logs'), { recursive: true }), fsp.mkdir(path.join(directory, 'mods'), { recursive: true })]);
      await fsp.writeFile(path.join(directory, 'eula.txt'), 'eula=true\n', 'utf8');
      await fsp.writeFile(path.join(directory, 'mods', 'README.txt'), `Fabric server mods for Minecraft ${version} only. Do not add client-only mods or files for another Minecraft version.\n`, 'utf8');
      await fsp.writeFile(path.join(directory, 'mods', 'swirl-server-mods.json'), '[]', 'utf8');
      await fsp.writeFile(path.join(directory, 'server.properties'), [
        'motd=Swirl private server', `server-port=${number}`, 'online-mode=false', `white-list=${whitelist}`, `enforce-whitelist=${whitelist}`,
        'max-players=12', 'gamemode=survival', 'difficulty=easy', 'pvp=true', 'enable-command-block=false', 'view-distance=10', 'simulation-distance=8'
      ].join('\n') + '\n', 'utf8');
      const server = { id, name: title, version: String(version), port: number, privateTestMode: true, whitelist, memoryMb, createdAt: new Date().toISOString() };
      list.push(server); await this.save(list); await this.writeLock(id); this.state(id, 'stopped', 'Ready to start.'); return { ...server, runtime: this.states.get(id) };
    } catch (error) { await fsp.rm(directory, { recursive: true, force: true }).catch(() => {}); throw error; }
  }

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
  async appendLog(id, line) {
    const file = this.logFile(id); await fsp.mkdir(path.dirname(file), { recursive: true });
    await fsp.appendFile(file, line, 'utf8');
    const stat = await fsp.stat(file).catch(() => null);
    if (stat?.size > MAX_LOG_BYTES) { const content = await fsp.readFile(file, 'utf8'); await fsp.writeFile(file, content.slice(-MAX_LOG_BYTES), 'utf8'); }
  }

  async start(id) {
    if (this.running.has(id)) throw new Error('That server is already running.');
    const server = (await this.rawList()).find(item => item.id === id);
    if (!server) throw new Error('Server not found.');
    await this.ensurePortFree(server.port); await this.verifyLock(id);
    const directory = this.dir(id); this.state(id, 'downloading', 'Checking Fabric server files…');
    try {
      const upgradeBackup = await this.ensureWorldUpgradeBackup(server);
      if (upgradeBackup) this.emit({ type: 'console', id, line: `World backup created before ${server.version}: ${upgradeBackup.destination}\n` });
      const jar = path.join(directory, 'fabric-server-launch.jar');
      if (!await this.validDownloadedJar(jar)) {
        await fsp.rm(jar, { force: true }); await fsp.rm(`${jar}.sha256`, { force: true });
        this.state(id, 'downloading', 'Downloading Fabric server files…');
        const loaders = await this.json(`https://meta.fabricmc.net/v2/versions/loader/${server.version}`);
        const loader = loaders.find(item => item.loader?.stable) || loaders[0];
        const installers = await this.json('https://meta.fabricmc.net/v2/versions/installer');
        const installer = installers.find(item => item.stable) || installers[0];
        if (!loader || !installer) throw new Error(`Fabric server components are not available for ${server.version}.`);
        await this.download(`https://meta.fabricmc.net/v2/versions/loader/${server.version}/${loader.loader.version}/${installer.version}/server/jar`, jar);
      }
      const runtime = await this.resolveRuntime(server.version); const java = this.serverJava(runtime.java);
      const useZgc = runtime.major >= 25 && spawnSync(java, ['-XX:+UseZGC', '-version'], { windowsHide: true, stdio: 'ignore' }).status === 0;
      const memory = Math.max(1024, Number(server.memoryMb) || 2048);
      this.state(id, 'starting', 'Starting Minecraft server…');
      const child = spawn(java, [`-Xms${Math.min(1024, memory)}M`, `-Xmx${memory}M`, useZgc ? '-XX:+UseZGC' : '-XX:+UseG1GC', '-jar', jar, 'nogui'], { cwd: directory, stdio: ['pipe', 'pipe', 'pipe'], windowsHide: true });
      this.running.set(id, child);
      const readinessTimer = setTimeout(() => { if (this.states.get(id)?.state === 'starting') this.state(id, 'starting', 'Still starting. Check the console for a mod error or first-run world generation.'); }, 120_000);
      const consume = chunk => {
        const text = String(chunk).replace(/\r/g, '');
        this.emit({ type: 'console', id, line: text }); this.appendLog(id, text).catch(() => {});
        if (/Done \([^)]*\)! For help, type "help"/i.test(text)) this.state(id, 'ready', `Ready. Join at this computer's LAN address and port ${server.port}.`);
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
  async stop(id) {
    const child = this.running.get(id); if (!child) { this.state(id, 'stopped', 'Server is not running.'); return { stopped: true }; }
    this.state(id, 'stopping', 'Saving the world and stopping safely…'); this.command(id, 'stop');
    await new Promise(resolve => { let finished = false; const done = () => { if (finished) return; finished = true; clearTimeout(timer); resolve(); }; const timer = setTimeout(() => { if (!child.killed) child.kill(); done(); }, 20_000); child.once('exit', done); });
    return { stopped: true };
  }
  async stopAll() { await Promise.all([...this.running.keys()].map(id => this.stop(id).catch(() => {}))); }
  async canConnect(host, port, timeout = 1500) { return new Promise(resolve => { const socket = net.createConnection({ host, port }); const done = value => { socket.destroy(); resolve(value); }; socket.setTimeout(timeout, () => done(false)); socket.once('connect', () => done(true)); socket.once('error', () => done(false)); }); }
  async diagnose(id, clientVersion = '') {
    const server = (await this.rawList()).find(item => item.id === id); if (!server) throw new Error('Server not found.'); const checks = []; const runtime = this.states.get(id) || { state: 'stopped' };
    if (clientVersion && clientVersion !== server.version) checks.push({ id: 'version', level: 'fail', title: 'Minecraft versions differ', detail: `The server uses ${server.version}, but the selected Play version is ${clientVersion}.` }); else checks.push({ id: 'version', level: 'pass', title: 'Minecraft version matches', detail: `Use a ${server.version} profile to join.` });
    if (this.running.has(id)) { const reachable = await this.canConnect('127.0.0.1', server.port); checks.push({ id: 'port', level: reachable ? 'pass' : 'fail', title: reachable ? 'Server answers locally' : 'Server is not answering yet', detail: reachable ? `Port ${server.port} accepts connections on this computer.` : `The process is ${runtime.state}; wait for Ready or inspect the console.` }); }
    else { try { await this.ensurePortFree(server.port); checks.push({ id: 'port', level: 'pass', title: 'Port is available', detail: `Port ${server.port} is free for this server.` }); } catch (error) { checks.push({ id: 'port', level: 'fail', title: 'Port conflict', detail: error.message }); } }
    const addresses = Object.values(os.networkInterfaces()).flat().filter(item => item && item.family === 'IPv4' && !item.internal); const useful = addresses.filter(item => !item.address.startsWith('169.254.'));
    if (!useful.length) checks.push({ id: 'network', level: 'fail', title: 'No usable LAN address', detail: 'Connect this computer to the same Wi-Fi or Ethernet network as your friends.' }); else { checks.push({ id: 'network', level: useful.length > 1 ? 'warn' : 'pass', title: useful.length > 1 ? 'Multiple network addresses found' : 'LAN address found', detail: useful.map(item => `${item.address}:${server.port}`).join(', ') }); checks.push({ id: 'isolation', level: 'info', title: 'Wi-Fi isolation needs a second device', detail: 'Swirl cannot prove whether the router blocks devices from talking to each other. Test the shown address from a friend’s computer on the same Wi-Fi.' }); }
    if (process.platform === 'win32') { const probe = spawnSync('netsh', ['advfirewall', 'show', 'currentprofile'], { encoding: 'utf8', windowsHide: true }); const output = `${probe.stdout || ''}\n${probe.stderr || ''}`; if (probe.status === 0 && /State\s+ON/i.test(output)) checks.push({ id: 'firewall', level: 'warn', title: 'Windows Firewall is on', detail: 'Allow Java when Windows asks. Swirl does not disable your firewall automatically.' }); else if (probe.status === 0) checks.push({ id: 'firewall', level: 'info', title: 'Firewall profile checked', detail: 'Windows reports the current firewall profile is off.' }); else checks.push({ id: 'firewall', level: 'info', title: 'Firewall status unavailable', detail: 'Windows did not allow Swirl to read the firewall profile.' }); }
    return { server: { id: server.id, name: server.name, version: server.version, port: server.port, state: runtime.state }, checks, ok: !checks.some(check => check.level === 'fail') };
  }
}
module.exports = IcecreamServerEngine;
