const assert = require('assert');
const fs = require('fs');
const fsp = fs.promises;
const path = require('path');

const project = path.resolve(__dirname, '..', '..');
const sourceRoot = path.join(project, 'src');

async function files(root) {
  const found = [];
  for (const entry of await fsp.readdir(root, { withFileTypes: true })) {
    const target = path.join(root, entry.name);
    if (entry.isDirectory()) found.push(...(await files(target)));
    else found.push(target);
  }
  return found;
}

function relativeImportTargets(file, source) {
  const targets = [];
  const pattern = /require\(['"](\.[^'"]+)['"]\)|from\s+['"](\.[^'"]+)['"]/g;
  for (const match of source.matchAll(pattern)) {
    const requested = match[1] || match[2];
    let target = path.resolve(path.dirname(file), requested);
    if (!path.extname(target)) target += '.js';
    if (fs.existsSync(target) && target.startsWith(sourceRoot)) targets.push(target);
  }
  return targets;
}

async function run() {
  const jsFiles = (await files(sourceRoot)).filter((file) => file.endsWith('.js'));
  const graph = new Map();
  for (const file of jsFiles) {
    const source = await fsp.readFile(file, 'utf8');
    const relative = path.relative(sourceRoot, file).replace(/\\/g, '/');
    if (relative.startsWith('core/'))
      assert(
        !/require\(['"]electron['"]\)|from\s+['"]electron['"]/.test(source),
        `${relative} imports Electron`,
      );
    if (relative.startsWith('renderer/'))
      assert(
        !/\brequire\s*\(|\bprocess\.[A-Za-z_$]|\bBuffer\b|node:/.test(source),
        `${relative} accesses Node`,
      );
    graph.set(file, relativeImportTargets(file, source));
  }
  const visiting = new Set();
  const visited = new Set();
  function visit(file) {
    if (visiting.has(file))
      throw new Error(`Circular source dependency at ${path.relative(project, file)}`);
    if (visited.has(file)) return;
    visiting.add(file);
    for (const target of graph.get(file) || []) visit(target);
    visiting.delete(file);
    visited.add(file);
  }
  for (const file of graph.keys()) visit(file);

  const preload = await fsp.readFile(path.join(sourceRoot, 'preload', 'index.js'), 'utf8');
  const mainEntry = await fsp.readFile(path.join(sourceRoot, 'main', 'index.js'), 'utf8');
  assert.match(
    mainEntry,
    /SMOKE_TEST[\s\S]+setPath\(['"]userData['"][\s\S]+setPath\(['"]appData['"]/,
    'Electron smoke mode must isolate both userData and appData',
  );
  const mainFiles = jsFiles.filter((file) =>
    path.relative(sourceRoot, file).replace(/\\/g, '/').startsWith('main/'),
  );
  const mainSources = await Promise.all(mainFiles.map((file) => fsp.readFile(file, 'utf8')));
  const handled = new Set(
    mainSources.flatMap((source) =>
      [...source.matchAll(/ipcMain\.handle\(['"]([^'"]+)/g)].map((match) => match[1]),
    ),
  );
  const contractSource = await fsp.readFile(
    path.join(sourceRoot, 'shared', 'contracts.js'),
    'utf8',
  );
  const channels = new Map(
    [...contractSource.matchAll(/\s+(\w+):\s*['"]([^'"]+)['"]/g)].map((match) => [
      match[1],
      match[2],
    ]),
  );
  for (const source of mainSources)
    for (const match of source.matchAll(/ipcMain\.handle\(CHANNELS\.(\w+)/g))
      if (channels.has(match[1])) handled.add(channels.get(match[1]));
  // Domain routers may register a bounded list through a shared helper. Every referenced
  // contract key is still required to exist in the central channel declaration.
  for (const source of mainSources)
    if (source.includes('ipcMain.handle'))
      for (const match of source.matchAll(/CHANNELS\.(\w+)/g))
        if (channels.has(match[1])) handled.add(channels.get(match[1]));
  const invoked = new Set(
    [...preload.matchAll(/ipcRenderer\.invoke\(['"]([^'"]+)/g)].map((match) => match[1]),
  );
  const missing = [...invoked].filter((channel) => !handled.has(channel));
  assert.deepEqual(missing, [], `Preload invokes undeclared IPC routes: ${missing.join(', ')}`);

  const forbiddenRoot = [
    'main.js',
    'preload.js',
    'renderer.js',
    'launcher-engine.js',
    'server-engine.js',
    'index.html',
  ];
  assert.deepEqual(
    forbiddenRoot.filter((name) => fs.existsSync(path.join(project, name))),
    [],
  );
  const unexpectedRuntimeFiles = (await fsp.readdir(project, { withFileTypes: true }))
    .filter((entry) => entry.isFile() && /\.(?:js|cjs|mjs|html|css|map)$/i.test(entry.name))
    .map((entry) => entry.name);
  assert.deepEqual(
    unexpectedRuntimeFiles,
    [],
    `Unexpected launcher runtime files at repository root: ${unexpectedRuntimeFiles.join(', ')}`,
  );
  console.log('Gleam architecture tests passed.');
}

run().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
