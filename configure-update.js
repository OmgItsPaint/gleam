/**
 * Release-workflow helper that writes the public update key and GitHub release URL into
 * update-config.json. It deliberately refuses incomplete CI configuration.
 */
const fs = require('fs');
const path = require('path');

const repository = String(process.env.GITHUB_REPOSITORY || '').trim();
const publicKey = String(process.env.SWIRL_UPDATE_PUBLIC_KEY || '')
  .replace(/\\n/g, '\n')
  .trim();
// Never produce an enabled update configuration with a missing repository or malformed key.
if (!/^[A-Za-z0-9_.-]+\/[A-Za-z0-9_.-]+$/.test(repository))
  throw new Error('GITHUB_REPOSITORY is missing or invalid.');
if (!publicKey.includes('BEGIN PUBLIC KEY'))
  throw new Error('SWIRL_UPDATE_PUBLIC_KEY must contain the Ed25519 public key in PEM format.');
const config = {
  enabled: true,
  manifestUrl: `https://github.com/${repository}/releases/latest/download/latest.json`,
  publicKey,
};
fs.writeFileSync(
  path.join(__dirname, 'update-config.json'),
  JSON.stringify(config, null, 2) + '\n',
  'utf8',
);
