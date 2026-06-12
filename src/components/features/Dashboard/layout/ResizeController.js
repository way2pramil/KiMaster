/**
 * @module Dashboard/layout/ResizeController
 * @summary Pointer-event resize handles for the 12-col grid (v3 plan §4.2).
 *
 * Three handle variants:
 *   - 'e'  — right edge; resizes width (cols) only
 *   - 's'  — bottom edge; resizes height (rows) only
 *   - 'se' — SE corner; resizes both
 *
 * Lifecycle (caller's responsibility):
 *   const ctl = attachResize(handleEl, cellEl, entry, { dir, geometry });
 *   …  // on `entry.w`/`entry.h` mutation, the caller also updates cellEl style
 *   ctl.dispose();   // removes the document listeners + badge DOM
 *
 * The controller:
 *   - listens to pointerdown on the handle
 *   - on first move, creates a floating size badge near the cursor
 *   - on every move, calls `onDelta({ cols, rows, dx, dy })` so the caller
 *     can update `entry`, the cell's `gridColumn`/`gridRow`, and the badge
 *   - on pointerup, calls `onCommit({ cols, rows })` once and cleans up
 *
 * Why this lives outside Dashboard.js:
 *   - pure pointer math; no dependency on WIDGETS, LayoutStore, or the shadow root
 *   - testable in isolation (mock `entry` + `cellEl`)
 *   - keeps Dashboard.js focused on composition
 */

import { GridGeometry, formatSize, NUM_COLS, MAX_ROWS } from './GridEngine.js';

/**
 * @typedef {'e' | 's' | 'se'} ResizeDir
 *
 * @typedef {Object} ResizeOptions
 * @property {ResizeDir} dir
 * @property {GridGeometry} geometry
 * @property {HTMLElement} cellEl      the .wgt-cell being resized
 * @property {{w:number,h:number}} entry   the live layout entry (mutated on move)
 * @property {(s: {cols:number, rows:number}) => void} onDelta
 *   called on every mousemove with the snapped, clamped size
 * @property {(s: {cols:number, rows:number}) => void} [onCommit]
 *   called once on mouseup, after the last delta
 * @property {() => void} [onCancel]  called if the gesture is aborted (blur/visibility)
 *
 * @typedef {Object} ResizeController
 * @property {() => void} dispose
 */

const CURSOR_BY_DIR = { e: 'ew-resize', s: 'ns-resize', se: 'nwse-resize' };

/**
 * Attach a resize gesture to `handleEl`. Pointer-down begins the gesture.
 * The returned controller's `dispose()` removes document listeners and the
 * floating badge (call on unmount).
 * @param {HTMLElement} handleEl
 * @param {ResizeOptions} opts
 * @returns {ResizeController}
 */
export function attachResize(handleEl, opts) {
  const { dir, geometry, cellEl, entry, onDelta, onCommit, onCancel } = opts;

  let active = null; // gesture state, or null when idle

  const onPointerDown = (e) => {
    if (e.button !== 0 && e.pointerType === 'mouse') return; // left mouse only
    e.stopPropagation();
    e.preventDefault();
    handleEl.setPointerCapture?.(e.pointerId);

    const m = geometry.measure();
    const startCols = entry.w;
    const startRows = entry.h;

    const badge = _createBadge();
    document.body.appendChild(badge);
    badge.textContent = formatSize(startCols, startRows);

    const overlay = cellEl.querySelector('.edit-overlay');
    overlay?.classList.add('resizing');

    document.body.style.cursor     = CURSOR_BY_DIR[dir] ?? 'default';
    document.body.style.userSelect = 'none';

    active = { e, m, startCols, startRows, badge, overlay, pointerId: e.pointerId };

    const onMove = (ev) => _onMove(ev);
    const onUp   = (ev) => _onUp(ev);
    const onCancelEvt = () => _onCancel();

    handleEl.addEventListener('pointermove', onMove);
    handleEl.addEventListener('pointerup',   onUp);
    handleEl.addEventListener('pointercancel', onCancelEvt);
    // also listen on the document so we keep tracking if pointer leaves the handle
    document.addEventListener('pointerup',   onUp);

    active._teardown = () => {
      handleEl.removeEventListener('pointermove', onMove);
      handleEl.removeEventListener('pointerup',   onUp);
      handleEl.removeEventListener('pointercancel', onCancelEvt);
      document.removeEventListener('pointerup', onUp);
    };
  };

  const _onMove = (ev) => {
    if (!active) return;
    const { e: startEv, m, startCols, startRows, badge } = active;
    const dx = ev.clientX - startEv.clientX;
    const dy = ev.clientY - startEv.clientY;

    let cols = startCols, rows = startRows;
    if (dir === 'e' || dir === 'se') cols = geometry.colsFromDelta(dx, startCols, m);
    if (dir === 's' || dir === 'se') rows = geometry.rowsFromDelta(dy, startRows, m);

    onDelta?.({ cols, rows });
    badge.textContent = formatSize(cols, rows);
    badge.style.left  = (ev.clientX + 14) + 'px';
    badge.style.top   = (ev.clientY - 12) + 'px';
  };

  const _onUp = (ev) => {
    if (!active) return;
    const finalCols = entry.w, finalRows = entry.h;
    _cleanup();
    onCommit?.({ cols: finalCols, rows: finalRows });
  };

  const _onCancel = () => {
    if (!active) return;
    _cleanup();
    onCancel?.();
  };

  const _cleanup = () => {
    if (!active) return;
    active._teardown?.();
    active.badge.remove();
    active.overlay?.classList.remove('resizing');
    document.body.style.cursor     = '';
    document.body.style.userSelect = '';
    active = null;
  };

  handleEl.addEventListener('pointerdown', onPointerDown);

  return {
    dispose() {
      handleEl.removeEventListener('pointerdown', onPointerDown);
      _cleanup();
    },
  };
}

// ── internals ───────────────────────────────────────────────────────────────

function _createBadge() {
  const b = document.createElement('div');
  b.style.cssText = `
    position:fixed; z-index:9999; pointer-events:none;
    background:var(--km-shadow-backdrop); backdrop-filter:blur(8px);
    border:1px solid rgba(37,99,235,0.5); border-radius:6px;
    padding:4px 9px; font-size:11px; font-weight:600;
    color:var(--km-accent-hover); font-family:var(--km-font);
    font-variant-numeric:tabular-nums; white-space:nowrap;
  `;
  return b;
}
