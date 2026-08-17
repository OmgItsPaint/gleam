const path = require('path');
const { CHANNELS, NETWORK_MODES, OFFLINE_MODES } = require('../../shared/contracts');
const validation = require('../../shared/validation');

function publicReadiness(report) {
  return {
    ...report,
    java: report.java?.available
      ? { available: true, major: report.java.major }
      : {
          available: false,
          major: report.java?.major,
          error: 'The required Java runtime is unavailable.',
        },
    artifacts: report.artifacts.map(({ relativePath, size, hash }) => ({
      relativePath,
      size,
      hash,
    })),
  };
}

function registerOperations(ipcMain, services) {
  const {
    engine,
    jobs,
    network,
    credentials,
    policyService,
    readiness,
    provisioning,
    storage,
    dialog,
    window,
  } = services;
  jobs.register('offline-export', async ({ profileId, destination }, { signal, progress }) => {
    if (signal.aborted) throw signal.reason;
    const report = await readiness.report(profileId);
    return provisioning.exportPack(destination, report, {
      signal,
      onProgress: (done, total) => void progress(done, total, 'Exporting verified files'),
    });
  });
  jobs.register('offline-import', async ({ source }, { signal, progress }) => {
    if (signal.aborted) throw signal.reason;
    const policy = await policyService.read();
    return provisioning.importPack(source, {
      signal,
      requireSignature: policy.managed === true,
      trustedPublicKeys: policy.provisioningPublicKeys || [],
      onProgress: (done, total) => void progress(done, total, 'Importing verified files'),
    });
  });
  ipcMain.handle(CHANNELS.networkSettings, async () => {
    const settings = await engine.getSettings();
    const policy = await policyService.read();
    return {
      network: settings.network,
      offline: settings.offline,
      managed: policy.managed,
      policy,
      hasProxyCredential: Boolean(await credentials.loadProxy()),
    };
  });
  ipcMain.handle(CHANNELS.saveNetworkSettings, async (_, input = {}) => {
    const policy = await policyService.read();
    const mode = validation.enumeration(input.mode, 'Network mode', NETWORK_MODES);
    const offlineMode = validation.enumeration(input.offlineMode, 'Offline mode', OFFLINE_MODES);
    const manualProxyUrl = mode === 'manual' ? validation.proxyUrl(input.manualProxyUrl) : '';
    const saved = await engine.setSettings({
      network: { mode, manualProxyUrl },
      offline: { mode: offlineMode },
    });
    if (input.updateCredentials === true) {
      if (input.proxyUsername || input.proxyPassword)
        await credentials.saveProxy(
          validation.string(input.proxyUsername, 'Proxy username', { max: 256 }),
          String(input.proxyPassword || '').slice(0, 1024),
        );
      else await credentials.clearProxy();
    }
    const effective = {
      ...saved.network,
      mode: policy.networkMode || saved.network.mode,
      manualProxyUrl: policy.manualProxyUrl || saved.network.manualProxyUrl,
      offline: policy.offlineOnly === true || saved.offline.mode === 'offline',
      allowedHosts: policy.allowedEndpoints,
    };
    await network.configure(effective);
    return { network: saved.network, offline: saved.offline, managed: policy.managed };
  });
  ipcMain.handle(CHANNELS.networkDiagnostics, async () => {
    const policy = await policyService.read();
    const endpoints = [
      ['Minecraft metadata', 'https://launchermeta.mojang.com/mc/game/version_manifest_v2.json'],
      ['Minecraft assets', 'https://resources.download.minecraft.net'],
      ['Minecraft libraries', 'https://libraries.minecraft.net'],
      ['Fabric', 'https://meta.fabricmc.net/v2/versions/game'],
      ['Modrinth', 'https://api.modrinth.com/v2/tag/game_version'],
      ['Java', 'https://api.adoptium.net/v3/info/available_releases'],
    ];
    const checks = [];
    for (const [name, url] of endpoints) checks.push({ name, ...(await network.probe(url)) });
    return {
      generatedAt: new Date().toISOString(),
      mode: network.mode,
      managed: policy.managed,
      checks,
    };
  });
  ipcMain.handle(CHANNELS.jobsList, () => jobs.list());
  for (const [channel, method] of [
    [CHANNELS.jobsPause, 'pause'],
    [CHANNELS.jobsResume, 'resume'],
    [CHANNELS.jobsCancel, 'cancel'],
    [CHANNELS.jobsRetry, 'retry'],
  ])
    ipcMain.handle(channel, (_, id) =>
      jobs[method](validation.string(id, 'Job id', { min: 24, max: 24, pattern: /^[a-f0-9]+$/ })),
    );
  ipcMain.handle(CHANNELS.offlineReadiness, async (_, profileId) =>
    publicReadiness(
      await readiness.report(
        validation.string(profileId, 'Profile id', { min: 16, max: 16, pattern: /^[a-f0-9]+$/ }),
      ),
    ),
  );
  ipcMain.handle(CHANNELS.offlineExport, async (_, profileId) => {
    profileId = validation.string(profileId, 'Profile id', {
      min: 16,
      max: 16,
      pattern: /^[a-f0-9]+$/,
    });
    const selected = await dialog.showSaveDialog(window(), {
      title: 'Export offline profile files',
      defaultPath: `Swirl-${profileId}.swirlpack`,
      filters: [{ name: 'Swirl provisioning bundle', extensions: ['swirlpack'] }],
    });
    if (selected.canceled || !selected.filePath) return { canceled: true };
    return jobs.enqueue(
      'offline-export',
      `profile:${profileId}`,
      { profileId, destination: path.resolve(selected.filePath) },
      { message: 'Waiting to export offline files' },
    );
  });
  ipcMain.handle(CHANNELS.offlineImport, async () => {
    const selected = await dialog.showOpenDialog(window(), {
      title: 'Import offline profile files',
      properties: ['openFile'],
      filters: [{ name: 'Swirl provisioning bundle', extensions: ['swirlpack'] }],
    });
    if (selected.canceled || !selected.filePaths[0]) return { canceled: true };
    const source = path.resolve(selected.filePaths[0]);
    const policy = await policyService.read();
    const details = await provisioning.inspect(source);
    if (!policy.managed && !details.signed) {
      const warning = await dialog.showMessageBox(window(), {
        type: 'warning',
        buttons: ['Cancel', 'Import unsigned pack'],
        defaultId: 0,
        cancelId: 0,
        title: 'Unsigned offline pack',
        message: 'This pack was not signed by an administrator.',
        detail:
          'Only continue if you created it yourself or trust the person who sent it. Swirl will still verify every file and path.',
      });
      if (warning.response !== 1) return { canceled: true };
    }
    return jobs.enqueue(
      'offline-import',
      'provisioning',
      { source },
      { message: 'Waiting to import offline files' },
    );
  });
  ipcMain.handle(CHANNELS.storageReport, () => storage.report());
  ipcMain.handle(CHANNELS.storageCleanup, (_, category, confirmed) =>
    storage.cleanup(
      validation.enumeration(category, 'Storage category', ['logs', 'updates', 'partialDownloads']),
      confirmed === true,
    ),
  );
}

module.exports = registerOperations;
module.exports.publicReadiness = publicReadiness;
