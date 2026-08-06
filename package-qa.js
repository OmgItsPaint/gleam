const fs = require('fs');
const fsp = fs.promises;
const os = require('os');
const path = require('path');
const { spawnSync } = require('child_process');
const asarTools = require('@electron/asar');

const sourceFiles = [
  'main.js', 'launcher-engine.js', 'server-engine.js', 'update-service.js', 'preload.js',
  'renderer.js', 'host-ui.js', 'identity-ui.js', 'qa-hooks.js', 'version-policy.js',
  'styles.css', 'desert.css', 'editor.css', 'fixes.css', 'hosting-run.css', 'hosting.css',
  'identity.css', 'polish.css', 'swirl.css', 'index.html', 'README.md', 'RELEASE.md',
  'update-config.json'
];

async function run() {
  const project = __dirname;
  const installerMode = process.argv.includes('--installer');
  const temporary = await fsp.mkdtemp(path.join(os.tmpdir(), 'swirl-package-qa-'));
  const appDirectory = path.join(temporary, 'app');
  const outputDirectory = installerMode ? path.join(project, 'dist') : path.join(temporary, 'output');
  await fsp.mkdir(appDirectory, { recursive: true });
  try {
    for (const file of sourceFiles) await fsp.copyFile(path.join(project, file), path.join(appDirectory, file));
    for (const directory of ['assets', 'bundled-mods']) await fsp.cp(path.join(project, directory), path.join(appDirectory, directory), { recursive: true });
    const packageData = JSON.parse(await fsp.readFile(path.join(project, 'package.json'), 'utf8'));
    delete packageData.build;
    delete packageData.devDependencies;
    delete packageData.scripts;
    delete packageData.files;
    await fsp.writeFile(path.join(appDirectory, 'package.json'), JSON.stringify(packageData, null, 2), 'utf8');
    const builder = path.join(project, 'node_modules', 'electron-builder', 'out', 'cli', 'cli.js');
    const electronDist = path.join(project, 'node_modules', 'electron', 'dist');
    const result = spawnSync(process.execPath, [builder,
      '--win', installerMode ? 'nsis' : 'dir',
      '--publish', 'never',
      `--config.directories.app=${appDirectory}`,
      `--config.directories.output=${outputDirectory}`,
      `--config.electronDist=${electronDist}`
    ], { cwd: project, stdio: 'inherit' });
    if (result.error) throw result.error;
    if (result.status !== 0) throw new Error(`electron-builder exited with code ${result.status}.`);
    const asar = path.join(outputDirectory, 'win-unpacked', 'resources', 'app.asar');
    if (!fs.existsSync(asar)) throw new Error('The packaged application archive was not created.');
    const archived = new Set(asarTools.listPackage(asar).map(entry => entry.replace(/^[/\\]/, '').replace(/\\/g, '/')));
    const requiredRuntimeFiles = ['main.js', 'launcher-engine.js', 'server-engine.js', 'update-service.js', 'version-policy.js', 'preload.js', 'renderer.js', 'host-ui.js', 'identity-ui.js', 'qa-hooks.js', 'index.html', 'package.json', 'update-config.json'];
    const missing = requiredRuntimeFiles.filter(file => !archived.has(file));
    if (missing.length) throw new Error(`The packaged app is missing runtime files: ${missing.join(', ')}`);
    if (installerMode) {
      const installer = path.join(outputDirectory, `Swirl-${packageData.version}-Setup.exe`);
      if (!fs.existsSync(installer)) throw new Error('The Windows installer was not created.');
      console.log(`Swirl installer created: ${installer}`);
    } else {
      console.log('Swirl packaged-app QA passed.');
    }
  } finally {
    await fsp.rm(temporary, { recursive: true, force: true, maxRetries: 5, retryDelay: 250 }).catch(error => console.warn(`Temporary package cleanup failed: ${error.message}`));
  }
}

run().catch(error => { console.error(error); process.exitCode = 1; });
