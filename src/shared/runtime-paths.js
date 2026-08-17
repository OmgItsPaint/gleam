const path = require('path');

// Tests have a deterministic fallback; the Electron entrypoint replaces it with app.getAppPath().
let appRoot = path.resolve(__dirname, '..', '..');
let resourcesRoot = typeof process.resourcesPath === 'string' ? process.resourcesPath : appRoot;

function configure(applicationPath, electronResourcesPath = resourcesRoot) {
  appRoot = path.resolve(String(applicationPath));
  resourcesRoot = path.resolve(String(electronResourcesPath));
  return { appRoot, resourcesRoot };
}

function within(root, ...segments) {
  const resolved = path.resolve(root, ...segments);
  const relative = path.relative(root, resolved);
  if (relative.startsWith('..') || path.isAbsolute(relative))
    throw new Error('Unsafe runtime path.');
  return resolved;
}

module.exports = {
  configure,
  get appRoot() {
    return appRoot;
  },
  get resourcesRoot() {
    return resourcesRoot;
  },
  asset: (...segments) => within(path.join(appRoot, 'assets'), ...segments),
  bundledMod: (version) =>
    within(path.join(appRoot, 'bundled-mods'), `swirl-client-${version}.jar`),
  config: (...segments) => within(path.join(appRoot, 'config'), ...segments),
  preload: () => within(appRoot, 'src', 'preload', 'index.js'),
  renderer: (...segments) => within(path.join(appRoot, 'src', 'renderer'), ...segments),
};
