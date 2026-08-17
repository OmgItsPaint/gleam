/**
 * Release-workflow helper that hashes the built installer and signs latest.json with the private
 * Ed25519 release key. The private key is read only from the environment and is never written.
 */
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const project = path.resolve(__dirname, '..', '..');
const UpdateService = require('../../src/core/updates/update-service');
const pkg = require('../../package.json');

const repository = String(process.env.GITHUB_REPOSITORY || '').trim();
const tag = String(
  process.env.RELEASE_TAG || process.env.GITHUB_REF_NAME || `v${pkg.version}`,
).trim();
const privateKey = String(
  process.env.GLEAM_UPDATE_PRIVATE_KEY || process.env.SWIRL_UPDATE_PRIVATE_KEY || '',
)
  .replace(/\\n/g, '\n')
  .trim();
const artifactName = `Gleam-${pkg.version}-Setup.exe`;
const artifact = path.join(project, 'dist', artifactName);
if (!/^[A-Za-z0-9_.-]+\/[A-Za-z0-9_.-]+$/.test(repository))
  throw new Error('GITHUB_REPOSITORY is missing or invalid.');
if (tag !== `v${pkg.version}`)
  throw new Error(`Release tag ${tag} does not match package version ${pkg.version}.`);
if (!fs.existsSync(artifact)) throw new Error(`Release installer not found: ${artifact}`);
if (!privateKey.includes('BEGIN PRIVATE KEY'))
  throw new Error('GLEAM_UPDATE_PRIVATE_KEY must contain an Ed25519 private key in PEM format.');
// UpdateService canonicalizes this payload the same way during verification.
const payload = {
  format: 2,
  version: pkg.version,
  channel: String(process.env.GLEAM_UPDATE_CHANNEL || process.env.SWIRL_UPDATE_CHANNEL || 'stable'),
  minimumVersion: String(
    process.env.GLEAM_UPDATE_MINIMUM_VERSION || process.env.SWIRL_UPDATE_MINIMUM_VERSION || '3.0.0',
  ),
  artifactType: 'nsis',
  url: `https://github.com/${repository}/releases/download/${encodeURIComponent(tag)}/${artifactName}`,
  size: fs.statSync(artifact).size,
  sha256: crypto.createHash('sha256').update(fs.readFileSync(artifact)).digest('hex'),
  notes: `Gleam ${pkg.version}`,
  publishedAt: new Date().toISOString(),
};
const signature = crypto
  .sign(null, Buffer.from(UpdateService.stable(payload)), privateKey)
  .toString('base64');
fs.writeFileSync(
  path.join(project, 'dist', 'latest.json'),
  JSON.stringify({ payload, signature }, null, 2) + '\n',
  'utf8',
);
