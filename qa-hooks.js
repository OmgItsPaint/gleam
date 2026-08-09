/**
 * Development-only browser hooks used by the Electron smoke test and screenshot capture.
 * package-qa.js removes this script reference before building anything for players.
 */
if (new URLSearchParams(location.search).get('qa') === '1') {
  // Track listeners installed after this script so the smoke test can find dead controls.
  const listeners = new WeakMap();
  const original = EventTarget.prototype.addEventListener;
  EventTarget.prototype.addEventListener = function tracked(type, handler, options) {
    if (this instanceof HTMLButtonElement || this instanceof HTMLFormElement) {
      const types = listeners.get(this) || new Set();
      types.add(type);
      listeners.set(this, types);
    }
    return original.call(this, type, handler, options);
  };
  window.__swirlHasListener = (element, type) => Boolean(listeners.get(element)?.has(type));

  const clickWithPointer = (element) => {
    element.dispatchEvent(new PointerEvent('pointerdown', { bubbles: true }));
    element.click();
  };

  const selected = (id) => document.getElementById(id).getAttribute('aria-current') === 'page';

  // Exercise navigation and popover behavior inside the real renderer document.
  window.__swirlRunSmokeTest = () => {
    const trigger = document.getElementById('identity-trigger');
    const popover = document.getElementById('identity-popover');
    const input = document.getElementById('identity-input');

    clickWithPointer(trigger);
    const opened = !popover.hidden;

    clickWithPointer(input);
    const stayedOpen = !popover.hidden;

    document
      .getElementById('library-view')
      .dispatchEvent(new PointerEvent('pointerdown', { bubbles: true }));
    const closedOutside = popover.hidden;

    document.getElementById('open-profiles').click();
    const profilesActive = selected('open-profiles');
    document.getElementById('open-hosts').click();
    const hostActive = selected('open-hosts');
    document.getElementById('open-settings').click();
    const settingsActive = selected('open-settings');
    document.getElementById('open-library').click();
    const playActive = selected('open-library');

    const unwired = [...document.querySelectorAll('button')]
      .filter((button) => {
        if (button.closest('#welcome')?.hidden) return false;
        const handlesClick =
          window.__swirlHasListener(button, 'click') || typeof button.onclick === 'function';
        const handlesSubmit =
          button.type === 'submit' &&
          button.form &&
          window.__swirlHasListener(button.form, 'submit');
        return !handlesClick && !handlesSubmit;
      })
      .map((button) => button.id || button.textContent.trim());

    return {
      opened,
      stayedOpen,
      closedOutside,
      profilesActive,
      hostActive,
      settingsActive,
      playActive,
      allButtonsWired: unwired.length === 0,
      unwired,
    };
  };

  // Named capture states keep executable JavaScript strings out of main.js.
  const captureActions = {
    play: () => document.getElementById('open-library').click(),
    profiles: () => document.getElementById('open-profiles').click(),
    'profile-editor': () =>
      document.querySelector('.profile-card-actions .secondary-action')?.click(),
    'world-manager': () => document.getElementById('editor-worlds')?.click(),
    'profile-editor-actions': () => document.querySelector('.profile-more summary')?.click(),
    host: () => document.getElementById('open-hosts').click(),
    'host-actions': () => {
      document.querySelector('.host-more summary')?.click();
      document.querySelector('.shell').scrollTop = document.getElementById('server-list').offsetTop;
    },
    'host-create': () => {
      document.querySelector('.host-more[open] summary')?.click();
      document.querySelector('.shell').scrollTop = document.querySelector('.host-create').offsetTop;
    },
    settings: () => document.getElementById('open-settings').click(),
  };

  window.__swirlPrepareCapture = (name) => {
    document.querySelectorAll('dialog[open]').forEach((dialog) => dialog.close());
    captureActions[name]?.();
  };
}
