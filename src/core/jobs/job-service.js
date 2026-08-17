const fs = require('fs');
const fsp = fs.promises;
const path = require('path');
const crypto = require('crypto');

class JobService {
  constructor(dataRoot, { concurrency = 3, onChange = () => {} } = {}) {
    this.root = path.join(dataRoot, '.icecream_client', 'jobs');
    this.file = path.join(this.root, 'jobs.json');
    this.backupFile = `${this.file}.bak`;
    this.concurrency = Math.max(1, Math.min(8, concurrency));
    this.onChange = onChange;
    this.jobs = [];
    this.runners = new Map();
    this.handlers = new Map();
    this.controllers = new Map();
    this.activeScopes = new Set();
    this.persistQueue = Promise.resolve();
  }
  async init() {
    try {
      this.jobs = JSON.parse(await fsp.readFile(this.file, 'utf8'));
    } catch {
      try {
        this.jobs = JSON.parse(await fsp.readFile(this.backupFile, 'utf8'));
      } catch {
        this.jobs = [];
      }
    }
    if (!Array.isArray(this.jobs)) this.jobs = [];
    this.jobs = this.jobs.filter(
      (job) =>
        job &&
        typeof job === 'object' &&
        typeof job.id === 'string' &&
        /^[a-f0-9]{24}$/.test(job.id) &&
        typeof job.type === 'string' &&
        typeof job.scope === 'string',
    );
    for (const job of this.jobs) {
      if (job.state === 'running' || job.state === 'queued') {
        job.state = 'paused';
        job.message = 'Paused after Swirl restarted';
        job.updatedAt = new Date().toISOString();
      }
      if (job.recoverable === true) this.attachRegisteredRunner(job);
    }
    this.jobs = this.jobs.slice(-500);
    await this.persist();
    return this.list();
  }
  list() {
    return this.jobs.map(({ payload: _payload, result: _result, ...job }) => ({ ...job }));
  }
  async persist() {
    const write = async () => {
      await fsp.mkdir(this.root, { recursive: true });
      const temporary = `${this.file}.${process.pid}.${crypto.randomBytes(4).toString('hex')}.tmp`;
      await fsp.writeFile(temporary, `${JSON.stringify(this.jobs, null, 2)}\n`, 'utf8');
      try {
        const current = await fsp.readFile(this.file, 'utf8');
        if (Array.isArray(JSON.parse(current))) await fsp.copyFile(this.file, this.backupFile);
      } catch (error) {
        if (error.code !== 'ENOENT' && !(error instanceof SyntaxError)) throw error;
      }
      await fsp.rename(temporary, this.file);
      this.onChange(this.list());
    };
    this.persistQueue = this.persistQueue.then(write, write);
    return this.persistQueue;
  }
  register(type, handler) {
    type = String(type || '').trim();
    if (!/^[a-z][a-z0-9-]{0,63}$/.test(type)) throw new Error('Invalid persistent job type.');
    if (typeof handler !== 'function')
      throw new TypeError('Persistent job handler must be a function.');
    if (this.handlers.has(type))
      throw new Error(`Persistent job handler already registered: ${type}`);
    this.handlers.set(type, handler);
    for (const job of this.jobs)
      if (job.type === type && job.recoverable === true) this.attachRegisteredRunner(job);
    return this;
  }
  serializablePayload(payload) {
    const encoded = JSON.stringify(payload ?? null);
    if (encoded === undefined || Buffer.byteLength(encoded, 'utf8') > 16 * 1024)
      throw new Error('Persistent job payload exceeds the 16 KiB limit.');
    const decoded = JSON.parse(encoded);
    if (decoded !== null && (typeof decoded !== 'object' || Array.isArray(decoded)))
      throw new Error('Persistent job payload must be an object.');
    return decoded;
  }
  attachRegisteredRunner(job) {
    const handler = this.handlers.get(job.type);
    if (!handler) return false;
    this.runners.set(job.id, (context) => handler(job.payload ?? null, context, { ...job }));
    return true;
  }
  async enqueue(type, scope, payload = null, options = {}) {
    type = String(type || '').trim();
    if (!this.handlers.has(type)) throw new Error(`No persistent job handler registered: ${type}`);
    const job = await this.create(type, scope, null, {
      ...options,
      payload: this.serializablePayload(payload),
      recoverable: true,
    });
    return job;
  }
  async create(
    type,
    scope,
    runner,
    {
      message = 'Waiting',
      retryable = true,
      cancellable = true,
      payload,
      recoverable = false,
      autoStart = true,
    } = {},
  ) {
    if (recoverable === true && !this.handlers.has(String(type || '').trim()))
      throw new Error(`No persistent job handler registered: ${type}`);
    if (recoverable !== true && typeof runner !== 'function')
      throw new TypeError('Job runner must be a function.');
    const now = new Date().toISOString();
    const job = {
      id: crypto.randomBytes(12).toString('hex'),
      type: String(type),
      scope: String(scope || 'global'),
      state: 'queued',
      message,
      completed: 0,
      total: 0,
      retryable,
      cancellable,
      recoverable: recoverable === true,
      createdAt: now,
      updatedAt: now,
    };
    if (job.recoverable) job.payload = payload;
    this.jobs.push(job);
    if (job.recoverable) this.attachRegisteredRunner(job);
    else this.runners.set(job.id, runner);
    await this.persist();
    if (autoStart) void this.pump();
    return { ...job };
  }
  async execute(type, scope, runner, options = {}) {
    let resolveCompletion;
    let rejectCompletion;
    const completion = new Promise((resolve, reject) => {
      resolveCompletion = resolve;
      rejectCompletion = reject;
    });
    const job = await this.create(type, scope, runner, { ...options, autoStart: false });
    this.waiters ||= new Map();
    this.waiters.set(job.id, { resolve: resolveCompletion, reject: rejectCompletion });
    void this.pump();
    try {
      return await completion;
    } finally {
      this.waiters.delete(job.id);
    }
  }
  async executePersistent(type, scope, payload = null, options = {}) {
    let resolveCompletion;
    let rejectCompletion;
    const completion = new Promise((resolve, reject) => {
      resolveCompletion = resolve;
      rejectCompletion = reject;
    });
    const job = await this.create(type, scope, null, {
      ...options,
      autoStart: false,
      payload: this.serializablePayload(payload),
      recoverable: true,
    });
    this.waiters ||= new Map();
    this.waiters.set(job.id, { resolve: resolveCompletion, reject: rejectCompletion });
    void this.pump();
    try {
      return await completion;
    } finally {
      this.waiters.delete(job.id);
    }
  }
  find(id) {
    return this.jobs.find((job) => job.id === id);
  }
  async pause(id) {
    const job = this.find(id);
    if (!job || job.cancellable === false || !['queued', 'running'].includes(job.state))
      return false;
    this.controllers.get(id)?.abort(new Error('Paused'));
    job.state = 'paused';
    job.message = 'Paused';
    job.updatedAt = new Date().toISOString();
    await this.persist();
    return true;
  }
  async resume(id) {
    const job = this.find(id);
    if (!job || job.state !== 'paused' || !this.runners.has(id)) return false;
    job.state = 'queued';
    job.message = 'Waiting';
    job.updatedAt = new Date().toISOString();
    await this.persist();
    void this.pump();
    return true;
  }
  async cancel(id) {
    const job = this.find(id);
    if (
      !job ||
      job.cancellable === false ||
      ['succeeded', 'failed', 'cancelled'].includes(job.state)
    )
      return false;
    this.controllers.get(id)?.abort(new Error('Cancelled'));
    job.state = 'cancelled';
    job.message = 'Cancelled';
    job.updatedAt = new Date().toISOString();
    this.waiters?.get(id)?.reject(new Error('Cancelled'));
    await this.persist();
    return true;
  }
  async retry(id) {
    const job = this.find(id);
    if (!job || job.state !== 'failed' || !job.retryable || !this.runners.has(id)) return false;
    job.state = 'queued';
    job.message = 'Waiting';
    job.error = undefined;
    job.completed = 0;
    job.total = 0;
    job.updatedAt = new Date().toISOString();
    await this.persist();
    void this.pump();
    return true;
  }
  async pump() {
    const running = this.jobs.filter((job) => job.state === 'running').length;
    if (running >= this.concurrency) return;
    const job = this.jobs.find(
      (candidate) =>
        candidate.state === 'queued' &&
        !this.activeScopes.has(candidate.scope) &&
        this.runners.has(candidate.id),
    );
    if (!job) return;
    job.state = 'running';
    job.message = 'Starting';
    job.updatedAt = new Date().toISOString();
    const controller = new AbortController();
    this.controllers.set(job.id, controller);
    this.activeScopes.add(job.scope);
    await this.persist();
    const progress = async (completed, total, message = job.message) => {
      if (job.state !== 'running') return;
      job.completed = Math.max(0, Number(completed) || 0);
      job.total = Math.max(0, Number(total) || 0);
      job.message = String(message || '').slice(0, 300);
      job.updatedAt = new Date().toISOString();
      await this.persist();
    };
    let result;
    let runError;
    try {
      result = await this.runners.get(job.id)({ signal: controller.signal, progress });
      if (job.state === 'running') {
        job.state = 'succeeded';
        job.message = 'Complete';
        job.result = result;
      }
    } catch (error) {
      runError = error;
      if (job.state === 'running') {
        job.state = controller.signal.aborted ? 'paused' : 'failed';
        job.message = controller.signal.aborted ? 'Paused' : 'Failed';
        job.error = String(error.message || error).slice(0, 500);
      }
    } finally {
      job.updatedAt = new Date().toISOString();
      this.controllers.delete(job.id);
      this.activeScopes.delete(job.scope);
      await this.persist();
      const waiter = this.waiters?.get(job.id);
      if (waiter && job.state === 'succeeded') waiter.resolve(result);
      else if (waiter && job.state === 'failed') waiter.reject(runError || new Error(job.error));
      else if (waiter && job.state === 'paused') waiter.reject(runError || new Error('Paused'));
      void this.pump();
    }
    void this.pump();
  }
}

module.exports = JobService;
