const assert = require('assert');
const fs = require('fs');
const path = require('path');

const root = path.resolve(__dirname, '..', '..');
const read = (relative) => fs.readFileSync(path.join(root, relative), 'utf8');
const config = JSON.parse(read('src-tauri/tauri.conf.json'));
const rust = read('src-tauri/src/lib.rs');
const paths = read('src-tauri/src/core/paths.rs');
const storage = read('src-tauri/src/core/storage.rs');
const html = read('gleam-ui/index.html');
const packageJson = JSON.parse(read('package.json'));

assert.equal(config.productName, 'Gleam');
assert.equal(config.identifier, 'app.gleamclient.launcher');
assert.equal(config.build.frontendDist, '../gleam-ui');
assert(!config.app.security.csp.includes("'unsafe-inline'"), 'Tauri CSP must reject inline code');
assert.equal(packageJson.scripts.start, 'tauri dev');
assert.equal(packageJson.scripts['start:legacy'], undefined);
assert.equal(packageJson.devDependencies.electron, undefined);

assert(paths.includes('.join("icecream-client")'));
assert(paths.includes('.join(".icecream_client")'));
assert(storage.includes('const MAX_JSON_BYTES'));
for (const command of ['launch_game', 'install_mod', 'create_identity', 'create_server']) {
  assert(rust.includes(command), `The native command ${command} must be registered`);
}
assert(!rust.includes('privateKey'));

assert(html.includes('assets/gleam-logo.png'));
assert(!/<script(?![^>]*\bsrc=)[^>]*>/i.test(html), 'Inline scripts violate the Tauri CSP');
assert(!/<style[\s>]/i.test(html), 'Inline styles violate the Tauri CSP');

console.log('Gleam Tauri source tests passed.');
