/** Generates release inventory, dependency report, and SHA-256 checksums without secret data. */
const fs = require('fs');
const fsp = fs.promises;
const path = require('path');
const crypto = require('crypto');
const project = path.resolve(__dirname, '..', '..');
const dist = path.join(project, 'dist');
const { version } = require(path.join(project, 'package.json'));

async function walk(root, prefix = '') {
  const output = [];
  for (const entry of await fsp.readdir(root, { withFileTypes: true })) {
    const relative = path.join(prefix, entry.name);
    if (entry.isDirectory()) output.push(...(await walk(path.join(root, entry.name), relative)));
    else if (entry.isFile()) output.push(relative.replace(/\\/g, '/'));
  }
  return output;
}

async function generate() {
  await fsp.mkdir(dist, { recursive: true });
  const lock = JSON.parse(await fsp.readFile(path.join(project, 'package-lock.json'), 'utf8'));
  const packages = Object.entries(lock.packages || {})
    .filter(([location]) => location.startsWith('node_modules/'))
    .map(([location, value]) => ({
      name: location.slice('node_modules/'.length),
      version: value.version || '',
      dev: value.dev === true,
      optional: value.optional === true,
    }))
    .sort((left, right) => left.name.localeCompare(right.name));
  await fsp.writeFile(
    path.join(dist, 'dependency-report.json'),
    `${JSON.stringify({ lockfileVersion: lock.lockfileVersion, generatedAt: new Date().toISOString(), packages }, null, 2)}\n`,
    'utf8',
  );
  const nativeBundle = path.join(project, 'src-tauri', 'target', 'release', 'bundle');
  const inventory = fs.existsSync(nativeBundle)
    ? (await walk(nativeBundle)).map((file) => `src-tauri/target/release/bundle/${file}`)
    : [];
  await fsp.writeFile(
    path.join(dist, 'packaged-file-inventory.json'),
    `${JSON.stringify({ version, generatedAt: new Date().toISOString(), files: inventory }, null, 2)}\n`,
    'utf8',
  );
  const releaseNames = [
    `Gleam-${version}-Setup.exe`,
    `Gleam-${version}-Setup.exe.blockmap`,
    `Gleam-${version}-Enterprise.msi`,
    `gleam-${version}-sbom.json`,
    'latest.json',
    'dependency-report.json',
    'packaged-file-inventory.json',
  ];
  const checksumFiles = releaseNames.filter((file) => fs.existsSync(path.join(dist, file))).sort();
  const lines = [];
  for (const file of checksumFiles) {
    const bytes = await fsp.readFile(path.join(dist, file));
    lines.push(`${crypto.createHash('sha256').update(bytes).digest('hex')}  ${file}`);
  }
  await fsp.writeFile(path.join(dist, 'release-checksums.sha256'), `${lines.join('\n')}\n`, 'utf8');
  console.log(`Gleam ${version} release reports and ${checksumFiles.length} checksums generated.`);
}

if (require.main === module)
  generate().catch((error) => {
    console.error(error);
    process.exitCode = 1;
  });

module.exports = { generate, walk };
