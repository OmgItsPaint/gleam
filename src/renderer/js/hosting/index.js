/**
 * Renderer-side controller for independent Fabric server profiles.
 * It builds server cards and dialogs, streams console state, and delegates every filesystem or
 * process operation to the restricted preload API.
 */
(() => {
  const byId = (id) => document.getElementById(id);
  const page = byId('hosts-view');
  const status = byId('server-status');
  const list = byId('server-list');
  const consoleView = byId('server-console');
  const summary = byId('host-running-summary');
  const runningName = byId('running-server-name');
  const runningAddress = byId('running-server-address');
  const consoleState = byId('console-state');
  const consoleSearch = byId('server-console-search');
  const consoleFollow = byId('server-console-follow');
  const consoleFilterStatus = byId('server-console-filter-status');
  const form = byId('create-server');
  const commandForm = byId('server-command-form');
  for (const id of ['server-whitelist', 'server-eula']) {
    const input = byId(id);
    const label = input.closest('label');
    label.classList.add('host-switch');
    if (id === 'server-eula') label.classList.add('host-eula');
    const track = document.createElement('i');
    track.setAttribute('aria-hidden', 'true');
    input.after(track);
  }
  const serverLibrary = document.createElement('section');
  serverLibrary.className = 'server-library';
  const serverLibraryHeading = document.createElement('div');
  serverLibraryHeading.className = 'server-library-heading';
  const serverLibraryCopy = document.createElement('div');
  const serverLibraryKicker = document.createElement('span');
  serverLibraryKicker.className = 'section-kicker';
  serverLibraryKicker.textContent = 'SAVED SERVERS';
  const serverLibraryTitle = document.createElement('h3');
  serverLibraryTitle.textContent = 'Server library';
  const serverLibraryHelp = document.createElement('p');
  serverLibraryHelp.className = 'host-help';
  serverLibraryHelp.textContent =
    'Choose a server to start it, manage its mods, or open its console.';
  serverLibraryCopy.append(serverLibraryKicker, serverLibraryTitle, serverLibraryHelp);
  serverLibraryHeading.append(serverLibraryCopy);
  serverLibrary.append(serverLibraryHeading, status, list);
  page.querySelector('.host-layout').before(serverLibrary);
  const recommendedMemory = [...byId('server-memory').options].find(
    (option) => option.value === '4096',
  );
  if (recommendedMemory) recommendedMemory.textContent = '4 GB · default';
  const templateField = document.createElement('label');
  templateField.className = 'field host-template';
  const templateLabel = document.createElement('span');
  templateLabel.textContent = 'SERVER TYPE';
  const templateSelect = document.createElement('select');
  templateSelect.id = 'server-template';
  templateSelect.setAttribute('aria-label', 'Server type');
  for (const [value, label] of [
    ['friends', 'Friends'],
    ['performance', 'Performance'],
    ['creative', 'Creative'],
    ['custom', 'Custom'],
  ]) {
    const option = document.createElement('option');
    option.value = value;
    option.textContent = label;
    templateSelect.append(option);
  }
  templateField.append(templateLabel, templateSelect);
  form.insertBefore(templateField, byId('server-memory').closest('label'));
  byId('copy-server-address').textContent = 'Copy invite';
  byId('server-players-dialog').querySelector(':scope > .mod-status').textContent =
    'Friends using a signed Gleam invite request access with a private player key. Check the short key fingerprint before approving.';
  let activeId = '';
  let activeServer = null;
  let modServer = null;
  let playerServer = null;
  let settingsServer = null;
  let addresses = [];
  const consoleBuffers = new Map();
  const serverIndex = new Map();
  const unread = new Set();

  const clear = (element) => element.replaceChildren();
  const activeStates = new Set(['downloading', 'starting', 'ready', 'stopping']);
  const friendly = (error) =>
    String(error?.message || error || 'Something went wrong.').replace(
      /^Error invoking remote method '[^']+': Error:\s*/i,
      '',
    );
  function renderConsole({ follow = false } = {}) {
    const raw = consoleBuffers.get(activeId) || '';
    const query = consoleSearch.value.trim().toLocaleLowerCase();
    const lines = raw.split(/\r?\n/);
    const filtered = query
      ? lines.filter((line) => line.toLocaleLowerCase().includes(query))
      : lines;
    consoleView.textContent =
      filtered.join('\n') || (query ? 'No matching console lines.' : 'No console output yet.');
    consoleFilterStatus.textContent = query
      ? `${filtered.filter(Boolean).length} of ${lines.filter(Boolean).length} lines shown.`
      : '';
    if (follow && consoleFollow.checked) consoleView.scrollTop = consoleView.scrollHeight;
  }
  function append(line) {
    const nearBottom =
      consoleView.scrollHeight - consoleView.scrollTop - consoleView.clientHeight < 32;
    const text = `${consoleBuffers.get(activeId) || ''}${line}`.slice(-64_000);
    consoleBuffers.set(activeId, text);
    renderConsole({ follow: nearBottom });
  }
  function addressFor(server) {
    const address = addresses[0]?.address || addresses[0];
    return address
      ? `${String(address).includes(':') ? `[${address}]` : address}:${server.port}`
      : `Port ${server.port}`;
  }
  // Selecting a server swaps the visible console and all context-sensitive actions.
  async function selectServer(server) {
    activeId = server.id;
    activeServer = server;
    unread.delete(server.id);
    const buffered =
      consoleBuffers.get(server.id) ||
      (await window.icecream.serverConsole(server.id).catch(() => '')) ||
      '';
    consoleBuffers.set(server.id, buffered);
    renderConsole({ follow: true });
    consoleState.textContent = server.runtime?.message || 'Ready to start.';
    drawActive(server);
    byId('server-domain-port').value = server.port;
    await refresh();
  }
  function drawActive(server) {
    const runtime = server?.runtime || { state: 'stopped', message: '' };
    const running = Boolean(server && activeStates.has(runtime.state));
    page.classList.toggle('server-running', running);
    summary.hidden = !running;
    if (!running) return;
    runningName.textContent = server.name;
    runningAddress.textContent =
      runtime.state === 'ready' ? `Friends on your Wi-Fi: ${addressFor(server)}` : runtime.message;
    consoleState.textContent =
      runtime.state === 'ready' ? 'Ready — commands are sent to this server.' : runtime.message;
  }
  // Refresh rebuilds cards from engine state; it never assumes a process is still running.
  async function refresh() {
    try {
      const servers = await window.icecream.servers();
      serverIndex.clear();
      servers.forEach((server) => serverIndex.set(server.id, server));
      clear(list);
      if (!servers.length) {
        status.textContent = 'Create a server to begin.';
        drawActive(null);
        return;
      }
      if (!activeId)
        status.textContent = `${servers.length} saved local server${servers.length === 1 ? '' : 's'}.`;
      for (const server of servers) {
        const runtime = server.runtime || { state: 'stopped', message: 'Ready to start.' };
        if (!activeId && activeStates.has(runtime.state)) {
          activeId = server.id;
          activeServer = server;
        }
        const card = document.createElement('article');
        card.className = 'host-server-card server-profile-card';
        const cover = document.createElement('div');
        cover.className = 'server-profile-cover';
        const logo = document.createElement('img');
        logo.src = '../../assets/swirl-logo.svg';
        logo.alt = '';
        const versionBadge = document.createElement('span');
        versionBadge.className = 'profile-version';
        versionBadge.textContent = `Fabric ${server.version}`;
        cover.append(logo, versionBadge);
        const information = document.createElement('div');
        const name = document.createElement('strong');
        name.textContent = server.name;
        const details = document.createElement('small');
        const backupLabel =
          server.backupSchedule && server.backupSchedule !== 'off'
            ? `${server.backupSchedule} backups`
            : 'manual backups';
        details.textContent = `${server.version} | port ${server.port} | ${server.whitelist ? 'approved names' : 'invite link'} | ${backupLabel}`;
        const state = document.createElement('small');
        state.className = `host-state ${runtime.state}`;
        state.textContent = `${runtime.message}${unread.has(server.id) ? ' | new console output' : ''}`;
        information.append(name, details, state);
        const actions = document.createElement('div');
        actions.className = 'host-server-actions';
        const secondary = document.createElement('div');
        secondary.className = 'host-secondary-actions';
        const consoleButton = document.createElement('button');
        consoleButton.className = activeId === server.id ? 'mod-install' : 'secondary-action';
        consoleButton.textContent = activeId === server.id ? 'Console selected' : 'Open console';
        consoleButton.disabled = activeId === server.id;
        consoleButton.addEventListener('click', () => selectServer(server));
        actions.append(consoleButton);
        const start = document.createElement('button');
        start.className = 'mod-install';
        start.textContent = runtime.state === 'error' ? 'Try again' : 'Start';
        start.disabled = activeStates.has(runtime.state);
        start.addEventListener('click', async () => {
          activeId = server.id;
          activeServer = {
            ...server,
            runtime: { state: 'starting', message: 'Preparing server…' },
          };
          consoleView.textContent = `Starting ${server.name}…`;
          status.textContent = 'Preparing server…';
          drawActive(activeServer);
          try {
            await window.icecream.startServer(server.id);
            await refresh();
          } catch (error) {
            const message = friendly(error);
            status.textContent = message;
            activeServer.runtime = { state: 'error', message };
            drawActive(activeServer);
            await refresh();
          }
        });
        if (!activeStates.has(runtime.state)) actions.append(start);
        const invite = document.createElement('button');
        invite.className = 'secondary-action';
        invite.textContent = 'Copy invite';
        invite.addEventListener('click', async () => {
          invite.disabled = true;
          try {
            const code = await window.icecream.exportServerInvite(server.id);
            await navigator.clipboard.writeText(code);
            invite.textContent = 'Copied';
            setTimeout(() => {
              invite.textContent = 'Copy invite';
              invite.disabled = false;
            }, 1400);
          } catch (error) {
            status.textContent = friendly(error);
            invite.disabled = false;
          }
        });
        actions.append(invite);
        const saveInvite = document.createElement('button');
        saveInvite.className = 'secondary-action';
        saveInvite.textContent = 'Save invite file';
        saveInvite.addEventListener('click', async () => {
          saveInvite.disabled = true;
          try {
            const result = await window.icecream.saveServerInvite(server.id);
            if (result.saved) status.textContent = `Invite saved to ${result.file}.`;
          } catch (error) {
            status.textContent = friendly(error);
          } finally {
            saveInvite.disabled = false;
          }
        });
        secondary.append(saveInvite);
        if (server.whitelist) {
          const players = document.createElement('button');
          players.className = 'secondary-action';
          players.textContent = 'Players';
          players.addEventListener('click', () => openPlayers(server));
          secondary.append(players);
        }
        if (activeStates.has(runtime.state)) {
          const test = document.createElement('button');
          test.className = 'secondary-action';
          test.textContent = 'Test connection';
          test.addEventListener('click', () => testConnection(server));
          const stop = document.createElement('button');
          stop.className = 'danger-action';
          stop.textContent = 'Stop';
          stop.addEventListener('click', () => stopServer(server));
          secondary.append(test);
          actions.append(stop);
        } else {
          const mods = document.createElement('button');
          mods.className = 'mod-install';
          mods.textContent = 'Manage mods';
          mods.addEventListener('click', () => openServerMods(server));
          const folder = document.createElement('button');
          folder.className = 'secondary-action';
          folder.textContent = 'All files';
          folder.addEventListener('click', async () => {
            try {
              await window.icecream.openServerFolder(server.id);
            } catch (error) {
              status.textContent = friendly(error);
            }
          });
          const backup = document.createElement('button');
          backup.className = 'secondary-action';
          backup.textContent = 'Back up';
          backup.addEventListener('click', async () => {
            backup.disabled = true;
            try {
              await window.icecream.backupServer(server.id);
              status.textContent = `${server.name} was backed up.`;
            } catch (error) {
              status.textContent = friendly(error);
            } finally {
              backup.disabled = false;
            }
          });
          const browse = document.createElement('button');
          browse.className = 'secondary-action';
          browse.textContent = 'Backups';
          browse.addEventListener('click', () =>
            window.swirlOpenBackups?.({
              kind: 'server',
              id: server.id,
              title: server.name,
              onRestore: refresh,
            }),
          );
          const test = document.createElement('button');
          test.className = 'secondary-action';
          test.textContent = 'Test connection';
          test.addEventListener('click', () => testConnection(server));
          const settings = document.createElement('button');
          settings.className = 'secondary-action';
          settings.textContent = 'Settings';
          settings.addEventListener('click', () => openServerSettings(server));
          const remove = document.createElement('button');
          remove.className = 'danger-action';
          remove.textContent = 'Delete server';
          remove.addEventListener('click', async () => {
            if (!window.confirm(`Delete ${server.name}? Its folder will be moved to Gleam Trash.`))
              return;
            try {
              await window.icecream.deleteServer(server.id);
              if (activeId === server.id) {
                activeId = '';
                activeServer = null;
              }
              await refresh();
            } catch (error) {
              status.textContent = friendly(error);
            }
          });
          secondary.append(mods, settings, test, backup, browse, folder, remove);
        }
        if (secondary.children.length) {
          const more = document.createElement('details');
          more.className = 'host-more';
          const moreLabel = document.createElement('summary');
          moreLabel.textContent = 'More';
          moreLabel.setAttribute('aria-label', `More actions for ${server.name}`);
          more.append(moreLabel, secondary);
          actions.append(more);
        }
        card.append(cover, information, actions);
        list.append(card);
        if (server.id === activeId) {
          activeServer = server;
          drawActive(server);
        }
      }
    } catch (error) {
      status.textContent = `Server error: ${friendly(error)}`;
    }
  }
  async function stopServer(server = activeServer) {
    if (!server) return;
    if (!window.confirm(`Stop ${server.name}? Minecraft will save the world before shutting down.`))
      return;
    try {
      status.textContent = 'Saving the world and stopping safely…';
      await window.icecream.stopServer(server.id);
    } catch (error) {
      status.textContent = friendly(error);
    }
  }
  // Player approval shows pending fingerprints separately from already approved identities.
  async function drawPlayers() {
    const container = byId('server-players-list');
    clear(container);
    if (!playerServer) return;
    try {
      const [players, adminState] = await Promise.all([
        window.icecream.approvedServerPlayers(playerServer.id),
        window.icecream.serverAdminState(playerServer.id),
      ]);
      const roles = new Map(
        adminState.assignments.map((assignment) => [assignment.fingerprint, assignment.role]),
      );
      const pendingCount = players.filter((player) => player.status === 'pending').length;
      const approvedCount = players.length - pendingCount;
      byId('server-players-status').textContent = pendingCount
        ? `${pendingCount} approval request${pendingCount === 1 ? '' : 's'} and ${approvedCount} approved player${approvedCount === 1 ? '' : 's'}.`
        : `${approvedCount} approved player${approvedCount === 1 ? '' : 's'}.`;
      for (const player of players) {
        const row = document.createElement('article');
        row.className = 'mod-card server-mod-item';
        const info = document.createElement('div');
        const title = document.createElement('div');
        title.className = 'mod-title';
        title.textContent = player.name;
        const detail = document.createElement('div');
        detail.className = 'mod-meta';
        const fingerprint = player.fingerprint
          ? ` • key ${player.fingerprint
              .slice(0, 16)
              .match(/.{1,4}/g)
              .join('-')}`
          : '';
        detail.textContent =
          player.status === 'pending'
            ? `Waiting for approval${fingerprint}`
            : `${player.operator ? 'Operator' : 'Player'}${player.verified ? fingerprint : ' • name only'}`;
        info.append(title, detail);
        const controls = document.createElement('div');
        controls.className = 'player-actions';
        if (player.status === 'pending') {
          const approve = document.createElement('button');
          approve.className = 'secondary-action';
          approve.textContent = 'Approve';
          approve.addEventListener('click', async () => {
            approve.disabled = true;
            try {
              await window.icecream.setApprovedServerPlayer(
                playerServer.id,
                player.name,
                true,
                false,
              );
              await drawPlayers();
            } catch (error) {
              byId('server-players-status').textContent = friendly(error);
              approve.disabled = false;
            }
          });
          controls.append(approve);
        } else {
          if (player.verified && player.fingerprint) {
            const role = roles.get(player.fingerprint) || 'none';
            const roleSelect = document.createElement('select');
            roleSelect.className = 'server-role-select';
            roleSelect.setAttribute('aria-label', `Host Manager role for ${player.name}`);
            for (const [value, label] of [
              ['none', 'No manager access'],
              ['viewer', 'Viewer'],
              ['moderator', 'Moderator'],
              ['admin', 'Admin'],
              ['owner', 'Owner'],
            ]) {
              const option = document.createElement('option');
              option.value = value;
              option.textContent = label;
              roleSelect.append(option);
            }
            roleSelect.value = role;
            roleSelect.addEventListener('change', async () => {
              const requested = roleSelect.value;
              roleSelect.disabled = true;
              try {
                if (requested === 'owner') {
                  const confirmation = window.prompt(
                    `Transfer ownership to ${player.name}? Type ${playerServer.name} to confirm.`,
                  );
                  if (confirmation == null) {
                    roleSelect.value = role;
                    return;
                  }
                  await window.icecream.transferServerOwnership(
                    playerServer.id,
                    player.fingerprint,
                    confirmation,
                  );
                } else {
                  await window.icecream.setServerAdminRole(
                    playerServer.id,
                    player.fingerprint,
                    requested,
                  );
                }
                await drawPlayers();
              } catch (error) {
                byId('server-players-status').textContent = friendly(error);
                roleSelect.value = role;
              } finally {
                roleSelect.disabled = false;
              }
            });
            controls.append(roleSelect);
          }
          const operator = document.createElement('button');
          operator.className = 'secondary-action';
          operator.textContent = player.operator ? 'Remove operator' : 'Make operator';
          operator.addEventListener('click', async () => {
            operator.disabled = true;
            try {
              await window.icecream.setApprovedServerPlayer(
                playerServer.id,
                player.name,
                true,
                !player.operator,
              );
              await drawPlayers();
            } catch (error) {
              byId('server-players-status').textContent = friendly(error);
              operator.disabled = false;
            }
          });
          controls.append(operator);
          if (activeStates.has(playerServer.runtime?.state)) {
            const kick = document.createElement('button');
            kick.className = 'secondary-action';
            kick.textContent = 'Kick';
            kick.addEventListener('click', async () => {
              try {
                await window.icecream.serverPlayerAction(playerServer.id, player.name, 'kick');
                byId('server-players-status').textContent = `${player.name} was kicked.`;
              } catch (error) {
                byId('server-players-status').textContent = friendly(error);
              }
            });
            const ban = document.createElement('button');
            ban.className = 'danger-action';
            ban.textContent = 'Ban';
            ban.addEventListener('click', async () => {
              if (!window.confirm(`Ban ${player.name} and remove this player?`)) return;
              try {
                await window.icecream.serverPlayerAction(playerServer.id, player.name, 'ban');
                await window.icecream.setApprovedServerPlayer(
                  playerServer.id,
                  player.name,
                  false,
                  false,
                );
                await drawPlayers();
              } catch (error) {
                byId('server-players-status').textContent = friendly(error);
              }
            });
            controls.append(kick, ban);
          }
        }
        const remove = document.createElement('button');
        remove.className = 'danger-action';
        remove.textContent = player.status === 'pending' ? 'Deny' : 'Remove';
        remove.addEventListener('click', async () => {
          remove.disabled = true;
          try {
            await window.icecream.setApprovedServerPlayer(
              playerServer.id,
              player.name,
              false,
              false,
            );
            await drawPlayers();
          } catch (error) {
            byId('server-players-status').textContent = friendly(error);
            remove.disabled = false;
          }
        });
        controls.append(remove);
        row.append(info, controls);
        container.append(row);
      }
    } catch (error) {
      byId('server-players-status').textContent = friendly(error);
    }
  }
  async function openPlayers(server) {
    playerServer = server;
    byId('server-players-title').textContent = `${server.name} players`;
    byId('server-player-name').value = '';
    byId('server-player-op').checked = false;
    const dialog = byId('server-players-dialog');
    if (!dialog.open) dialog.showModal();
    await drawPlayers();
  }
  // Settings are loaded from the server's allowlisted server.properties representation.
  async function openServerSettings(server) {
    settingsServer = server;
    byId('server-settings-title').textContent = `${server.name} settings`;
    byId('server-settings-status').textContent = 'Loading…';
    const dialog = byId('server-settings-dialog');
    if (!dialog.open) dialog.showModal();
    try {
      const values = await window.icecream.serverProperties(server.id);
      byId('server-setting-motd').value = values.motd;
      byId('server-setting-max-players').value = values.maxPlayers;
      byId('server-setting-gamemode').value = values.gamemode;
      byId('server-setting-difficulty').value = values.difficulty;
      byId('server-setting-view').value = values.viewDistance;
      byId('server-setting-simulation').value = values.simulationDistance;
      byId('server-setting-backups').value = server.backupSchedule || 'off';
      byId('server-setting-pvp').checked = values.pvp;
      byId('server-setting-command-blocks').checked = values.commandBlocks;
      byId('server-settings-status').textContent = 'A backup is made before saving.';
    } catch (error) {
      byId('server-settings-status').textContent = friendly(error);
    }
  }
  // Server mod cards expose only compatible managed installs and safe removal actions.
  async function drawInstalledServerMods() {
    const container = byId('server-installed-mods');
    clear(container);
    if (!modServer) return;
    try {
      const mods = await window.icecream.installedServerMods(modServer.id);
      byId('server-mod-status').textContent = mods.length
        ? `${mods.length} installed server mod${mods.length === 1 ? '' : 's'}.`
        : 'No managed server mods installed.';
      for (const mod of mods) {
        const card = document.createElement('article');
        card.className = 'mod-card server-mod-item';
        const icon = document.createElement('div');
        icon.className = 'mod-icon';
        const info = document.createElement('div');
        const title = document.createElement('div');
        title.className = 'mod-title';
        title.textContent = mod.name;
        const meta = document.createElement('div');
        meta.className = 'mod-meta';
        meta.textContent = mod.versionNumber || mod.versionId;
        info.append(title, meta);
        const remove = document.createElement('button');
        remove.className = 'danger-action';
        remove.textContent = 'Remove';
        remove.addEventListener('click', async () => {
          if (!window.confirm(`Remove ${mod.name} from ${modServer.name}? A backup is made first.`))
            return;
          remove.disabled = true;
          try {
            await window.icecream.removeServerMod(modServer.id, mod.projectId);
            await drawInstalledServerMods();
          } catch (error) {
            byId('server-mod-status').textContent = friendly(error);
            remove.disabled = false;
          }
        });
        card.append(icon, info, remove);
        container.append(card);
      }
    } catch (error) {
      byId('server-mod-status').textContent = friendly(error);
    }
  }
  async function openServerMods(server) {
    if (activeStates.has(server.runtime?.state)) {
      status.textContent = 'Stop the server before changing its mods.';
      return;
    }
    modServer = server;
    byId('server-mod-title').textContent = `${server.name} mods`;
    clear(byId('server-mod-results'));
    byId('server-mod-query').value = '';
    const dialog = byId('server-mod-dialog');
    if (!dialog.open) dialog.showModal();
    await drawInstalledServerMods();
  }
  // Connection testing is read-only and renders each diagnostic check independently.
  async function testConnection(server) {
    const dialog = byId('connection-dialog');
    const results = byId('connection-results');
    byId('connection-title').textContent = server.name;
    clear(results);
    const loading = document.createElement('p');
    loading.className = 'mod-status';
    loading.textContent = 'Testing this computer and server…';
    results.append(loading);
    if (!dialog.open) dialog.showModal();
    try {
      const report = await window.icecream.testServerConnection(server.id, byId('version').value);
      clear(results);
      for (const check of report.checks) {
        const card = document.createElement('article');
        card.className = `diagnostic-card ${check.level}`;
        const mark = document.createElement('span');
        mark.className = 'diagnostic-mark';
        mark.textContent =
          check.level === 'pass'
            ? '✓'
            : check.level === 'fail'
              ? '!'
              : check.level === 'warn'
                ? '?'
                : 'i';
        const info = document.createElement('div');
        const title = document.createElement('strong');
        title.textContent = check.title;
        const detail = document.createElement('small');
        detail.textContent = check.detail;
        info.append(title, detail);
        card.append(mark, info);
        results.append(card);
      }
    } catch (error) {
      loading.textContent = friendly(error);
    }
  }

  byId('open-hosts').addEventListener('click', () => {
    ['library-view', 'profiles-view', 'settings-view', 'editor-view'].forEach((id) => {
      byId(id).hidden = true;
    });
    page.hidden = false;
    window.swirlSetActiveTab?.('hosts');
    document.querySelector('.shell')?.scrollTo({ top: 0, behavior: 'instant' });
    refresh();
  });
  byId('stop-active-server').addEventListener('click', () => stopServer());
  byId('clear-server-console').addEventListener('click', () => {
    consoleBuffers.set(activeId, '');
    renderConsole();
  });
  consoleSearch.addEventListener('input', () => renderConsole());
  consoleFollow.addEventListener('change', () => {
    if (consoleFollow.checked) renderConsole({ follow: true });
  });
  byId('server-mod-close').addEventListener('click', () => byId('server-mod-dialog').close());
  byId('connection-close').addEventListener('click', () => byId('connection-dialog').close());
  byId('server-players-close').addEventListener('click', () =>
    byId('server-players-dialog').close(),
  );
  byId('server-settings-close').addEventListener('click', () =>
    byId('server-settings-dialog').close(),
  );
  byId('server-settings-form').addEventListener('submit', async (event) => {
    event.preventDefault();
    if (!settingsServer) return;
    const button = event.submitter;
    button.disabled = true;
    try {
      await window.icecream.saveServerProperties(settingsServer.id, {
        motd: byId('server-setting-motd').value,
        maxPlayers: Number(byId('server-setting-max-players').value),
        gamemode: byId('server-setting-gamemode').value,
        difficulty: byId('server-setting-difficulty').value,
        viewDistance: Number(byId('server-setting-view').value),
        simulationDistance: Number(byId('server-setting-simulation').value),
        pvp: byId('server-setting-pvp').checked,
        commandBlocks: byId('server-setting-command-blocks').checked,
      });
      await window.icecream.setServerBackupSchedule(
        settingsServer.id,
        byId('server-setting-backups').value,
      );
      byId('server-settings-status').textContent =
        'Saved. The changes apply next time the server starts.';
      status.textContent = `${settingsServer.name} settings saved.`;
      await refresh();
    } catch (error) {
      byId('server-settings-status').textContent = friendly(error);
    } finally {
      button.disabled = false;
    }
  });
  byId('server-domain-form').addEventListener('submit', async (event) => {
    event.preventDefault();
    const button = event.submitter;
    const output = byId('server-domain-results');
    const domainStatus = byId('server-domain-status');
    button.disabled = true;
    clear(output);
    domainStatus.textContent = 'Checking public DNS…';
    try {
      const report = await window.icecream.diagnoseServerDomain(
        byId('server-domain').value,
        Number(byId('server-domain-port').value),
      );
      domainStatus.textContent = report.ready
        ? `${report.hostname} is configured for this port.`
        : `${report.hostname} still needs one or more DNS records.`;
      for (const check of report.checks) {
        const card = document.createElement('article');
        card.className = `domain-check ${check.level}`;
        const title = document.createElement('strong');
        title.textContent = check.title;
        const detail = document.createElement('small');
        detail.textContent = check.detail;
        card.append(title, detail);
        output.append(card);
      }
      for (const record of [report.records.address, report.records.service].filter(Boolean)) {
        const card = document.createElement('article');
        card.className = 'domain-record';
        const title = document.createElement('strong');
        title.textContent = `${record.type} record`;
        const value = document.createElement('code');
        value.textContent = record.port
          ? `Name: ${record.name}\nPriority: ${record.priority}\nWeight: ${record.weight}\nPort: ${record.port}\nTarget: ${record.target}`
          : `Name: ${record.name}\nValue: ${record.value}`;
        card.append(title, value);
        output.append(card);
      }
      const note = document.createElement('p');
      note.className = 'host-help';
      note.textContent = report.note;
      output.append(note);
    } catch (error) {
      domainStatus.textContent = friendly(error);
    } finally {
      button.disabled = false;
    }
  });
  byId('server-player-form').addEventListener('submit', async (event) => {
    event.preventDefault();
    if (!playerServer) return;
    const button = event.submitter;
    button.disabled = true;
    try {
      await window.icecream.setApprovedServerPlayer(
        playerServer.id,
        byId('server-player-name').value,
        true,
        byId('server-player-op').checked,
      );
      byId('server-player-name').value = '';
      byId('server-player-op').checked = false;
      await drawPlayers();
    } catch (error) {
      byId('server-players-status').textContent = friendly(error);
    } finally {
      button.disabled = false;
    }
  });
  byId('update-server-mods').addEventListener('click', async () => {
    if (!modServer) return;
    const button = byId('update-server-mods');
    button.disabled = true;
    try {
      const plan = await window.icecream.planServerModUpdates(modServer.id);
      if (!plan.length) {
        byId('server-mod-status').textContent = 'All server mods are current.';
        return;
      }
      const lines = plan
        .slice(0, 12)
        .map((item) => `${item.name}: ${item.fromVersion} → ${item.toVersion}`);
      if (plan.length > lines.length) lines.push(`…and ${plan.length - lines.length} more`);
      if (
        !window.confirm(
          `Update ${plan.length} server mod${plan.length === 1 ? '' : 's'}?\n\n${lines.join('\n')}\n\nGleam will back up the server and roll everything back if an update fails.`,
        )
      ) {
        byId('server-mod-status').textContent = 'No changes made.';
        return;
      }
      const updated = await window.icecream.updateServerMods(modServer.id);
      byId('server-mod-status').textContent = `Updated ${updated.join(', ')}.`;
      await drawInstalledServerMods();
    } catch (error) {
      byId('server-mod-status').textContent = friendly(error);
    } finally {
      button.disabled = false;
    }
  });
  byId('server-mod-search').addEventListener('submit', async (event) => {
    event.preventDefault();
    if (!modServer) return;
    const results = byId('server-mod-results');
    clear(results);
    byId('server-mod-status').textContent = 'Searching compatible server mods…';
    try {
      const installed = new Set(
        (await window.icecream.installedServerMods(modServer.id)).map((mod) => mod.projectId),
      );
      const mods = await window.icecream.searchServerMods(
        modServer.id,
        byId('server-mod-query').value,
      );
      byId('server-mod-status').textContent = mods.length
        ? `${mods.length} compatible result${mods.length === 1 ? '' : 's'}.`
        : 'No compatible server mods found.';
      for (const mod of mods) {
        const card = document.createElement('article');
        card.className = 'mod-card server-mod-item';
        const icon = document.createElement('img');
        icon.className = 'mod-icon';
        icon.alt = '';
        if (mod.icon) icon.src = mod.icon;
        const info = document.createElement('div');
        const title = document.createElement('div');
        title.className = 'mod-title';
        title.textContent = mod.title;
        const description = document.createElement('div');
        description.className = 'mod-description';
        description.textContent = mod.description || '';
        info.append(title, description);
        const install = document.createElement('button');
        install.className = 'mod-install';
        install.textContent = installed.has(mod.id) ? 'Installed' : 'Install';
        install.disabled = installed.has(mod.id);
        install.addEventListener('click', async () => {
          install.disabled = true;
          install.textContent = 'Installing…';
          try {
            await window.icecream.installServerMod(modServer.id, mod.id, '');
            await drawInstalledServerMods();
            install.textContent = 'Installed';
          } catch (error) {
            byId('server-mod-status').textContent = friendly(error);
            install.disabled = false;
            install.textContent = 'Install';
          }
        });
        card.append(icon, info, install);
        results.append(card);
      }
    } catch (error) {
      byId('server-mod-status').textContent = friendly(error);
    }
  });
  byId('copy-server-address').addEventListener('click', async () => {
    if (!activeServer) {
      status.textContent = 'Select a running server first.';
      return;
    }
    const button = byId('copy-server-address');
    button.disabled = true;
    try {
      const invite = await window.icecream.exportServerInvite(activeServer.id);
      await navigator.clipboard.writeText(invite);
      button.textContent = 'Copied';
      setTimeout(() => {
        button.textContent = 'Copy invite';
        button.disabled = false;
      }, 1200);
    } catch (error) {
      status.textContent = friendly(error);
      button.disabled = false;
    }
  });
  form.addEventListener('submit', async (event) => {
    event.preventDefault();
    try {
      const created = await window.icecream.createServer(
        byId('server-name').value,
        byId('server-version').value,
        byId('server-port').value,
        {
          template: byId('server-template').value,
          whitelist: byId('server-whitelist').checked,
          acceptEula: byId('server-eula').checked,
          memoryMb: Number(byId('server-memory').value),
          hostName: localStorage.getItem('swirl-player-name') || '',
        },
      );
      activeId = created.id;
      activeServer = created;
      status.textContent = `${created.name} was created. Press Start when ready.`;
      const selectedVersion = created.version;
      form.reset();
      byId('server-version').value = selectedVersion;
      byId('server-port').value = '';
      await refresh();
    } catch (error) {
      status.textContent = friendly(error);
    }
  });
  commandForm.addEventListener('submit', async (event) => {
    event.preventDefault();
    const input = byId('server-command');
    try {
      await window.icecream.serverCommand(activeId, input.value);
      append(`> ${input.value}`);
      input.value = '';
    } catch (error) {
      status.textContent = friendly(error);
    }
  });
  window.icecream
    .serverLanAddresses()
    .then((result) => {
      addresses = result;
      if (activeServer) drawActive(activeServer);
    })
    .catch(() => {});
  window.icecream
    .fetchVersions()
    .then((versions) => {
      const supported = versions
        .filter((item) => !item.experimental)
        .map((item) => ({ value: item.id, label: `Minecraft ${item.id}` }));
      if (supported.length && window.swirlCreatePicker) {
        const preferred = supported.some((item) => item.value === '26.2')
          ? '26.2'
          : supported[0].value;
        window.swirlCreatePicker(
          byId('server-version-picker'),
          byId('server-version'),
          supported,
          preferred,
        );
        byId('server-version-picker').addEventListener('icecream-change', () => {
          if (
            /^\d{2}\./.test(byId('server-version').value) &&
            Number(byId('server-memory').value) < 4096
          )
            byId('server-memory').value = '4096';
        });
      }
    })
    .catch(() => {
      if (window.swirlCreatePicker)
        window.swirlCreatePicker(
          byId('server-version-picker'),
          byId('server-version'),
          [
            { value: '26.2', label: 'Minecraft 26.2' },
            { value: '1.21.1', label: 'Minecraft 1.21.1' },
          ],
          '26.2',
        );
    });
  window.icecream.onServerEvent((event) => {
    if (event.type === 'scheduled-backup') {
      const server = serverIndex.get(event.id);
      status.textContent = server
        ? `${server.name} automatic backup completed.`
        : 'Automatic server backup completed.';
      refresh();
      return;
    }
    if (event.type === 'console') {
      if (event.id === activeId) append(event.line);
      else {
        consoleBuffers.set(
          event.id,
          `${consoleBuffers.get(event.id) || ''}${event.line}`.slice(-64_000),
        );
        unread.add(event.id);
      }
      return;
    }
    const indexed = serverIndex.get(event.id);
    if (indexed) indexed.runtime = { state: event.state, message: event.message };
    if (event.id !== activeId) {
      refresh();
      return;
    }
    status.textContent = event.message;
    if (activeServer) {
      activeServer.runtime = { state: event.state, message: event.message };
      drawActive(activeServer);
    }
    if (event.state === 'ready') refresh();
    if (event.state === 'stopped' || event.state === 'error') {
      page.classList.remove('server-running');
      summary.hidden = true;
      consoleState.textContent = event.message;
      refresh();
    }
  });
})();
