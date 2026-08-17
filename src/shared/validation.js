// @ts-check
const path = require('path');
const { SwirlError } = require('./errors');

/** @param {unknown} value @param {string} name @param {{min?: number, max?: number, pattern?: RegExp}} [options] */
function string(value, name, { min = 0, max = 256, pattern } = {}) {
  const result = String(value ?? '').trim();
  if (result.length < min || result.length > max || (pattern && !pattern.test(result)))
    throw new SwirlError('INVALID_INPUT', `${name} is invalid.`);
  return result;
}

/** @param {unknown} value @param {string} name @param {readonly string[]} allowed */
function enumeration(value, name, allowed) {
  const result = String(value ?? '');
  if (!allowed.includes(result)) throw new SwirlError('INVALID_INPUT', `${name} is invalid.`);
  return result;
}

/** @param {unknown} value @param {string} name @param {number} [max] */
function array(value, name, max = 1000) {
  if (!Array.isArray(value) || value.length > max)
    throw new SwirlError('INVALID_INPUT', `${name} is too large or invalid.`);
  return value;
}

/** @param {unknown} value @param {string} name @param {readonly string[]} [allowedHosts] */
function httpsUrl(value, name, allowedHosts = []) {
  /** @type {URL} */
  let parsed;
  try {
    parsed = new URL(String(value));
  } catch {
    throw new SwirlError('INVALID_INPUT', `${name} is not a valid URL.`);
  }
  if (parsed.protocol !== 'https:' || parsed.username || parsed.password)
    throw new SwirlError('INVALID_INPUT', `${name} must be a credential-free HTTPS URL.`);
  if (
    allowedHosts.length &&
    !allowedHosts.some((host) => parsed.hostname === host || parsed.hostname.endsWith(`.${host}`))
  )
    throw new SwirlError('HOST_BLOCKED', `${parsed.hostname} is not an approved Swirl endpoint.`);
  return parsed;
}

/** @param {unknown} value @param {string} [name] */
function proxyUrl(value, name = 'Proxy address') {
  let parsed;
  try {
    parsed = new URL(string(value, name, { min: 4, max: 2048 }));
  } catch {
    throw new SwirlError('INVALID_INPUT', `${name} is not a valid proxy URL.`);
  }
  if (
    !['http:', 'https:', 'socks:', 'socks5:'].includes(parsed.protocol) ||
    parsed.username ||
    parsed.password ||
    !parsed.hostname
  )
    throw new SwirlError(
      'INVALID_INPUT',
      `${name} must be HTTP, HTTPS, or SOCKS and cannot contain credentials.`,
    );
  return parsed.toString();
}

/** @param {string} root @param {unknown} relative @param {string} [name] */
function containedPath(root, relative, name = 'Path') {
  const clean = string(relative, name, { max: 512 });
  if (path.isAbsolute(clean) || clean.includes('\0'))
    throw new SwirlError('INVALID_PATH', `${name} is unsafe.`);
  const resolved = path.resolve(root, clean);
  const relation = path.relative(root, resolved);
  if (!relation || relation.startsWith('..') || path.isAbsolute(relation))
    throw new SwirlError('INVALID_PATH', `${name} leaves its allowed directory.`);
  return resolved;
}

module.exports = { string, enumeration, array, httpsUrl, proxyUrl, containedPath };
