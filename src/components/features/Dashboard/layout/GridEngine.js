/**
 * @module Dashboard/layout/GridEngine
 * @summary Pure geometry helpers for the 12-col dashboard grid (v3 plan §4.2).
 *
 * No DOM mutation here — the engine only *measures* and *computes*. The
 * caller (Dashboard.js) owns the cells; this module gives it the math.
 *
 * Responsibilities:
 *   - 12-col layout constants
 *   - cell width / cell height from a grid rect
 *   - snap-to-grid rounding (1 col / 1 row increments; no half-cells)
 *   - clamp to legal bounds
 *   - bounding-rect hit test for "which cell is the cursor inside?"
 *
 * All functions are pure: same input → same output, no side effects.
 *
 * @example
 *   const geo = new GridGeometry(gridEl);
 *   const w = geo.cellWidth();              // px per column
 *   const cols = geo.colsAt(clientX);       // 1..12 from x
 *   const rect = geo.snap(cols, rows);      // clamped {cols,rows}
 */

export const NUM_COLS = 12;
export const MAX_ROWS = 8;
export const DEFAULT_GAP = 14;

/**
 * @typedef {Object} GridMetrics
 * @property {number} cellW     px per column (gap subtracted)
 * @property {number} rowH      px per row (gap subtracted)
 * @property {number} gap       px between cells
 * @property {number} cols      NUM_COLS
 * @property {number} maxRows   MAX_ROWS
 * @property {DOMRect} rect     grid element bounding rect at measurement time
 */

/**
 * @typedef {Object} SnapResult
 * @property {number} cols  columns, clamped to [1, NUM_COLS]
 * @property {number} rows  rows, clamped to [1, MAX_ROWS]
 */

export class GridGeometry {
  /**
   * @param {HTMLElement} gridEl the `.grid` element (12-col, gap=var(--km-grid-gap))
   * @param {{gap?: number, maxRows?: number}} [opts]
   */
  constructor(gridEl, opts = {}) {
    this.gridEl   = gridEl;
    this.gap      = opts.gap      ?? DEFAULT_GAP;
    this.maxRows  = opts.maxRows  ?? MAX_ROWS;
  }

  /**
   * Re-measure the grid. Returns a snapshot of current geometry.
   * The grid must be laid out (not display:none) for a meaningful result.
   * @returns {GridMetrics}
   */
  measure() {
    const rect = this.gridEl.getBoundingClientRect();
    const cols = NUM_COLS;
    const cellW = (rect.width - (cols - 1) * this.gap) / cols;
    const rowH  = this._measureRowHeight();
    return { cellW, rowH, gap: this.gap, cols, maxRows: this.maxRows, rect };
  }

  /**
   * Row height: read a real cell if the grid is populated, otherwise
   * fall back to the CSS-declared `minmax` min (220px from Dashboard.js).
   * @returns {number}
   */
  _measureRowHeight() {
    const firstCell = this.gridEl.querySelector('.wgt-cell');
    if (firstCell) {
      const span = parseInt(firstCell.style.gridRow?.match(/span (\d+)/)?.[1] ?? '1', 10);
      return firstCell.getBoundingClientRect().height / Math.max(1, span);
    }
    return 220;
  }

  /**
   * Round a raw delta (px) to the nearest column index.
   * Negative deltas round toward zero (shrinking is allowed).
   * @param {number} dxPx
   * @param {number} startCols
   * @param {GridMetrics} m
   * @returns {number} integer column count, clamped to [1, NUM_COLS]
   */
  colsFromDelta(dxPx, startCols, m) {
    const step   = m.cellW + m.gap;
    const target = Math.round(startCols + dxPx / step);
    return this._clampCols(target);
  }

  /**
   * Round a raw delta (px) to the nearest row index.
   * @param {number} dyPx
   * @param {number} startRows
   * @param {GridMetrics} m
   * @returns {number} integer row count, clamped to [1, maxRows]
   */
  rowsFromDelta(dyPx, startRows, m) {
    const step   = m.rowH + m.gap;
    const target = Math.round(startRows + dyPx / step);
    return this._clampRows(target);
  }

  /**
   * Clamp a candidate size to the legal grid range.
   * @param {number} cols
   * @param {number} rows
   * @returns {SnapResult}
   */
  snap(cols, rows) {
    return { cols: this._clampCols(cols), rows: this._clampRows(rows) };
  }

  _clampCols(n) {
    if (!Number.isFinite(n)) return 1;
    return Math.max(1, Math.min(NUM_COLS, Math.round(n)));
  }

  _clampRows(n) {
    if (!Number.isFinite(n)) return 1;
    return Math.max(1, Math.min(this.maxRows, Math.round(n)));
  }

  /**
   * Hit-test a list of cells against a viewport-space point.
   * Returns the matching cell, or null.
   * @param {Iterable<HTMLElement>} cells
   * @param {number} x viewport x (e.clientX)
   * @param {number} y viewport y (e.clientY)
   * @param {(cell: HTMLElement) => boolean} [skip] optional predicate
   * @returns {HTMLElement|null}
   */
  hitTest(cells, x, y, skip) {
    for (const c of cells) {
      if (skip?.(c)) continue;
      const r = c.getBoundingClientRect();
      if (x >= r.left && x <= r.right && y >= r.top && y <= r.bottom) {
        return c;
      }
    }
    return null;
  }
}

/**
 * Format a size badge "w × h" — small enough to fit next to a cursor.
 * @param {number} cols
 * @param {number} rows
 * @returns {string}
 */
export function formatSize(cols, rows) {
  return `${cols} × ${rows}`;
}
