const assert = require('assert');
const fs = require('fs');
const fsp = fs.promises;
const os = require('os');
const path = require('path');
const crypto = require('crypto');
const JobService = require('../../src/core/jobs/job-service');
const StorageService = require('../../src/core/diagnostics/storage-service');
const ProvisioningService = require('../../src/core/provisioning/provisioning-service');
const StructuredLogger = require('../../src/core/diagnostics/structured-logger');
const ElectronNetworkTransport = require('../../src/platform/electron/network-transport');
const WindowsPolicy = require('../../src/platform/electron/windows-policy');
const { ensureDiskSpace } = require('../../src/core/downloads/disk-space');
const { publicReadiness } = require('../../src/main/ipc/operations');
const CrashAssistant = require('../../src/core/diagnostics/crash-assistant');
const ServerDomainService = require('../../src/core/servers/domain-service');
const ServerEngine = require('../../src/core/servers/server-engine');
const LauncherEngine = require('../../src/core/launch/launcher-engine');
const SessionStatistics = require('../../src/core/diagnostics/session-statistics');
const ServerAdminService = require('../../src/core/servers/server-admin-service');
const HostAgent = require('../../src/core/servers/host-agent');

async function waitFor(test, timeout = 3000) {
  const started = Date.now();
  while (!test()) {
    if (Date.now() - started > timeout)
      throw new Error('Timed out waiting for deterministic service state.');
    await new Promise((resolve) => setTimeout(resolve, 10));
  }
}

(async () => {
  const temporary = await fsp.mkdtemp(path.join(os.tmpdir(), 'swirl-services-'));
  try {
    const jobs = new JobService(temporary);
    await jobs.init();
    assert.deepEqual(
      await ensureDiskSpace(temporary, 100, 'run a test', {
        reserveBytes: 0,
        statfs: async () => ({ bavail: 20, bsize: 10 }),
      }),
      { checked: true, freeBytes: 200, requiredBytes: 100 },
    );
    await assert.rejects(
      () =>
        ensureDiskSpace(temporary, 201, 'run a test', {
          reserveBytes: 0,
          statfs: async () => ({ bavail: 20, bsize: 10 }),
        }),
      /at least 1 MiB/,
    );
    const created = await jobs.create('test-download', 'profile:one', async ({ progress }) => {
      await progress(2, 2, 'Verified');
      return { ok: true };
    });
    await waitFor(() => jobs.find(created.id)?.state === 'succeeded');
    assert.equal(jobs.find(created.id).completed, 2);
    assert.deepEqual(
      await jobs.execute('profile-repair', 'profile:two', async () => ({ repaired: true }), {
        cancellable: false,
      }),
      { repaired: true },
    );
    jobs.register('persistent-repair-test', async ({ profileId }) => ({
      profileId,
      repaired: true,
    }));
    assert.deepEqual(
      await jobs.executePersistent(
        'persistent-repair-test',
        'profile:three',
        { profileId: '0123456789abcdef' },
        { cancellable: false },
      ),
      { profileId: '0123456789abcdef', repaired: true },
    );
    assert.equal(
      jobs.list().some((job) => Object.hasOwn(job, 'result')),
      false,
    );
    const restarted = new JobService(temporary);
    await restarted.init();
    assert.equal(restarted.find(created.id).state, 'succeeded');

    const recoveryRoot = path.join(temporary, 'recovery');
    const recoveryDirectory = path.join(recoveryRoot, '.icecream_client', 'jobs');
    const recoveryId = '0123456789abcdef01234567';
    await fsp.mkdir(recoveryDirectory, { recursive: true });
    await fsp.writeFile(
      path.join(recoveryDirectory, 'jobs.json'),
      JSON.stringify([
        {
          id: recoveryId,
          type: 'recoverable-test',
          scope: 'profile:recovery',
          state: 'running',
          message: 'Interrupted',
          completed: 3,
          total: 10,
          retryable: true,
          cancellable: true,
          recoverable: true,
          payload: { value: 7 },
          createdAt: new Date().toISOString(),
          updatedAt: new Date().toISOString(),
        },
      ]),
    );
    const recovered = new JobService(recoveryRoot);
    recovered.register('recoverable-test', async (payload, { progress }) => {
      assert.deepEqual(payload, { value: 7 });
      await progress(10, 10, 'Recovered');
      return { doubled: payload.value * 2 };
    });
    await recovered.init();
    assert.equal(recovered.find(recoveryId).state, 'paused');
    assert.equal(Object.hasOwn(recovered.list()[0], 'payload'), false);
    assert.equal(await recovered.resume(recoveryId), true);
    await waitFor(() => recovered.find(recoveryId)?.state === 'succeeded');
    assert.deepEqual(recovered.find(recoveryId).result, { doubled: 14 });
    await assert.rejects(
      () => recovered.enqueue('recoverable-test', 'global', { value: 'x'.repeat(17 * 1024) }),
      /16 KiB/,
    );

    const backupRoot = path.join(temporary, 'backup-recovery');
    const backupDirectory = path.join(backupRoot, '.icecream_client', 'jobs');
    await fsp.mkdir(backupDirectory, { recursive: true });
    await fsp.writeFile(path.join(backupDirectory, 'jobs.json'), '{broken');
    await fsp.writeFile(
      path.join(backupDirectory, 'jobs.json.bak'),
      JSON.stringify([
        {
          id: 'abcdef0123456789abcdef01',
          type: 'complete-test',
          scope: 'global',
          state: 'succeeded',
          message: 'Complete',
          recoverable: false,
        },
      ]),
    );
    const backupRecovered = new JobService(backupRoot);
    await backupRecovered.init();
    assert.equal(backupRecovered.list()[0].state, 'succeeded');

    const sourceRoot = path.join(temporary, 'source');
    const managedRoot = path.join(sourceRoot, '.icecream_client');
    const source = path.join(managedRoot, 'assets', 'objects', 'aa', 'sample');
    await fsp.mkdir(path.dirname(source), { recursive: true });
    await fsp.writeFile(source, 'verified offline bytes');
    const bytes = await fsp.readFile(source);
    const artifact = {
      source,
      relativePath: 'assets/objects/aa/sample',
      size: bytes.length,
      hash: crypto.createHash('sha256').update(bytes).digest('hex'),
    };
    const pack = path.join(temporary, 'profile.swirlpack');
    const exporter = new ProvisioningService(sourceRoot);
    const readiness = {
      complete: true,
      profileId: '0123456789abcdef',
      gameVersion: '26.2',
      artifacts: [artifact],
    };
    await exporter.exportPack(pack, readiness);
    const cancelledPack = path.join(temporary, 'cancelled.swirlpack');
    const exportAbort = new AbortController();
    await assert.rejects(
      () =>
        exporter.exportPack(cancelledPack, readiness, {
          signal: exportAbort.signal,
          onProgress: () => exportAbort.abort(new Error('Export cancelled for test.')),
        }),
      /cancelled for test/,
    );
    assert.equal(fs.existsSync(cancelledPack), false);
    assert.equal(
      (await fsp.readdir(temporary)).some((name) => name.startsWith('cancelled.swirlpack.')),
      false,
    );
    assert.equal((await exporter.inspect(pack)).signed, false);
    const targetRoot = path.join(temporary, 'target');
    const importer = new ProvisioningService(targetRoot);
    const imported = await importer.importPack(pack);
    assert.equal(imported.imported, 1);
    assert.equal(
      await fsp.readFile(path.join(targetRoot, '.icecream_client', artifact.relativePath), 'utf8'),
      'verified offline bytes',
    );
    const cancelledTarget = path.join(temporary, 'cancelled-target');
    const importAbort = new AbortController();
    await assert.rejects(
      () =>
        new ProvisioningService(cancelledTarget).importPack(pack, {
          signal: importAbort.signal,
          onProgress: () => importAbort.abort(new Error('Import cancelled for test.')),
        }),
      /cancelled for test/,
    );
    assert.equal(
      fs.existsSync(path.join(cancelledTarget, '.icecream_client', artifact.relativePath)),
      false,
    );

    const storage = await new StorageService(targetRoot).report();
    assert.ok(storage.totalBytes >= bytes.length);
    assert.equal(storage.categories.assets.bytes, bytes.length);

    const redacted = StructuredLogger.redact({
      token: 'private',
      url: 'https://example.test/x?key=secret',
      file: 'C:\\Users\\person\\world',
    });
    assert.equal(redacted.token, '[REDACTED]');
    assert.ok(!JSON.stringify(redacted).includes('secret'));
    assert.ok(!JSON.stringify(redacted).includes('person'));

    const publicReport = publicReadiness({
      complete: true,
      required: [],
      missing: [],
      invalid: [],
      absent: [],
      repairable: [],
      networkRequired: [],
      java: { available: true, major: 25, path: 'C:\\Private\\Java\\javaw.exe' },
      artifacts: [
        {
          source: 'C:\\Private\\Minecraft\\client.jar',
          relativePath: 'versions/26.2/26.2.jar',
          size: 10,
          hash: 'abc',
        },
      ],
    });
    assert.deepEqual(publicReport.java, { available: true, major: 25 });
    assert.equal(Object.hasOwn(publicReport.artifacts[0], 'source'), false);
    assert.ok(!JSON.stringify(publicReport).includes('Private'));

    const crashRoot = path.join(temporary, 'crash-test');
    const crashDirectory = path.join(crashRoot, '.icecream_client', 'crash-reports');
    await fsp.mkdir(crashDirectory, { recursive: true });
    await fsp.writeFile(
      path.join(crashDirectory, 'latest.json'),
      JSON.stringify({
        startedAt: '2026-08-16T00:00:00.000Z',
        finishedAt: '2026-08-16T00:01:00.000Z',
        minecraftVersion: '26.2',
        profile: { id: '0123456789abcdef', name: 'Test' },
        exitCode: 1,
        crashed: true,
        java: 'C:\\Private\\Java\\javaw.exe',
      }),
    );
    await fsp.writeFile(
      path.join(crashDirectory, 'latest.log'),
      'java.lang.OutOfMemoryError: Java heap space',
    );
    const crash = await new CrashAssistant(crashRoot).latest();
    assert.equal(crash.kind, 'memory');
    assert.equal(crash.profile.id, '0123456789abcdef');
    assert.ok(!JSON.stringify(crash).includes('Private'));
    const statistics = await new SessionStatistics(crashRoot).summary('0123456789abcdef');
    assert.equal(statistics.sessions, 1);
    assert.equal(statistics.totalPlayMs, 60_000);
    assert.equal(statistics.crashes, 1);

    const domain = new ServerDomainService({
      resolve4: async (hostname) => (hostname === 'play.example.test' ? ['203.0.113.10'] : []),
      resolve6: async () => [],
      resolveSrv: async () => [{ name: 'play.example.test', port: 25570, priority: 0, weight: 0 }],
    });
    const domainReport = await domain.diagnose('PLAY.example.test.', 25570);
    assert.equal(domainReport.hostname, 'play.example.test');
    assert.equal(domainReport.ready, true);
    assert.equal(domainReport.records.service.port, 25570);
    await assert.rejects(
      () => domain.diagnose('https://example.test/path', 25565),
      /only a domain/,
    );

    const serverRoot = path.join(temporary, 'scheduled-server-test');
    const serverEngine = new ServerEngine(serverRoot, async () => 'java');
    const serverId = '0123456789abcdef';
    await serverEngine.save([
      {
        id: serverId,
        name: 'Scheduled test',
        version: '26.2',
        port: 25565,
        createdAt: '2026-01-01T00:00:00.000Z',
        backupSchedule: 'off',
      },
    ]);
    assert.equal((await serverEngine.setBackupSchedule(serverId, 'hourly')).schedule, 'hourly');
    serverEngine.running.set(serverId, {});
    assert.deepEqual(await serverEngine.runScheduledBackups(Date.parse('2026-08-16T00:00:00Z')), [
      { id: serverId, state: 'deferred', reason: 'server-running' },
    ]);
    await assert.rejects(() => serverEngine.setBackupSchedule(serverId, 'weekly'), /Hourly/);

    const screenshotRoot = path.join(temporary, 'screenshot-test');
    const launcher = new LauncherEngine(screenshotRoot);
    await launcher.saveModProfiles([
      {
        id: serverId,
        name: 'Screenshot test',
        gameVersion: '26.2',
        mods: [],
        autoSync: false,
      },
    ]);
    const screenshotDirectory = path.join(
      launcher.instanceDirectory('26.2', serverId),
      'screenshots',
    );
    await fsp.mkdir(screenshotDirectory, { recursive: true });
    await fsp.writeFile(path.join(screenshotDirectory, '2026-08-16_12.00.00.png'), 'png');
    assert.equal((await launcher.listScreenshots(serverId))[0].name, '2026-08-16_12.00.00.png');
    await assert.rejects(
      () => launcher.screenshotContext(serverId, '..\\private.png'),
      /valid screenshot/,
    );
    assert.equal(
      (await launcher.removeScreenshot(serverId, '2026-08-16_12.00.00.png')).recoverable,
      true,
    );
    assert.deepEqual(await launcher.listScreenshots(serverId), []);

    const adminRoot = path.join(temporary, 'admin-test');
    const admin = new ServerAdminService(adminRoot);
    const ownerFingerprint = 'a'.repeat(64);
    const adminFingerprint = 'b'.repeat(64);
    let adminState = await admin.load(serverId, [
      {
        name: 'LaterAdmin',
        fingerprint: adminFingerprint,
        approvedAt: '2026-02-01T00:00:00.000Z',
      },
      {
        name: 'FirstOwner',
        fingerprint: ownerFingerprint,
        approvedAt: '2026-01-01T00:00:00.000Z',
      },
    ]);
    assert.equal(admin.roleFor(adminState, ownerFingerprint), 'owner');
    assert.equal(admin.require(adminState, ownerFingerprint, 'roles.write'), 'owner');
    assert.throws(
      () => admin.require(adminState, adminFingerprint, 'console.write'),
      /not allowed/,
    );
    adminState = await admin.assign(
      serverId,
      adminState,
      ownerFingerprint,
      { name: 'LaterAdmin', fingerprint: adminFingerprint },
      'admin',
    );
    assert.equal(admin.require(adminState, adminFingerprint, 'console.write'), 'admin');
    await assert.rejects(
      () =>
        admin.transfer(
          serverId,
          adminState,
          ownerFingerprint,
          { name: 'LaterAdmin', fingerprint: adminFingerprint },
          'wrong',
          'Test server',
        ),
      /server name exactly/,
    );
    const audit = await admin.audit(serverId, {
      fingerprint: ownerFingerprint,
      role: 'owner',
      operation: 'test',
      result: 'allowed',
      detail: 'C:\\Users\\Private\\server',
    });
    assert.ok(!audit.detail.includes('Private'));

    const agent = new HostAgent(serverId, async (operation, payload) => ({ operation, payload }));
    const capability = await agent.start();
    try {
      const denied = await fetch(`http://127.0.0.1:${capability.port}/v1/request`, {
        method: 'POST',
        body: '{}',
      });
      assert.equal(denied.status, 404);
      const accepted = await fetch(`http://127.0.0.1:${capability.port}/v1/request`, {
        method: 'POST',
        headers: {
          authorization: `Bearer ${capability.token}`,
          'x-swirl-server': serverId,
          'content-type': 'application/json',
        },
        body: JSON.stringify({ operation: 'status', payload: { value: 1 } }),
      });
      assert.deepEqual(await accepted.json(), {
        ok: true,
        result: { operation: 'status', payload: { value: 1 } },
      });
    } finally {
      agent.close();
    }

    let proxy = null;
    const fakeSession = {
      setProxy: async (value) => {
        proxy = value;
      },
      closeAllConnections: async () => {},
      fetch: async () => new Response('{}', { status: 200 }),
    };
    const transport = new ElectronNetworkTransport(fakeSession, { allowedHosts: ['example.test'] });
    await transport.configure({ mode: 'manual', manualProxyUrl: 'http://proxy.test:8080' });
    assert.equal(proxy.mode, 'fixed_servers');
    assert.deepEqual(await transport.getJson('https://example.test/data'), {});
    await transport.configure({ mode: 'system', offline: true });
    await assert.rejects(() => transport.getJson('https://example.test/data'), /Offline mode/);
    await assert.rejects(
      () =>
        transport
          .configure({ mode: 'system' })
          .then(() => transport.getJson('https://blocked.test/data')),
      /approved/,
    );

    const policyFile = path.join(temporary, 'policy.json');
    await fsp.writeFile(
      policyFile,
      JSON.stringify({
        offlineMode: 'offline',
        updatePolicy: 'managed',
        allowedEndpoints: ['EXAMPLE.TEST'],
        serverHostingEnabled: false,
      }),
    );
    const policy = await new WindowsPolicy(policyFile).read();
    assert.equal(policy.offlineOnly, true);
    assert.deepEqual(policy.allowedEndpoints, ['example.test']);
    assert.equal(policy.serverHostingEnabled, false);
  } finally {
    await fsp.rm(temporary, { recursive: true, force: true });
  }
  console.log('Legacy compatibility service tests passed.');
})().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
