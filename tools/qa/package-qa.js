/** Builds Swirl from the explicit runtime allowlist and inspects the resulting ASAR. */
const fs = require('fs');
const fsp = fs.promises;
const os = require('os');
const path = require('path');
const { spawnSync } = require('child_process');
const asarTools = require('@electron/asar');

const project = path.resolve(__dirname, '..', '..');
const manifestFile = path.join(project, 'packaging', 'runtime-files.json');

async function copyEntry(source, destination) {
  const stat = await fsp.stat(source);
  await fsp.mkdir(path.dirname(destination), { recursive: true });
  if (stat.isDirectory()) await fsp.cp(source, destination, { recursive: true });
  else await fsp.copyFile(source, destination);
}

async function run() {
  const installerMode = process.argv.includes('--installer');
  const msixMode = process.argv.includes('--msix');
  if (installerMode && msixMode) throw new Error('Choose either NSIS or MSIX packaging, not both.');
  const manifest = JSON.parse(await fsp.readFile(manifestFile, 'utf8'));
  const temporary = await fsp.mkdtemp(path.join(os.tmpdir(), 'swirl-package-qa-'));
  const appDirectory = path.join(temporary, 'app');
  const outputDirectory =
    installerMode || msixMode ? path.join(project, 'dist') : path.join(temporary, 'output');
  await fsp.mkdir(appDirectory, { recursive: true });
  try {
    for (const entry of manifest.copy) {
      const source = path.join(project, entry);
      if (!fs.existsSync(source)) throw new Error(`Runtime allowlist entry is missing: ${entry}`);
      await copyEntry(source, path.join(appDirectory, entry));
    }
    const playerIndexFile = path.join(appDirectory, 'src', 'renderer', 'index.html');
    const sourceIndex = await fsp.readFile(playerIndexFile, 'utf8');
    const playerIndex = sourceIndex.replace(
      /\s*<script src="\.\.\/\.\.\/tests\/smoke\/qa-hooks\.js"><\/script>/,
      '',
    );
    if (playerIndex === sourceIndex)
      throw new Error('Could not remove the QA hook from player HTML.');
    await fsp.writeFile(playerIndexFile, playerIndex, 'utf8');

    const packageFile = path.join(appDirectory, 'package.json');
    const packageData = JSON.parse(await fsp.readFile(packageFile, 'utf8'));
    delete packageData.build;
    delete packageData.devDependencies;
    delete packageData.scripts;
    delete packageData.files;
    await fsp.writeFile(packageFile, `${JSON.stringify(packageData, null, 2)}\n`, 'utf8');

    const builder = path.join(project, 'node_modules', 'electron-builder', 'out', 'cli', 'cli.js');
    const electronDist = path.join(project, 'node_modules', 'electron', 'dist');
    const target = installerMode ? 'nsis' : 'dir';
    const args = [
      builder,
      '--win',
      target,
      '--publish',
      'never',
      `--config.directories.app=${appDirectory}`,
      `--config.directories.output=${outputDirectory}`,
      `--config.electronDist=${electronDist}`,
    ];
    const result = spawnSync(process.execPath, args, { cwd: project, stdio: 'inherit' });
    if (result.error) throw result.error;
    if (result.status !== 0) throw new Error(`electron-builder exited with code ${result.status}.`);

    const asar = path.join(outputDirectory, 'win-unpacked', 'resources', 'app.asar');
    if (!fs.existsSync(asar)) throw new Error('The packaged application archive was not created.');
    const archived = new Set(
      asarTools.listPackage(asar).map((entry) => entry.replace(/^[/\\]/, '').replace(/\\/g, '/')),
    );
    const missing = manifest.required.filter((file) => !archived.has(file));
    if (missing.length)
      throw new Error(`Packaged app is missing runtime files: ${missing.join(', ')}`);
    const leaked = manifest.forbidden.filter((file) => archived.has(file));
    if (leaked.length)
      throw new Error(`Packaged app contains developer-only files: ${leaked.join(', ')}`);
    const forbiddenPatterns = [
      /^(?:tests|tools|docs|\.github)(?:\/|$)/i,
      /(?:^|\/)Swirl-support-.*\.json$/i,
      /\.(?:map|pem|key|pfx|p12)$/i,
      /(?:^|\/)(?:private[-_.]?key|credentials?|secrets?)(?:\.|$)/i,
    ];
    const genericLeaks = [...archived].filter((file) =>
      forbiddenPatterns.some((pattern) => pattern.test(file)),
    );
    if (genericLeaks.length)
      throw new Error(
        `Packaged app contains forbidden files: ${genericLeaks.slice(0, 20).join(', ')}`,
      );
    const allowedRoots = new Set(['assets', 'bundled-mods', 'config', 'package.json', 'src']);
    const unexpectedRoots = [
      ...new Set(
        [...archived]
          .map((file) => file.split('/')[0])
          .filter((root) => root && !allowedRoots.has(root)),
      ),
    ];
    if (unexpectedRoots.length)
      throw new Error(
        `Packaged app contains unexpected runtime roots: ${unexpectedRoots.join(', ')}`,
      );
    const packagedIndex = asarTools
      .extractFile(asar, path.join('src', 'renderer', 'index.html'))
      .toString('utf8');
    if (packagedIndex.includes('qa-hooks.js'))
      throw new Error('Player HTML still references QA hooks.');
    if ([...archived].some((file) => /(?:^|\/)Swirl-support-.*\.json$/i.test(file)))
      throw new Error('A private support export leaked into the player package.');

    if (installerMode) {
      const installer = path.join(outputDirectory, `Swirl-${packageData.version}-Setup.exe`);
      if (!fs.existsSync(installer))
        throw new Error(`NSIS installer was not created: ${installer}`);
      console.log(`Swirl installer created: ${installer}`);
    } else if (msixMode) {
      const certificate = String(process.env.SWIRL_WINDOWS_CERTIFICATE || '').trim();
      const publisher = String(process.env.SWIRL_WINDOWS_PUBLISHER || '').trim();
      if (!certificate || !fs.existsSync(certificate))
        throw new Error(
          'SWIRL_WINDOWS_CERTIFICATE must point to the production PFX for MSIX builds.',
        );
      if (!/^CN=.{1,200}$/.test(publisher))
        throw new Error('SWIRL_WINDOWS_PUBLISHER must be the certificate publisher DN.');
      const unpacked = path.join(outputDirectory, 'win-unpacked');
      await fsp.copyFile(
        path.join(project, 'assets', 'gleam-logo.png'),
        path.join(unpacked, 'gleam-logo.png'),
      );
      const manifestTemplate = await fsp.readFile(
        path.join(project, 'packaging', 'windows', 'Package.appxmanifest'),
        'utf8',
      );
      const manifest = path.join(unpacked, 'Package.appxmanifest');
      await fsp.writeFile(
        manifest,
        manifestTemplate.replace('__SWIRL_PUBLISHER__', publisher),
        'utf8',
      );
      const msix = path.join(outputDirectory, `Swirl-${packageData.version}-Enterprise.msix`);
      const winapp = path.join(
        project,
        'node_modules',
        '@microsoft',
        'winappcli',
        'bin',
        'win-x64',
        'winapp.exe',
      );
      const packed = spawnSync(
        winapp,
        [
          'pack',
          unpacked,
          '--output',
          msix,
          '--manifest',
          manifest,
          '--cert',
          certificate,
          '--cert-password',
          String(process.env.SWIRL_WINDOWS_CERTIFICATE_PASSWORD || ''),
          '--quiet',
        ],
        { cwd: project, stdio: 'inherit' },
      );
      if (packed.error) throw packed.error;
      if (packed.status !== 0 || !fs.existsSync(msix))
        throw new Error('Microsoft winapp CLI did not create the enterprise MSIX.');
      console.log(`Swirl enterprise MSIX created: ${msix}`);
    } else console.log('Swirl packaged-app QA passed.');
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
