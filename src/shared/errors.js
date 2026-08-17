// @ts-check
class SwirlError extends Error {
  /** @param {string} code @param {string} message @param {unknown} [details] */
  constructor(code, message, details = undefined) {
    super(message);
    this.name = 'SwirlError';
    this.code = code;
    this.details = details;
  }
}

/** @param {unknown} error */
function normalizeError(error) {
  /** @type {Error & {code?: unknown}} */
  const value = error instanceof Error ? error : new Error(String(error || 'Unknown error'));
  return {
    code: typeof value.code === 'string' ? value.code : 'INTERNAL',
    message: String(value.message || 'Swirl could not complete that action.').slice(0, 500),
  };
}

module.exports = { SwirlError, normalizeError };
