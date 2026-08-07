(() => {
  const byId = id => document.getElementById(id);
  const control = byId('identity-control');
  const trigger = byId('identity-trigger');
  const popover = byId('identity-popover');
  const input = byId('identity-input');
  const display = byId('identity-name');
  const avatar = byId('identity-avatar');
  const feedback = byId('identity-status');
  const generate = () => `Swirl${Math.floor(1000 + Math.random() * 9000)}`;
  const identityDialog = byId('player-identity-dialog');
  const identityButton = document.createElement('button');
  identityButton.type = 'button'; identityButton.className = 'identity-manage'; identityButton.textContent = 'Identity & recovery';
  popover.append(identityButton);

  async function refreshIdentity() {
    try {
      const identity = await window.icecream.playerIdentity();
      byId('player-identity-summary').textContent = identity.recovery?.message || (identity.osProtected ? 'Protected by your Windows sign-in.' : 'Protected by this computer’s file permissions.');
      byId('player-identity-fingerprint').textContent = identity.fingerprint.match(/.{1,4}/g).join(' ');
    } catch (error) { byId('player-identity-summary').textContent = error.message; }
  }

  function setOpen(open) { popover.hidden = !open; trigger.setAttribute('aria-expanded', String(open)); if (open) { input.focus(); input.select(); } }
  function draw(name) { display.textContent = name; avatar.textContent = name.slice(0, 2).toUpperCase(); input.value = name; }
  async function save(name) {
    const normalized = String(name || '').trim();
    feedback.textContent = 'Saving…';
    try {
      const player = await window.icecream.offlinePlayer(normalized);
      localStorage.setItem('swirl-player-name', player.username);
      draw(player.username); feedback.textContent = player.identityRecovery?.message || 'Saved.';
      window.dispatchEvent(new CustomEvent('icecream-identity-change', { detail: player }));
      setTimeout(() => setOpen(false), 650);
    } catch (error) { feedback.textContent = error.message; input.focus(); }
  }
  control.addEventListener('pointerdown', event => event.stopPropagation());
  control.addEventListener('click', event => event.stopPropagation());
  trigger.addEventListener('click', () => setOpen(popover.hidden));
  byId('identity-save').addEventListener('click', () => save(input.value));
  byId('identity-generate').addEventListener('click', () => { input.value = generate(); save(input.value); });
  input.addEventListener('keydown', event => { if (event.key === 'Enter') { event.preventDefault(); save(input.value); } if (event.key === 'Escape') setOpen(false); });
  document.addEventListener('pointerdown', event => { if (!control.contains(event.target)) setOpen(false); });
  byId('quick-name').addEventListener('click', event => { event.preventDefault(); event.stopImmediatePropagation(); setOpen(true); }, true);
  identityButton.addEventListener('click', async () => { setOpen(false); await refreshIdentity(); if (!identityDialog.open) identityDialog.showModal(); });
  byId('player-identity-close').addEventListener('click', () => identityDialog.close());
  byId('export-player-identity').addEventListener('click', async () => {
    const password = byId('identity-recovery-password').value; const status = byId('identity-recovery-status');
    try { const result = await window.icecream.exportPlayerIdentity(password); status.textContent = result.saved ? `Recovery saved to ${result.file}` : 'Save cancelled.'; } catch (error) { status.textContent = error.message; }
  });
  byId('import-player-identity').addEventListener('click', async () => {
    const password = byId('identity-recovery-password').value; const status = byId('identity-recovery-status');
    if (!window.confirm('Restore a player identity? This replaces the identity currently used on this computer.')) return;
    try { const result = await window.icecream.importPlayerIdentity(password); status.textContent = result.imported ? 'Identity restored. Servers will now recognize the restored key.' : 'Restore cancelled.'; if (result.imported) await refreshIdentity(); } catch (error) { status.textContent = error.message; }
  });

  const saved = localStorage.getItem('swirl-player-name') || localStorage.getItem('icecream-test-name');
  if (saved) draw(saved); else save(generate());
})();
