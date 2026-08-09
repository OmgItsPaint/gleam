/**
 * Builds Swirl from a clean temporary staging directory and inspects the resulting ASAR.
 * Runtime files must be present, while tests, QA hooks, release tools, and documentation must not
 * leak into the player package. With --installer, the same check also creates the NSIS installer.
 */
const fs = require('fs');
const fsp = fs.promises;
const os = require('os');
const path = require('path');
const { spawnSync } = require('child_process');
const asarTools = require('@electron/asar');

// Explicit player allowlist used to build from a clean staging directory.
const sourceFiles = [
  'main.js',
  'launcher-engine.js',
  'server-engine.js',
  'update-service.js',
  'identity-service.js',
  'preload.js',
  'renderer.js',
  'host-ui.js',
  'identity-ui.js',
  'version-policy.js',
  'styles.css',
  'editor.css',
  'fixes.css',
  'hosting-run.css',
  'hosting.css',
  'identity.css',
  'identity-security.css',
  'polish.css',
  'swirl.css',
  'swirl-2.css',
  'index.html',
  'update-config.json',
];

async function run() {
  const project = __dirname;
  const installerMode = process.argv.includes('--installer');
  const temporary = await fsp.mkdtemp(path.join(os.tmpdir(), 'swirl-package-qa-'));
  const appDirectory = path.join(temporary, 'app');
  const outputDirectory = installerMode
    ? path.join(project, 'dist')
    : path.join(temporary, 'output');
  await fsp.mkdir(appDirectory, { recursive: true });
  try {
    for (const file of sourceFiles)
      await fsp.copyFile(path.join(project, file), path.join(appDirectory, file));
    const playerIndexFile = path.join(appDirectory, 'index.html');
    const sourceIndex = await fsp.readFile(playerIndexFile, 'utf8');
    const playerIndex = sourceIndex.replace(/\s*<script src="qa-hooks\.js"><\/script>/, '');
    if (playerIndex === sourceIndex)
      throw new Error('Could not remove the QA hook from player HTML.');
    await fsp.writeFile(playerIndexFile, playerIndex, 'utf8');
    await fsp.cp(path.join(project, 'assets'), path.join(appDirectory, 'assets'), {
      recursive: true,
    });
    await fsp.mkdir(path.join(appDirectory, 'bundled-mods'), { recursive: true });
    const bundledMods = (await fsp.readdir(path.join(project, 'bundled-mods'))).filter((file) =>
      file.endsWith('.jar'),
    );
    for (const file of bundledMods)
      await fsp.copyFile(
        path.join(project, 'bundled-mods', file),
        path.join(appDirectory, 'bundled-mods', file),
      );
    const packageData = JSON.parse(await fsp.readFile(path.join(project, 'package.json'), 'utf8'));
    delete packageData.build;
    delete packageData.devDependencies;
    delete packageData.scripts;
    delete packageData.files;
    await fsp.writeFile(
      path.join(appDirectory, 'package.json'),
      JSON.stringify(packageData, null, 2),
      'utf8',
    );
    const builder = path.join(project, 'node_modules', 'electron-builder', 'out', 'cli', 'cli.js');
    const electronDist = path.join(project, 'node_modules', 'electron', 'dist');
    const result = spawnSync(
      process.execPath,
      [
        builder,
        '--win',
        installerMode ? 'nsis' : 'dir',
        '--publish',
        'never',
        `--config.directories.app=${appDirectory}`,
        `--config.directories.output=${outputDirectory}`,
        `--config.electronDist=${electronDist}`,
      ],
      { cwd: project, stdio: 'inherit' },
    );
    if (result.error) throw result.error;
    if (result.status !== 0) throw new Error(`electron-builder exited with code ${result.status}.`);
    const asar = path.join(outputDirectory, 'win-unpacked', 'resources', 'app.asar');
    if (!fs.existsSync(asar)) throw new Error('The packaged application archive was not created.');
    const archived = new Set(
      asarTools.listPackage(asar).map((entry) => entry.replace(/^[/\\]/, '').replace(/\\/g, '/')),
    );
    const requiredRuntimeFiles = [
      'main.js',
      'launcher-engine.js',
      'server-engine.js',
      'update-service.js',
      'version-policy.js',
      'identity-service.js',
      'preload.js',
      'renderer.js',
      'host-ui.js',
      'identity-ui.js',
      'index.html',
      'package.json',
      'update-config.json',
    ];
    const missing = requiredRuntimeFiles.filter((file) => !archived.has(file));
    if (missing.length)
      throw new Error(`The packaged app is missing runtime files: ${missing.join(', ')}`);
    // Prove maintenance-only files did not leak into the player ASAR.
    const developerOnlyFiles = [
      'qa-hooks.js',
      'compatibility-test.js',
      'smoke-test.js',
      'package-qa.js',
      'render-icon.js',
      'configure-update.js',
      'sign-update-manifest.js',
      'README.md',
      'RELEASE.md',
      'bundled-mods/README.md',
    ];
    const leaked = developerOnlyFiles.filter((file) => archived.has(file));
    if (leaked.length)
      throw new Error(`The packaged app contains developer-only files: ${leaked.join(', ')}`);
    const packagedIndex = asarTools.extractFile(asar, 'index.html');
    if (packagedIndex.toString('utf8').includes('qa-hooks.js'))
      throw new Error('The packaged player HTML still references the QA hook.');
    if (installerMode) {
      const installer = path.join(outputDirectory, `Swirl-${packageData.version}-Setup.exe`);
      if (!fs.existsSync(installer)) throw new Error('The Windows installer was not created.');
      console.log(`Swirl installer created: ${installer}`);
    } else {
      console.log('Swirl packaged-app QA passed.');
    }
  } finally {
    await fsp
      .rm(temporary, { recursive: true, force: true, maxRetries: 5, retryDelay: 250 })
      .catch((error) => console.warn(`Temporary package cleanup failed: ${error.message}`));
  }
}

run().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
