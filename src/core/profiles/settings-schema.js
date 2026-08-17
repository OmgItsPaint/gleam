const { isSupportedVersion } = require('../../shared/version-policy');

const DEFAULTS = Object.freeze({
  format: 2,
  autoUpdate: true,
  updatePolicy: 'notify',
  fabricLoaderVersion: '',
  activeProfiles: {},
  lastVersion: '26.2',
  beginnerMode: true,
  experimentalVersions: false,
  backupRetention: 5,
  uiScale: 1,
  reducedMotion: false,
  readableFont: false,
  network: { mode: 'system', manualProxyUrl: '' },
  offline: { mode: 'online' },
  jobs: { concurrency: 3 },
  diagnostics: { allowExport: true },
});

function defaults() {
  return {
    ...DEFAULTS,
    activeProfiles: {},
    network: { ...DEFAULTS.network },
    offline: { ...DEFAULTS.offline },
    jobs: { ...DEFAULTS.jobs },
    diagnostics: { ...DEFAULTS.diagnostics },
  };
}

function normalizeLoaded(loaded = {}) {
  const base = defaults();
  return {
    ...base,
    ...loaded,
    format: 2,
    updatePolicy: ['notify', 'automatic', 'disabled', 'managed'].includes(loaded.updatePolicy)
      ? loaded.updatePolicy
      : loaded.autoUpdate === true
        ? 'notify'
        : 'disabled',
    network: { ...base.network, ...(loaded.network || {}) },
    offline: { ...base.offline, ...(loaded.offline || {}) },
    jobs: { ...base.jobs, ...(loaded.jobs || {}) },
    diagnostics: { ...base.diagnostics, ...(loaded.diagnostics || {}) },
  };
}

function merge(current, input = {}) {
  const experimentalVersions =
    typeof input.experimentalVersions === 'boolean'
      ? input.experimentalVersions
      : current.experimentalVersions === true;
  return {
    ...current,
    format: 2,
    autoUpdate: typeof input.autoUpdate === 'boolean' ? input.autoUpdate : current.autoUpdate,
    beginnerMode:
      typeof input.beginnerMode === 'boolean' ? input.beginnerMode : current.beginnerMode,
    experimentalVersions,
    backupRetention: Math.max(
      1,
      Math.min(20, Number(input.backupRetention ?? current.backupRetention) || 5),
    ),
    uiScale: Math.max(0.8, Math.min(1.4, Number(input.uiScale ?? current.uiScale) || 1)),
    reducedMotion:
      typeof input.reducedMotion === 'boolean'
        ? input.reducedMotion
        : current.reducedMotion === true,
    readableFont:
      typeof input.readableFont === 'boolean' ? input.readableFont : current.readableFont === true,
    updatePolicy: ['notify', 'automatic', 'disabled', 'managed'].includes(input.updatePolicy)
      ? input.updatePolicy
      : current.updatePolicy,
    network: {
      mode: ['system', 'manual', 'direct'].includes(input.network?.mode)
        ? input.network.mode
        : current.network.mode,
      manualProxyUrl:
        typeof input.network?.manualProxyUrl === 'string'
          ? input.network.manualProxyUrl.slice(0, 2048)
          : current.network.manualProxyUrl,
    },
    offline: {
      mode: ['online', 'prefer-offline', 'offline'].includes(input.offline?.mode)
        ? input.offline.mode
        : current.offline.mode,
    },
    jobs: {
      concurrency: Math.max(
        1,
        Math.min(8, Number(input.jobs?.concurrency ?? current.jobs.concurrency) || 3),
      ),
    },
    diagnostics: {
      allowExport:
        typeof input.diagnostics?.allowExport === 'boolean'
          ? input.diagnostics.allowExport
          : current.diagnostics.allowExport !== false,
    },
    lastVersion:
      typeof input.lastVersion === 'string' &&
      isSupportedVersion(input.lastVersion, experimentalVersions)
        ? input.lastVersion
        : current.lastVersion,
    fabricLoaderVersions: {
      ...(current.fabricLoaderVersions || {}),
      ...(input.fabricLoaderVersions && typeof input.fabricLoaderVersions === 'object'
        ? input.fabricLoaderVersions
        : {}),
    },
    activeProfiles:
      input.replaceActiveProfiles === true
        ? { ...(input.activeProfiles || {}) }
        : {
            ...(current.activeProfiles || {}),
            ...(input.activeProfiles && typeof input.activeProfiles === 'object'
              ? input.activeProfiles
              : {}),
          },
  };
}

module.exports = { DEFAULTS, defaults, normalizeLoaded, merge };
