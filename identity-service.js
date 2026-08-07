const fs = require('fs');
const fsp = fs.promises;
const path = require('path');
const crypto = require('crypto');
const http = require('http');

const AUTH_PREFIX = Buffer.from('SWIRL-AUTH-1\0', 'utf8');
const MAX_SIGN_BYTES = 4096;

class IdentityService {
  constructor(appData, safeStorage) {
    this.root = path.join(appData, '.icecream_client', 'identity');
    this.safeStorage = safeStorage;
    this.cached = null;
    this.brokers = new Map();
  }

  privateFile() { return path.join(this.root, 'player-key.json'); }
  publicFile() { return path.join(this.root, 'player-identity.json'); }
  fingerprint(publicDer) { return crypto.createHash('sha256').update(publicDer).digest('hex'); }
  publicRecord(publicDer, createdAt) {
    return { format: 1, algorithm: 'Ed25519', publicKey: publicDer.toString('base64'), fingerprint: this.fingerprint(publicDer), createdAt };
  }
  async atomicWrite(file, value) {
    await fsp.mkdir(path.dirname(file), { recursive: true });
    const temporary = `${file}.${process.pid}.${crypto.randomBytes(5).toString('hex')}.tmp`;
    await fsp.writeFile(temporary, value, { encoding: 'utf8', mode: 0o600, flag: 'wx' });
    await fsp.rename(temporary, file);
  }
  protect(privatePem) {
    if (this.safeStorage?.isEncryptionAvailable()) return { protection: 'os', value: this.safeStorage.encryptString(privatePem).toString('base64') };
    return { protection: 'file', value: Buffer.from(privatePem, 'utf8').toString('base64') };
  }
  unprotect(record) {
    const encrypted = Buffer.from(String(record.value || ''), 'base64');
    if (record.protection === 'os') {
      if (!this.safeStorage?.isEncryptionAvailable()) throw new Error('Windows could not unlock your Swirl identity. Sign back into Windows or restore your recovery file.');
      return this.safeStorage.decryptString(encrypted);
    }
    if (record.protection === 'file') return encrypted.toString('utf8');
    throw new Error('The stored Swirl identity uses an unknown protection method.');
  }
  validate(privatePem, publicDer) {
    const test = crypto.randomBytes(32);
    const privateKey = crypto.createPrivateKey(privatePem);
    const publicKey = crypto.createPublicKey({ key: publicDer, format: 'der', type: 'spki' });
    if (!crypto.verify(null, test, publicKey, crypto.sign(null, test, privateKey))) throw new Error('The identity keypair does not match.');
  }
  async get() {
    if (this.cached) return this.cached;
    try {
      const stored = JSON.parse(await fsp.readFile(this.privateFile(), 'utf8'));
      const privatePem = this.unprotect(stored);
      const publicDer = Buffer.from(stored.publicKey, 'base64');
      this.validate(privatePem, publicDer);
      this.cached = { privatePem, publicDer, createdAt: stored.createdAt || new Date().toISOString() };
      return this.cached;
    } catch (error) {
      if (error.code !== 'ENOENT') throw error;
    }
    const pair = crypto.generateKeyPairSync('ed25519', {
      privateKeyEncoding: { type: 'pkcs8', format: 'pem' },
      publicKeyEncoding: { type: 'spki', format: 'der' }
    });
    const createdAt = new Date().toISOString();
    const protectedKey = this.protect(pair.privateKey);
    const stored = { format: 1, algorithm: 'Ed25519', ...protectedKey, publicKey: pair.publicKey.toString('base64'), createdAt };
    await this.atomicWrite(this.privateFile(), JSON.stringify(stored, null, 2));
    await this.atomicWrite(this.publicFile(), JSON.stringify(this.publicRecord(pair.publicKey, createdAt), null, 2));
    this.cached = { privatePem: pair.privateKey, publicDer: pair.publicKey, createdAt };
    return this.cached;
  }
  async info() {
    const identity = await this.get();
    const record = this.publicRecord(identity.publicDer, identity.createdAt);
    return { ...record, shortFingerprint: record.fingerprint.match(/.{1,4}/g).slice(0, 4).join('-'), osProtected: this.safeStorage?.isEncryptionAvailable() === true };
  }
  async exportRecovery(passphrase) {
    if (String(passphrase || '').length < 10) throw new Error('Use a recovery password with at least 10 characters.');
    const identity = await this.get();
    const salt = crypto.randomBytes(16); const iv = crypto.randomBytes(12);
    const key = await new Promise((resolve, reject) => crypto.scrypt(passphrase, salt, 32, { N: 1 << 17, r: 8, p: 1, maxmem: 256 * 1024 * 1024 }, (error, value) => error ? reject(error) : resolve(value)));
    const cipher = crypto.createCipheriv('aes-256-gcm', key, iv);
    const payload = Buffer.from(JSON.stringify({ privateKey: identity.privatePem, publicKey: identity.publicDer.toString('base64'), createdAt: identity.createdAt }), 'utf8');
    const ciphertext = Buffer.concat([cipher.update(payload), cipher.final()]);
    return JSON.stringify({ format: 1, type: 'swirl-player-identity', kdf: 'scrypt-N131072-r8-p1', cipher: 'aes-256-gcm', salt: salt.toString('base64'), iv: iv.toString('base64'), tag: cipher.getAuthTag().toString('base64'), ciphertext: ciphertext.toString('base64') }, null, 2);
  }
  async importRecovery(text, passphrase) {
    let bundle;
    try { bundle = JSON.parse(String(text || '')); } catch { throw new Error('That recovery file is not valid JSON.'); }
    if (bundle?.format !== 1 || bundle.type !== 'swirl-player-identity') throw new Error('That is not a supported Swirl identity recovery file.');
    try {
      const salt = Buffer.from(bundle.salt, 'base64'); const iv = Buffer.from(bundle.iv, 'base64');
      const key = await new Promise((resolve, reject) => crypto.scrypt(passphrase, salt, 32, { N: 1 << 17, r: 8, p: 1, maxmem: 256 * 1024 * 1024 }, (error, value) => error ? reject(error) : resolve(value)));
      const decipher = crypto.createDecipheriv('aes-256-gcm', key, iv); decipher.setAuthTag(Buffer.from(bundle.tag, 'base64'));
      const payload = JSON.parse(Buffer.concat([decipher.update(Buffer.from(bundle.ciphertext, 'base64')), decipher.final()]).toString('utf8'));
      const publicDer = Buffer.from(payload.publicKey, 'base64'); this.validate(payload.privateKey, publicDer);
      const protectedKey = this.protect(payload.privateKey); const createdAt = payload.createdAt || new Date().toISOString();
      await this.atomicWrite(this.privateFile(), JSON.stringify({ format: 1, algorithm: 'Ed25519', ...protectedKey, publicKey: publicDer.toString('base64'), createdAt }, null, 2));
      await this.atomicWrite(this.publicFile(), JSON.stringify(this.publicRecord(publicDer, createdAt), null, 2));
      this.cached = { privatePem: payload.privateKey, publicDer, createdAt };
      return this.info();
    } catch (error) { if (/identity keypair/.test(error.message)) throw error; throw new Error('The recovery password is wrong or the recovery file is damaged.'); }
  }
  async startBroker(playerName, enrollmentToken = '') {
    const identity = await this.get(); const token = crypto.randomBytes(32).toString('base64url');
    const server = http.createServer((request, response) => {
      response.setHeader('Cache-Control', 'no-store');
      if (request.method !== 'POST' || request.url !== '/sign' || request.headers.authorization !== `Bearer ${token}`) { response.writeHead(404); response.end(); return; }
      let data = Buffer.alloc(0);
      request.on('data', chunk => { data = Buffer.concat([data, chunk]); if (data.length > MAX_SIGN_BYTES) request.destroy(); });
      request.on('end', () => {
        try {
          const message = Buffer.from(data.toString('utf8'), 'base64');
          if (message.length > MAX_SIGN_BYTES || !message.subarray(0, AUTH_PREFIX.length).equals(AUTH_PREFIX)) throw new Error('Rejected signing request.');
          const signature = crypto.sign(null, message, identity.privatePem);
          response.writeHead(200, { 'Content-Type': 'text/plain; charset=utf-8' });
          response.end([playerName, identity.publicDer.toString('base64'), this.fingerprint(identity.publicDer), signature.toString('base64'), String(enrollmentToken || '')].join('\n'));
        } catch { response.writeHead(400); response.end(); }
      });
    });
    await new Promise((resolve, reject) => { server.once('error', reject); server.listen(0, '127.0.0.1', resolve); });
    const id = crypto.randomUUID(); this.brokers.set(id, server);
    return { id, port: server.address().port, token, publicKey: identity.publicDer.toString('base64'), fingerprint: this.fingerprint(identity.publicDer) };
  }
  closeBroker(id) { const server = this.brokers.get(id); if (!server) return; this.brokers.delete(id); server.close(); }
  closeAll() { for (const id of [...this.brokers.keys()]) this.closeBroker(id); }
}

module.exports = IdentityService;
