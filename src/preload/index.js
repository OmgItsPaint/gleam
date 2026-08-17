/**
 * The renderer's only bridge to privileged Electron and Node functionality.
 * Each method maps to one validated IPC handler in main.js; no raw ipcRenderer or Node APIs are
 * exposed to page scripts.
 */
const { contextBridge, ipcRenderer } = require('electron');
contextBridge.exposeInMainWorld('icecream', {
  // Local player identity and game startup.
  offlinePlayer: (name) => ipcRenderer.invoke('offline-player', name),
  playerIdentity: () => ipcRenderer.invoke('player-identity'),
  exportPlayerIdentity: (passphrase) => ipcRenderer.invoke('export-player-identity', passphrase),
  importPlayerIdentity: (passphrase) => ipcRenderer.invoke('import-player-identity', passphrase),
  fetchVersions: () => ipcRenderer.invoke('fetch-versions'),
  launchGame: (profile, version, modProfile) =>
    ipcRenderer.invoke('launch-game', profile, version, modProfile),
  gameStatus: () => ipcRenderer.invoke('game-status'),
  latestGameCrash: () => ipcRenderer.invoke('latest-game-crash'),
  sessionStatistics: (profileId = '') => ipcRenderer.invoke('session-statistics', profileId),
  openCrashFolder: () => ipcRenderer.invoke('open-crash-folder'),
  // Client Modrinth browsing and managed installation.
  searchMods: (query, version) => ipcRenderer.invoke('search-mods', query, version),
  featuredMods: (version) => ipcRenderer.invoke('featured-mods', version),
  installMod: (projectId, version, profileId) =>
    ipcRenderer.invoke('install-mod', projectId, version, profileId),
  installModVersion: (projectId, versionId, version, profileId) =>
    ipcRenderer.invoke('install-mod-version', projectId, versionId, version, profileId),
  modProject: (projectId) => ipcRenderer.invoke('mod-project', projectId),
  installedMods: (version, profileId) => ipcRenderer.invoke('installed-mods', version, profileId),
  planModUpdates: (version, profileId) =>
    ipcRenderer.invoke('plan-mod-updates', version, profileId),
  updateMods: (version, profileId) => ipcRenderer.invoke('update-mods', version, profileId),
  checkModCompatibility: (version, profileId) =>
    ipcRenderer.invoke('check-mod-compatibility', version, profileId),
  // Profile lifecycle, backups, worlds, and safe folder access.
  modProfiles: () => ipcRenderer.invoke('mod-profiles'),
  createModProfile: (name, gameVersion, sourceProfileId, transfer) =>
    ipcRenderer.invoke('create-mod-profile', name, gameVersion, sourceProfileId, transfer),
  exportModProfile: (id) => ipcRenderer.invoke('export-mod-profile', id),
  importModProfile: (code) => ipcRenderer.invoke('import-mod-profile', code),
  importServerInvite: (code) => ipcRenderer.invoke('import-server-invite', code),
  testServerInvite: (code) => ipcRenderer.invoke('test-server-invite', code),
  saveModProfile: (id, changes) => ipcRenderer.invoke('save-mod-profile', id, changes),
  duplicateModProfile: (id, name) => ipcRenderer.invoke('duplicate-mod-profile', id, name),
  deleteModProfile: (id) => ipcRenderer.invoke('delete-mod-profile', id),
  repairModProfile: (id) => ipcRenderer.invoke('repair-mod-profile', id),
  syncProfileSettings: (id) => ipcRenderer.invoke('sync-profile-settings', id),
  backupModProfile: (id) => ipcRenderer.invoke('backup-mod-profile', id),
  profileBackups: (id) => ipcRenderer.invoke('profile-backups', id),
  restoreProfileBackup: (id, backupId) =>
    ipcRenderer.invoke('restore-profile-backup', id, backupId),
  deleteProfileBackup: (id, backupId) => ipcRenderer.invoke('delete-profile-backup', id, backupId),
  profileWorlds: (id) => ipcRenderer.invoke('profile-worlds', id),
  copyProfileWorld: (sourceId, worldName, targetId, requestedName) =>
    ipcRenderer.invoke('copy-profile-world', sourceId, worldName, targetId, requestedName),
  duplicateProfileWorld: (id, worldName) =>
    ipcRenderer.invoke('duplicate-profile-world', id, worldName),
  renameProfileWorld: (id, worldName, requestedName) =>
    ipcRenderer.invoke('rename-profile-world', id, worldName, requestedName),
  deleteProfileWorld: (id, worldName) => ipcRenderer.invoke('delete-profile-world', id, worldName),
  exportProfileWorld: (id, worldName) => ipcRenderer.invoke('export-profile-world', id, worldName),
  importProfileWorld: (id) => ipcRenderer.invoke('import-profile-world', id),
  removeMod: (projectId, version, profileId) =>
    ipcRenderer.invoke('remove-mod', projectId, version, profileId),
  openProfileFolder: (id) => ipcRenderer.invoke('open-profile-folder', id),
  profileScreenshots: (id) => ipcRenderer.invoke('profile-screenshots', id),
  profileScreenshotPreview: (id, name) =>
    ipcRenderer.invoke('profile-screenshot-preview', id, name),
  openProfileScreenshot: (id, name) => ipcRenderer.invoke('open-profile-screenshot', id, name),
  removeProfileScreenshot: (id, name) => ipcRenderer.invoke('remove-profile-screenshot', id, name),
  openProfileScreenshotsFolder: (id) => ipcRenderer.invoke('open-profile-screenshots-folder', id),
  // Launcher diagnostics, settings, signed updates, and Fabric loader metadata.
  diagnostics: () => ipcRenderer.invoke('diagnostics'),
  saveDiagnostics: () => ipcRenderer.invoke('save-diagnostics'),
  settings: () => ipcRenderer.invoke('settings'),
  saveSettings: (settings) => ipcRenderer.invoke('save-settings', settings),
  setUiScale: (scale) => ipcRenderer.invoke('set-ui-scale', scale),
  networkSettings: () => ipcRenderer.invoke('network:settings'),
  saveNetworkSettings: (settings) => ipcRenderer.invoke('network:save-settings', settings),
  networkDiagnostics: () => ipcRenderer.invoke('network:diagnostics'),
  jobs: () => ipcRenderer.invoke('jobs:list'),
  pauseJob: (id) => ipcRenderer.invoke('jobs:pause', id),
  resumeJob: (id) => ipcRenderer.invoke('jobs:resume', id),
  cancelJob: (id) => ipcRenderer.invoke('jobs:cancel', id),
  retryJob: (id) => ipcRenderer.invoke('jobs:retry', id),
  offlineReadiness: (profileId) => ipcRenderer.invoke('offline:readiness', profileId),
  exportOfflinePack: (profileId) => ipcRenderer.invoke('offline:export', profileId),
  importOfflinePack: () => ipcRenderer.invoke('offline:import'),
  storageReport: () => ipcRenderer.invoke('storage:report'),
  cleanupStorage: (category, confirmed) =>
    ipcRenderer.invoke('storage:cleanup', category, confirmed),
  checkLauncherUpdate: () => ipcRenderer.invoke('check-launcher-update'),
  stageLauncherUpdate: () => ipcRenderer.invoke('stage-launcher-update'),
  applyLauncherUpdate: () => ipcRenderer.invoke('apply-launcher-update'),
  markLauncherHealthy: () => ipcRenderer.invoke('launcher-healthy'),
  fabricLoaders: (version) => ipcRenderer.invoke('fabric-loaders', version),
  // Independent Fabric server profiles and their managed processes.
  servers: () => ipcRenderer.invoke('servers'),
  createServer: (name, version, port, options) =>
    ipcRenderer.invoke('create-server', name, version, port, options),
  startServer: (id) => ipcRenderer.invoke('start-server', id),
  stopServer: (id) => ipcRenderer.invoke('stop-server', id),
  serverCommand: (id, command) => ipcRenderer.invoke('server-command', id, command),
  serverConsole: (id) => ipcRenderer.invoke('server-console', id),
  serverProperties: (id) => ipcRenderer.invoke('server-properties', id),
  saveServerProperties: (id, changes) => ipcRenderer.invoke('save-server-properties', id, changes),
  approvedServerPlayers: (id) => ipcRenderer.invoke('approved-server-players', id),
  serverAdminState: (id) => ipcRenderer.invoke('server-admin-state', id),
  setServerAdminRole: (id, fingerprint, role) =>
    ipcRenderer.invoke('set-server-admin-role', id, fingerprint, role),
  transferServerOwnership: (id, fingerprint, confirmation) =>
    ipcRenderer.invoke('transfer-server-ownership', id, fingerprint, confirmation),
  setApprovedServerPlayer: (id, name, approved, operator) =>
    ipcRenderer.invoke('set-approved-server-player', id, name, approved, operator),
  serverPlayerAction: (id, name, action) =>
    ipcRenderer.invoke('server-player-action', id, name, action),
  exportServerInvite: (id) => ipcRenderer.invoke('export-server-invite', id),
  saveServerInvite: (id) => ipcRenderer.invoke('save-server-invite', id),
  openServerInviteFile: () => ipcRenderer.invoke('open-server-invite-file'),
  backupServer: (id) => ipcRenderer.invoke('backup-server', id),
  serverBackups: (id) => ipcRenderer.invoke('server-backups', id),
  setServerBackupSchedule: (id, schedule) =>
    ipcRenderer.invoke('set-server-backup-schedule', id, schedule),
  diagnoseServerDomain: (hostname, port) =>
    ipcRenderer.invoke('diagnose-server-domain', hostname, port),
  restoreServerBackup: (id, backupId) => ipcRenderer.invoke('restore-server-backup', id, backupId),
  deleteServerBackup: (id, backupId) => ipcRenderer.invoke('delete-server-backup', id, backupId),
  searchServerMods: (id, query) => ipcRenderer.invoke('search-server-mods', id, query),
  installedServerMods: (id) => ipcRenderer.invoke('installed-server-mods', id),
  installServerMod: (id, projectId, versionId) =>
    ipcRenderer.invoke('install-server-mod', id, projectId, versionId),
  removeServerMod: (id, projectId) => ipcRenderer.invoke('remove-server-mod', id, projectId),
  planServerModUpdates: (id) => ipcRenderer.invoke('plan-server-mod-updates', id),
  updateServerMods: (id) => ipcRenderer.invoke('update-server-mods', id),
  testServerConnection: (id, clientVersion) =>
    ipcRenderer.invoke('test-server-connection', id, clientVersion),
  deleteServer: (id) => ipcRenderer.invoke('delete-server', id),
  openServerFolder: (id) => ipcRenderer.invoke('open-server-folder', id),
  serverLanAddresses: () => ipcRenderer.invoke('server-lan-addresses'),
  windowControl: (action) => ipcRenderer.invoke('window-control', action),
  // Read-only event subscriptions for long-running client and server work.
  onProgress: (callback) =>
    ipcRenderer.on('download-progress', (_, progress) => callback(progress)),
  onServerEvent: (callback) => ipcRenderer.on('server-event', (_, event) => callback(event)),
  onJobsChanged: (callback) => ipcRenderer.on('jobs-changed', (_, items) => callback(items)),
});
