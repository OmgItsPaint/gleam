if (new URLSearchParams(location.search).get('qa') === '1') {
  const listeners = new WeakMap();
  const original = EventTarget.prototype.addEventListener;
  EventTarget.prototype.addEventListener = function tracked(type, handler, options) {
    if (this instanceof HTMLButtonElement || this instanceof HTMLFormElement) {
      const types = listeners.get(this) || new Set(); types.add(type); listeners.set(this, types);
    }
    return original.call(this, type, handler, options);
  };
  window.__swirlHasListener = (element, type) => Boolean(listeners.get(element)?.has(type));
}
