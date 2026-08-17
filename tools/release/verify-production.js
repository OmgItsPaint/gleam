/** Refuses to start a public release when required signing and policy inputs are incomplete. */
const fs = require('fs');
const required = [
  'GLEAM_UPDATE_PUBLIC_KEY',
  'GLEAM_UPDATE_PRIVATE_KEY',
  'GLEAM_UPDATE_MANIFEST_URL',
  'GLEAM_PROVISIONING_METADATA',
  'GLEAM_WINDOWS_PUBLISHER',
];
const missing = required.filter((name) => !String(process.env[name] || '').trim());
const certificate = String(process.env.GLEAM_WINDOWS_CERTIFICATE || '').trim();
if (!certificate || !fs.existsSync(certificate)) missing.push('GLEAM_WINDOWS_CERTIFICATE');
if (missing.length) throw new Error(`Production release inputs are missing: ${missing.join(', ')}`);
if (!/^https:\/\//.test(process.env.GLEAM_UPDATE_MANIFEST_URL))
  throw new Error('GLEAM_UPDATE_MANIFEST_URL must use HTTPS.');
if (!String(process.env.GLEAM_UPDATE_PUBLIC_KEY).includes('BEGIN PUBLIC KEY'))
  throw new Error('GLEAM_UPDATE_PUBLIC_KEY is not a PEM public key.');
if (!String(process.env.GLEAM_UPDATE_PRIVATE_KEY).includes('BEGIN PRIVATE KEY'))
  throw new Error('GLEAM_UPDATE_PRIVATE_KEY is not a PEM private key.');
console.log('Gleam production release inputs are complete.');
