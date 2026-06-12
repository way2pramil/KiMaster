/**
 * @module Dashboard/layout/DragController
 * @summary Mousedown-based drag-reorder for grid cells (v3 plan §4.2).
 *
 * No HTML5 DnD — Shadow DOM + Tauri WebView have spotty DnD support.
 * Pointer events give us consistent behavior across desktop + touch.
 *
 * What this does:
 *   - On pointerdown anywhere on the cell (excluding inner handles/buttons
 *     the caller marks with `data-no-drag`), capture pointer + offset
 *   - On pointermove, position a floating "ghost" card under the cursor
 *     and highlight the cell currently under the ghost's centre
 *   - On pointerup, call `onDrop({ sourceId, targetId })`. The caller
 *     decides what to do (reorder, move-to-empty-slot, etc.)
 *
 * The ghost is a clone-styled placeholder (dashed border, blurred fill).
 * We use FLIP-ish behaviour: the source cell dims to 0.3 opacity so the
 * user can clearly see the destination. The actual layout mutation
 * happens in the caller's commit handler.
 *
 * @example
 *   attachDrag(cellEl, {
 *     id: entry.id,
 *     geometry,
 *     getCells: () => [...grid.querySelectorAll('.wgt-cell')],
 *     onDrop: ({ sourceId, targetId }) => { … },
 *   });
 */

import { GridGeometry } from './GridEngine.js';

/**
 * @typedef {Object} DragOptions
 * @property {string} id
 * @property {GridGeometry} geometry
 * @property {() => HTMLElement[]} getCells
 *   function (not array) so the controller picks up cells added/removed
 *   during the gesture
 * @property {HTMLElement} sourceEl   the cell being dragged
 * @property {(targetId: string|null) => void} [onTargetChange]
 * @property {(p: {sourceId: string, targetId: string|null}) => void} [onDrop]
 * @property {(e: PointerEvent) => boolean} [shouldStart]
 *   return false to veto the gesture (e.g. when not in edit mode)
 * @property {string} [noDragSelector='.resize-e, .resize-s, .resize-se, .cell-rm, button']
 *   elements matching this selector (relative to the cell) won't start a drag
 */

/**
 * @typedef {Object} DragController
 * @property {boolean} active  true while a gesture is in progress
 * @property {() => void} dispose
 */

export function attachDrag(sourceEl, opts) {
  const noDragSelector = opts.noDragSelector ?? '.resize-e, .resize-s, .resize-se, .cell-rm, button';

  let gesture = null;

  const onPointerDown = (e) => {
    if (e.button !== 0 && e.pointerType === 'mouse') return;
    if (opts.shouldStart && !opts.shouldStart(e)) return;
    if (e.target.closest(noDragSelector)) return;
    e.preventDefault();
    e.stopPropagation();

    const rect = sourceEl.getBoundingClientRect();
    const offsetX = e.clientX - rect.left;
    const offsetY = e.clientY - rect.top;

    const ghost = _createGhost(rect);
    document.body.appendChild(ghost);

    sourceEl.style.opacity = '0.3';
    document.body.style.cursor     = 'grabbing';
    document.body.style.userSelect = 'none';

    gesture = { e, rect, offsetX, offsetY, ghost, lastTarget: null };

    sourceEl.setPointerCapture?.(e.pointerId);
    const onMove = (ev) => _onMove(ev);
    const onUp   = (ev) => _onUp(ev);
    const onCancel = () => _onCancel();

    sourceEl.addEventListener('pointermove',   onMove);
    sourceEl.addEventListener('pointerup',     onUp);
    sourceEl.addEventListener('pointercancel', onCancel);
    // Safety net: track even if pointer leaves the source.
    document.addEventListener('pointerup', onUp);

    gesture._teardown = () => {
      sourceEl.removeEventListener('pointermove',   onMove);
      sourceEl.removeEventListener('pointerup',     onUp);
      sourceEl.removeEventListener('pointercancel', onCancel);
      document.removeEventListener('pointerup', onUp);
    };
  };

  const _onMove = (ev) => {
    if (!gesture) return;
    const { offsetX, offsetY, rect, ghost } = gesture;
    const left = ev.clientX - offsetX;
    const top  = ev.clientY - offsetY;
    ghost.style.left = left + 'px';
    ghost.style.top  = top  + 'px';

    const cx = left + rect.width  / 2;
    const cy = top  + rect.height / 2;

    const cells = opts.getCells();
    const found = opts.geometry.hitTest(cells, cx, cy, (c) => c.dataset.id === opts.id);
    const newTarget = found?.dataset.id ?? null;

    if (newTarget !== gesture.lastTarget) {
      cells.forEach(c => c.classList.toggle('drag-over', c === found && !!found));
      gesture.lastTarget = newTarget;
      opts.onTargetChange?.(newTarget);
    }
  };

  const _onUp = () => {
    if (!gesture) return;
    const { lastTarget, ghost } = gesture;
    _cleanup();
    opts.onDrop?.({ sourceId: opts.id, targetId: lastTarget });
  };

  const _onCancel = () => {
    if (!gesture) return;
    _cleanup();
    opts.onDrop?.({ sourceId: opts.id, targetId: null });
  };

  const _cleanup = () => {
    if (!gesture) return;
    gesture._teardown?.();
    gesture.ghost.remove();
    sourceEl.style.opacity = '';
    document.body.style.cursor     = '';
    document.body.style.userSelect = '';
    gesture = null;
  };

  sourceEl.addEventListener('pointerdown', onPointerDown);

  return {
    get active() { return gesture !== null; },
    dispose() {
      sourceEl.removeEventListener('pointerdown', onPointerDown);
      _cleanup();
    },
  };
}

function _createGhost(rect) {
  const g = document.createElement('div');
  g.style.cssText = `
    position:fixed; pointer-events:none; z-index:9998;
    left:${rect.left}px; top:${rect.top}px;
    width:${rect.width}px; height:${rect.height}px;
    border-radius:18px;
    border:2px dashed rgba(37,99,235,0.65);
    background:rgba(37,99,235,0.07);
    backdrop-filter:blur(6px);
    box-shadow:0 12px 40px rgba(37,99,235,0.22);
    transition:none;
  `;
  return g;
}
