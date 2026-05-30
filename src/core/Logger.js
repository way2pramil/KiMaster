/**
 * Logger — centralized error handler and structured logger.
 *
 * Rules (Rule 3):
 *  - No silent catch blocks anywhere. All errors flow through here.
 *  - Preserves human-override sovereignty: errors are always surfaced,
 *    never swallowed.
 *  - Future: pipe to Tauri `cmd_log_error`, Sentry, or in-app error panel.
 *
 * Usage:
 *   import { Logger } from './Logger.js';
 *   Logger.info('Boot', 'App started');
 *   Logger.error('Bridge', err, 'during connect');
 *
 * @module Logger
 */

const _isDev = () => !!(window.__TAURI_INTERNALS__ === undefined && import.meta.env?.DEV);

/** @param {'info'|'warn'|'error'|'debug'} level */
function _emit(level, tag, message, extra) {
  const prefix = `[${tag}]`;
  const ts = new Date().toISOString().slice(11, 23); // HH:MM:SS.mmm
  const line = `${ts} ${prefix} ${message}`;

  switch (level) {
    case 'debug': console.debug(line, extra ?? ''); break;
    case 'info':  console.info(line,  extra ?? ''); break;
    case 'warn':  console.warn(line,  extra ?? ''); break;
    case 'error': console.error(line, extra ?? ''); break;
  }

  // Future hook: send to backend telemetry or in-app error panel.
  // if (level === 'error') sendToBackend({ tag, message, extra });
}

export const Logger = {
  /**
   * Informational message.
   * @param {string} tag  Module name, e.g. 'Boot'
   * @param {string} msg
   * @param {*} [extra]
   */
  info(tag, msg, extra)  { _emit('info',  tag, msg, extra); },

  /**
   * Non-fatal warning — something unexpected but recoverable.
   * @param {string} tag
   * @param {string} msg
   * @param {*} [extra]
   */
  warn(tag, msg, extra)  { _emit('warn',  tag, msg, extra); },

  /**
   * Fatal or near-fatal error — NEVER silenced.
   * @param {string} tag
   * @param {Error|string} err
   * @param {string} [context]  Human-readable description of what was attempted.
   */
  error(tag, err, context = '') {
    const msg = context ? `${context}: ${err?.message ?? err}` : String(err?.message ?? err);
    _emit('error', tag, msg, err?.stack ?? err);
  },

  /**
   * Debug-only — stripped in production builds if tree-shaken.
   * @param {string} tag
   * @param {string} msg
   * @param {*} [extra]
   */
  debug(tag, msg, extra) { _emit('debug', tag, msg, extra); },
};
