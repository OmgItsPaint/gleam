const LEGACY_RELEASE = /^1\.(\d+)(?:\.(\d+))?$/;
const CALENDAR_RELEASE = /^(\d{2})\.(\d+)(?:\.(\d+))?$/;
const CALENDAR_EXPERIMENTAL = /^26(?:(?:\.\d+){1,2}-(?:snapshot|pre|rc)-\d+|w\d{2}[a-z])$/;

const FIRST_LEGACY_MINOR = 14;
const FIRST_CALENDAR_YEAR = 26;
const APPROVED_26_RELEASES = new Set(['26.1.2', '26.2']);

function isLegacyRelease(version) {
  const match = LEGACY_RELEASE.exec(String(version));
  return Boolean(match && Number(match[1]) >= FIRST_LEGACY_MINOR);
}

function isCalendarRelease(version) {
  const match = CALENDAR_RELEASE.exec(String(version));
  return Boolean(match && Number(match[1]) >= FIRST_CALENDAR_YEAR);
}

function isStableSupportedVersion(version) {
  const value = String(version);
  if (isLegacyRelease(value)) return true;
  return APPROVED_26_RELEASES.has(value);
}

function isExperimentalVersion(version) {
  return CALENDAR_EXPERIMENTAL.test(String(version));
}

function isSupportedVersion(version, experimental = false) {
  return isStableSupportedVersion(version) || (experimental && isExperimentalVersion(version));
}

function fallbackJavaMajor(version) {
  const value = String(version);
  if (isCalendarRelease(value) || isExperimentalVersion(value)) return 25;
  const match = LEGACY_RELEASE.exec(value);
  if (!match) return 0;
  const minor = Number(match[1]);
  const patch = Number(match[2] || 0);
  if (minor > 20 || (minor === 20 && patch >= 5)) return 21;
  if (minor >= 17) return 17;
  return 8;
}

function compareVersionIds(left, right) {
  const tokens = value => String(value).split(/[^0-9]+/).filter(Boolean).map(Number);
  const a = tokens(left); const b = tokens(right);
  for (let index = 0; index < Math.max(a.length, b.length); index += 1) {
    const difference = (b[index] || 0) - (a[index] || 0);
    if (difference) return difference;
  }
  return String(right).localeCompare(String(left));
}

module.exports = {
  APPROVED_26_RELEASES,
  compareVersionIds,
  fallbackJavaMajor,
  isCalendarRelease,
  isExperimentalVersion,
  isStableSupportedVersion,
  isSupportedVersion
};
