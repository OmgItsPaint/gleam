const fs = require('fs');
const fsp = fs.promises;
const path = require('path');
const crypto = require('crypto');
const { httpsUrl, proxyUrl } = require('../../shared/validation');

const DEFAULT_HOSTS = Object.freeze([
  'launchermeta.mojang.com',
  'piston-meta.mojang.com',
  'piston-data.mojang.com',
  'resources.download.minecraft.net',
  'libraries.minecraft.net',
  'meta.fabricmc.net',
  'maven.fabricmc.net',
  'api.modrinth.com',
  'cdn.modrinth.com',
  'api.adoptium.net',
  'github.com',
  'objects.githubusercontent.com',
  'release-assets.githubusercontent.com',
]);

class ElectronNetworkTransport {
  constructor(
    electronSession,
    { userAgent = 'Swirl-Launcher/3.0.0', allowedHosts = DEFAULT_HOSTS } = {},
  ) {
    this.session = electronSession;
    this.userAgent = userAgent;
    this.allowedHosts = [...allowedHosts];
    this.mode = 'system';
    this.offline = false;
  }
  async configure({ mode = 'system', manualProxyUrl = '', offline = false, allowedHosts } = {}) {
    this.mode = mode;
    this.offline = offline === true;
    if (Array.isArray(allowedHosts) && allowedHosts.length)
      this.allowedHosts = [...new Set(allowedHosts.map((host) => String(host).toLowerCase()))];
    if (mode === 'direct') await this.session.setProxy({ mode: 'direct' });
    else if (mode === 'manual')
      await this.session.setProxy({ mode: 'fixed_servers', proxyRules: proxyUrl(manualProxyUrl) });
    else await this.session.setProxy({ mode: 'system' });
    await this.session.closeAllConnections();
  }
  allowed(url) {
    return httpsUrl(url, 'Network URL', this.allowedHosts).toString();
  }
  async response(url, { method = 'GET', timeout = 30_000, headers = {}, signal } = {}) {
    if (this.offline) throw new Error('Network access is disabled while Swirl is in Offline mode.');
    const controller = new AbortController();
    const timer = setTimeout(
      () => controller.abort(new Error('Network request timed out.')),
      timeout,
    );
    const abort = () => controller.abort(signal?.reason);
    if (signal) signal.addEventListener('abort', abort, { once: true });
    try {
      let current = this.allowed(url);
      for (let redirects = 0; redirects <= 5; redirects += 1) {
        const response = await this.session.fetch(current, {
          method,
          headers: { 'User-Agent': this.userAgent, 'Accept-Encoding': 'identity', ...headers },
          redirect: 'manual',
          signal: controller.signal,
        });
        if (![301, 302, 303, 307, 308].includes(response.status)) return response;
        const location = response.headers.get('location');
        if (!location) throw new Error('Network redirect did not include a destination.');
        if (redirects === 5) throw new Error('Network request redirected too many times.');
        current = this.allowed(new URL(location, current).toString());
      }
      throw new Error('Network request redirected too many times.');
    } finally {
      clearTimeout(timer);
      if (signal) signal.removeEventListener('abort', abort);
    }
  }
  async getJson(url, { maxBytes = 8 * 1024 * 1024, timeout, signal } = {}) {
    const response = await this.response(url, { timeout, signal });
    if (!response.ok) throw new Error(`Request failed (${response.status}).`);
    const declared = Number(response.headers.get('content-length') || 0);
    if (declared > maxBytes) throw new Error('Network response exceeded its safety limit.');
    const bytes = Buffer.from(await response.arrayBuffer());
    if (bytes.length > maxBytes) throw new Error('Network response exceeded its safety limit.');
    try {
      return JSON.parse(bytes.toString('utf8'));
    } catch {
      throw new Error('Network response was not valid JSON.');
    }
  }
  async probe(url, { timeout = 15_000 } = {}) {
    const started = Date.now();
    try {
      const response = await this.response(url, { method: 'HEAD', timeout });
      return {
        ok: response.ok,
        status: response.status,
        durationMs: Date.now() - started,
        host: new URL(url).hostname,
        failure:
          response.status === 407 ? 'proxy-authentication' : response.ok ? null : 'http-status',
      };
    } catch (error) {
      const message = String(error.message || error);
      const failure = /timed out|abort/i.test(message)
        ? 'timeout'
        : /certificate|cert_|ssl|tls/i.test(message)
          ? 'tls-trust'
          : /name.not.resolved|enotfound|dns/i.test(message)
            ? 'dns'
            : /proxy|407/i.test(message)
              ? 'proxy-authentication'
              : 'transport';
      return {
        ok: false,
        status: 0,
        durationMs: Date.now() - started,
        host: new URL(url).hostname,
        failure,
        error: message.slice(0, 300),
      };
    }
  }
  async download(
    url,
    destination,
    {
      expectedHash = '',
      algorithm = 'sha256',
      maxBytes = 1024 * 1024 * 1024,
      onProgress = () => {},
      signal,
      resume = true,
    } = {},
  ) {
    await fsp.mkdir(path.dirname(destination), { recursive: true });
    const partial = `${destination}.part`;
    let offset = resume && fs.existsSync(partial) ? (await fsp.stat(partial)).size : 0;
    const response = await this.response(url, {
      timeout: 90_000,
      signal,
      headers: offset ? { Range: `bytes=${offset}-` } : {},
    });
    if (!response.ok && response.status !== 206)
      throw new Error(`Download failed (${response.status}).`);
    if (offset && response.status !== 206) offset = 0;
    const total = offset + Number(response.headers.get('content-length') || 0);
    if (total > maxBytes) throw new Error('Download exceeded its safety limit.');
    const output = fs.createWriteStream(partial, { flags: offset ? 'a' : 'w' });
    const reader = response.body?.getReader();
    let received = offset;
    try {
      if (!reader) throw new Error('Download response had no body.');
      while (true) {
        const { done, value } = await reader.read();
        if (done) break;
        received += value.byteLength;
        if (received > maxBytes) throw new Error('Download exceeded its safety limit.');
        if (!output.write(Buffer.from(value)))
          await new Promise((resolve) => output.once('drain', resolve));
        onProgress(received, total);
      }
      await new Promise((resolve, reject) =>
        output.end((error) => (error ? reject(error) : resolve())),
      );
    } catch (error) {
      output.destroy();
      throw error;
    }
    const hash = crypto
      .createHash(algorithm)
      .update(await fsp.readFile(partial))
      .digest('hex');
    if (expectedHash && hash.toLowerCase() !== expectedHash.toLowerCase())
      throw new Error('Downloaded file failed its hash check.');
    await fsp.rm(destination, { force: true });
    await fsp.rename(partial, destination);
    return { bytes: received, hash };
  }
}

ElectronNetworkTransport.DEFAULT_HOSTS = DEFAULT_HOSTS;
module.exports = ElectronNetworkTransport;
