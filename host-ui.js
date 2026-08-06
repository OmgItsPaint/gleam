(() => {
  const byId = id => document.getElementById(id);
  const page = byId('hosts-view');
  const status = byId('server-status');
  const list = byId('server-list');
  const consoleView = byId('server-console');
  const summary = byId('host-running-summary');
  const runningName = byId('running-server-name');
  const runningAddress = byId('running-server-address');
  const consoleState = byId('console-state');
  const form = byId('create-server');
  const commandForm = byId('server-command-form');
  byId('copy-server-address').textContent = 'Copy invite';
  let activeId = '';
  let activeServer = null;
  let modServer = null;
  let playerServer = null;
  let addresses = [];
  const consoleBuffers = new Map();
  const serverIndex = new Map();
  const unread = new Set();

  const clear = element => element.replaceChildren();
  const activeStates = new Set(['downloading', 'starting', 'ready', 'stopping']);
  const friendly = error => String(error?.message || error || 'Something went wrong.').replace(/^Error invoking remote method '[^']+': Error:\s*/i, '');
  function append(line) { const text = `${consoleBuffers.get(activeId) || ''}${line}`.slice(-64_000); consoleBuffers.set(activeId, text); consoleView.textContent = text || 'No console output yet.'; consoleView.scrollTop = consoleView.scrollHeight; }
  function addressFor(server) { const address = addresses[0]?.address || addresses[0]; return address ? `${String(address).includes(':') ? `[${address}]` : address}:${server.port}` : `Port ${server.port}`; }
  async function selectServer(server) { activeId = server.id; activeServer = server; unread.delete(server.id); consoleView.textContent = consoleBuffers.get(server.id) || await window.icecream.serverConsole(server.id).catch(() => '') || 'No console output yet.'; consoleView.scrollTop = consoleView.scrollHeight; consoleState.textContent = server.runtime?.message || 'Ready to start.'; drawActive(server); await refresh(); }
  function drawActive(server) {
    const runtime = server?.runtime || { state: 'stopped', message: '' };
    const running = Boolean(server && activeStates.has(runtime.state));
    page.classList.toggle('server-running', running);
    summary.hidden = !running;
    if (!running) return;
    runningName.textContent = server.name;
    runningAddress.textContent = runtime.state === 'ready' ? `Friends on your Wi-Fi: ${addressFor(server)}` : runtime.message;
    consoleState.textContent = runtime.state === 'ready' ? 'Ready — commands are sent to this server.' : runtime.message;
  }
  async function refresh() {
    try {
      const servers = await window.icecream.servers();
      serverIndex.clear(); servers.forEach(server => serverIndex.set(server.id, server));
      clear(list);
      if (!servers.length) { status.textContent = 'Create a server to begin.'; drawActive(null); return; }
      if (!activeId) status.textContent = `${servers.length} saved local server${servers.length === 1 ? '' : 's'}.`;
      for (const server of servers) {
        const runtime = server.runtime || { state: 'stopped', message: 'Ready to start.' };
        if (!activeId && activeStates.has(runtime.state)) { activeId = server.id; activeServer = server; }
        const card = document.createElement('article'); card.className = 'host-server-card server-profile-card';
        const cover = document.createElement('div'); cover.className = 'server-profile-cover'; const logo = document.createElement('img'); logo.src = 'assets/swirl-logo.svg'; logo.alt = ''; const versionBadge = document.createElement('span'); versionBadge.className = 'profile-version'; versionBadge.textContent = `Fabric ${server.version}`; cover.append(logo, versionBadge);
        const information = document.createElement('div');
        const name = document.createElement('strong'); name.textContent = server.name;
        const details = document.createElement('small'); details.textContent = `${server.version} • ${server.port} • ${server.whitelist ? 'friends list on' : 'anyone with the address can join'}`;
        const state = document.createElement('small'); state.className = `host-state ${runtime.state}`; state.textContent = `${runtime.message}${unread.has(server.id) ? ' • new console output' : ''}`;
        information.append(name, details, state);
        const actions = document.createElement('div'); actions.className = 'host-server-actions';
        const secondary = document.createElement('div'); secondary.className = 'host-secondary-actions';
        const consoleButton = document.createElement('button'); consoleButton.className = activeId === server.id ? 'mod-install' : 'secondary-action'; consoleButton.textContent = activeId === server.id ? 'Console selected' : 'Open console'; consoleButton.disabled = activeId === server.id; consoleButton.addEventListener('click', () => selectServer(server)); actions.append(consoleButton);
        const start = document.createElement('button'); start.className = 'mod-install'; start.textContent = runtime.state === 'error' ? 'Try again' : 'Start'; start.disabled = activeStates.has(runtime.state);
        start.addEventListener('click', async () => {
          activeId = server.id; activeServer = { ...server, runtime: { state: 'starting', message: 'Preparing server…' } };
          consoleView.textContent = `Starting ${server.name}…`; status.textContent = 'Preparing server…'; drawActive(activeServer);
          try { await window.icecream.startServer(server.id); await refresh(); } catch (error) { const message = friendly(error); status.textContent = message; activeServer.runtime = { state: 'error', message }; drawActive(activeServer); await refresh(); }
        });
        if (!activeStates.has(runtime.state)) actions.append(start);
        const invite = document.createElement('button'); invite.className = 'secondary-action'; invite.textContent = 'Copy invite'; invite.addEventListener('click', async () => { invite.disabled = true; try { const code = await window.icecream.exportServerInvite(server.id); await navigator.clipboard.writeText(code); invite.textContent = 'Copied'; setTimeout(() => { invite.textContent = 'Copy invite'; invite.disabled = false; }, 1400); } catch (error) { status.textContent = friendly(error); invite.disabled = false; } }); actions.append(invite);
        if (server.whitelist) { const players = document.createElement('button'); players.className = 'secondary-action'; players.textContent = 'Players'; players.addEventListener('click', () => openPlayers(server)); secondary.append(players); }
        if (activeStates.has(runtime.state)) { const test = document.createElement('button'); test.className = 'secondary-action'; test.textContent = 'Test connection'; test.addEventListener('click', () => testConnection(server)); const stop = document.createElement('button'); stop.className = 'danger-action'; stop.textContent = 'Stop'; stop.addEventListener('click', () => stopServer(server)); secondary.append(test); actions.append(stop); }
        else {
          const mods = document.createElement('button'); mods.className = 'mod-install'; mods.textContent = 'Manage mods'; mods.addEventListener('click', () => openServerMods(server));
          const folder = document.createElement('button'); folder.className = 'secondary-action'; folder.textContent = 'All files'; folder.addEventListener('click', async () => { try { await window.icecream.openServerFolder(server.id); } catch (error) { status.textContent = friendly(error); } });
          const backup = document.createElement('button'); backup.className = 'secondary-action'; backup.textContent = 'Back up'; backup.addEventListener('click', async () => { backup.disabled = true; try { await window.icecream.backupServer(server.id); status.textContent = `${server.name} was backed up.`; } catch (error) { status.textContent = friendly(error); } finally { backup.disabled = false; } });
          const browse = document.createElement('button'); browse.className = 'secondary-action'; browse.textContent = 'Backups'; browse.addEventListener('click', () => window.swirlOpenBackups?.({ kind: 'server', id: server.id, title: server.name, onRestore: refresh }));
          const test = document.createElement('button'); test.className = 'secondary-action'; test.textContent = 'Test connection'; test.addEventListener('click', () => testConnection(server));
          const remove = document.createElement('button'); remove.className = 'danger-action'; remove.textContent = 'Delete server'; remove.addEventListener('click', async () => { if (!window.confirm(`Delete ${server.name}? Its folder will be moved to Swirl Trash.`)) return; try { await window.icecream.deleteServer(server.id); if (activeId === server.id) { activeId = ''; activeServer = null; } await refresh(); } catch (error) { status.textContent = friendly(error); } }); secondary.append(mods, test, backup, browse, folder, remove);
        }
        if (secondary.children.length) {
          const more = document.createElement('details'); more.className = 'host-more';
          const moreLabel = document.createElement('summary'); moreLabel.textContent = 'More'; moreLabel.setAttribute('aria-label', `More actions for ${server.name}`);
          more.append(moreLabel, secondary); actions.append(more);
        }
        card.append(cover, information, actions); list.append(card);
        if (server.id === activeId) { activeServer = server; drawActive(server); }
      }
    } catch (error) { status.textContent = `Server error: ${friendly(error)}`; }
  }
  async function stopServer(server = activeServer) {
    if (!server) return;
    if (!window.confirm(`Stop ${server.name}? Minecraft will save the world before shutting down.`)) return;
    try { status.textContent = 'Saving the world and stopping safely…'; await window.icecream.stopServer(server.id); } catch (error) { status.textContent = friendly(error); }
  }
  async function drawPlayers() { const container = byId('server-players-list'); clear(container); if (!playerServer) return; try { const players = await window.icecream.approvedServerPlayers(playerServer.id); byId('server-players-status').textContent = players.length ? `${players.length} approved name${players.length === 1 ? '' : 's'}.` : 'No approved names yet. Add your own name before joining.'; for (const player of players) { const row = document.createElement('article'); row.className = 'mod-card server-mod-item'; const info = document.createElement('div'); const title = document.createElement('div'); title.className = 'mod-title'; title.textContent = player.name; const detail = document.createElement('div'); detail.className = 'mod-meta'; detail.textContent = player.operator ? 'Operator' : 'Player'; info.append(title, detail); const remove = document.createElement('button'); remove.className = 'danger-action'; remove.textContent = 'Remove'; remove.addEventListener('click', async () => { remove.disabled = true; try { await window.icecream.setApprovedServerPlayer(playerServer.id, player.name, false, false); await drawPlayers(); } catch (error) { byId('server-players-status').textContent = friendly(error); remove.disabled = false; } }); row.append(info, remove); container.append(row); } } catch (error) { byId('server-players-status').textContent = friendly(error); } }
  async function openPlayers(server) { playerServer = server; byId('server-players-title').textContent = `${server.name} players`; byId('server-player-name').value = ''; byId('server-player-op').checked = false; const dialog = byId('server-players-dialog'); if (!dialog.open) dialog.showModal(); await drawPlayers(); }
  async function drawInstalledServerMods() { const container = byId('server-installed-mods'); clear(container); if (!modServer) return; try { const mods = await window.icecream.installedServerMods(modServer.id); byId('server-mod-status').textContent = mods.length ? `${mods.length} installed server mod${mods.length === 1 ? '' : 's'}.` : 'No managed server mods installed.'; for (const mod of mods) { const card = document.createElement('article'); card.className = 'mod-card server-mod-item'; const icon = document.createElement('div'); icon.className = 'mod-icon'; const info = document.createElement('div'); const title = document.createElement('div'); title.className = 'mod-title'; title.textContent = mod.name; const meta = document.createElement('div'); meta.className = 'mod-meta'; meta.textContent = mod.versionNumber || mod.versionId; info.append(title, meta); const remove = document.createElement('button'); remove.className = 'danger-action'; remove.textContent = 'Remove'; remove.addEventListener('click', async () => { if (!window.confirm(`Remove ${mod.name} from ${modServer.name}? A backup is made first.`)) return; remove.disabled = true; try { await window.icecream.removeServerMod(modServer.id, mod.projectId); await drawInstalledServerMods(); } catch (error) { byId('server-mod-status').textContent = friendly(error); remove.disabled = false; } }); card.append(icon, info, remove); container.append(card); } } catch (error) { byId('server-mod-status').textContent = friendly(error); } }
  async function openServerMods(server) { if (activeStates.has(server.runtime?.state)) { status.textContent = 'Stop the server before changing its mods.'; return; } modServer = server; byId('server-mod-title').textContent = `${server.name} mods`; clear(byId('server-mod-results')); byId('server-mod-query').value = ''; const dialog = byId('server-mod-dialog'); if (!dialog.open) dialog.showModal(); await drawInstalledServerMods(); }
  async function testConnection(server) { const dialog = byId('connection-dialog'); const results = byId('connection-results'); byId('connection-title').textContent = server.name; clear(results); const loading = document.createElement('p'); loading.className = 'mod-status'; loading.textContent = 'Testing this computer and server…'; results.append(loading); if (!dialog.open) dialog.showModal(); try { const report = await window.icecream.testServerConnection(server.id, byId('version').value); clear(results); for (const check of report.checks) { const card = document.createElement('article'); card.className = `diagnostic-card ${check.level}`; const mark = document.createElement('span'); mark.className = 'diagnostic-mark'; mark.textContent = check.level === 'pass' ? '✓' : check.level === 'fail' ? '!' : check.level === 'warn' ? '?' : 'i'; const info = document.createElement('div'); const title = document.createElement('strong'); title.textContent = check.title; const detail = document.createElement('small'); detail.textContent = check.detail; info.append(title, detail); card.append(mark, info); results.append(card); } } catch (error) { loading.textContent = friendly(error); } }

  byId('open-hosts').addEventListener('click', () => { ['library-view', 'profiles-view', 'settings-view', 'editor-view'].forEach(id => { byId(id).hidden = true; }); page.hidden = false; window.swirlSetActiveTab?.('hosts'); refresh(); });
  byId('stop-active-server').addEventListener('click', () => stopServer());
  byId('clear-server-console').addEventListener('click', () => { consoleBuffers.set(activeId, ''); consoleView.textContent = ''; });
  byId('server-mod-close').addEventListener('click', () => byId('server-mod-dialog').close());
  byId('connection-close').addEventListener('click', () => byId('connection-dialog').close());
  byId('server-players-close').addEventListener('click', () => byId('server-players-dialog').close());
  byId('server-player-form').addEventListener('submit', async event => { event.preventDefault(); if (!playerServer) return; const button = event.submitter; button.disabled = true; try { await window.icecream.setApprovedServerPlayer(playerServer.id, byId('server-player-name').value, true, byId('server-player-op').checked); byId('server-player-name').value = ''; byId('server-player-op').checked = false; await drawPlayers(); } catch (error) { byId('server-players-status').textContent = friendly(error); } finally { button.disabled = false; } });
  byId('update-server-mods').addEventListener('click', async () => { if (!modServer) return; const button = byId('update-server-mods'); button.disabled = true; try { const updated = await window.icecream.updateServerMods(modServer.id); byId('server-mod-status').textContent = updated.length ? `Updated ${updated.join(', ')}.` : 'All server mods are current.'; await drawInstalledServerMods(); } catch (error) { byId('server-mod-status').textContent = friendly(error); } finally { button.disabled = false; } });
  byId('server-mod-search').addEventListener('submit', async event => { event.preventDefault(); if (!modServer) return; const results = byId('server-mod-results'); clear(results); byId('server-mod-status').textContent = 'Searching compatible server mods…'; try { const installed = new Set((await window.icecream.installedServerMods(modServer.id)).map(mod => mod.projectId)); const mods = await window.icecream.searchServerMods(modServer.id, byId('server-mod-query').value); byId('server-mod-status').textContent = mods.length ? `${mods.length} compatible result${mods.length === 1 ? '' : 's'}.` : 'No compatible server mods found.'; for (const mod of mods) { const card = document.createElement('article'); card.className = 'mod-card server-mod-item'; const icon = document.createElement('img'); icon.className = 'mod-icon'; icon.alt = ''; if (mod.icon) icon.src = mod.icon; const info = document.createElement('div'); const title = document.createElement('div'); title.className = 'mod-title'; title.textContent = mod.title; const description = document.createElement('div'); description.className = 'mod-description'; description.textContent = mod.description || ''; info.append(title, description); const install = document.createElement('button'); install.className = 'mod-install'; install.textContent = installed.has(mod.id) ? 'Installed' : 'Install'; install.disabled = installed.has(mod.id); install.addEventListener('click', async () => { install.disabled = true; install.textContent = 'Installing…'; try { await window.icecream.installServerMod(modServer.id, mod.id, ''); await drawInstalledServerMods(); install.textContent = 'Installed'; } catch (error) { byId('server-mod-status').textContent = friendly(error); install.disabled = false; install.textContent = 'Install'; } }); card.append(icon, info, install); results.append(card); } } catch (error) { byId('server-mod-status').textContent = friendly(error); } });
  byId('copy-server-address').addEventListener('click', async () => {
    if (!activeServer) { status.textContent = 'Select a running server first.'; return; }
    const button = byId('copy-server-address');
    button.disabled = true;
    try {
      const invite = await window.icecream.exportServerInvite(activeServer.id);
      await navigator.clipboard.writeText(invite);
      button.textContent = 'Copied';
      setTimeout(() => { button.textContent = 'Copy invite'; button.disabled = false; }, 1200);
    } catch (error) { status.textContent = friendly(error); button.disabled = false; }
  });
  form.addEventListener('submit', async event => {
    event.preventDefault();
    try {
      const created = await window.icecream.createServer(byId('server-name').value, byId('server-version').value, byId('server-port').value, { whitelist: byId('server-whitelist').checked, acceptEula: byId('server-eula').checked, memoryMb: Number(byId('server-memory').value), hostName: localStorage.getItem('swirl-player-name') || '' });
      activeId = created.id; activeServer = created; status.textContent = `${created.name} was created. Press Start when ready.`;
      const selectedVersion = created.version; form.reset(); byId('server-version').value = selectedVersion; byId('server-port').value = ''; await refresh();
    } catch (error) { status.textContent = friendly(error); }
  });
  commandForm.addEventListener('submit', async event => {
    event.preventDefault(); const input = byId('server-command');
    try { await window.icecream.serverCommand(activeId, input.value); append(`> ${input.value}`); input.value = ''; } catch (error) { status.textContent = friendly(error); }
  });
  window.icecream.serverLanAddresses().then(result => { addresses = result; if (activeServer) drawActive(activeServer); }).catch(() => {});
  window.icecream.fetchVersions().then(versions => { const supported = versions.filter(item => !item.experimental).map(item => ({ value: item.id, label: `Minecraft ${item.id}` })); if (supported.length && window.swirlCreatePicker) { const preferred = supported.some(item => item.value === '26.2') ? '26.2' : supported[0].value; window.swirlCreatePicker(byId('server-version-picker'), byId('server-version'), supported, preferred); byId('server-version-picker').addEventListener('icecream-change', () => { if (/^\d{2}\./.test(byId('server-version').value) && Number(byId('server-memory').value) < 4096) byId('server-memory').value = '4096'; }); } }).catch(() => { if (window.swirlCreatePicker) window.swirlCreatePicker(byId('server-version-picker'), byId('server-version'), [{ value: '26.2', label: 'Minecraft 26.2' }, { value: '1.21.1', label: 'Minecraft 1.21.1' }], '26.2'); });
  window.icecream.onServerEvent(event => {
    if (event.type === 'console') { if (event.id === activeId) append(event.line); else { consoleBuffers.set(event.id, `${consoleBuffers.get(event.id) || ''}${event.line}`.slice(-64_000)); unread.add(event.id); } return; }
    const indexed = serverIndex.get(event.id); if (indexed) indexed.runtime = { state: event.state, message: event.message };
    if (event.id !== activeId) { refresh(); return; }
    status.textContent = event.message;
    if (activeServer) { activeServer.runtime = { state: event.state, message: event.message }; drawActive(activeServer); }
    if (event.state === 'ready') refresh();
    if (event.state === 'stopped' || event.state === 'error') { page.classList.remove('server-running'); summary.hidden = true; consoleState.textContent = event.message; refresh(); }
  });
})();
