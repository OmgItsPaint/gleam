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

    const consoleSearch = document.getElementById('server-console-search');
    const consoleFollow = document.getElementById('server-console-follow');
    consoleSearch.value = 'qa-no-match';
    consoleSearch.dispatchEvent(new InputEvent('input', { bubbles: true }));
    const consoleFilterWorks =
      document.getElementById('server-console').textContent === 'No matching console lines.';
    consoleSearch.value = '';
    consoleSearch.dispatchEvent(new InputEvent('input', { bubbles: true }));
    const consoleFollowPresent = consoleFollow.checked === true;

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
      consoleFilterWorks,
      consoleFollowPresent,
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
    'profile-health': async () => {
      if (document.getElementById('editor-view').hidden)
        document.querySelector('.profile-card-actions .secondary-action')?.click();
      for (let attempt = 0; attempt < 20; attempt += 1) {
        const recommendationsReady = !document
          .getElementById('editor-status')
          .textContent.startsWith('Loading');
        const installedReady = !document
          .getElementById('editor-installed-status')
          .textContent.startsWith('Loading');
        if (recommendationsReady && installedReady) break;
        await new Promise((resolve) => setTimeout(resolve, 100));
      }
      await new Promise((resolve) => setTimeout(resolve, 200));
      const panel = document.getElementById('editor-health');
      panel.hidden = false;
      document.getElementById('editor-health-title').textContent = 'This profile needs attention';
      const badge = document.getElementById('editor-health-badge');
      badge.textContent = 'REPAIR';
      badge.dataset.state = 'repair';
      document.getElementById('editor-health-summary').textContent =
        '2 required files must be downloaded or repaired before reliable offline play. 18.4 GB of storage is currently free.';
      document.getElementById('editor-health-verified').textContent = '1,284';
      document.getElementById('editor-health-missing').textContent = '2';
      document.getElementById('editor-health-java').textContent = 'Java 25';
      const issues = document.getElementById('editor-health-issues');
      issues.replaceChildren();
      for (const message of [
        'client.jar is damaged or incomplete.',
        'fabric-loader.json is missing.',
      ]) {
        const item = document.createElement('li');
        item.textContent = message;
        issues.append(item);
      }
    },
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
    'settings-managed': () => {
      document.getElementById('open-settings').click();
      setTimeout(() => {
        const shell = document.querySelector('.shell');
        shell.scrollTop = shell.scrollHeight;
      }, 0);
    },
  };

  window.__swirlPrepareCapture = async (name) => {
    document.querySelectorAll('dialog[open]').forEach((dialog) => dialog.close());
    await captureActions[name]?.();
    document.getElementById('toast').hidden = true;
  };
}
