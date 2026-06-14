/**
 * @module Dashboard/widget-sdk/states
 * @summary Helpers for the 4 widget shell states: empty / loading / ok / error.
 *
 * Centralises the logic that used to live inline in `defineWidget._runLoad`:
 *   - hasContent()  — does the merged state have any visible data?
 *   - computeState() — given (cfg, state, lastError), which shell state wins?
 *   - messagesFor()  — what message + action does each state want to show?
 *
 * Widget authors can use these to build their own shells; defineWidget()
 * uses them internally.
 *
 * @typedef {'empty'|'loading'|'ok'|'error'} WidgetState
 */

/** True if `state` has any non-internal, non-empty value worth showing. */
export function hasContent(state) {
  if (!state || typeof state !== 'object') return false;
  for (const k of Object.keys(state)) {
    if (k.startsWith('__')) continue;
    const v = state[k];
    if (v == null) continue;
    if (Array.isArray(v)      && v.length === 0)            continue;
    if (typeof v === 'object' && Object.keys(v).length === 0) continue;
    return true;
  }
  return false;
}

/**
 * Pick the shell state for a widget, in priority order:
 *   error > loading > empty > ok
 * `cfg.isEmpty` lets widgets override the default emptiness heuristic.
 *
 * @param {{ isEmpty?: (state:any) => boolean }} cfg
 * @param {object} state
 * @param {boolean} loading
 * @param {Error|null} lastError
 * @returns {WidgetState}
 */
export function computeState(cfg, state, loading, lastError) {
  if (lastError)                   return 'error';
  if (loading)                     return 'loading';
  const empty = cfg.isEmpty
    ? cfg.isEmpty(state)
    : !hasContent(state);
  return empty ? 'empty' : 'ok';
}

/** Default messages per state. Callers can override via cfg.*Message. */
export function messagesFor(state, cfg, lastError) {
  switch (state) {
    case 'loading':
      return { message: cfg.loadingMessage ?? 'Loading…' };
    case 'empty':
      return { message: cfg.emptyMessage   ?? 'Nothing to show yet' };
    case 'error':
      return {
        message: cfg.errorMessage ?? lastError?.message ?? 'Could not load widget',
        action:  { label: 'Retry', onClick: cfg.onRetry ?? null },
      };
    case 'ok':
    default:
      return { message: '' };
  }
}
