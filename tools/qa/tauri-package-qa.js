const assert = require('assert');
const crypto = require('crypto');
const fs = require('fs');
const path = require('path');

const root = path.resolve(__dirname, '..', '..');
const config = JSON.parse(fs.readFileSync(path.join(root, 'src-tauri', 'tauri.conf.json'), 'utf8'));
const packageJson = JSON.parse(fs.readFileSync(path.join(root, 'package.json'), 'utf8'));
const runtimeFiles = JSON.parse(
  fs.readFileSync(path.join(root, 'packaging', 'runtime-files.json'), 'utf8'),
);

assert.equal(config.productName, 'Gleam');
assert.equal(config.identifier, 'app.gleamclient.launcher');
assert.equal(config.version, packageJson.version);
assert.equal(config.build.frontendDist, '../gleam-ui');
assert.deepEqual(config.bundle.targets, ['nsis', 'msi']);
assert(!config.app.security.csp.includes("'unsafe-inline'"));
assert(!config.app.security.csp.includes("'unsafe-eval'"));

for (const file of runtimeFiles.required) {
  assert(
    fs.statSync(path.join(root, file)).isFile(),
    `Required Tauri resource is missing: ${file}`,
  );
}
assert.deepEqual(config.bundle.resources, runtimeFiles.resourceMappings);

const html = fs.readFileSync(path.join(root, 'gleam-ui', 'index.html'), 'utf8');
assert(!/<script(?![^>]*\bsrc=)[^>]*>/i.test(html), 'Inline script would weaken the CSP');
assert(!/<style[\s>]/i.test(html), 'Inline style would weaken the CSP');
assert(
  !html.includes('Electron compatibility'),
  'The player UI must not expose migration placeholders',
);

const forbiddenFrontend = /(?:private[_-]?key|access[_-]?token|client[_-]?secret)/i;
for (const file of ['index.html', 'app.js', 'styles.css']) {
  assert(
    !forbiddenFrontend.test(fs.readFileSync(path.join(root, 'gleam-ui', file), 'utf8')),
    `${file} contains a secret-like field`,
  );
}

const hashes = {};
for (const version of ['26.1.2', '26.2']) {
  const file = path.join(root, 'bundled-mods', `swirl-client-${version}.jar`);
  hashes[version] = crypto.createHash('sha256').update(fs.readFileSync(file)).digest('hex');
}
assert.notEqual(
  hashes['26.1.2'],
  hashes['26.2'],
  'Version-specific bundled mods must not be identical',
);

const bundleRoot = path.join(root, 'src-tauri', 'target', 'release', 'bundle');
if (fs.existsSync(bundleRoot)) {
  const bundles = fs.readdirSync(bundleRoot, { recursive: true }).map(String);
  assert(
    bundles.some((file) => /\.(?:exe|msi)$/i.test(file)),
    'A release build exists without a Windows installer',
  );
  assert(
    !bundles.some((file) => /Swirl-support-.*\.json/i.test(file)),
    'Support exports leaked into a release bundle',
  );
}

console.log('Gleam Tauri package QA passed.');
