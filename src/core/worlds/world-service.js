// @ts-check
const fs = require('fs');
const fsp = fs.promises;
const path = require('path');
const { isCalendarRelease } = require('../../shared/version-policy');

class WorldService {
  /** @param {any} engine */
  constructor(engine) {
    this.engine = engine;
  }

  /** @param {string} directory */
  async directorySize(directory) {
    let total = 0;
    const queue = [directory];
    while (queue.length) {
      const current = queue.pop();
      if (!current) continue;
      for (const entry of await fsp.readdir(current, { withFileTypes: true }).catch(() => [])) {
        const file = path.join(current, entry.name);
        if (entry.isDirectory()) queue.push(file);
        else if (entry.isFile())
          total += Number((await fsp.stat(file).catch(() => null))?.size || 0);
      }
    }
    return total;
  }

  /** @param {unknown} value */
  safeName(value) {
    const name = String(value || '').trim();
    if (
      !name ||
      name === '.' ||
      name === '..' ||
      path.basename(name) !== name ||
      /[\\/:*?"<>|\0]/.test(name)
    )
      throw new Error('Choose a valid world name without file-system symbols.');
    return name.slice(0, 80);
  }

  /** @param {string} profileId @param {string} [requestedWorld] */
  async context(profileId, requestedWorld = '') {
    /** @type {any[]} */
    const profiles = await this.engine.getModProfiles();
    const profile = profiles.find((item) => item.id === profileId);
    if (!profile) throw new Error('That profile was not found.');
    const saves = path.join(
      this.engine.instanceDirectory(profile.gameVersion, profile.id),
      'saves',
    );
    await this.engine.ensure(saves);
    if (!requestedWorld) return { profile, saves };
    const name = this.safeName(requestedWorld);
    const entry = (await fsp.readdir(saves, { withFileTypes: true })).find(
      (item) => item.isDirectory() && item.name === name,
    );
    if (!entry) throw new Error('That world was not found in this profile.');
    return { profile, saves, name, directory: path.join(saves, name) };
  }

  /** @param {string} saves @param {unknown} requested */
  async uniqueName(saves, requested) {
    const base = this.safeName(requested);
    let candidate = base;
    let suffix = 2;
    while (await this.engine.exists(path.join(saves, candidate))) {
      candidate = `${base.slice(0, Math.max(1, 76 - String(suffix).length))} (${suffix})`;
      suffix += 1;
    }
    return candidate;
  }

  /** @param {string} profileId */
  async list(profileId) {
    const { profile, saves } = await this.context(profileId);
    const worlds = [];
    for (const entry of await fsp.readdir(saves, { withFileTypes: true }).catch(() => [])) {
      if (!entry.isDirectory()) continue;
      const directory = path.join(saves, entry.name);
      const stat = await fsp.stat(directory);
      worlds.push({
        name: entry.name,
        profileId: profile.id,
        profileName: profile.name,
        profileVersion: profile.gameVersion,
        size: await this.directorySize(directory),
        modifiedAt: stat.mtime.toISOString(),
        valid: await this.engine.exists(path.join(directory, 'level.dat')),
      });
    }
    return worlds.sort((a, b) => b.modifiedAt.localeCompare(a.modifiedAt));
  }

  /**
   * @param {string} sourceProfileId
   * @param {string} worldName
   * @param {string} targetProfileId
   * @param {string} [requestedName]
   */
  async copy(sourceProfileId, worldName, targetProfileId, requestedName = '') {
    if (sourceProfileId === targetProfileId)
      throw new Error('Choose a different destination profile, or use Duplicate.');
    /** @type {any} */
    const source = await this.context(sourceProfileId, worldName);
    /** @type {any} */
    const target = await this.context(targetProfileId);
    await this.engine.backupModProfile(targetProfileId);
    const name = await this.uniqueName(target.saves, requestedName || source.name);
    await fsp.cp(source.directory, path.join(target.saves, name), {
      recursive: true,
      errorOnExist: true,
    });
    return {
      name,
      sourceVersion: source.profile.gameVersion,
      targetVersion: target.profile.gameVersion,
      versionChanged: source.profile.gameVersion !== target.profile.gameVersion,
    };
  }

  /** @param {string} profileId @param {string} worldName */
  async duplicate(profileId, worldName) {
    /** @type {any} */
    const context = await this.context(profileId, worldName);
    await this.engine.backupModProfile(profileId);
    const name = await this.uniqueName(context.saves, `${context.name} Copy`);
    await fsp.cp(context.directory, path.join(context.saves, name), {
      recursive: true,
      errorOnExist: true,
    });
    return { name };
  }

  /** @param {string} profileId @param {string} worldName @param {string} requestedName */
  async rename(profileId, worldName, requestedName) {
    /** @type {any} */
    const context = await this.context(profileId, worldName);
    const name = this.safeName(requestedName);
    if (name === context.name) return { name };
    if (await this.engine.exists(path.join(context.saves, name)))
      throw new Error('A world with that name already exists in this profile.');
    await this.engine.backupModProfile(profileId);
    await fsp.rename(context.directory, path.join(context.saves, name));
    return { name };
  }

  /** @param {string} profileId @param {string} worldName */
  async remove(profileId, worldName) {
    /** @type {any} */
    const context = await this.context(profileId, worldName);
    await this.engine.backupModProfile(profileId);
    const destination = path.join(
      this.engine.root,
      'trash',
      'worlds',
      `${profileId}-${Date.now()}-${context.name}`,
    );
    await this.engine.ensure(path.dirname(destination));
    await fsp.rename(context.directory, destination);
    return { name: context.name, recoverableAt: destination };
  }

  /** @param {string} profileId @param {string} worldName @param {string} destinationRoot */
  async export(profileId, worldName, destinationRoot) {
    /** @type {any} */
    const context = await this.context(profileId, worldName);
    const root = path.resolve(String(destinationRoot || ''));
    if (!root) throw new Error('Choose a destination folder.');
    await this.engine.ensure(root);
    const name = await this.uniqueName(root, context.name);
    const destination = path.join(root, name);
    await fsp.cp(context.directory, destination, { recursive: true, errorOnExist: true });
    return { name, destination };
  }

  /** @param {string} profileId @param {string} sourceDirectory */
  async import(profileId, sourceDirectory) {
    const source = path.resolve(String(sourceDirectory || ''));
    if (!(await this.engine.exists(path.join(source, 'level.dat'))))
      throw new Error('Choose a Minecraft world folder containing level.dat.');
    /** @type {any} */
    const context = await this.context(profileId);
    await this.engine.backupModProfile(profileId);
    const name = await this.uniqueName(context.saves, path.basename(source));
    const destination = path.join(context.saves, name);
    await fsp.cp(source, destination, { recursive: true, errorOnExist: true });
    return { name, destination };
  }

  /** @param {any} profile */
  async ensureUpgradeBackup(profile) {
    if (!isCalendarRelease(profile.gameVersion)) return null;
    const instance = this.engine.instanceDirectory(profile.gameVersion, profile.id);
    const saves = path.join(instance, 'saves');
    const worlds = (await fsp.readdir(saves, { withFileTypes: true }).catch(() => [])).filter(
      (entry) => entry.isDirectory(),
    );
    if (!worlds.length) return null;
    const recordFile = path.join(instance, '.swirl-world-upgrades.json');
    /** @type {{version: number, worlds: Record<string, any>}} */
    let record = { version: 1, worlds: {} };
    try {
      record = { ...record, ...JSON.parse(await fsp.readFile(recordFile, 'utf8')) };
    } catch {}
    const pending = worlds.filter((world) => !record.worlds?.[world.name]);
    if (!pending.length) return null;
    const stamp = new Date().toISOString().replace(/[:.]/g, '-');
    const destination = path.join(this.engine.root, 'backups', profile.id, 'world-upgrades', stamp);
    await this.engine.ensure(destination);
    for (const world of pending)
      await fsp.cp(path.join(saves, world.name), path.join(destination, world.name), {
        recursive: true,
        errorOnExist: true,
      });
    record.worlds = { ...(record.worlds || {}) };
    for (const world of pending)
      record.worlds[world.name] = {
        backedUpAt: new Date().toISOString(),
        targetVersion: profile.gameVersion,
        destination,
      };
    await this.engine.atomicWrite(recordFile, JSON.stringify(record, null, 2));
    this.engine.emit(
      'backup',
      `Backed up ${pending.length} world${pending.length === 1 ? '' : 's'} before the ${profile.gameVersion} upgrade`,
    );
    return { destination, worlds: pending.map((world) => world.name) };
  }
}

module.exports = WorldService;
