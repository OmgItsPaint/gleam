/**
 * Persistent fingerprint-bound server administration roles and bounded audit history.
 * This service contains no Electron or networking code so every authorization decision is
 * deterministic and testable before an operation reaches the server engine.
 */
const fs = require('fs');
const fsp = fs.promises;
const path = require('path');
const crypto = require('crypto');

const FINGERPRINT = /^[a-f0-9]{64}$/;
const ROLES = new Set(['owner', 'admin', 'moderator', 'viewer']);
const PERMISSIONS = Object.freeze({
  owner: ['*'],
  admin: [
    'dashboard.read',
    'players.read',
    'players.manage',
    'console.read',
    'console.write',
    'settings.read',
    'settings.write',
    'backups.read',
    'backups.write',
    'mods.read',
    'mods.write',
    'automation.read',
    'automation.write',
    'diagnostics.read',
    'lifecycle.restart',
    'lifecycle.stop',
  ],
  moderator: [
    'dashboard.read',
    'players.read',
    'players.manage',
    'console.read',
    'announcements.write',
    'diagnostics.read',
  ],
  viewer: ['dashboard.read', 'players.read', 'diagnostics.read'],
});

class ServerAdminService {
  constructor(serverRoot) {
    this.root = serverRoot;
  }

  roleFile(id) {
    return path.join(this.root, id, 'swirl-admin-roles.json');
  }

  auditFile(id) {
    return path.join(this.root, id, 'logs', 'swirl-admin-audit.jsonl');
  }

  async atomicWrite(file, value) {
    await fsp.mkdir(path.dirname(file), { recursive: true });
    const temporary = `${file}.${process.pid}.${crypto.randomBytes(4).toString('hex')}.tmp`;
    await fsp.writeFile(temporary, value, { encoding: 'utf8', flag: 'wx' });
    await fsp.rename(temporary, file);
  }

  normalizeFingerprint(value) {
    const fingerprint = String(value || '').toLowerCase();
    if (!FINGERPRINT.test(fingerprint)) throw new Error('Choose a verified player identity.');
    return fingerprint;
  }

  normalizeRole(value) {
    const role = String(value || '').toLowerCase();
    if (!ROLES.has(role)) throw new Error('Choose Owner, Admin, Moderator, or Viewer.');
    return role;
  }

  async load(id, approved = [], creatorFingerprint = '') {
    try {
      const value = JSON.parse(await fsp.readFile(this.roleFile(id), 'utf8'));
      if (value?.format !== 1 || !Array.isArray(value.assignments)) throw new Error('invalid');
      const assignments = value.assignments
        .filter((item) => FINGERPRINT.test(String(item?.fingerprint || '').toLowerCase()))
        .map((item) => ({
          fingerprint: String(item.fingerprint).toLowerCase(),
          name: String(item.name || '').slice(0, 16),
          role: ROLES.has(item.role) ? item.role : 'viewer',
          assignedAt: item.assignedAt || new Date().toISOString(),
        }));
      if (assignments.filter((item) => item.role === 'owner').length !== 1)
        throw new Error('The server administrator role file has no single Owner.');
      return { ...value, format: 1, assignments };
    } catch (error) {
      if (error.code !== 'ENOENT')
        throw new Error(
          error.message.includes('single Owner')
            ? error.message
            : 'The server administrator role file is damaged. Restore a backup before managing roles.',
        );
    }
    const candidates = approved
      .filter((item) => FINGERPRINT.test(String(item?.fingerprint || '').toLowerCase()))
      .sort((a, b) =>
        String(a.approvedAt || a.requestedAt || '').localeCompare(
          String(b.approvedAt || b.requestedAt || ''),
        ),
      );
    const requested = String(creatorFingerprint || '').toLowerCase();
    const owner = candidates.find((item) => item.fingerprint === requested) || candidates[0];
    if (!owner) return { format: 1, assignments: [], migrationRequired: true };
    const now = new Date().toISOString();
    const value = {
      format: 1,
      assignments: [
        {
          fingerprint: owner.fingerprint.toLowerCase(),
          name: String(owner.name || '').slice(0, 16),
          role: 'owner',
          assignedAt: now,
        },
      ],
      migratedAt: now,
      migration: requested === owner.fingerprint ? 'creator' : 'oldest-approved',
    };
    await this.atomicWrite(this.roleFile(id), JSON.stringify(value, null, 2));
    return value;
  }

  roleFor(state, fingerprint) {
    const normalized = String(fingerprint || '').toLowerCase();
    return state.assignments.find((item) => item.fingerprint === normalized)?.role || null;
  }

  can(role, permission) {
    const allowed = PERMISSIONS[role] || [];
    return allowed.includes('*') || allowed.includes(permission);
  }

  require(state, fingerprint, permission) {
    const role = this.roleFor(state, fingerprint);
    if (!role || !this.can(role, permission))
      throw new Error('Your Swirl identity is not allowed to perform that server action.');
    return role;
  }

  async assign(id, state, actorFingerprint, target, role) {
    this.require(state, actorFingerprint, 'roles.write');
    const fingerprint = this.normalizeFingerprint(target.fingerprint);
    const requestedRole = role === 'none' ? 'none' : this.normalizeRole(role);
    const currentOwner = state.assignments.find((item) => item.role === 'owner');
    if (currentOwner?.fingerprint === fingerprint && requestedRole !== 'owner')
      throw new Error('Transfer ownership before changing the Owner role.');
    if (requestedRole === 'owner' && currentOwner?.fingerprint !== fingerprint)
      throw new Error('Use ownership transfer to choose a new Owner.');
    const assignments = state.assignments.filter((item) => item.fingerprint !== fingerprint);
    if (requestedRole !== 'none')
      assignments.push({
        fingerprint,
        name: String(target.name || '').slice(0, 16),
        role: requestedRole,
        assignedAt: new Date().toISOString(),
      });
    const next = { ...state, assignments };
    await this.atomicWrite(this.roleFile(id), JSON.stringify(next, null, 2));
    return next;
  }

  async transfer(id, state, actorFingerprint, target, confirmation, serverName) {
    this.require(state, actorFingerprint, 'roles.write');
    if (String(confirmation || '') !== String(serverName || ''))
      throw new Error('Type the server name exactly to transfer ownership.');
    const fingerprint = this.normalizeFingerprint(target.fingerprint);
    const now = new Date().toISOString();
    const assignments = state.assignments
      .filter((item) => item.fingerprint !== fingerprint)
      .map((item) => (item.role === 'owner' ? { ...item, role: 'admin', assignedAt: now } : item));
    assignments.push({
      fingerprint,
      name: String(target.name || '').slice(0, 16),
      role: 'owner',
      assignedAt: now,
    });
    const next = { ...state, assignments };
    await this.atomicWrite(this.roleFile(id), JSON.stringify(next, null, 2));
    return next;
  }

  async audit(id, entry) {
    const file = this.auditFile(id);
    await fsp.mkdir(path.dirname(file), { recursive: true });
    const clean = {
      at: new Date().toISOString(),
      fingerprint: FINGERPRINT.test(String(entry.fingerprint || '').toLowerCase())
        ? String(entry.fingerprint).toLowerCase()
        : '',
      role: ROLES.has(entry.role) ? entry.role : '',
      operation: String(entry.operation || '').slice(0, 80),
      target: String(entry.target || '').slice(0, 80),
      result: ['allowed', 'denied', 'failed'].includes(entry.result) ? entry.result : 'failed',
      detail: String(entry.detail || '')
        .replace(/[\r\n]+/g, ' ')
        .replace(/[A-Za-z]:\\[^ ]+/g, '[PATH]')
        .slice(0, 300),
    };
    await fsp.appendFile(file, `${JSON.stringify(clean)}\n`, 'utf8');
    const stat = await fsp.stat(file);
    if (stat.size > 512 * 1024) {
      const content = await fsp.readFile(file, 'utf8');
      await this.atomicWrite(file, content.slice(-384 * 1024).replace(/^[^\n]*\n?/, ''));
    }
    return clean;
  }

  async recentAudit(id, limit = 100) {
    const text = await fsp.readFile(this.auditFile(id), 'utf8').catch(() => '');
    return text
      .trim()
      .split(/\r?\n/)
      .slice(-Math.max(1, Math.min(200, Number(limit) || 100)))
      .map((line) => {
        try {
          return JSON.parse(line);
        } catch {
          return null;
        }
      })
      .filter(Boolean)
      .reverse();
  }
}

ServerAdminService.PERMISSIONS = PERMISSIONS;
module.exports = ServerAdminService;
