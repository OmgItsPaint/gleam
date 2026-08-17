// @ts-check
const fs = require('fs');
const fsp = fs.promises;
const path = require('path');

const DEFAULT_RESERVE = 64 * 1024 * 1024;

/**
 * @param {string} directory
 * @param {number} neededBytes
 * @param {string} purpose
 * @param {{reserveBytes?: number, statfs?: typeof fsp.statfs}} [options]
 */
async function ensureDiskSpace(
  directory,
  neededBytes,
  purpose,
  { reserveBytes = DEFAULT_RESERVE, statfs = fsp.statfs } = {},
) {
  neededBytes = Math.max(0, Number(neededBytes) || 0);
  reserveBytes = Math.max(0, Number(reserveBytes) || 0);
  let candidate = path.resolve(directory);
  while (!fs.existsSync(candidate)) {
    const parent = path.dirname(candidate);
    if (parent === candidate) return { checked: false, freeBytes: 0, requiredBytes: neededBytes };
    candidate = parent;
  }
  if (typeof statfs !== 'function')
    return { checked: false, freeBytes: 0, requiredBytes: neededBytes };
  const stats = await statfs(candidate);
  const freeBytes = Number(stats.bavail) * Number(stats.bsize);
  const requiredBytes = neededBytes + reserveBytes;
  if (Number.isFinite(freeBytes) && freeBytes < requiredBytes) {
    const missingMiB = Math.ceil((requiredBytes - freeBytes) / 1024 / 1024);
    throw new Error(
      `Not enough free disk space to ${purpose}. Free at least ${missingMiB} MiB and try again.`,
    );
  }
  return { checked: true, freeBytes, requiredBytes };
}

module.exports = { DEFAULT_RESERVE, ensureDiskSpace };
