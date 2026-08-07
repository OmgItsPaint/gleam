const assert = require('assert');
const fs = require('fs');
const fsp = fs.promises;
const os = require('os');
const path = require('path');
const crypto = require('crypto');
const net = require('net');
const IcecreamEngine = require('./launcher-engine');
const IcecreamServerEngine = require('./server-engine');
const UpdateService = require('./update-service');
const IdentityService = require('./identity-service');
const policy = require('./version-policy');

async function run() {
  const mainSource = await fsp.readFile(path.join(__dirname, 'main.js'), 'utf8');
  const preloadSource = await fsp.readFile(path.join(__dirname, 'preload.js'), 'utf8');
  const htmlSource = await fsp.readFile(path.join(__dirname, 'index.html'), 'utf8');
  const handledChannels = new Set([...mainSource.matchAll(/ipcMain\.handle\('([^']+)'/g)].map(match => match[1]));
  const invokedChannels = new Set([...preloadSource.matchAll(/ipcRenderer\.invoke\('([^']+)'/g)].map(match => match[1]));
  assert.deepEqual([...invokedChannels].filter(channel => !handledChannels.has(channel)), [], 'Every exposed IPC action must have a main-process handler.');
  const htmlIds = [...htmlSource.matchAll(/\sid="([^"]+)"/g)].map(match => match[1]);
  assert.equal(new Set(htmlIds).size, htmlIds.length, 'HTML IDs must be unique so buttons target one control.');
  assert.equal(policy.isStableSupportedVersion('26.1.2'), true);
  assert.equal(policy.isStableSupportedVersion('26.2'), true);
  assert.equal(policy.isStableSupportedVersion('26.1.1'), false);
  assert.equal(policy.isStableSupportedVersion('27.1'), false);
  assert.equal(policy.isExperimentalVersion('26.1.2-rc-1'), true);
  assert.equal(policy.isExperimentalVersion('26.3-snapshot-7'), true);
  assert.equal(policy.isExperimentalVersion('27.1-snapshot-1'), false);
  assert.equal(policy.isStableSupportedVersion('1.14'), true);
  assert.equal(policy.isExperimentalVersion('26.3-snapshot-7'), true);
  assert.equal(policy.isSupportedVersion('26.3-snapshot-7', false), false);
  assert.equal(policy.isSupportedVersion('26.3-snapshot-7', true), true);
  assert.equal(policy.fallbackJavaMajor('26.2'), 25);
  assert.equal(policy.fallbackJavaMajor('1.21.1'), 21);
  assert.equal(policy.fallbackJavaMajor('1.20.4'), 17);

  const temporary = await fsp.mkdtemp(path.join(os.tmpdir(), 'swirl-compat-'));
  try {
    const protectionKey = crypto.randomBytes(32); const fakeSafeStorage = { isEncryptionAvailable: () => true, encryptString: value => { const iv = crypto.randomBytes(12); const cipher = crypto.createCipheriv('aes-256-gcm', protectionKey, iv); const body = Buffer.concat([cipher.update(value, 'utf8'), cipher.final()]); return Buffer.concat([iv, cipher.getAuthTag(), body]); }, decryptString: value => { const decipher = crypto.createDecipheriv('aes-256-gcm', protectionKey, value.subarray(0, 12)); decipher.setAuthTag(value.subarray(12, 28)); return Buffer.concat([decipher.update(value.subarray(28)), decipher.final()]).toString('utf8'); } };
    const identityService = new IdentityService(temporary, fakeSafeStorage); const identity = await identityService.info(); assert.match(identity.fingerprint, /^[a-f0-9]{64}$/); assert.equal(identity.osProtected, true);
    const unreadableRoot = path.join(temporary, 'unreadable'); const unreadableIdentityDir = path.join(unreadableRoot, '.icecream_client', 'identity'); await fsp.mkdir(unreadableIdentityDir, { recursive: true });
    await fsp.copyFile(identityService.privateFile(), path.join(unreadableIdentityDir, 'player-key.json')); await fsp.copyFile(identityService.publicFile(), path.join(unreadableIdentityDir, 'player-identity.json'));
    const brokenSafeStorage = { ...fakeSafeStorage, decryptString: () => { throw new Error('Error while decrypting the ciphertext provided to safeStorage.decryptString.'); } };
    const recoveredService = new IdentityService(unreadableRoot, brokenSafeStorage); const recoveredIdentity = await recoveredService.info(); assert.notEqual(recoveredIdentity.fingerprint, identity.fingerprint); assert.equal(recoveredIdentity.recovery.reset, true); assert.equal(recoveredIdentity.recovery.backups.length, 2); assert.equal(fs.existsSync(recoveredService.privateFile()), true);
    const recovery = await identityService.exportRecovery('correct horse battery staple'); const restoredRoot = path.join(temporary, 'restored'); const restoredService = new IdentityService(restoredRoot, fakeSafeStorage); const restored = await restoredService.importRecovery(recovery, 'correct horse battery staple'); assert.equal(restored.fingerprint, identity.fingerprint); await assert.rejects(() => restoredService.importRecovery(recovery, 'wrong password'), /wrong or.*damaged/);
    const broker = await identityService.startBroker('HostFriend', 'enrollment-token'); const message = Buffer.concat([Buffer.from('SWIRL-AUTH-1\0'), Buffer.from('server\0HostFriend\0nonce')]); const brokerReply = await fetch(`http://127.0.0.1:${broker.port}/sign`, { method: 'POST', headers: { Authorization: `Bearer ${broker.token}` }, body: message.toString('base64') }); assert.equal(brokerReply.status, 200); const replyFields = (await brokerReply.text()).split('\n'); assert.equal(replyFields[0], 'HostFriend'); assert.equal(replyFields[4], 'enrollment-token'); assert.equal(crypto.verify(null, message, { key: Buffer.from(replyFields[1], 'base64'), format: 'der', type: 'spki' }, Buffer.from(replyFields[3], 'base64')), true); identityService.closeBroker(broker.id);
    const engine = new IcecreamEngine(temporary);
    assert.equal(engine.requiredJava('26.2', { javaVersion: { majorVersion: 25 } }), 25);
    assert.equal(engine.requiredJava('1.21.1', { javaVersion: { majorVersion: 21 } }), 21);
    const args = engine.resolveArguments([
      '--username', '${auth_player_name}',
      { rules: [{ action: 'allow', features: { is_demo_user: false } }], value: '--allowed' },
      { rules: [{ action: 'allow', features: { is_demo_user: true } }], value: '--blocked' }
    ], { auth_player_name: 'Friend' }, { is_demo_user: false });
    assert.deepEqual(args, ['--username', 'Friend', '--allowed']);

    const profile = await engine.createModProfile('26 Test', '26.2');
    assert.equal(fs.existsSync(engine.profileLockFile('26.2', profile.id)), true);
    const rogueMod = path.join(engine.instanceDirectory('26.2', profile.id), 'mods', 'unmanaged.jar');
    await fsp.writeFile(rogueMod, 'not trusted');
    await assert.rejects(() => engine.verifyProfileLock(profile.id, '26.2'), /Unmanaged mod files/);
    await assert.rejects(() => engine.repairModProfile(profile.id), /Unmanaged mod files/);
    await fsp.rm(rogueMod);
    await engine.verifyProfileLock(profile.id, '26.2');
    const secondProfile = await engine.createModProfile('Settings Target', '26.2');
    const sourceOptions = path.join(engine.instanceDirectory('26.2', profile.id), 'options.txt');
    const targetOptions = path.join(engine.instanceDirectory('26.2', secondProfile.id), 'options.txt');
    await fsp.writeFile(sourceOptions, 'gamma:1.0\nrenderDistance:12\n'); await fsp.writeFile(targetOptions, 'gamma:0.5\n');
    const settingsSync = await engine.syncMinecraftSettings(profile.id); assert.equal(settingsSync.synced.length, 1); assert.equal(await fsp.readFile(targetOptions, 'utf8'), 'gamma:1.0\nrenderDistance:12\n');
    assert.equal((await fsp.readdir(engine.settingsBackupRoot(secondProfile.id))).length, 1);
    const world = path.join(engine.instanceDirectory('26.2', profile.id), 'saves', 'Friends World');
    await fsp.mkdir(world, { recursive: true }); await fsp.writeFile(path.join(world, 'level.dat'), 'fixture');
    const listedWorlds = await engine.listWorlds(profile.id); assert.equal(listedWorlds.length, 1); assert.equal(listedWorlds[0].name, 'Friends World'); assert.equal(listedWorlds[0].valid, true);
    const duplicatedWorld = await engine.duplicateWorld(profile.id, 'Friends World'); assert.equal(duplicatedWorld.name, 'Friends World Copy');
    const renamedWorld = await engine.renameWorld(profile.id, duplicatedWorld.name, 'QA Copy'); assert.equal(renamedWorld.name, 'QA Copy'); assert.equal(fs.existsSync(path.join(engine.instanceDirectory('26.2', profile.id), 'saves', 'QA Copy', 'level.dat')), true);
    const copiedWorld = await engine.copyWorld(profile.id, 'Friends World', secondProfile.id); assert.equal(copiedWorld.versionChanged, false); assert.equal(fs.existsSync(path.join(engine.instanceDirectory('26.2', secondProfile.id), 'saves', 'Friends World', 'level.dat')), true);
    const exportRoot = path.join(temporary, 'world-export'); const exportedWorld = await engine.exportWorld(profile.id, 'Friends World', exportRoot); assert.equal(fs.existsSync(path.join(exportedWorld.destination, 'level.dat')), true);
    const importedWorld = await engine.importWorld(secondProfile.id, exportedWorld.destination); assert.equal(importedWorld.name, 'Friends World (2)');
    const deletedWorld = await engine.deleteWorld(profile.id, 'QA Copy'); assert.equal(fs.existsSync(deletedWorld.recoverableAt), true); await assert.rejects(() => engine.renameWorld(profile.id, 'Friends World', '../unsafe'), /valid world name/);
    const resourcePack = path.join(engine.instanceDirectory('26.2', profile.id), 'resourcepacks', 'Friends Pack', 'pack.mcmeta'); await fsp.mkdir(path.dirname(resourcePack), { recursive: true }); await fsp.writeFile(resourcePack, '{}');
    const transferred = await engine.createModProfile('Transferred', '26.2', profile.id, { mods: false, settings: true, resourcePacks: true, worlds: true, preset: 'vanilla' });
    assert.equal(transferred.preset, 'vanilla'); assert.equal(transferred.mods.length, 0); assert.equal(await fsp.readFile(path.join(engine.instanceDirectory('26.2', transferred.id), 'options.txt'), 'utf8'), 'gamma:1.0\nrenderDistance:12\n'); assert.equal(fs.existsSync(path.join(engine.instanceDirectory('26.2', transferred.id), 'resourcepacks', 'Friends Pack', 'pack.mcmeta')), true); assert.equal(fs.existsSync(path.join(engine.instanceDirectory('26.2', transferred.id), 'saves', 'Friends World', 'level.dat')), true);
    const backup = await engine.ensureWorldUpgradeBackup(profile);
    assert.ok(backup && backup.worlds.includes('Friends World'));
    assert.equal(fs.existsSync(path.join(backup.destination, 'Friends World', 'level.dat')), true);
    assert.equal(await engine.ensureWorldUpgradeBackup(profile), null);
    await engine.setSettings({ backupRetention: 2 });
    await engine.backupModProfile(profile.id); await new Promise(resolve => setTimeout(resolve, 5)); await engine.backupModProfile(profile.id); await new Promise(resolve => setTimeout(resolve, 5)); await engine.backupModProfile(profile.id);
    const profileBackups = await engine.listProfileBackups(profile.id); assert.equal(profileBackups.length, 2);
    const tamperedProfileBackup = path.join(engine.profileBackupRoot(profile.id), profileBackups[0].id, 'mods', 'unmanaged.jar');
    await fsp.writeFile(tamperedProfileBackup, 'tampered');
    await assert.rejects(() => engine.restoreProfileBackup(profile.id, profileBackups[0].id), /integrity check failed/);
    assert.equal(fs.existsSync(world), true);
    await engine.restoreProfileBackup(profile.id, profileBackups[1].id); assert.equal(fs.existsSync(world), true);

    const originalPlan = engine.planModUpdates.bind(engine); const originalBackup = engine.backupModProfile.bind(engine); const originalInstall = engine.installModrinthMod.bind(engine); const originalRestore = engine.restoreProfileBackup.bind(engine); let installAttempt = 0; let restoredBackup = '';
    engine.planModUpdates = async () => [{ projectId: 'one', name: 'One', toVersionId: 'one-new' }, { projectId: 'two', name: 'Two', toVersionId: 'two-new' }]; engine.backupModProfile = async () => ({ destination: path.join(engine.profileBackupRoot(profile.id), 'rollback-fixture') }); engine.installModrinthMod = async () => { installAttempt += 1; if (installAttempt === 2) throw new Error('fixture failure'); return []; }; engine.restoreProfileBackup = async (_, backupId) => { restoredBackup = backupId; return {}; };
    await assert.rejects(() => engine.updateAllMods(profile.gameVersion, profile.id), /Updates were rolled back/); assert.equal(restoredBackup, 'rollback-fixture'); engine.planModUpdates = originalPlan; engine.backupModProfile = originalBackup; engine.installModrinthMod = originalInstall; engine.restoreProfileBackup = originalRestore;

    const servers = new IcecreamServerEngine(temporary, async version => ({ java: 'java', major: policy.fallbackJavaMajor(version) }));
    const server = await servers.create('Friends', '26.2', 25565, { acceptEula: true, whitelist: true, hostName: 'HostFriend', hostIdentity: identity, template: 'creative' });
    assert.equal(server.version, '26.2');
    assert.equal(server.memoryMb, 4096);
    assert.equal(server.template, 'creative');
    const originalProperties = await servers.getProperties(server.id); assert.equal(originalProperties.maxPlayers, 12); assert.equal(originalProperties.gamemode, 'creative'); assert.equal(originalProperties.difficulty, 'peaceful'); const savedProperties = await servers.setProperties(server.id, { motd: 'Friends only', maxPlayers: 6, gamemode: 'creative', difficulty: 'normal', viewDistance: 14, simulationDistance: 10, pvp: false, commandBlocks: true }); assert.equal(savedProperties.motd, 'Friends only'); assert.equal(savedProperties.maxPlayers, 6); assert.equal(savedProperties.gamemode, 'creative'); assert.equal(savedProperties.pvp, false);
    assert.equal(fs.existsSync(path.join(servers.modsDir(server.id), 'README.txt')), true);
    assert.equal(fs.existsSync(servers.lockFile(server.id)), true);
    const fakeMinecraft = net.createServer(socket => socket.once('data', () => { const text = Buffer.from(JSON.stringify({ version: { name: 'Swirl QA', protocol: 999 }, players: { online: 1, max: 8 }, description: { text: 'test' } })); const body = Buffer.concat([servers.encodeVarInt(0), servers.encodeVarInt(text.length), text]); socket.end(Buffer.concat([servers.encodeVarInt(body.length), body])); }));
    await new Promise((resolve, reject) => fakeMinecraft.once('error', reject).listen(0, '127.0.0.1', resolve)); const fakePort = fakeMinecraft.address().port; const statusReply = await servers.minecraftStatus('127.0.0.1', fakePort); assert.equal(statusReply.version.name, 'Swirl QA'); await new Promise(resolve => fakeMinecraft.close(resolve));
    assert.deepEqual((await servers.approvedPlayers(server.id)).map(item => item.name), ['HostFriend']); assert.equal((await servers.approvedPlayers(server.id))[0].verified, true);
    await servers.setApprovedPlayer(server.id, 'SecondFriend', true, true);
    assert.deepEqual((await servers.approvedPlayers(server.id)).map(item => [item.name, item.operator]), [['HostFriend', false], ['SecondFriend', true]]);
    await servers.setApprovedPlayer(server.id, 'SecondFriend', false, false);
    assert.deepEqual((await servers.approvedPlayers(server.id)).map(item => item.name), ['HostFriend']);
    await assert.rejects(() => servers.playerAction(server.id, 'HostFriend', 'kick'), /Start the server/);
    const concurrent = await Promise.all(Array.from({ length: 8 }, (_, index) => servers.create(`Auto ${index}`, '26.2', '', { acceptEula: true })));
    assert.equal(new Set(concurrent.map(item => item.id)).size, 8, 'Concurrent server creates must not overwrite one another.');
    assert.equal(new Set(concurrent.map(item => item.port)).size, 8, 'Automatic ports must be unique.');
    assert.equal((await servers.rawList()).length, 9, 'All concurrently created servers must be saved.');
    servers.lanAddresses = () => [{ address: '192.168.1.20', family: 'IPv4', adapter: 'Test Wi-Fi', preferred: true }];
    servers.ensureLoaderPin = async item => ({ gameVersion: item.version, loaderVersion: 'test-loader', installerVersion: 'test-installer' });
    const inviteCode = await servers.exportInvite(server.id); const parsedInvite = await engine.parseServerInvite(inviteCode);
    assert.equal(parsedInvite.gameVersion, '26.2'); assert.equal(parsedInvite.joinAddress, '192.168.1.20:25565'); assert.match(parsedInvite.fingerprint, /^[a-f0-9]{4}(?:-[a-f0-9]{4}){3}$/); assert.equal(parsedInvite.authentication.required, true);
    const joined = await engine.importServerInvite(inviteCode); assert.equal(joined.profile.serverAddress, '192.168.1.20:25565'); assert.equal(joined.profile.fabricLoaderVersion, 'test-loader'); assert.equal(joined.profile.autoSync, false); assert.equal(joined.profile.identityRequired, true); assert.equal(joined.profile.enrollmentToken, parsedInvite.authentication.enrollmentToken); assert.equal(fs.existsSync(engine.profileLockFile('26.2', joined.profile.id)), true);
    const inviteParts = inviteCode.split('.'); const changedPayload = Buffer.from(JSON.stringify({ ...JSON.parse(Buffer.from(inviteParts[1], 'base64url').toString('utf8')), port: 25566 })).toString('base64url');
    await assert.rejects(() => engine.parseServerInvite(`${inviteParts[0]}.${changedPayload}.${inviteParts[2]}`), /changed or damaged/);
    await servers.backup(server.id, 2); await new Promise(resolve => setTimeout(resolve, 5)); await servers.backup(server.id, 2); await new Promise(resolve => setTimeout(resolve, 5)); await servers.backup(server.id, 2);
    const serverBackups = await servers.listBackups(server.id); assert.equal(serverBackups.length, 2);
    const tamperedServerBackup = path.join(servers.backupRoot(server.id), serverBackups[0].id, 'mods', 'unmanaged.jar');
    await fsp.writeFile(tamperedServerBackup, 'tampered');
    await assert.rejects(() => servers.restoreBackup(server.id, serverBackups[0].id), /integrity check failed/);
    assert.equal(fs.existsSync(path.join(servers.dir(server.id), 'server.properties')), true);
    const connection = await servers.diagnose(server.id, '26.1.2'); assert.equal(connection.ok, false); assert.ok(connection.checks.some(check => check.id === 'version' && check.level === 'fail'));
    await assert.rejects(() => servers.create('Old 26', '26.1.1', 25566, { acceptEula: true }), /supported stable/);

    const keys = crypto.generateKeyPairSync('ed25519'); const payload = { version: '1.1.0', url: 'https://example.com/Swirl.exe', sha256: 'a'.repeat(64), notes: 'QA' }; const signature = crypto.sign(null, Buffer.from(UpdateService.stable(payload)), keys.privateKey).toString('base64'); const updater = new UpdateService(temporary, '1.0.0'); assert.deepEqual(updater.verifyManifest({ payload, signature }, keys.publicKey), payload); assert.throws(() => updater.verifyManifest({ payload: { ...payload, version: '1.2.0' }, signature }, keys.publicKey), /not trusted/);
  } finally {
    await fsp.rm(temporary, { recursive: true, force: true });
  }
  console.log('Swirl compatibility tests passed.');
}

run().catch(error => { console.error(error); process.exitCode = 1; });
