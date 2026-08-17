const fs = require('fs');
const fsp = fs.promises;
const path = require('path');
const crypto = require('crypto');
const { containedPath } = require('../../shared/validation');
const { ensureDiskSpace } = require('../downloads/disk-space');

const MAGIC = Buffer.from('SWIRLPACK1\n', 'ascii');
const MAX_MANIFEST = 8 * 1024 * 1024;
const MAX_TOTAL = 32 * 1024 * 1024 * 1024;

function stable(value) {
  if (Array.isArray(value)) return `[${value.map(stable).join(',')}]`;
  if (value && typeof value === 'object')
    return `{${Object.keys(value)
      .sort()
      .map((key) => `${JSON.stringify(key)}:${stable(value[key])}`)
      .join(',')}}`;
  return JSON.stringify(value);
}

function safeArtifactPath(value) {
  const clean = String(value || '').replace(/\\/g, '/');
  if (
    !clean ||
    clean.length > 512 ||
    clean.startsWith('/') ||
    clean.split('/').some((part) => !part || part === '.' || part === '..')
  )
    throw new Error('Provisioning archive contains an unsafe path.');
  if (/(^|\/)(?:saves|servers|identity|logs?|crash-reports)(?:\/|$)/i.test(clean))
    throw new Error(
      'Provisioning archives cannot contain private worlds, servers, identities, or logs.',
    );
  if (
    !/^(?:assets|libraries|versions|runtime|java)(?:\/|$)/.test(clean) &&
    !/^instances\/profiles\/[a-f0-9]{16}\/(?:mods|config)(?:\/|$)/.test(clean) &&
    !/^instances\/profiles\/[a-f0-9]{16}\/(?:swirl-profile\.json|swirl\.lock\.json)$/.test(clean)
  )
    throw new Error(`Provisioning path is not an approved managed artifact: ${clean}`);
  return clean;
}

class ProvisioningService {
  constructor(dataRoot) {
    this.root = path.join(dataRoot, '.icecream_client');
    this.stageRoot = path.join(this.root, 'provisioning');
  }
  async inspect(source) {
    const handle = await fsp.open(source, 'r');
    try {
      const magic = Buffer.alloc(MAGIC.length);
      await handle.read(magic, 0, magic.length, 0);
      if (!magic.equals(MAGIC)) throw new Error('That is not a Swirl provisioning archive.');
      const length = Buffer.alloc(4);
      await handle.read(length, 0, 4, MAGIC.length);
      const size = length.readUInt32BE();
      if (!size || size > MAX_MANIFEST) throw new Error('Provisioning manifest is invalid.');
      const bytes = Buffer.alloc(size);
      await handle.read(bytes, 0, size, MAGIC.length + 4);
      const envelope = JSON.parse(bytes.toString('utf8'));
      return {
        format: envelope.payload?.format,
        profile: envelope.payload?.profile || null,
        artifacts: Array.isArray(envelope.payload?.artifacts)
          ? envelope.payload.artifacts.length
          : 0,
        totalSize: Number(envelope.payload?.totalSize) || 0,
        signed: typeof envelope.signature === 'string' && envelope.signature.length > 0,
      };
    } finally {
      await handle.close();
    }
  }
  async exportPack(
    destination,
    readiness,
    { signerPrivateKey = '', signerFingerprint = '', onProgress = () => {}, signal } = {},
  ) {
    if (signal?.aborted) throw signal.reason || new Error('Provisioning export cancelled.');
    if (!readiness?.complete || !Array.isArray(readiness.artifacts))
      throw new Error('Only a complete verified profile can be exported.');
    const artifacts = [];
    let total = 0;
    for (const item of readiness.artifacts) {
      const relativePath = safeArtifactPath(item.relativePath);
      const stat = await fsp.lstat(item.source);
      if (!stat.isFile() || stat.isSymbolicLink())
        throw new Error(`Provisioning source is not a regular file: ${relativePath}`);
      total += stat.size;
      if (total > MAX_TOTAL)
        throw new Error('Provisioning archive exceeds the 32 GiB safety limit.');
      artifacts.push({
        path: relativePath,
        size: stat.size,
        sha256: item.hash || (await this.hash(item.source)),
      });
    }
    const payload = {
      format: 1,
      type: 'swirl-offline-provisioning',
      createdAt: new Date().toISOString(),
      launcher: '3.0.0',
      profile: { id: readiness.profileId, gameVersion: readiness.gameVersion },
      totalSize: total,
      artifacts,
    };
    const envelope = { payload, signerFingerprint: String(signerFingerprint || '') };
    if (signerPrivateKey)
      envelope.signature = crypto
        .sign(null, Buffer.from(stable(payload)), signerPrivateKey)
        .toString('base64');
    const manifest = Buffer.from(JSON.stringify(envelope), 'utf8');
    if (manifest.length > MAX_MANIFEST) throw new Error('Provisioning manifest is too large.');
    await ensureDiskSpace(
      path.dirname(destination),
      total + manifest.length,
      'export this offline pack',
    );
    await fsp.mkdir(path.dirname(destination), { recursive: true });
    const temporary = `${destination}.${process.pid}.${crypto.randomBytes(4).toString('hex')}.tmp`;
    const output = fs.createWriteStream(temporary, { flags: 'wx' });
    // A pipe can report a late error after cancellation has already rejected its operation.
    // Keep a permanent listener so cleanup never turns that expected race into an uncaught event;
    // the operation-specific listeners below still propagate the original failure.
    output.on('error', () => {});
    try {
      output.write(MAGIC);
      const length = Buffer.alloc(4);
      length.writeUInt32BE(manifest.length);
      output.write(length);
      output.write(manifest);
      let written = 0;
      for (let index = 0; index < artifacts.length; index += 1) {
        if (signal?.aborted) throw signal.reason || new Error('Provisioning export cancelled.');
        await new Promise((resolve, reject) => {
          const input = fs.createReadStream(readiness.artifacts[index].source);
          let settled = false;
          const finish = (error) => {
            if (settled) return;
            settled = true;
            signal?.removeEventListener('abort', abort);
            input.removeListener('error', fail);
            input.removeListener('end', done);
            output.removeListener('error', fail);
            input.unpipe(output);
            if (error) reject(error);
            else resolve();
          };
          const fail = (error) => finish(error);
          const done = () => finish();
          const abort = () => {
            const error = signal.reason || new Error('Provisioning export cancelled.');
            input.destroy();
            finish(error);
          };
          input.on('data', (chunk) => {
            written += chunk.length;
            onProgress(written, total);
          });
          input.once('error', fail);
          input.once('end', done);
          output.once('error', fail);
          signal?.addEventListener('abort', abort, { once: true });
          input.pipe(output, { end: false });
        });
      }
      await new Promise((resolve, reject) =>
        output.end((error) => (error ? reject(error) : resolve())),
      );
      await fsp.rename(temporary, destination);
    } catch (error) {
      output.destroy();
      await fsp.rm(temporary, { force: true }).catch(() => {});
      throw error;
    }
    return {
      destination,
      artifacts: artifacts.length,
      bytes: total,
      signed: Boolean(envelope.signature),
    };
  }
  async importPack(
    source,
    { trustedPublicKeys = [], requireSignature = false, onProgress = () => {}, signal } = {},
  ) {
    if (signal?.aborted) throw signal.reason || new Error('Provisioning import cancelled.');
    const handle = await fsp.open(source, 'r');
    let position = 0;
    try {
      const magic = Buffer.alloc(MAGIC.length);
      await handle.read(magic, 0, magic.length, position);
      position += magic.length;
      if (!magic.equals(MAGIC)) throw new Error('That is not a Swirl provisioning archive.');
      const length = Buffer.alloc(4);
      await handle.read(length, 0, 4, position);
      position += 4;
      const manifestLength = length.readUInt32BE();
      if (!manifestLength || manifestLength > MAX_MANIFEST)
        throw new Error('Provisioning manifest is invalid.');
      const bytes = Buffer.alloc(manifestLength);
      await handle.read(bytes, 0, bytes.length, position);
      position += bytes.length;
      const envelope = JSON.parse(bytes.toString('utf8'));
      const payload = envelope.payload;
      if (
        payload?.format !== 1 ||
        payload.type !== 'swirl-offline-provisioning' ||
        !Array.isArray(payload.artifacts) ||
        payload.artifacts.length > 100000
      )
        throw new Error('Unsupported provisioning manifest.');
      const seen = new Set();
      let declaredTotal = 0;
      for (const artifact of payload.artifacts) {
        const relative = safeArtifactPath(artifact.path);
        if (seen.has(relative.toLowerCase()))
          throw new Error('Provisioning manifest contains duplicate paths.');
        seen.add(relative.toLowerCase());
        const size = Number(artifact.size);
        if (
          !Number.isSafeInteger(size) ||
          size < 0 ||
          declaredTotal + size > MAX_TOTAL ||
          !/^[a-f0-9]{64}$/i.test(String(artifact.sha256))
        )
          throw new Error('Provisioning artifact metadata is invalid.');
        declaredTotal += size;
      }
      if (declaredTotal !== Number(payload.totalSize))
        throw new Error('Provisioning total size is invalid.');
      await ensureDiskSpace(this.root, declaredTotal, 'import this offline pack');
      let verified = false;
      if (envelope.signature)
        for (const key of trustedPublicKeys)
          try {
            if (
              crypto.verify(
                null,
                Buffer.from(stable(payload)),
                key,
                Buffer.from(envelope.signature, 'base64'),
              )
            ) {
              verified = true;
              break;
            }
          } catch {}
      if (requireSignature && !verified)
        throw new Error('Managed provisioning requires a trusted administrator signature.');
      const stage = path.join(this.stageRoot, `stage-${crypto.randomBytes(8).toString('hex')}`);
      await fsp.mkdir(stage, { recursive: true });
      let read = 0;
      try {
        for (const artifact of payload.artifacts) {
          if (signal?.aborted) throw signal.reason || new Error('Provisioning import cancelled.');
          const relative = safeArtifactPath(artifact.path);
          const size = Number(artifact.size);
          if (!Number.isSafeInteger(size) || size < 0 || read + size > MAX_TOTAL)
            throw new Error('Provisioning artifact size is invalid.');
          const target = containedPath(stage, relative, 'Provisioning path');
          await fsp.mkdir(path.dirname(target), { recursive: true });
          const output = await fsp.open(target, 'wx');
          const digest = crypto.createHash('sha256');
          let remaining = size;
          try {
            while (remaining) {
              if (signal?.aborted)
                throw signal.reason || new Error('Provisioning import cancelled.');
              const chunk = Buffer.alloc(Math.min(1024 * 1024, remaining));
              const result = await handle.read(chunk, 0, chunk.length, position);
              if (!result.bytesRead) throw new Error('Provisioning archive ended unexpectedly.');
              const value = chunk.subarray(0, result.bytesRead);
              await output.write(value, 0, value.length, null);
              digest.update(value);
              position += result.bytesRead;
              remaining -= result.bytesRead;
              read += result.bytesRead;
              onProgress(read, payload.totalSize || 0);
            }
          } finally {
            await output.close();
          }
          if (digest.digest('hex') !== artifact.sha256)
            throw new Error(`Provisioning hash failed: ${relative}`);
        }
        if ((await handle.stat()).size !== position)
          throw new Error('Provisioning archive contains unexpected trailing data.');
        const rollback = path.join(stage, '.rollback');
        const committed = [];
        try {
          for (let index = 0; index < payload.artifacts.length; index += 1) {
            if (signal?.aborted) throw signal.reason || new Error('Provisioning import cancelled.');
            const relative = safeArtifactPath(payload.artifacts[index].path);
            const staged = containedPath(stage, relative);
            const destination = containedPath(this.root, relative);
            const previous = path.join(rollback, `${index}.previous`);
            await fsp.mkdir(path.dirname(destination), { recursive: true });
            let hadPrevious = false;
            if (fs.existsSync(destination)) {
              await fsp.mkdir(rollback, { recursive: true });
              await fsp.rename(destination, previous);
              hadPrevious = true;
            }
            committed.push({ destination, previous, hadPrevious });
            await fsp.rename(staged, destination);
          }
        } catch (error) {
          for (const item of committed.reverse()) {
            await fsp.rm(item.destination, { force: true }).catch(() => {});
            if (item.hadPrevious) await fsp.rename(item.previous, item.destination).catch(() => {});
          }
          throw error;
        }
        return {
          imported: payload.artifacts.length,
          bytes: read,
          verified,
          profile: payload.profile || null,
        };
      } finally {
        await fsp.rm(stage, { recursive: true, force: true });
      }
    } finally {
      await handle.close();
    }
  }
  async hash(file) {
    return crypto
      .createHash('sha256')
      .update(await fsp.readFile(file))
      .digest('hex');
  }
}

ProvisioningService.stable = stable;
module.exports = ProvisioningService;
