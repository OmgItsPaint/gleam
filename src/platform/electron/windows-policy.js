const fs = require('fs');
const fsp = fs.promises;
const path = require('path');
const { NETWORK_MODES, OFFLINE_MODES, UPDATE_POLICIES } = require('../../shared/contracts');
const { proxyUrl } = require('../../shared/validation');

class WindowsPolicy {
  constructor(
    file = path.join(process.env.ProgramData || 'C:\\ProgramData', 'Swirl', 'policy.json'),
  ) {
    this.file = file;
  }
  async read() {
    let raw;
    try {
      raw = JSON.parse(await fsp.readFile(this.file, 'utf8'));
    } catch {
      return { managed: false };
    }
    const policy = { managed: true, source: this.file };
    if (NETWORK_MODES.includes(raw.networkMode)) policy.networkMode = raw.networkMode;
    if (OFFLINE_MODES.includes(raw.offlineMode)) policy.offlineMode = raw.offlineMode;
    if (typeof raw.offlineOnly === 'boolean') policy.offlineOnly = raw.offlineOnly;
    if (policy.offlineMode === 'offline') policy.offlineOnly = true;
    if (UPDATE_POLICIES.includes(raw.updatePolicy)) policy.updatePolicy = raw.updatePolicy;
    if (typeof raw.manualProxyUrl === 'string') {
      try {
        policy.manualProxyUrl = proxyUrl(raw.manualProxyUrl);
      } catch {}
    }
    if (typeof raw.serverHostingEnabled === 'boolean')
      policy.serverHostingEnabled = raw.serverHostingEnabled;
    if (typeof raw.diagnosticsExportEnabled === 'boolean')
      policy.diagnosticsExportEnabled = raw.diagnosticsExportEnabled;
    if (Array.isArray(raw.allowedEndpoints))
      policy.allowedEndpoints = raw.allowedEndpoints
        .filter((item) => typeof item === 'string' && /^[a-z0-9.-]{1,253}$/i.test(item))
        .map((item) => item.toLowerCase())
        .slice(0, 100);
    if (Array.isArray(raw.provisioningPublicKeys))
      policy.provisioningPublicKeys = raw.provisioningPublicKeys
        .filter((item) => typeof item === 'string' && item.includes('BEGIN PUBLIC KEY'))
        .slice(0, 20);
    return policy;
  }
  exists() {
    return fs.existsSync(this.file);
  }
}

module.exports = WindowsPolicy;
