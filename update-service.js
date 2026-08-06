const fs = require('fs');
const fsp = fs.promises;
const path = require('path');
const https = require('https');
const crypto = require('crypto');
const { spawn } = require('child_process');

function stable(value) {
  if (Array.isArray(value)) return `[${value.map(stable).join(',')}]`;
  if (value && typeof value === 'object') return `{${Object.keys(value).sort().map(key => `${JSON.stringify(key)}:${stable(value[key])}`).join(',')}}`;
  return JSON.stringify(value);
}

function newer(candidate, current) {
  const parts = value => String(value).split('.').map(part => Number(part) || 0);
  const left = parts(candidate); const right = parts(current);
  for (let index = 0; index < Math.max(left.length, right.length); index += 1) { if ((left[index] || 0) !== (right[index] || 0)) return (left[index] || 0) > (right[index] || 0); }
  return false;
}

class UpdateService {
  constructor(root, currentVersion, configFile = path.join(__dirname, 'update-config.json')) { this.root = path.join(root, '.icecream_client', 'updates'); this.currentVersion = currentVersion; this.configFile = configFile; }
  stateFile() { return path.join(this.root, 'state.json'); }
  healthFile() { return path.join(this.root, 'healthy.txt'); }
  async config() { let file = {}; try { file = JSON.parse(await fsp.readFile(this.configFile, 'utf8')); } catch {} const manifestUrl = process.env.SWIRL_UPDATE_MANIFEST_URL || file.manifestUrl || ''; const publicKey = (process.env.SWIRL_UPDATE_PUBLIC_KEY || file.publicKey || '').replace(/\\n/g, '\n'); return { enabled: file.enabled === true || Boolean(process.env.SWIRL_UPDATE_MANIFEST_URL), manifestUrl, publicKey }; }
  async fetch(url, limit, redirects = 0) { if (redirects > 5) throw new Error('The update server redirected too many times.'); const parsed = new URL(url); if (parsed.protocol !== 'https:') throw new Error('Swirl updates require HTTPS.'); return new Promise((resolve, reject) => { const request = https.get(parsed, { headers: { 'User-Agent': `Swirl-Launcher/${this.currentVersion}`, 'Accept-Encoding': 'identity' } }, response => { if (response.statusCode >= 300 && response.statusCode < 400 && response.headers.location) { response.resume(); this.fetch(new URL(response.headers.location, parsed).toString(), limit, redirects + 1).then(resolve, reject); return; } if (response.statusCode !== 200) { response.resume(); reject(new Error(`Update server returned ${response.statusCode}.`)); return; } const chunks = []; let total = 0; response.on('data', chunk => { total += chunk.length; if (total > limit) request.destroy(new Error('The update download exceeded its safety limit.')); else chunks.push(chunk); }); response.on('end', () => resolve(Buffer.concat(chunks))); }); request.setTimeout(60_000, () => request.destroy(new Error('The update server timed out.'))); request.on('error', reject); }); }
  verifyManifest(document, publicKey) { if (!document?.payload || typeof document.signature !== 'string') throw new Error('The update manifest is incomplete.'); const payload = document.payload; if (!/^\d+\.\d+\.\d+$/.test(String(payload.version)) || !/^https:\/\//.test(String(payload.url)) || !/^[a-f0-9]{64}$/i.test(String(payload.sha256))) throw new Error('The update manifest contains invalid release data.'); let verified = false; try { verified = crypto.verify(null, Buffer.from(stable(payload)), publicKey, Buffer.from(document.signature, 'base64')); } catch {} if (!verified) throw new Error('The update manifest signature is not trusted.'); return payload; }
  async check() { const config = await this.config(); if (!config.enabled) return { enabled: false, currentVersion: this.currentVersion, message: 'Updates are disabled in this private build.' }; if (!config.manifestUrl || !config.publicKey) throw new Error('Signed updates are enabled but the release URL or public key is missing.'); const body = await this.fetch(config.manifestUrl, 1024 * 1024); let document; try { document = JSON.parse(body.toString('utf8')); } catch { throw new Error('The update server returned invalid JSON.'); } const payload = this.verifyManifest(document, config.publicKey); return { enabled: true, available: newer(payload.version, this.currentVersion), currentVersion: this.currentVersion, payload }; }
  async stage() { const result = await this.check(); if (!result.enabled || !result.available) return result; await fsp.mkdir(this.root, { recursive: true }); const destination = path.join(this.root, `Swirl-${result.payload.version}-Setup.exe`); const bytes = await this.fetch(result.payload.url, 350 * 1024 * 1024); const actual = crypto.createHash('sha256').update(bytes).digest('hex'); if (actual !== result.payload.sha256.toLowerCase()) throw new Error('The update installer failed its SHA-256 check.'); await fsp.writeFile(destination, bytes); const state = await this.readState(); state.staged = { version: result.payload.version, installer: destination, sha256: actual, notes: String(result.payload.notes || ''), stagedAt: new Date().toISOString() }; await this.writeState(state); return { ...result, staged: state.staged }; }
  async readState() { try { return JSON.parse(await fsp.readFile(this.stateFile(), 'utf8')); } catch { return {}; } }
  async writeState(state) { await fsp.mkdir(this.root, { recursive: true }); const temporary = `${this.stateFile()}.tmp`; await fsp.writeFile(temporary, JSON.stringify(state, null, 2), 'utf8'); await fsp.rename(temporary, this.stateFile()); }
  async markHealthy() { const state = await this.readState(); await fsp.mkdir(this.root, { recursive: true }); await fsp.writeFile(this.healthFile(), this.currentVersion, 'utf8'); if (state.pending?.version === this.currentVersion) { state.knownGood = state.pending; delete state.pending; delete state.staged; await this.writeState(state); } }
  async apply() { const state = await this.readState(); const staged = state.staged; if (!staged || !fs.existsSync(staged.installer)) throw new Error('Download an update before installing it.'); const previous = state.knownGood?.installer && fs.existsSync(state.knownGood.installer) ? state.knownGood : null; state.pending = staged; await this.writeState(state); await fsp.writeFile(this.healthFile(), '', 'utf8'); if (previous) { const watcher = path.join(this.root, 'rollback-watch.ps1'); const script = 'param([string]$Health,[string]$Expected,[string]$Previous)\nStart-Sleep -Seconds 180\n$healthy = if (Test-Path -LiteralPath $Health) { Get-Content -LiteralPath $Health -Raw } else { "" }\nif ($healthy.Trim() -ne $Expected -and (Test-Path -LiteralPath $Previous)) { Start-Process -FilePath $Previous -ArgumentList "/S" -WindowStyle Hidden }\n'; await fsp.writeFile(watcher, script, 'utf8'); const monitor = spawn('powershell.exe', ['-NoProfile', '-ExecutionPolicy', 'Bypass', '-File', watcher, '-Health', this.healthFile(), '-Expected', staged.version, '-Previous', previous.installer], { detached: true, stdio: 'ignore', windowsHide: true }); monitor.unref(); }
    const installer = spawn(staged.installer, ['/S'], { detached: true, stdio: 'ignore', windowsHide: true }); installer.unref(); return { installing: staged.version, rollbackArmed: Boolean(previous) };
  }
}

UpdateService.stable = stable;
module.exports = UpdateService;
