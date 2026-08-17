const invoke = window.__TAURI__?.core?.invoke;

const state = {
  appInfo: null,
  library: null,
  profiles: [],
  settings: {},
  identity: null,
  servers: [],
  selectedProfileId: '',
  selectedServerId: '',
};

function text(value, fallback = '—') {
  return typeof value === 'string' && value.trim() ? value.trim() : fallback;
}

function toast(message, kind = 'info') {
  const item = document.createElement('div');
  item.className = `toast ${kind}`;
  item.textContent = message;
  document.querySelector('#toast-region').append(item);
  window.setTimeout(() => item.remove(), 4200);
}

async function call(name, args = {}, fallback) {
  if (!invoke) {
    if (fallback !== undefined) return fallback;
    throw new Error('Open Gleam through the Tauri app to use this feature.');
  }
  return invoke(name, args);
}

function errorMessage(error) {
  return typeof error === 'string'
    ? error
    : error?.message || 'Gleam could not complete that action.';
}

function showView(name) {
  const panel = document.querySelector(`[data-view-panel="${CSS.escape(name)}"]`);
  if (!panel) return;
  document
    .querySelectorAll('[data-view-panel]')
    .forEach((item) => item.classList.toggle('active', item === panel));
  document
    .querySelectorAll('.nav-item')
    .forEach((item) => item.classList.toggle('active', item.dataset.view === name));
  document.querySelector('main').scrollTo({
    top: 0,
    behavior: document.body.classList.contains('reduced-motion') ? 'auto' : 'smooth',
  });
  panel.querySelector('h1')?.focus?.({ preventScroll: true });
  if (name === 'mods') refreshInstalledMods();
  if (name === 'host') refreshServers();
}

function activeProfile() {
  return (
    state.profiles.find((profile) => profile.id === state.selectedProfileId) || state.profiles[0]
  );
}

function syncProfileSelects() {
  const current = activeProfile()?.id || '';
  state.selectedProfileId = current;
  for (const select of document.querySelectorAll('#play-profile, #mods-profile')) {
    const old = select.value || current;
    select.replaceChildren(
      ...state.profiles.map((profile) => {
        const option = document.createElement('option');
        option.value = profile.id;
        option.textContent = `${profile.name} · ${profile.gameVersion}`;
        return option;
      }),
    );
    select.value = state.profiles.some((profile) => profile.id === old) ? old : current;
  }
}

function renderProfiles() {
  const list = document.querySelector('#profile-list');
  const grid = document.querySelector('#profiles-grid');
  list.replaceChildren();
  grid.replaceChildren();
  if (!state.profiles.length) {
    const empty = document.createElement('p');
    empty.className = 'muted';
    empty.textContent = 'No profiles yet. Create your first adventure.';
    list.append(empty);
    grid.append(empty.cloneNode(true));
  }
  state.profiles.slice(0, 3).forEach((profile) => {
    const row = document.createElement('button');
    row.type = 'button';
    row.className = 'profile-row';
    row.innerHTML =
      '<i class="mini-cube" aria-hidden="true"></i><span><strong></strong><small></small></span><b aria-hidden="true">›</b>';
    row.querySelector('strong').textContent = text(profile.name, 'Unnamed profile');
    row.querySelector('small').textContent = text(profile.gameVersion, 'Version unknown');
    row.addEventListener('click', () => {
      state.selectedProfileId = profile.id;
      syncProfileSelects();
      renderProfiles();
    });
    list.append(row);
  });
  state.profiles.forEach((profile) => {
    const card = document.createElement('article');
    card.className = `profile-card${profile.id === activeProfile()?.id ? ' selected' : ''}`;
    const modCount = Number.isSafeInteger(profile.modCount) ? profile.modCount : 0;
    card.innerHTML =
      '<header><i class="mini-cube" aria-hidden="true"></i><div><h2></h2><small></small></div></header><p></p><div class="card-actions"><button type="button">Select</button><button type="button">Play</button></div>';
    card.querySelector('h2').textContent = text(profile.name, 'Unnamed profile');
    card.querySelector('small').textContent = text(profile.gameVersion, 'Version unknown');
    card.querySelector('p').textContent =
      `${modCount} managed mod${modCount === 1 ? '' : 's'} · Isolated game directory`;
    const [select, play] = card.querySelectorAll('button');
    select.addEventListener('click', () => {
      state.selectedProfileId = profile.id;
      syncProfileSelects();
      renderProfiles();
    });
    play.addEventListener('click', () => {
      state.selectedProfileId = profile.id;
      syncProfileSelects();
      showView('play');
    });
    grid.append(card);
  });
  const active = activeProfile();
  document.querySelector('#active-profile-name').textContent = active
    ? active.name
    : 'No active profile';
  document.querySelector('#active-profile-version').textContent = active
    ? `Minecraft ${active.gameVersion}`
    : 'Create one to start playing';
  syncProfileSelects();
}

function renderHealth() {
  const status = state.library || {};
  const values = [
    ['Local library', status.available ? 'Found' : 'Fresh setup'],
    ['Profiles', String(status.profileCount || 0)],
    ['Identity', status.identityAvailable ? 'Protected' : 'Not configured'],
    ['Servers', status.serversAvailable ? 'Available' : 'None found'],
  ];
  document.querySelector('#health-list').replaceChildren(
    ...values.map(([label, value]) => {
      const item = document.createElement('li');
      const name = document.createElement('span');
      const result = document.createElement('strong');
      name.textContent = label;
      result.textContent = value;
      item.append(name, result);
      return item;
    }),
  );
  const badge = document.querySelector('#health-badge');
  badge.textContent = status.available ? 'Library found' : 'Fresh setup';
  badge.classList.toggle('good', Boolean(status.available));
}

function renderSettings() {
  const username = text(state.settings.username, 'PlayerOne');
  const offline = state.settings.offline?.mode || 'online';
  for (const input of document.querySelectorAll(
    '#home-username, #play-username, #setting-username',
  ))
    input.value = username;
  for (const select of document.querySelectorAll('#play-offline-mode, #setting-offline-mode'))
    select.value = offline;
  const reduced = Boolean(state.settings.reducedMotion);
  document.querySelector('#reduced-motion').checked = reduced;
  document.body.classList.toggle('reduced-motion', reduced);
}

function renderIdentity() {
  const status = state.identity || {};
  const element = document.querySelector('#identity-status');
  const button = document.querySelector('#create-identity-button');
  if (status.needsLegacyMigration) {
    element.textContent =
      'Your existing identity needs the one-time signed Electron-to-Gleam migration before it can be used here.';
    button.hidden = true;
  } else if (status.available) {
    element.textContent = `Protected by Windows · ${text(status.fingerprint).slice(0, 16)}…`;
    button.hidden = true;
  } else {
    element.textContent = 'Create a private Ed25519 identity protected by your Windows account.';
    button.hidden = false;
  }
}

async function reloadProfiles() {
  state.profiles = await call('list_profiles', {}, []);
  if (!state.profiles.some((profile) => profile.id === state.selectedProfileId))
    state.selectedProfileId = state.profiles[0]?.id || '';
  renderProfiles();
}

async function launchSelected(usernameInput = '#play-username') {
  const profile = activeProfile();
  if (!profile) return toast('Create or select a profile first.', 'error');
  const username = document.querySelector(usernameInput).value.trim();
  const mode = document.querySelector('#play-offline-mode').value;
  const status = document.querySelector('#launch-status');
  status.textContent = 'Verifying files, Java, Fabric, and mods…';
  try {
    const result = await call('launch_game', {
      request: { username, profileId: profile.id, offlineMode: mode },
    });
    status.textContent = `Minecraft started (process ${result.pid}).`;
    toast('Minecraft is starting. Gleam will keep crash recovery ready.', 'success');
  } catch (error) {
    status.textContent = errorMessage(error);
    toast(errorMessage(error), 'error');
  }
}

async function refreshInstalledMods() {
  const profileId = document.querySelector('#mods-profile').value || activeProfile()?.id;
  const root = document.querySelector('#installed-mods');
  if (!profileId) return root.replaceChildren(messageNode('Choose a profile first.'));
  root.replaceChildren(messageNode('Loading installed mods…'));
  try {
    const mods = await call('list_installed_mods', { request: { id: profileId } });
    root.replaceChildren(
      ...(mods.length
        ? mods.map((mod) =>
            itemNode(
              mod.name || mod.projectId,
              mod.versionNumber || mod.file,
              'Remove',
              async () => {
                await call('remove_mod', { request: { profileId, projectId: mod.projectId } });
                toast(`${mod.name || mod.projectId} removed.`);
                await refreshInstalledMods();
              },
            ),
          )
        : [messageNode('No managed mods installed.')]),
    );
  } catch (error) {
    root.replaceChildren(messageNode(errorMessage(error)));
  }
}

function messageNode(message) {
  const node = document.createElement('p');
  node.className = 'muted';
  node.textContent = message;
  return node;
}

function itemNode(title, detail, actionLabel, action) {
  const row = document.createElement('article');
  row.className = 'list-item';
  const copy = document.createElement('div');
  const heading = document.createElement('strong');
  const note = document.createElement('small');
  const button = document.createElement('button');
  heading.textContent = title;
  note.textContent = detail;
  copy.append(heading, note);
  button.type = 'button';
  button.className = 'quiet-surface-button';
  button.textContent = actionLabel;
  button.addEventListener('click', async () => {
    button.disabled = true;
    try {
      await action();
    } catch (error) {
      toast(errorMessage(error), 'error');
    } finally {
      button.disabled = false;
    }
  });
  row.append(copy, button);
  return row;
}

async function searchMods() {
  const profile = state.profiles.find(
    (item) => item.id === document.querySelector('#mods-profile').value,
  );
  const query = document.querySelector('#mod-search').value.trim();
  if (!profile || !query) return;
  const root = document.querySelector('#mod-results');
  root.replaceChildren(messageNode('Searching Modrinth…'));
  try {
    const result = await call('search_mods', {
      request: { query, gameVersion: profile.gameVersion },
    });
    const hits = Array.isArray(result?.hits) ? result.hits.slice(0, 25) : [];
    root.replaceChildren(
      ...(hits.length
        ? hits.map((hit) =>
            itemNode(
              hit.title || hit.slug,
              `${hit.description || 'Fabric mod'} · ${Number(hit.downloads || 0).toLocaleString()} downloads`,
              'Install',
              async () => {
                await call('install_mod', {
                  request: { profileId: profile.id, projectId: hit.project_id, versionId: '' },
                });
                toast(`${hit.title || hit.slug} installed.`, 'success');
                await reloadProfiles();
                await refreshInstalledMods();
              },
            ),
          )
        : [messageNode('No compatible results found.')]),
    );
  } catch (error) {
    root.replaceChildren(messageNode(errorMessage(error)));
  }
}

async function refreshServers() {
  const root = document.querySelector('#server-list');
  root.replaceChildren(messageNode('Loading servers…'));
  try {
    state.servers = await call('list_servers');
    if (!state.servers.some((item) => item.id === state.selectedServerId))
      state.selectedServerId = state.servers[0]?.id || '';
    root.replaceChildren(
      ...(state.servers.length
        ? state.servers.map((server) => {
            const row = document.createElement('article');
            row.className = 'list-item server-item';
            const copy = document.createElement('div');
            const heading = document.createElement('strong');
            const note = document.createElement('small');
            const actions = document.createElement('section');
            heading.textContent = server.name;
            note.textContent = `Minecraft ${server.version} · Port ${server.port} · ${server.state}`;
            copy.append(heading, note);
            actions.className = 'server-actions';
            const choose = document.createElement('button');
            choose.className = 'quiet-surface-button';
            choose.textContent = 'Console';
            choose.addEventListener('click', () => {
              state.selectedServerId = server.id;
              refreshConsole();
            });
            const lifecycle = document.createElement('button');
            lifecycle.className = 'quiet-surface-button';
            lifecycle.textContent = ['starting', 'ready', 'preparing'].includes(server.state)
              ? 'Stop'
              : 'Start';
            lifecycle.addEventListener('click', async () => {
              lifecycle.disabled = true;
              try {
                if (lifecycle.textContent === 'Stop')
                  await call('stop_server', { request: { id: server.id } });
                else await call('start_server', { request: { id: server.id } });
                state.selectedServerId = server.id;
                toast(
                  lifecycle.textContent === 'Stop' ? 'Safe stop requested.' : 'Server is starting.',
                  'success',
                );
                await refreshServers();
                await refreshConsole();
              } catch (error) {
                toast(errorMessage(error), 'error');
              } finally {
                lifecycle.disabled = false;
              }
            });
            const backup = document.createElement('button');
            backup.className = 'quiet-surface-button';
            backup.textContent = 'Backup';
            backup.disabled = ['starting', 'ready', 'preparing'].includes(server.state);
            backup.addEventListener('click', async () => {
              try {
                await call('create_server_backup', { request: { id: server.id } });
                toast('Server backup completed.', 'success');
              } catch (error) {
                toast(errorMessage(error), 'error');
              }
            });
            actions.append(choose, lifecycle, backup);
            row.append(copy, actions);
            return row;
          })
        : [messageNode('No servers yet. Create one for your friends.')]),
    );
    if (state.selectedServerId) await refreshConsole();
  } catch (error) {
    root.replaceChildren(messageNode(errorMessage(error)));
  }
}

async function refreshConsole() {
  if (!state.selectedServerId) return;
  const server = state.servers.find((item) => item.id === state.selectedServerId);
  document.querySelector('#console-title').textContent = server
    ? `${server.name} console`
    : 'Console';
  try {
    const output = await call('server_console', { request: { id: state.selectedServerId } });
    const consoleElement = document.querySelector('#server-console');
    consoleElement.textContent = output || 'No console output yet.';
    consoleElement.scrollTop = consoleElement.scrollHeight;
  } catch (error) {
    toast(errorMessage(error), 'error');
  }
}

async function load() {
  try {
    [state.appInfo, state.library, state.profiles, state.settings, state.identity] =
      await Promise.all([
        call(
          'app_info',
          {},
          { name: 'Gleam', version: '3.0.0', migrationStage: 'Browser preview' },
        ),
        call('legacy_status', {}, { available: false, profileCount: 0 }),
        call('list_profiles', {}, []),
        call('get_settings', {}, {}),
        call('identity_status', {}, { available: false }),
      ]);
  } catch (error) {
    toast(errorMessage(error), 'error');
  }
  state.selectedProfileId = state.profiles[0]?.id || '';
  document.querySelector('#app-version').textContent =
    `${text(state.appInfo?.name, 'Gleam')} ${text(state.appInfo?.version, '3.0.0')}`;
  document.querySelector('#migration-stage').textContent = text(
    state.appInfo?.migrationStage,
    'Native Rust core',
  );
  renderProfiles();
  renderHealth();
  renderSettings();
  renderIdentity();
}

document.addEventListener('click', async (event) => {
  const viewButton = event.target.closest('[data-view]');
  if (viewButton) showView(viewButton.dataset.view);
  const viewLink = event.target.closest('[data-view-link]');
  if (viewLink) {
    event.preventDefault();
    showView(viewLink.dataset.viewLink);
  }
  const action = event.target.closest('[data-window-action]')?.dataset.windowAction;
  if (action && window.__TAURI__?.window) {
    const appWindow = window.__TAURI__.window.getCurrentWindow();
    if (action === 'minimize') await appWindow.minimize();
    if (action === 'close') await appWindow.close();
  }
});

document
  .querySelector('#new-profile-button')
  .addEventListener('click', () => document.querySelector('#profile-dialog').showModal());
document.querySelector('#create-profile-button').addEventListener('click', async () => {
  const name = document.querySelector('#profile-name').value.trim();
  const gameVersion = document.querySelector('#profile-version').value.trim();
  if (!name || !gameVersion) return document.querySelector('#profile-form').reportValidity();
  try {
    const profile = await call('create_profile', {
      request: {
        name,
        gameVersion,
        preset: 'custom',
        sourceProfileId: '',
        copyWorlds: false,
        copyMods: false,
        copySettings: false,
      },
    });
    state.selectedProfileId = profile.id;
    document.querySelector('#profile-dialog').close();
    await reloadProfiles();
    toast(`${profile.name} is ready.`, 'success');
  } catch (error) {
    toast(errorMessage(error), 'error');
  }
});
document.querySelector('#home-play-button').addEventListener('click', async () => {
  document.querySelector('#play-username').value = document.querySelector('#home-username').value;
  showView('play');
  await launchSelected();
});
document.querySelector('#launch-button').addEventListener('click', () => launchSelected());
document.querySelector('#prepare-button').addEventListener('click', async () => {
  const profile = activeProfile();
  if (!profile) return toast('Choose a profile first.', 'error');
  const status = document.querySelector('#launch-status');
  status.textContent = 'Checking and repairing managed files…';
  try {
    await call('prepare_profile', { request: { id: profile.id } });
    status.textContent = 'Profile is ready to play.';
    toast('Profile check completed.', 'success');
  } catch (error) {
    status.textContent = errorMessage(error);
    toast(errorMessage(error), 'error');
  }
});
document.querySelector('#play-profile').addEventListener('change', (event) => {
  state.selectedProfileId = event.target.value;
  document.querySelector('#mods-profile').value = event.target.value;
  renderProfiles();
});
document.querySelector('#mods-profile').addEventListener('change', (event) => {
  state.selectedProfileId = event.target.value;
  document.querySelector('#play-profile').value = event.target.value;
  renderProfiles();
  refreshInstalledMods();
});
document.querySelector('#mod-search-button').addEventListener('click', searchMods);
document.querySelector('#mod-search').addEventListener('keydown', (event) => {
  if (event.key === 'Enter') searchMods();
});
document
  .querySelector('#reduced-motion')
  .addEventListener('change', (event) =>
    document.body.classList.toggle('reduced-motion', event.target.checked),
  );
document.querySelector('#save-settings-button').addEventListener('click', async () => {
  try {
    state.settings = await call('update_settings', {
      patch: {
        username: document.querySelector('#setting-username').value.trim(),
        reducedMotion: document.querySelector('#reduced-motion').checked,
        offline: { mode: document.querySelector('#setting-offline-mode').value },
      },
    });
    renderSettings();
    toast('Settings saved.', 'success');
  } catch (error) {
    toast(errorMessage(error), 'error');
  }
});
document.querySelector('#create-identity-button').addEventListener('click', async () => {
  try {
    state.identity = await call('create_identity');
    renderIdentity();
    toast('Your protected Gleam identity is ready.', 'success');
  } catch (error) {
    toast(errorMessage(error), 'error');
  }
});
document.querySelector('#import-pack-button').addEventListener('click', async () => {
  try {
    const path = await call('choose_provisioning_import');
    if (!path) return;
    const info = await call('inspect_provisioning_pack', { request: { path } });
    const approved = window.confirm(
      `Import ${info.artifacts.toLocaleString()} verified artifacts (${Math.round(info.totalSize / 1024 / 1024).toLocaleString()} MiB)? Existing managed files will be recoverable during the transaction.`,
    );
    if (!approved) return;
    const result = await call('import_provisioning_pack', {
      request: { path, allowUnsigned: !info.signed },
    });
    toast(`Imported ${result.artifacts.toLocaleString()} verified artifacts.`, 'success');
    await reloadProfiles();
  } catch (error) {
    toast(errorMessage(error), 'error');
  }
});
document.querySelector('#export-pack-button').addEventListener('click', async () => {
  const profile = activeProfile();
  if (!profile) return toast('Choose a profile to export.', 'error');
  try {
    const path = await call('choose_provisioning_export');
    if (!path) return;
    toast('Building the offline pack. Large profiles can take a while.');
    const result = await call('export_provisioning_pack', {
      request: { profileId: profile.id, path },
    });
    toast(`Exported ${result.artifacts.toLocaleString()} verified artifacts.`, 'success');
  } catch (error) {
    toast(errorMessage(error), 'error');
  }
});
document.querySelector('#check-updates-button').addEventListener('click', async () => {
  const status = document.querySelector('#update-status');
  status.textContent = 'Checking the signed update channel…';
  try {
    const result = await call('check_updates');
    status.textContent = result.enabled
      ? result.available
        ? `Gleam ${result.payload.version} is available.`
        : 'Gleam is up to date.'
      : result.message;
  } catch (error) {
    status.textContent = errorMessage(error);
    toast(errorMessage(error), 'error');
  }
});
document
  .querySelector('#new-server-button')
  .addEventListener('click', () => document.querySelector('#server-dialog').showModal());
document.querySelector('#create-server-button').addEventListener('click', async () => {
  const form = document.querySelector('#server-form');
  if (!form.reportValidity()) return;
  try {
    const server = await call('create_server', {
      request: {
        name: document.querySelector('#server-name').value.trim(),
        version: document.querySelector('#server-version').value.trim(),
        port: Number(document.querySelector('#server-port').value),
        memoryMb: Number(document.querySelector('#server-memory').value),
        whitelist: false,
        acceptEula: document.querySelector('#server-eula').checked,
      },
    });
    state.selectedServerId = server.id;
    document.querySelector('#server-dialog').close();
    toast(`${server.name} was created.`, 'success');
    await refreshServers();
  } catch (error) {
    toast(errorMessage(error), 'error');
  }
});
document.querySelector('#refresh-console-button').addEventListener('click', refreshConsole);
document.querySelector('#send-command-button').addEventListener('click', async () => {
  const input = document.querySelector('#server-command');
  if (!state.selectedServerId || !input.value.trim()) return;
  try {
    await call('server_command', {
      request: { id: state.selectedServerId, command: input.value.trim() },
    });
    input.value = '';
    window.setTimeout(refreshConsole, 200);
  } catch (error) {
    toast(errorMessage(error), 'error');
  }
});
document.querySelector('#server-command').addEventListener('keydown', (event) => {
  if (event.key === 'Enter') document.querySelector('#send-command-button').click();
});

load();
