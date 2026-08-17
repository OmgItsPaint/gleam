const fs = require('fs');
const fsp = fs.promises;
const path = require('path');

const MAX_LOG_BYTES = 1024 * 1024;

class CrashAssistant {
  constructor(dataRoot) {
    this.root = path.join(dataRoot, '.icecream_client');
    this.crashRoot = path.join(this.root, 'crash-reports');
  }

  async tail(file) {
    const handle = await fsp.open(file, 'r');
    try {
      const stat = await handle.stat();
      const size = Math.min(stat.size, MAX_LOG_BYTES);
      const bytes = Buffer.alloc(size);
      await handle.read(bytes, 0, size, Math.max(0, stat.size - size));
      return bytes.toString('utf8');
    } finally {
      await handle.close();
    }
  }

  explain(log, exitCode = null) {
    const text = String(log || '').toLowerCase();
    if (/outofmemoryerror|could not reserve enough space|java heap space/.test(text))
      return {
        kind: 'memory',
        title: 'Minecraft ran out of memory',
        detail: 'Close memory-heavy apps, increase the profile memory, or remove a large modpack.',
        actions: ['repair', 'mods'],
      };
    if (/unsupportedclassversionerror|class file version/.test(text))
      return {
        kind: 'java',
        title: 'The Java version is incompatible',
        detail:
          'Let Swirl repair this profile so it can select and verify the required Java runtime.',
        actions: ['repair'],
      };
    if (
      /mixin.*(?:failed|error)|mod resolution encountered an incompatible|incompatible mod set/.test(
        text,
      )
    )
      return {
        kind: 'mods',
        title: 'Installed mods conflict',
        detail:
          'Review recently changed mods. Swirl can verify managed files before the next launch.',
        actions: ['compatibility', 'repair', 'mods'],
      };
    if (/nosuchmethoderror|noclassdeffounderror|classnotfoundexception/.test(text))
      return {
        kind: 'mods',
        title: 'A mod or dependency is incompatible',
        detail: 'One mod expects code that is missing from this Minecraft or dependency version.',
        actions: ['compatibility', 'mods'],
      };
    if (/opengl|glfw error|failed to create.*(?:window|context)|graphics driver/.test(text))
      return {
        kind: 'graphics',
        title: 'Minecraft could not initialize graphics',
        detail: 'Update the approved graphics driver or disable incompatible shaders and overlays.',
        actions: ['folder'],
      };
    if (/accessdeniedexception|access is denied|being used by another process/.test(text))
      return {
        kind: 'files',
        title: 'A required file is locked',
        detail: 'Close Minecraft and tools using this profile, then try Repair files.',
        actions: ['repair', 'folder'],
      };
    return {
      kind: 'unknown',
      title: 'Minecraft closed unexpectedly',
      detail:
        exitCode == null
          ? 'Minecraft did not finish starting.'
          : `Minecraft exited with code ${exitCode}.`,
      actions: ['repair', 'folder'],
    };
  }

  async latest() {
    let entries;
    try {
      entries = await fsp.readdir(this.crashRoot, { withFileTypes: true });
    } catch {
      return null;
    }
    const reports = [];
    for (const entry of entries) {
      if (!entry.isFile() || !entry.name.endsWith('.json')) continue;
      const file = path.join(this.crashRoot, entry.name);
      const stat = await fsp.stat(file).catch(() => null);
      if (stat) reports.push({ file, name: entry.name, modifiedAt: stat.mtimeMs });
    }
    reports.sort((left, right) => right.modifiedAt - left.modifiedAt);
    for (const candidate of reports.slice(0, 20)) {
      try {
        const report = JSON.parse(await fsp.readFile(candidate.file, 'utf8'));
        if (report.exitCode === 0 || report.crashed === false || !report.finishedAt) continue;
        const logFile = candidate.file.replace(/\.json$/i, '.log');
        const log = fs.existsSync(logFile) ? await this.tail(logFile) : '';
        return {
          id: candidate.name.replace(/\.json$/i, ''),
          occurredAt:
            report.finishedAt || report.startedAt || new Date(candidate.modifiedAt).toISOString(),
          minecraftVersion: String(report.minecraftVersion || ''),
          profile: report.profile
            ? {
                id: String(report.profile.id || ''),
                name: String(report.profile.name || 'Profile'),
              }
            : null,
          exitCode: Number.isInteger(report.exitCode) ? report.exitCode : null,
          ...this.explain(log, report.exitCode),
        };
      } catch {}
    }
    return null;
  }
}

module.exports = CrashAssistant;
