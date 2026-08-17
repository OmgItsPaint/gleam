/** Builds private, local play statistics from Swirl's bounded launch records. */
const fs = require('fs');
const path = require('path');

class SessionStatistics {
  constructor(appData) {
    this.directory = path.join(appData, '.icecream_client', 'crash-reports');
  }

  async summary(profileId = '') {
    const entries = await fs.promises
      .readdir(this.directory, { withFileTypes: true })
      .catch(() => []);
    const records = [];
    for (const entry of entries
      .filter((item) => item.isFile() && item.name.endsWith('.json'))
      .slice(-500)) {
      try {
        const record = JSON.parse(
          await fs.promises.readFile(path.join(this.directory, entry.name), 'utf8'),
        );
        if (profileId && record.profile?.id !== profileId) continue;
        const started = Date.parse(record.startedAt);
        const finished = Date.parse(record.finishedAt);
        if (!Number.isFinite(started) || !Number.isFinite(finished) || finished < started) continue;
        records.push({
          started,
          durationMs: Math.min(24 * 60 * 60 * 1000, finished - started),
          crashed: record.crashed === true || Number(record.exitCode) !== 0,
        });
      } catch {}
    }
    const sevenDaysAgo = Date.now() - 7 * 24 * 60 * 60 * 1000;
    return {
      sessions: records.length,
      totalPlayMs: records.reduce((total, record) => total + record.durationMs, 0),
      recentPlayMs: records
        .filter((record) => record.started >= sevenDaysAgo)
        .reduce((total, record) => total + record.durationMs, 0),
      crashes: records.filter((record) => record.crashed).length,
      lastPlayedAt: records.length
        ? new Date(Math.max(...records.map((record) => record.started))).toISOString()
        : null,
    };
  }
}

module.exports = SessionStatistics;
