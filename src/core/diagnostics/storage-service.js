const fs = require('fs');
const fsp = fs.promises;
const path = require('path');

class StorageService {
  constructor(dataRoot) {
    this.root = path.join(dataRoot, '.icecream_client');
  }
  async size(target) {
    let total = 0;
    async function visit(file) {
      let stat;
      try {
        stat = await fsp.lstat(file);
      } catch {
        return;
      }
      if (stat.isSymbolicLink()) return;
      if (stat.isFile()) {
        total += stat.size;
        return;
      }
      if (stat.isDirectory())
        for (const item of await fsp.readdir(file)) await visit(path.join(file, item));
    }
    await visit(target);
    return total;
  }
  async partFiles(root = this.root) {
    const found = [];
    async function visit(directory) {
      let entries;
      try {
        entries = await fsp.readdir(directory, { withFileTypes: true });
      } catch {
        return;
      }
      for (const entry of entries) {
        const target = path.join(directory, entry.name);
        if (entry.isDirectory() && !entry.isSymbolicLink()) await visit(target);
        else if (entry.isFile() && /\.(?:part|tmp)$/i.test(entry.name)) found.push(target);
      }
    }
    await visit(root);
    return found;
  }
  async report() {
    const categories = {
      assets: path.join(this.root, 'assets'),
      libraries: path.join(this.root, 'libraries'),
      versions: path.join(this.root, 'versions'),
      java: path.join(this.root, 'java'),
      profiles: path.join(this.root, 'instances', 'profiles'),
      worlds: path.join(this.root, 'instances', 'profiles'),
      backups: path.join(this.root, 'backups'),
      servers: path.join(this.root, 'servers'),
      logs: path.join(this.root, 'logs'),
      updates: path.join(this.root, 'updates'),
    };
    const result = {};
    for (const [name, target] of Object.entries(categories))
      result[name] = {
        path: target,
        bytes: await this.size(target),
        cleanup: ['logs', 'updates'].includes(name),
      };
    const parts = await this.partFiles();
    result.partialDownloads = {
      bytes: (await Promise.all(parts.map((file) => this.size(file)))).reduce((a, b) => a + b, 0),
      files: parts.length,
      cleanup: true,
    };
    return {
      generatedAt: new Date().toISOString(),
      totalBytes: await this.size(this.root),
      categories: result,
    };
  }
  async cleanup(category, confirmed = false) {
    if (!confirmed) throw new Error('Storage cleanup requires confirmation.');
    if (category === 'partialDownloads') {
      const files = await this.partFiles();
      let bytes = 0;
      for (const file of files) {
        bytes += await this.size(file);
        await fsp.rm(file, { force: true });
      }
      return { category, files: files.length, bytes };
    }
    const targets = {
      logs: path.join(this.root, 'logs'),
      updates: path.join(this.root, 'updates'),
    };
    const target = targets[category];
    if (!target) throw new Error('That storage category cannot be cleaned automatically.');
    const bytes = await this.size(target);
    await fsp.rm(target, { recursive: true, force: true });
    return { category, bytes };
  }
}

module.exports = StorageService;
