const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const UpdateService = require('./update-service');
const pkg = require('./package.json');

const repository = String(process.env.GITHUB_REPOSITORY || '').trim();
const tag = String(process.env.RELEASE_TAG || process.env.GITHUB_REF_NAME || `v${pkg.version}`).trim();
const privateKey = String(process.env.SWIRL_UPDATE_PRIVATE_KEY || '').replace(/\\n/g, '\n').trim();
const artifactName = `Swirl-${pkg.version}-Setup.exe`;
const artifact = path.join(__dirname, 'dist', artifactName);
if (!/^[A-Za-z0-9_.-]+\/[A-Za-z0-9_.-]+$/.test(repository)) throw new Error('GITHUB_REPOSITORY is missing or invalid.');
if (tag !== `v${pkg.version}`) throw new Error(`Release tag ${tag} does not match package version ${pkg.version}.`);
if (!fs.existsSync(artifact)) throw new Error(`Release installer not found: ${artifact}`);
if (!privateKey.includes('BEGIN PRIVATE KEY')) throw new Error('SWIRL_UPDATE_PRIVATE_KEY must contain an Ed25519 private key in PEM format.');
const payload = { version: pkg.version, url: `https://github.com/${repository}/releases/download/${encodeURIComponent(tag)}/${artifactName}`, sha256: crypto.createHash('sha256').update(fs.readFileSync(artifact)).digest('hex'), notes: `Swirl ${pkg.version}`, publishedAt: new Date().toISOString() };
const signature = crypto.sign(null, Buffer.from(UpdateService.stable(payload)), privateKey).toString('base64');
fs.writeFileSync(path.join(__dirname, 'dist', 'latest.json'), JSON.stringify({ payload, signature }, null, 2) + '\n', 'utf8');
