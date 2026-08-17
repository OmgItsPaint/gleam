// @ts-check
const validation = require('../../shared/validation');
const { isSupportedVersion } = require('../../shared/version-policy');

const PROFILE_ID = /^[a-f0-9]{16}$/;

/** @typedef {{register: (type: string, handler: (payload: any) => unknown) => unknown}} JobRegistry */

/** @param {unknown} value */
function profileId(value) {
  return validation.string(value, 'Profile id', { min: 16, max: 16, pattern: PROFILE_ID });
}

/** @param {unknown} value */
function version(value) {
  const result = validation.string(value, 'Minecraft version', { min: 3, max: 64 });
  if (!isSupportedVersion(result, true))
    throw new Error('Choose a Minecraft version shown by Swirl.');
  return result;
}

/** @param {unknown} value @param {string} name @param {number} [max] */
function shortText(value, name, max = 256) {
  return validation.string(value, name, { max });
}

/**
 * @param {JobRegistry} jobs
 * @param {{engine: any, servers: any}} services
 */
function registerPersistentJobs(jobs, { engine, servers }) {
  jobs.register('mod-update', ({ gameVersion, profileId: id }) =>
    engine.updateAllMods(version(gameVersion), profileId(id)),
  );
  jobs.register('profile-repair', ({ profileId: id }) =>
    engine.repairManagedProfile(profileId(id)),
  );
  jobs.register('profile-backup', ({ profileId: id }) => engine.backupModProfile(profileId(id)));
  jobs.register('server-backup', async ({ serverId }) =>
    servers.backup(profileId(serverId), (await engine.getSettings()).backupRetention),
  );
  jobs.register('server-restore', ({ serverId, backupId }) =>
    servers.restoreBackup(profileId(serverId), shortText(backupId, 'Backup id', 128)),
  );
  jobs.register('server-mod-install', ({ serverId, projectId, versionId = '' }) =>
    servers.installMod(
      profileId(serverId),
      shortText(projectId, 'Project id', 128),
      shortText(versionId, 'Version id', 128),
    ),
  );
  jobs.register('server-mod-update', ({ serverId }) => servers.updateMods(profileId(serverId)));
}

module.exports = registerPersistentJobs;
