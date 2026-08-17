/**
 * Electron main-process entry point.
 * It creates the hardened launcher window, owns privileged services, validates renderer input,
 * and exposes narrowly scoped IPC handlers through preload.js.
 */
const { app, BrowserWindow, ipcMain, shell, dialog, safeStorage, session } = require('electron');
const https = require('https');
const fs = require('fs');
const fsp = fs.promises;
const path = require('path');
const crypto = require('crypto');
const { pathToFileURL } = require('url');
const IcecreamEngine = require('../core/launch/launcher-engine');
const IcecreamServerEngine = require('../core/servers/server-engine');
const UpdateService = require('../core/updates/update-service');
const IdentityService = require('../core/identity/identity-service');
const { version: APP_VERSION } = require('../../package.json');
const runtimePaths = require('../shared/runtime-paths');
const ElectronNetworkTransport = require('../platform/electron/network-transport');
const CredentialVault = require('../platform/electron/credential-vault');
const WindowsPolicy = require('../platform/electron/windows-policy');
const JobService = require('../core/jobs/job-service');
const ReadinessService = require('../core/diagnostics/readiness-service');
const StorageService = require('../core/diagnostics/storage-service');
const ProvisioningService = require('../core/provisioning/provisioning-service');
const StructuredLogger = require('../core/diagnostics/structured-logger');
const CrashAssistant = require('../core/diagnostics/crash-assistant');
const ServerDomainService = require('../core/servers/domain-service');
const SessionStatistics = require('../core/diagnostics/session-statistics');
const registerOperations = require('./ipc/operations');
const registerPersistentJobs = require('./lifecycle/persistent-jobs');
const {
  compareVersionIds,
  isExperimentalVersion,
  isStableSupportedVersion,
  isSupportedVersion,
} = require('../shared/version-policy');

// Electron process configuration must be set before the app becomes ready.
app.setName('Gleam');
runtimePaths.configure(app.getAppPath(), process.resourcesPath);
app.commandLine.appendSwitch('disable-features', 'SpellingService');
app.commandLine.appendSwitch('disable-spell-checking');
const hasSingleInstanceLock = app.requestSingleInstanceLock();
if (!hasSingleInstanceLock) app.quit();
const SMOKE_TEST = process.env.SWIRL_SMOKE_TEST === '1';
if (SMOKE_TEST && process.env.SWIRL_SMOKE_USER_DATA) {
  const smokeRoot = path.resolve(process.env.SWIRL_SMOKE_USER_DATA);
  app.setPath('userData', path.join(smokeRoot, 'user-data'));
  app.setPath('appData', path.join(smokeRoot, 'app-data'));
}

let mainWindow;
let engine;
let servers;
let updates;
let identities;
let network;
let credentials;
let policyService;
let jobs;
let readiness;
let storage;
let provisioning;
let logger;
let crashAssistant;
let serverDomains;
let sessionStatistics;
let serverBackupTimer;
let servicesReady = Promise.resolve();
let isQuitting = false;
let gameLaunchPending = false;
let activeGame = null;
const MANIFEST_URL = 'https://launchermeta.mojang.com/mc/game/version_manifest_v2.json';
const FABRIC_GAME_VERSIONS_URL = 'https://meta.fabricmc.net/v2/versions/game';

// This small metadata client is used only to build the supported-version picker.
function getJson(url, redirects = 0) {
  if (network) return network.getJson(url, { maxBytes: 5 * 1024 * 1024, timeout: 20_000 });
  if (redirects > 5)
    return Promise.reject(new Error('Too many redirects while fetching Minecraft versions.'));
  return new Promise((resolve, reject) => {
    const request = https.get(
      url,
      { headers: { 'User-Agent': 'Gleam-Launcher/3.0' } },
      (response) => {
        if (response.statusCode >= 300 && response.statusCode < 400 && response.headers.location) {
          response.resume();
          resolve(getJson(new URL(response.headers.location, url).toString(), redirects + 1));
          return;
        }
        if (response.statusCode !== 200) {
          response.resume();
          reject(new Error(`Request failed (${response.statusCode})`));
          return;
        }
        let body = '';
        response.setEncoding('utf8');
        response.on('data', (chunk) => {
          body += chunk;
          if (body.length > 5 * 1024 * 1024) {
            request.destroy(new Error('Minecraft version response was too large.'));
          }
        });
        response.on('end', () => {
          try {
            resolve(JSON.parse(body));
          } catch (error) {
            reject(error);
          }
        });
      },
    );
    request.setTimeout(20_000, () =>
      request.destroy(new Error('Minecraft version request timed out.')),
    );
    request.on('error', reject);
  });
}

const PROFILE_ID_PATTERN = /^[a-f0-9]{16}$/;
// IPC boundary validators reject paths or versions that were not issued by Swirl.
function requireVersion(version) {
  if (!isSupportedVersion(String(version), true))
    throw new Error('Choose a Minecraft version shown by Gleam.');
  return String(version);
}
function requireProfileId(id) {
  if (!PROFILE_ID_PATTERN.test(String(id))) throw new Error('Choose a valid Gleam profile.');
  return String(id);
}
function offlineUuid(username) {
  const bytes = crypto.createHash('md5').update(`OfflinePlayer:${username}`, 'utf8').digest();
  bytes[6] = (bytes[6] & 0x0f) | 0x30;
  bytes[8] = (bytes[8] & 0x3f) | 0x80;
  return bytes.toString('hex');
}

// Creates the sandboxed renderer and wires smoke-test-only inspection when requested.
function createWindow() {
  if (SMOKE_TEST) console.log('SWIRL_SMOKE_WINDOW');
  mainWindow = new BrowserWindow({
    width: 1180,
    height: 800,
    minWidth: 900,
    minHeight: 650,
    icon: runtimePaths.asset('gleam-logo.png'),
    frame: false,
    transparent: !SMOKE_TEST,
    show: !SMOKE_TEST,
    backgroundColor: SMOKE_TEST ? '#080808' : '#00000000',
    webPreferences: {
      preload: runtimePaths.preload(),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: !SMOKE_TEST,
      spellcheck: false,
    },
  });
  const launcherPage = `${pathToFileURL(runtimePaths.renderer('index.html')).toString()}${SMOKE_TEST ? '?qa=1' : ''}`;
  mainWindow.loadURL(launcherPage).catch((error) => {
    if (SMOKE_TEST) console.error(`SWIRL_SMOKE_LOAD_ERROR: ${error.message}`);
  });
  if (SMOKE_TEST) {
    const rendererErrors = [];
    mainWindow.webContents.on('console-message', (_, level, message) => {
      if (level >= 2) rendererErrors.push(message);
    });
    mainWindow.webContents.once('did-finish-load', () => {
      console.log('SWIRL_SMOKE_LOADED');
      setTimeout(
        async () => {
          try {
            const interaction = await mainWindow.webContents.executeJavaScript(
              'window.__swirlRunSmokeTest()',
            );
            const failed = Object.entries(interaction).filter(
              ([key, value]) => key !== 'unwired' && value !== true,
            );
            if (failed.length)
              rendererErrors.push(`UI interaction failed: ${JSON.stringify(interaction)}`);
          } catch (error) {
            rendererErrors.push(error.message);
          }
          if (rendererErrors.length) {
            console.error(`SWIRL_SMOKE_FAILED: ${rendererErrors.join(' | ')}`);
            process.exitCode = 1;
          } else console.log('SWIRL_SMOKE_OK');
          app.quit();
        },
        process.env.SWIRL_CAPTURE_DIR ? 6000 : 3000,
      );
    });
  }
  if (SMOKE_TEST && process.env.SWIRL_CAPTURE_DIR) {
    mainWindow.webContents.once('did-finish-load', () =>
      setTimeout(async () => {
        const captureDir = path.resolve(process.env.SWIRL_CAPTURE_DIR);
        await fsp.mkdir(captureDir, { recursive: true });
        const views = [
          'play',
          'profiles',
          'profile-editor',
          'profile-health',
          'world-manager',
          'profile-editor-actions',
          'host',
          'host-actions',
          'host-create',
          'settings',
          'settings-managed',
        ];
        for (const name of views) {
          await mainWindow.webContents.executeJavaScript(
            `window.__swirlPrepareCapture(${JSON.stringify(name)})`,
          );
          await new Promise((resolve) => setTimeout(resolve, 120));
          const image = await mainWindow.webContents.capturePage();
          await fsp.writeFile(path.join(captureDir, `${name}.png`), image.toPNG());
        }
      }, 500),
    );
  }
  mainWindow.webContents.setWindowOpenHandler(() => ({ action: 'deny' }));
  mainWindow.webContents.on('will-attach-webview', (event) => event.preventDefault());
  mainWindow.webContents.on('will-navigate', (event, url) => {
    if (!url.startsWith('file:')) event.preventDefault();
  });
  const dataRoot = path.join(app.getPath('appData'), 'icecream-client');
  if (engine) return;
  logger = new StructuredLogger(dataRoot);
  void logger.info('launcher-window-created', {
    version: APP_VERSION,
    packaged: app.isPackaged,
    windowsStore: process.windowsStore === true,
  });
  network = new ElectronNetworkTransport(session.defaultSession, {
    userAgent: `Gleam-Launcher/${APP_VERSION}`,
  });
  credentials = new CredentialVault(dataRoot, safeStorage);
  policyService = new WindowsPolicy();
  identities = new IdentityService(dataRoot, safeStorage);
  engine = new IcecreamEngine(
    dataRoot,
    (event) => {
      if (event.stage === 'game-exit') {
        if (activeGame?.brokerId) identities.closeBroker(activeGame.brokerId);
        activeGame = null;
      }
      if (mainWindow && !mainWindow.isDestroyed())
        mainWindow.webContents.send('download-progress', event);
    },
    { network },
  );
  servers = new IcecreamServerEngine(
    dataRoot,
    (version) => engine.javaForVersion(version),
    (event) => mainWindow && mainWindow.webContents.send('server-event', event),
    { network },
  );
  jobs = new JobService(dataRoot, {
    onChange: (items) =>
      mainWindow && !mainWindow.isDestroyed() && mainWindow.webContents.send('jobs-changed', items),
  });
  readiness = new ReadinessService(engine);
  storage = new StorageService(dataRoot);
  provisioning = new ProvisioningService(dataRoot);
  crashAssistant = new CrashAssistant(dataRoot);
  serverDomains = new ServerDomainService();
  sessionStatistics = new SessionStatistics(dataRoot);
  updates = new UpdateService(dataRoot, APP_VERSION, undefined, { network });
  registerPersistentJobs(jobs, { engine, servers });
  registerOperations(ipcMain, {
    engine,
    jobs,
    network,
    credentials,
    policyService,
    readiness,
    storage,
    provisioning,
    dialog,
    window: () => mainWindow,
  });
  servicesReady = Promise.all([engine.getSettings(), policyService.read(), jobs.init()]).then(
    async ([settings, policy]) => {
      servers.backupRetention = settings.backupRetention || 5;
      jobs.concurrency = settings.jobs?.concurrency || 3;
      await network.configure({
        mode: policy.networkMode || settings.network.mode,
        manualProxyUrl: policy.manualProxyUrl || settings.network.manualProxyUrl,
        offline: policy.offlineOnly === true || settings.offline?.mode === 'offline',
        allowedHosts: policy.allowedEndpoints,
      });
      await logger.info('services-ready', {
        networkMode: network.mode,
        offline: network.offline,
        managed: policy.managed === true,
      });
      const runScheduledBackups = () =>
        servers
          .runScheduledBackups()
          .then((results) => {
            for (const result of results) {
              if (result.state === 'completed' && mainWindow && !mainWindow.isDestroyed())
                mainWindow.webContents.send('server-event', {
                  type: 'scheduled-backup',
                  id: result.id,
                  completedAt: result.completedAt,
                });
            }
          })
          .catch((error) =>
            logger.warn('scheduled-server-backup-failed', { message: error.message }),
          );
      serverBackupTimer = setInterval(runScheduledBackups, 5 * 60 * 1000);
      serverBackupTimer.unref?.();
      void runScheduledBackups();
      const effectiveUpdatePolicy = process.windowsStore
        ? 'managed'
        : policy.updatePolicy || settings.updatePolicy;
      if (effectiveUpdatePolicy === 'automatic' && !network.offline)
        void updates
          .stage()
          .then((result) =>
            logger.info('automatic-update-check', { available: result.available === true }),
          )
          .catch((error) =>
            logger.warn('automatic-update-check-failed', { message: error.message }),
          );
    },
  );
}

// Application lifecycle keeps child game/server processes from being abandoned on exit.
app.whenReady().then(() => {
  createWindow();
  session.defaultSession.setPermissionRequestHandler((_contents, _permission, callback) =>
    callback(false),
  );
  session.defaultSession.setPermissionCheckHandler(() => false);
  app.on('login', async (event, _contents, _details, authInfo, callback) => {
    if (!authInfo.isProxy || !credentials) return;
    event.preventDefault();
    const value = await credentials.loadProxy();
    if (value) callback(value.username, value.password);
    else callback();
  });
  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) createWindow();
  });
});
app.on('second-instance', () => {
  if (!mainWindow) return;
  if (mainWindow.isMinimized()) mainWindow.restore();
  mainWindow.show();
  mainWindow.focus();
});
app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') app.quit();
});
app.on('before-quit', (event) => {
  if (isQuitting || !servers) return;
  isQuitting = true;
  event.preventDefault();
  if (serverBackupTimer) clearInterval(serverBackupTimer);
  identities?.closeAll();
  servers
    .stopAll()
    .catch(() => {})
    .finally(() => app.quit());
});

// Window and local player identity IPC.
ipcMain.handle('window-control', (_, action) => {
  if (!mainWindow) return;
  if (action === 'minimize') mainWindow.minimize();
  if (action === 'close') mainWindow.close();
});
ipcMain.handle('offline-player', async (_, requestedName = '') => {
  const username = String(requestedName || '').trim() || `Gleam${crypto.randomInt(1000, 9999)}`;
  if (!/^[a-zA-Z0-9_]{3,16}$/.test(username))
    throw new Error('Use 3–16 letters, numbers, or underscores for your player name.');
  const identity = await identities.info();
  return {
    username,
    uuid: offlineUuid(username),
    offline: true,
    identityFingerprint: identity.fingerprint,
    identityRecovery: identity.recovery || null,
  };
});
ipcMain.handle('player-identity', async () => identities.info());
ipcMain.handle('export-player-identity', async (_, passphrase) => {
  const recovery = await identities.exportRecovery(String(passphrase || ''));
  const result = await dialog.showSaveDialog(mainWindow, {
    title: 'Save encrypted Gleam identity recovery',
    defaultPath: 'Gleam-player-identity.swirlidentity',
    filters: [{ name: 'Gleam identity recovery', extensions: ['swirlidentity'] }],
  });
  if (result.canceled || !result.filePath) return { saved: false };
  await engine.atomicWrite(result.filePath, recovery);
  return { saved: true, file: result.filePath };
});
ipcMain.handle('import-player-identity', async (_, passphrase) => {
  if (activeGame) throw new Error('Close Minecraft before restoring an identity.');
  const result = await dialog.showOpenDialog(mainWindow, {
    title: 'Open Gleam identity recovery',
    properties: ['openFile'],
    filters: [{ name: 'Gleam identity recovery', extensions: ['swirlidentity', 'json'] }],
  });
  if (result.canceled || !result.filePaths[0]) return { imported: false };
  const stat = await fsp.stat(result.filePaths[0]);
  if (stat.size > 1024 * 1024) throw new Error('That recovery file is too large.');
  return {
    imported: true,
    identity: await identities.importRecovery(
      await fsp.readFile(result.filePaths[0], 'utf8'),
      String(passphrase || ''),
    ),
  };
});
// Minecraft version discovery and launch lifecycle IPC.
ipcMain.handle('fetch-versions', async () => {
  await servicesReady;
  const cacheFile = path.join(engine.root, 'version-manifest-cache.json');
  let manifest;
  let fabricVersions;
  const currentSettings = await engine.getSettings();
  try {
    if (currentSettings.offline?.mode === 'offline') throw new Error('Offline mode is enabled.');
    [manifest, fabricVersions] = await Promise.all([
      getJson(MANIFEST_URL),
      getJson(FABRIC_GAME_VERSIONS_URL),
    ]);
    await engine.atomicWrite(
      cacheFile,
      JSON.stringify({ savedAt: new Date().toISOString(), manifest, fabricVersions }),
    );
  } catch (networkError) {
    try {
      const cached = JSON.parse(await fsp.readFile(cacheFile, 'utf8'));
      manifest = cached.manifest;
      fabricVersions = cached.fabricVersions || [];
    } catch {
      const profiles = await engine.getModProfiles();
      const settings = await engine.getSettings();
      const local = [
        ...new Set(
          profiles
            .map((profile) => profile.gameVersion)
            .filter((version) =>
              isSupportedVersion(version, settings.experimentalVersions === true),
            ),
        ),
      ];
      if (local.length) return local.map((id) => ({ id, type: 'release', offline: true }));
      throw new Error(
        'Gleam could not reach Minecraft services and has no saved versions yet. Check your connection and try again.',
      );
    }
  }
  const settings = currentSettings;
  const fabric = new Map((fabricVersions || []).map((item) => [item.version, item]));
  const hasFabricCatalog = fabric.size > 0;
  return manifest.versions
    .filter((version) => {
      const fabricEntry = fabric.get(version.id);
      if (hasFabricCatalog && !fabricEntry) return false;
      if (version.type === 'release')
        return (
          isStableSupportedVersion(version.id) && (!hasFabricCatalog || fabricEntry.stable === true)
        );
      return (
        settings.experimentalVersions === true &&
        isExperimentalVersion(version.id) &&
        (!hasFabricCatalog || fabricEntry.stable === false)
      );
    })
    .map((version) => ({
      id: version.id,
      type: version.type,
      experimental: version.type !== 'release',
      offline: !hasFabricCatalog,
    }))
    .sort((left, right) => compareVersionIds(left.id, right.id));
});
ipcMain.handle('launch-game', async (_, profile, versionId, modProfile) => {
  await servicesReady;
  if (gameLaunchPending) throw new Error('Minecraft is already starting.');
  if (activeGame) throw new Error('Minecraft is already running. Close it before playing again.');
  versionId = requireVersion(versionId);
  if (!modProfile || !modProfile.id) throw new Error('Choose a profile before launching.');
  requireProfileId(modProfile.id);
  const username = String(profile?.username || '').trim();
  if (!/^[a-zA-Z0-9_]{3,16}$/.test(username))
    throw new Error('Choose a player name before launching.');
  gameLaunchPending = true;
  let broker;
  try {
    broker = await identities.startBroker(username, modProfile.enrollmentToken || '');
    const launched = await engine.launchGame(
      username,
      versionId,
      { uuid: offlineUuid(username), accessToken: 'swirl-offline', swirlIdentity: broker },
      modProfile,
      {
        offlineModeOverride: (await policyService.read()).offlineOnly === true ? 'offline' : '',
      },
    );
    activeGame = {
      pid: launched.pid,
      versionId,
      profileId: modProfile.id,
      brokerId: broker.id,
      startedAt: new Date().toISOString(),
    };
    return launched;
  } catch (error) {
    if (broker?.id) identities.closeBroker(broker.id);
    throw error;
  } finally {
    gameLaunchPending = false;
  }
});
ipcMain.handle('game-status', async () => ({
  starting: gameLaunchPending,
  running: Boolean(activeGame),
  ...(activeGame || {}),
}));
ipcMain.handle('latest-game-crash', async () => crashAssistant.latest());
ipcMain.handle('session-statistics', async (_, profileId = '') =>
  sessionStatistics.summary(profileId ? requireProfileId(profileId) : ''),
);
ipcMain.handle('open-crash-folder', async () => {
  await fsp.mkdir(crashAssistant.crashRoot, { recursive: true });
  const error = await shell.openPath(crashAssistant.crashRoot);
  if (error) throw new Error(error);
  return true;
});
// Client Modrinth catalog, installation, and compatibility IPC.
ipcMain.handle('search-mods', async (_, query, gameVersion = '26.2') =>
  engine.searchModrinthMods(String(query || '').slice(0, 100), requireVersion(gameVersion)),
);
ipcMain.handle('featured-mods', async (_, gameVersion = '26.2') =>
  engine.getFeaturedModrinthMods(requireVersion(gameVersion)),
);
ipcMain.handle('install-mod', async (_, projectId, gameVersion, profileId) =>
  engine.installModrinthMod(
    String(projectId),
    requireVersion(gameVersion),
    new Set(),
    '',
    requireProfileId(profileId),
  ),
);
ipcMain.handle('install-mod-version', async (_, projectId, versionId, gameVersion, profileId) =>
  engine.installModrinthMod(
    String(projectId),
    requireVersion(gameVersion),
    new Set(),
    String(versionId),
    requireProfileId(profileId),
  ),
);
ipcMain.handle('mod-project', async (_, projectId) =>
  engine.getJson(`https://api.modrinth.com/v2/project/${encodeURIComponent(projectId)}`),
);
ipcMain.handle('installed-mods', async (_, gameVersion, profileId) =>
  engine.getInstalledMods(requireVersion(gameVersion), requireProfileId(profileId)),
);
ipcMain.handle('plan-mod-updates', async (_, gameVersion, profileId) =>
  engine.planModUpdates(requireVersion(gameVersion), requireProfileId(profileId)),
);
ipcMain.handle('update-mods', async (_, gameVersion, profileId) =>
  jobs.executePersistent(
    'mod-update',
    `profile:${requireProfileId(profileId)}`,
    { gameVersion: requireVersion(gameVersion), profileId: requireProfileId(profileId) },
    { message: 'Waiting to update profile mods', cancellable: false },
  ),
);
ipcMain.handle('check-mod-compatibility', async (_, gameVersion, profileId) =>
  engine.preflightMods(requireVersion(gameVersion), requireProfileId(profileId)),
);
// Isolated profile creation, sharing, repair, backup, and world-management IPC.
ipcMain.handle('mod-profiles', async () => engine.getModProfiles());
ipcMain.handle('create-mod-profile', async (_, name, gameVersion, sourceProfileId, transfer = {}) =>
  engine.createModProfile(
    String(name || ''),
    requireVersion(gameVersion),
    sourceProfileId ? requireProfileId(sourceProfileId) : '',
    transfer,
  ),
);
ipcMain.handle('export-mod-profile', async (_, id) =>
  engine.exportModProfile(requireProfileId(id)),
);
ipcMain.handle('import-mod-profile', async (_, code) => engine.importModProfile(code));
ipcMain.handle('import-server-invite', async (_, code) => engine.importServerInvite(code));
ipcMain.handle('test-server-invite', async (_, code) => {
  const invite = await engine.parseServerInvite(code);
  const attempts = [];
  for (const address of invite.addresses) {
    try {
      const response = await servers.minecraftStatus(address, invite.port, 2500);
      return { ok: true, address, response, invite, attempts };
    } catch (error) {
      attempts.push({ address, error: error.message });
    }
  }
  return { ok: false, invite, attempts };
});
ipcMain.handle('save-mod-profile', async (_, id, changes) =>
  engine.setModProfile(requireProfileId(id), changes),
);
ipcMain.handle('duplicate-mod-profile', async (_, id, name) =>
  engine.duplicateModProfile(requireProfileId(id), String(name || '')),
);
ipcMain.handle('delete-mod-profile', async (_, id) =>
  engine.deleteModProfile(requireProfileId(id)),
);
ipcMain.handle('repair-mod-profile', async (_, id) =>
  jobs.executePersistent(
    'profile-repair',
    `profile:${requireProfileId(id)}`,
    { profileId: requireProfileId(id) },
    { message: 'Waiting to repair managed files', cancellable: false },
  ),
);
ipcMain.handle('sync-profile-settings', async (_, id) =>
  engine.syncMinecraftSettings(requireProfileId(id)),
);
ipcMain.handle('backup-mod-profile', async (_, id) =>
  jobs.executePersistent(
    'profile-backup',
    `profile:${requireProfileId(id)}`,
    { profileId: requireProfileId(id) },
    { message: 'Waiting to back up profile', cancellable: false },
  ),
);
ipcMain.handle('profile-backups', async (_, id) => engine.listProfileBackups(requireProfileId(id)));
ipcMain.handle('restore-profile-backup', async (_, id, backupId = '') =>
  engine.restoreProfileBackup(requireProfileId(id), String(backupId || '')),
);
ipcMain.handle('delete-profile-backup', async (_, id, backupId) =>
  engine.deleteProfileBackup(requireProfileId(id), String(backupId || '')),
);
ipcMain.handle('profile-worlds', async (_, id) => engine.listWorlds(requireProfileId(id)));
ipcMain.handle('copy-profile-world', async (_, sourceId, worldName, targetId, requestedName = '') =>
  engine.copyWorld(
    requireProfileId(sourceId),
    String(worldName || ''),
    requireProfileId(targetId),
    String(requestedName || ''),
  ),
);
ipcMain.handle('duplicate-profile-world', async (_, id, worldName) =>
  engine.duplicateWorld(requireProfileId(id), String(worldName || '')),
);
ipcMain.handle('rename-profile-world', async (_, id, worldName, requestedName) =>
  engine.renameWorld(requireProfileId(id), String(worldName || ''), String(requestedName || '')),
);
ipcMain.handle('delete-profile-world', async (_, id, worldName) =>
  engine.deleteWorld(requireProfileId(id), String(worldName || '')),
);
ipcMain.handle('export-profile-world', async (_, id, worldName) => {
  const result = await dialog.showOpenDialog(mainWindow, {
    title: 'Choose where to copy the world',
    properties: ['openDirectory', 'createDirectory'],
  });
  if (result.canceled || !result.filePaths[0]) return { saved: false };
  return {
    saved: true,
    ...(await engine.exportWorld(
      requireProfileId(id),
      String(worldName || ''),
      result.filePaths[0],
    )),
  };
});
ipcMain.handle('import-profile-world', async (_, id) => {
  const result = await dialog.showOpenDialog(mainWindow, {
    title: 'Choose a Minecraft world folder',
    properties: ['openDirectory'],
  });
  if (result.canceled || !result.filePaths[0]) return { imported: false };
  return {
    imported: true,
    ...(await engine.importWorld(requireProfileId(id), result.filePaths[0])),
  };
});
ipcMain.handle('remove-mod', async (_, projectId, gameVersion, profileId) =>
  engine.removeMod(String(projectId), requireVersion(gameVersion), requireProfileId(profileId)),
);
ipcMain.handle('open-profile-folder', async (_, id) => {
  const profile = (await engine.getModProfiles()).find((item) => item.id === requireProfileId(id));
  if (!profile) throw new Error('That profile was not found.');
  await engine.repairModProfile(profile.id);
  const error = await shell.openPath(engine.instanceDirectory(profile.gameVersion, profile.id));
  if (error) throw new Error(error);
  return true;
});
ipcMain.handle('profile-screenshots', async (_, id) =>
  engine.listScreenshots(requireProfileId(id)),
);
ipcMain.handle('profile-screenshot-preview', async (_, id, name) => {
  const context = await engine.screenshotContext(requireProfileId(id), String(name || ''));
  const mime = /\.jpe?g$/i.test(context.name) ? 'image/jpeg' : 'image/png';
  return `data:${mime};base64,${(await fsp.readFile(context.file)).toString('base64')}`;
});
ipcMain.handle('open-profile-screenshot', async (_, id, name) => {
  const context = await engine.screenshotContext(requireProfileId(id), String(name || ''));
  const error = await shell.openPath(context.file);
  if (error) throw new Error(error);
  return true;
});
ipcMain.handle('remove-profile-screenshot', async (_, id, name) =>
  engine.removeScreenshot(requireProfileId(id), String(name || '')),
);
ipcMain.handle('open-profile-screenshots-folder', async (_, id) => {
  const context = await engine.screenshotContext(requireProfileId(id));
  const error = await shell.openPath(context.directory);
  if (error) throw new Error(error);
  return true;
});
// Diagnostics, settings, and signed launcher-update IPC.
ipcMain.handle('diagnostics', async () => {
  await servicesReady;
  const policy = await policyService.read();
  return {
    ...(await engine.diagnostics()),
    network: { mode: network.mode },
    policy: {
      managed: policy.managed === true,
      updatePolicy: process.windowsStore ? 'managed' : policy.updatePolicy || null,
      offlineOnly: policy.offlineOnly === true,
    },
  };
});
ipcMain.handle('save-diagnostics', async () => {
  await servicesReady;
  const policy = await policyService.read();
  if (policy.diagnosticsExportEnabled === false)
    throw new Error('Your administrator has disabled diagnostic exports.');
  const report = {
    generatedAt: new Date().toISOString(),
    launcher: await engine.diagnostics(),
    policy: {
      managed: policy.managed === true,
      networkMode: policy.networkMode || null,
      offlineOnly: policy.offlineOnly === true,
    },
    network: { mode: network.mode },
    servers: (await servers.list()).map(({ runtime, ...server }) => ({
      id: server.id,
      name: server.name,
      version: server.version,
      port: server.port,
      memoryMb: server.memoryMb,
      state: runtime?.state || 'stopped',
    })),
  };
  const result = await dialog.showSaveDialog(mainWindow, {
    title: 'Save Gleam troubleshooting report',
    defaultPath: `Gleam-support-${new Date().toISOString().slice(0, 10)}.json`,
    filters: [{ name: 'JSON report', extensions: ['json'] }],
  });
  if (result.canceled || !result.filePath) return { saved: false };
  await engine.atomicWrite(result.filePath, JSON.stringify(report, null, 2));
  return { saved: true, file: result.filePath };
});
ipcMain.handle('settings', async () => {
  await servicesReady;
  const [settings, policy] = await Promise.all([engine.getSettings(), policyService.read()]);
  return {
    ...settings,
    effectivePolicy: {
      managed: policy.managed === true,
      networkMode: policy.networkMode || null,
      offlineOnly: policy.offlineOnly === true,
      updatePolicy: process.windowsStore ? 'managed' : policy.updatePolicy || null,
      serverHostingEnabled: policy.serverHostingEnabled !== false,
      diagnosticsExportEnabled: policy.diagnosticsExportEnabled !== false,
    },
  };
});
ipcMain.handle('save-settings', async (_, settings) => {
  await servicesReady;
  const saved = await engine.setSettings(settings);
  if (servers) servers.backupRetention = saved.backupRetention;
  if (jobs) jobs.concurrency = saved.jobs?.concurrency || 3;
  const policy = await policyService.read();
  await network.configure({
    mode: policy.networkMode || saved.network.mode,
    manualProxyUrl: policy.manualProxyUrl || saved.network.manualProxyUrl,
    offline: policy.offlineOnly === true || saved.offline?.mode === 'offline',
    allowedHosts: policy.allowedEndpoints,
  });
  return saved;
});
ipcMain.handle('set-ui-scale', async (_, scale) => {
  const value = Math.max(0.8, Math.min(1.4, Number(scale) || 1));
  mainWindow?.webContents.setZoomFactor(value);
  return value;
});
async function requireLauncherUpdateAction(action) {
  await servicesReady;
  const [settings, policy] = await Promise.all([engine.getSettings(), policyService.read()]);
  const effective = process.windowsStore ? 'managed' : policy.updatePolicy || settings.updatePolicy;
  if (effective === 'managed')
    throw new Error(
      'This installation is updated by your administrator or Microsoft package management.',
    );
  if (effective === 'disabled') throw new Error('Launcher updates are disabled.');
  if (action === 'install' && effective === 'notify') return effective;
  return effective;
}
ipcMain.handle('check-launcher-update', async () => {
  await requireLauncherUpdateAction('check');
  return updates.check();
});
ipcMain.handle('stage-launcher-update', async () => {
  await requireLauncherUpdateAction('install');
  return updates.stage();
});
ipcMain.handle('apply-launcher-update', async () => {
  await requireLauncherUpdateAction('install');
  const result = await updates.apply();
  setTimeout(() => app.quit(), 800);
  return result;
});
ipcMain.handle('launcher-healthy', async () => updates.markHealthy());
// Independent Fabric server profile and process IPC.
async function requireServerHosting() {
  await servicesReady;
  const policy = await policyService.read();
  if (policy.serverHostingEnabled === false)
    throw new Error('Server hosting is disabled by your administrator.');
}
ipcMain.handle('fabric-loaders', async (_, gameVersion) =>
  engine.getFabricLoaders(requireVersion(gameVersion)),
);
ipcMain.handle('servers', async () => servers.list());
ipcMain.handle('create-server', async (_, name, version, port, options = {}) => {
  await requireServerHosting();
  const hostIdentity = await identities.info();
  return jobs.execute(
    'server-create',
    'servers:create',
    () =>
      servers.create(name, requireVersion(version), port, {
        template: String(options?.template || 'friends'),
        whitelist: options?.whitelist === true,
        acceptEula: options?.acceptEula === true,
        memoryMb: Number(options?.memoryMb),
        hostName: String(options?.hostName || ''),
        hostIdentity,
      }),
    { message: 'Waiting to create server', cancellable: false },
  );
});
ipcMain.handle('start-server', async (_, id) => {
  await requireServerHosting();
  return servers.start(requireProfileId(id));
});
ipcMain.handle('stop-server', async (_, id) => servers.stop(requireProfileId(id)));
ipcMain.handle('server-command', async (_, id, command) =>
  servers.command(requireProfileId(id), command),
);
ipcMain.handle('server-console', async (_, id) => servers.console(requireProfileId(id)));
ipcMain.handle('server-properties', async (_, id) => servers.getProperties(requireProfileId(id)));
ipcMain.handle('save-server-properties', async (_, id, changes) =>
  servers.setProperties(requireProfileId(id), changes),
);
ipcMain.handle('approved-server-players', async (_, id) =>
  servers.approvedPlayers(requireProfileId(id)),
);
ipcMain.handle('server-admin-state', async (_, id) => servers.adminState(requireProfileId(id)));
ipcMain.handle('set-server-admin-role', async (_, id, targetFingerprint, role) => {
  const actor = await identities.info();
  return servers.setAdminRole(
    requireProfileId(id),
    actor.fingerprint,
    String(targetFingerprint || ''),
    String(role || ''),
  );
});
ipcMain.handle('transfer-server-ownership', async (_, id, targetFingerprint, confirmation) => {
  const actor = await identities.info();
  return servers.transferOwnership(
    requireProfileId(id),
    actor.fingerprint,
    String(targetFingerprint || ''),
    String(confirmation || ''),
  );
});
ipcMain.handle('set-approved-server-player', async (_, id, name, approved, operator) =>
  servers.setApprovedPlayer(
    requireProfileId(id),
    String(name || ''),
    approved === true,
    operator === true,
  ),
);
ipcMain.handle('server-player-action', async (_, id, name, action) =>
  servers.playerAction(requireProfileId(id), String(name || ''), String(action || '')),
);
ipcMain.handle('export-server-invite', async (_, id) => servers.exportInvite(requireProfileId(id)));
ipcMain.handle('save-server-invite', async (_, id) => {
  const server = (await servers.list()).find((item) => item.id === requireProfileId(id));
  if (!server) throw new Error('Server not found.');
  const code = await servers.exportInvite(server.id);
  const result = await dialog.showSaveDialog(mainWindow, {
    title: 'Save Gleam server invite',
    defaultPath: `${server.name.replace(/[^a-z0-9_-]+/gi, '-')}.swirlinvite`,
    filters: [{ name: 'Gleam server invite', extensions: ['swirlinvite'] }],
  });
  if (result.canceled || !result.filePath) return { saved: false };
  await engine.atomicWrite(result.filePath, code);
  return { saved: true, file: result.filePath };
});
ipcMain.handle('open-server-invite-file', async () => {
  const result = await dialog.showOpenDialog(mainWindow, {
    title: 'Open Gleam server invite',
    properties: ['openFile'],
    filters: [{ name: 'Gleam server invite', extensions: ['swirlinvite', 'txt'] }],
  });
  if (result.canceled || !result.filePaths[0]) return { opened: false };
  const stat = await fsp.stat(result.filePaths[0]);
  if (stat.size > 2 * 1024 * 1024) throw new Error('That invite file is too large.');
  return { opened: true, code: (await fsp.readFile(result.filePaths[0], 'utf8')).trim() };
});
ipcMain.handle('backup-server', async (_, id) =>
  jobs.executePersistent(
    'server-backup',
    `server:${requireProfileId(id)}`,
    { serverId: requireProfileId(id) },
    { message: 'Waiting to back up server', cancellable: false },
  ),
);
ipcMain.handle('server-backups', async (_, id) => servers.listBackups(requireProfileId(id)));
ipcMain.handle('set-server-backup-schedule', async (_, id, schedule) =>
  servers.setBackupSchedule(requireProfileId(id), String(schedule || 'off')),
);
ipcMain.handle('diagnose-server-domain', async (_, hostname, port) => {
  await requireServerHosting();
  return serverDomains.diagnose(String(hostname || ''), Number(port));
});
ipcMain.handle('restore-server-backup', async (_, id, backupId) =>
  jobs.executePersistent(
    'server-restore',
    `server:${requireProfileId(id)}`,
    { serverId: requireProfileId(id), backupId: String(backupId || '') },
    { message: 'Waiting to restore server backup', cancellable: false },
  ),
);
ipcMain.handle('delete-server-backup', async (_, id, backupId) =>
  servers.deleteBackup(requireProfileId(id), String(backupId || '')),
);
ipcMain.handle('search-server-mods', async (_, id, query) =>
  servers.searchMods(requireProfileId(id), String(query || '')),
);
ipcMain.handle('installed-server-mods', async (_, id) =>
  servers.installedMods(requireProfileId(id)),
);
ipcMain.handle('install-server-mod', async (_, id, projectId, versionId = '') =>
  jobs.executePersistent(
    'server-mod-install',
    `server:${requireProfileId(id)}`,
    {
      serverId: requireProfileId(id),
      projectId: String(projectId || ''),
      versionId: String(versionId || ''),
    },
    { message: 'Waiting to install server mod', cancellable: false },
  ),
);
ipcMain.handle('remove-server-mod', async (_, id, projectId) =>
  servers.removeMod(requireProfileId(id), String(projectId || '')),
);
ipcMain.handle('plan-server-mod-updates', async (_, id) =>
  servers.planModUpdates(requireProfileId(id)),
);
ipcMain.handle('update-server-mods', async (_, id) =>
  jobs.executePersistent(
    'server-mod-update',
    `server:${requireProfileId(id)}`,
    { serverId: requireProfileId(id) },
    { message: 'Waiting to update server mods', cancellable: false },
  ),
);
ipcMain.handle('test-server-connection', async (_, id, clientVersion = '') =>
  servers.diagnose(requireProfileId(id), String(clientVersion || '')),
);
ipcMain.handle('delete-server', async (_, id) => servers.remove(requireProfileId(id)));
ipcMain.handle('open-server-folder', async (_, id) => {
  const error = await shell.openPath(servers.dir(requireProfileId(id)));
  if (error) throw new Error(error);
  return true;
});
ipcMain.handle('server-lan-addresses', async () => servers.lanAddresses());
