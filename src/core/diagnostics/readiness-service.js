const fs = require('fs');
const fsp = fs.promises;
const path = require('path');
const crypto = require('crypto');

class ReadinessService {
  constructor(engine) {
    this.engine = engine;
  }
  async hash(file, algorithm = 'sha1') {
    const digest = crypto.createHash(algorithm);
    await new Promise((resolve, reject) =>
      fs
        .createReadStream(file)
        .on('data', (chunk) => digest.update(chunk))
        .on('end', resolve)
        .on('error', reject),
    );
    return digest.digest('hex');
  }
  async add(report, file, expected = '', algorithm = 'sha1', required = true) {
    const relativePath = path.relative(this.engine.root, file).replace(/\\/g, '/');
    const entry = {
      relativePath,
      required,
      present: fs.existsSync(file),
      valid: false,
      expectedHash: expected || '',
    };
    if (entry.present) {
      const stat = await fsp.stat(file);
      entry.size = stat.size;
      entry.valid =
        stat.isFile() &&
        (!expected || (await this.hash(file, algorithm)) === expected.toLowerCase());
      if (entry.valid)
        report.artifacts.push({
          source: file,
          relativePath,
          size: stat.size,
          hash: await this.hash(file, 'sha256'),
        });
    }
    if (!entry.present || !entry.valid) report.missing.push(entry);
    report.required.push(entry);
  }
  async addTree(report, root, required = true) {
    let entries;
    try {
      entries = await fsp.readdir(root, { withFileTypes: true });
    } catch {
      if (required) {
        const entry = {
          relativePath: path.relative(this.engine.root, root).replace(/\\/g, '/'),
          required: true,
          present: false,
          valid: false,
        };
        report.required.push(entry);
        report.missing.push(entry);
      }
      return;
    }
    for (const entry of entries) {
      const target = path.join(root, entry.name);
      if (entry.isSymbolicLink()) continue;
      if (entry.isDirectory()) await this.addTree(report, target, required);
      else if (entry.isFile()) await this.add(report, target, '', 'sha256', required);
    }
  }
  missing(report, relativePath, message) {
    const entry = { relativePath, required: true, present: false, valid: false, message };
    report.required.push(entry);
    report.missing.push(entry);
  }
  async report(profileId) {
    const profile = (await this.engine.getModProfiles()).find((item) => item.id === profileId);
    if (!profile) throw new Error('That profile was not found.');
    const report = {
      profileId,
      gameVersion: profile.gameVersion,
      complete: false,
      required: [],
      missing: [],
      artifacts: [],
      networkRequired: [],
    };
    const versionDir = path.join(this.engine.root, 'versions', profile.gameVersion);
    const metadataFile = path.join(versionDir, `${profile.gameVersion}.json`);
    await this.add(report, metadataFile);
    let metadata = null;
    try {
      metadata = JSON.parse(await fsp.readFile(metadataFile, 'utf8'));
    } catch {}
    await this.add(
      report,
      path.join(versionDir, `${profile.gameVersion}.jar`),
      metadata?.downloads?.client?.sha1 || '',
    );
    for (const library of metadata?.libraries || []) {
      if (!this.engine.rulesAllow(library.rules)) continue;
      const artifact = library.downloads?.artifact;
      if (artifact?.path)
        await this.add(
          report,
          path.join(this.engine.root, 'libraries', artifact.path),
          artifact.sha1 || '',
        );
      const native = this.engine.nativeDownload(library);
      if (native?.path)
        await this.add(
          report,
          path.join(this.engine.root, 'libraries', native.path),
          native.sha1 || '',
        );
    }
    const index = metadata?.assetIndex;
    if (index?.id) {
      const indexFile = path.join(this.engine.root, 'assets', 'indexes', `${index.id}.json`);
      await this.add(report, indexFile, index.sha1 || '');
      try {
        const assets = JSON.parse(await fsp.readFile(indexFile, 'utf8'));
        for (const item of Object.values(assets.objects || {}))
          await this.add(
            report,
            path.join(this.engine.root, 'assets', 'objects', item.hash.slice(0, 2), item.hash),
            item.hash,
          );
      } catch {}
    }
    if (metadata?.logging?.client?.file)
      await this.add(
        report,
        path.join(this.engine.root, 'assets', 'log_configs', metadata.logging.client.file.id),
        metadata.logging.client.file.sha1 || '',
      );
    await this.addTree(report, path.join(versionDir, 'natives'), false);
    const settings = await this.engine.getSettings();
    const loader =
      profile.fabricLoaderVersion ||
      settings.fabricLoaderVersions?.[profile.gameVersion] ||
      settings.fabricLoaderVersion ||
      '';
    if (!loader)
      this.missing(
        report,
        `versions/fabric-loader-unknown-${profile.gameVersion}.json`,
        'No installed Fabric Loader is selected.',
      );
    else {
      const fabricFile = path.join(
        this.engine.root,
        'versions',
        `fabric-loader-${loader}-${profile.gameVersion}.json`,
      );
      await this.add(report, fabricFile);
      try {
        const fabric = JSON.parse(await fsp.readFile(fabricFile, 'utf8'));
        for (const library of fabric.libraries || []) {
          if (!this.engine.rulesAllow(library.rules)) continue;
          const relative =
            library.downloads?.artifact?.path || this.engine.libraryPath(library.name);
          await this.add(
            report,
            path.join(this.engine.root, 'libraries', relative),
            library.downloads?.artifact?.sha1 || '',
          );
        }
      } catch {}
    }
    const instance = this.engine.instanceDirectory(profile.gameVersion, profile.id);
    for (const relative of ['swirl-profile.json', 'swirl.lock.json']) {
      const file = path.join(instance, relative);
      if (fs.existsSync(file)) await this.add(report, file, '', 'sha256', false);
    }
    const mods = path.join(instance, 'mods');
    if (fs.existsSync(mods))
      for (const entry of await fsp.readdir(mods, { withFileTypes: true }))
        if (entry.isFile() && (entry.name.endsWith('.jar') || entry.name === 'icecream-mods.json'))
          await this.add(report, path.join(mods, entry.name));
    const requiredJava = this.engine.requiredJava(profile.gameVersion, metadata);
    try {
      const major = requiredJava;
      const javaPath = this.engine.findJava(major);
      report.java = { available: true, path: javaPath, major };
      const javaHome = path.dirname(path.dirname(path.resolve(javaPath)));
      const relation = path.relative(this.engine.root, javaHome);
      if (relation && !relation.startsWith('..') && !path.isAbsolute(relation))
        await this.addTree(report, javaHome);
    } catch (error) {
      report.java = {
        available: false,
        major: requiredJava,
        error: String(error.message || error),
      };
    }
    report.complete =
      report.missing.filter((entry) => entry.required).length === 0 && report.java.available;
    report.invalid = report.missing.filter((entry) => entry.required && entry.present);
    report.absent = report.missing.filter((entry) => entry.required && !entry.present);
    report.repairable = report.missing.filter((entry) => entry.required);
    report.networkRequired = report.repairable.map((entry) => entry.relativePath);
    try {
      const disk = await fsp.statfs(this.engine.root);
      report.disk = {
        available: Number(disk.bavail) * Number(disk.bsize),
        total: Number(disk.blocks) * Number(disk.bsize),
      };
    } catch {
      report.disk = null;
    }
    return report;
  }
}

module.exports = ReadinessService;
