const fs = require('fs');
const fsp = fs.promises;
const path = require('path');

class CredentialVault {
  constructor(dataRoot, safeStorage) {
    this.file = path.join(dataRoot, '.icecream_client', 'network', 'credentials.json');
    this.safeStorage = safeStorage;
  }
  async available() {
    return Boolean(
      this.safeStorage?.isAsyncEncryptionAvailable &&
        (await this.safeStorage.isAsyncEncryptionAvailable()),
    );
  }
  async saveProxy(username, password) {
    if (!(await this.available()))
      throw new Error('Windows protected credential storage is unavailable.');
    const value = JSON.stringify({
      username: String(username || ''),
      password: String(password || ''),
    });
    const encrypted = await this.safeStorage.encryptStringAsync(value);
    await fsp.mkdir(path.dirname(this.file), { recursive: true });
    const temporary = `${this.file}.${process.pid}.tmp`;
    await fsp.writeFile(
      temporary,
      JSON.stringify({ format: 1, protection: 'os-async', value: encrypted.toString('base64') }),
      { encoding: 'utf8', mode: 0o600 },
    );
    await fsp.rename(temporary, this.file);
  }
  async loadProxy() {
    try {
      if (!(await this.available())) return null;
      const stored = JSON.parse(await fsp.readFile(this.file, 'utf8'));
      if (stored.format !== 1 || stored.protection !== 'os-async') return null;
      const result = await this.safeStorage.decryptStringAsync(Buffer.from(stored.value, 'base64'));
      const credential = JSON.parse(result.result);
      if (result.shouldReEncrypt) await this.saveProxy(credential.username, credential.password);
      return {
        username: String(credential.username || ''),
        password: String(credential.password || ''),
      };
    } catch {
      return null;
    }
  }
  async clearProxy() {
    await fsp.rm(this.file, { force: true });
  }
}

module.exports = CredentialVault;
