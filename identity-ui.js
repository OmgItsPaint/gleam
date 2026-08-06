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

  function setOpen(open) { popover.hidden = !open; trigger.setAttribute('aria-expanded', String(open)); if (open) { input.focus(); input.select(); } }
  function draw(name) { display.textContent = name; avatar.textContent = name.slice(0, 2).toUpperCase(); input.value = name; }
  async function save(name) {
    const normalized = String(name || '').trim();
    feedback.textContent = 'Saving…';
    try {
      const player = await window.icecream.offlinePlayer(normalized);
      localStorage.setItem('swirl-player-name', player.username);
      draw(player.username); feedback.textContent = 'Saved.';
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

  const saved = localStorage.getItem('swirl-player-name') || localStorage.getItem('icecream-test-name');
  if (saved) draw(saved); else save(generate());
})();
