// @ts-check
/** @typedef {'system'|'manual'|'direct'} NetworkMode */
/** @typedef {'online'|'prefer-offline'|'offline'} OfflineMode */
/** @typedef {'notify'|'automatic'|'disabled'|'managed'} UpdatePolicy */
/** @typedef {'queued'|'running'|'paused'|'succeeded'|'failed'|'cancelled'} JobState */

/**
 * @typedef {object} JobRecord
 * @property {string} id
 * @property {string} type
 * @property {string} scope
 * @property {JobState} state
 * @property {string} message
 * @property {number} completed
 * @property {number} total
 * @property {boolean} retryable
 * @property {boolean} cancellable
 * @property {boolean} recoverable
 * @property {string} createdAt
 * @property {string} updatedAt
 * @property {string=} error
 */

/**
 * @typedef {object} ReadinessArtifact
 * @property {string} relativePath
 * @property {number} size
 * @property {string} hash
 */

/**
 * @typedef {object} ReadinessReport
 * @property {boolean} complete
 * @property {string} profileId
 * @property {string} gameVersion
 * @property {ReadinessArtifact[]} artifacts
 * @property {unknown[]=} required
 * @property {unknown[]=} present
 * @property {unknown[]=} invalid
 * @property {unknown[]=} repairable
 * @property {unknown[]=} networkRequired
 */

/**
 * @typedef {object} DiagnosticsReport
 * @property {string} generatedAt
 * @property {NetworkMode} mode
 * @property {boolean} managed
 * @property {Array<{name: string, ok: boolean, category?: string, message?: string}>} checks
 */

/**
 * @typedef {object} NetworkTransport
 * @property {(settings: {mode: NetworkMode, manualProxyUrl?: string, offline?: boolean, allowedHosts?: string[]}) => Promise<void>} configure
 * @property {(url: string, options?: object) => Promise<unknown>} getJson
 * @property {(url: string, destination: string, options?: object) => Promise<unknown>} download
 * @property {(url: string, options?: object) => Promise<object>} probe
 */

const CHANNELS = Object.freeze({
  networkDiagnostics: 'network:diagnostics',
  networkSettings: 'network:settings',
  saveNetworkSettings: 'network:save-settings',
  jobsList: 'jobs:list',
  jobsPause: 'jobs:pause',
  jobsResume: 'jobs:resume',
  jobsCancel: 'jobs:cancel',
  jobsRetry: 'jobs:retry',
  offlineReadiness: 'offline:readiness',
  offlineExport: 'offline:export',
  offlineImport: 'offline:import',
  storageReport: 'storage:report',
  storageCleanup: 'storage:cleanup',
});

const NETWORK_MODES = Object.freeze(['system', 'manual', 'direct']);
const OFFLINE_MODES = Object.freeze(['online', 'prefer-offline', 'offline']);
const UPDATE_POLICIES = Object.freeze(['notify', 'automatic', 'disabled', 'managed']);

module.exports = { CHANNELS, NETWORK_MODES, OFFLINE_MODES, UPDATE_POLICIES };
