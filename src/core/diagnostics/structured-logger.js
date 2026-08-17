const fs = require('fs');
const fsp = fs.promises;
const path = require('path');

const SECRET_KEYS =
  /(?:token|secret|password|credential|private|authorization|cookie|username|playerName|identity)/i;
const PATH_VALUE = /(?:[A-Za-z]:\\|\\\\|\/(?:Users|home)\/)[^\s"']+/gi;
const QUERY_SECRET = /([?&](?:token|key|secret|signature|password)=)[^&#\s]*/gi;

function redact(value, depth = 0) {
  if (depth > 8) return '[TRUNCATED]';
  if (typeof value === 'string')
    return value
      .replace(QUERY_SECRET, '$1[REDACTED]')
      .replace(PATH_VALUE, '[PRIVATE_PATH]')
      .slice(0, 4000);
  if (Array.isArray(value)) return value.slice(0, 100).map((item) => redact(item, depth + 1));
  if (value && typeof value === 'object') {
    const output = {};
    for (const [key, item] of Object.entries(value).slice(0, 100))
      output[key] = SECRET_KEYS.test(key) ? '[REDACTED]' : redact(item, depth + 1);
    return output;
  }
  return value;
}

class StructuredLogger {
  constructor(dataRoot) {
    this.directory = path.join(dataRoot, '.icecream_client', 'logs');
    this.file = path.join(this.directory, 'launcher.jsonl');
  }
  async write(level, event, data = {}) {
    await fsp.mkdir(this.directory, { recursive: true });
    const record = redact({ at: new Date().toISOString(), level, event, data });
    await fsp.appendFile(this.file, `${JSON.stringify(record)}\n`, 'utf8');
  }
  info(event, data) {
    return this.write('info', event, data);
  }
  warn(event, data) {
    return this.write('warn', event, data);
  }
  error(event, error) {
    return this.write('error', event, {
      message: error?.message || String(error),
      code: error?.code,
    });
  }
}

StructuredLogger.redact = redact;
module.exports = StructuredLogger;
