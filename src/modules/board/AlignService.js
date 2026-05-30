/**
 * AlignService — pure JS board alignment math.
 *
 * Rule 1: No IPC, no store, no DOM. Takes component arrays in,
 *         returns moved-position arrays out. Caller applies via BridgeClient.
 *
 * All positions are in millimetres (the same unit that pcbnew uses after
 * FromMM / ToMM conversion in the Python plugin).
 *
 * @module AlignService
 */

// ── Types ─────────────────────────────────────────────────────────────────────

/**
 * @typedef {{ ref: string, position: { x: number, y: number }, rotation?: number }} Component
 */

/**
 * @typedef {{ ref: string, x_mm: number, y_mm: number }} MoveOp
 */

// ── Alignment ─────────────────────────────────────────────────────────────────

/**
 * Align all components to the leftmost X position in the group.
 * @param {Component[]} components
 * @returns {MoveOp[]}
 */
export function alignLeft(components) {
  if (components.length < 2) return [];
  const minX = Math.min(...components.map(c => c.position.x));
  return components.map(c => ({ ref: c.ref, x_mm: minX, y_mm: c.position.y }));
}

/**
 * Align all components to the rightmost X position.
 * @param {Component[]} components
 * @returns {MoveOp[]}
 */
export function alignRight(components) {
  if (components.length < 2) return [];
  const maxX = Math.max(...components.map(c => c.position.x));
  return components.map(c => ({ ref: c.ref, x_mm: maxX, y_mm: c.position.y }));
}

/**
 * Align all components to the topmost Y position (minimum Y in board coordinates).
 * @param {Component[]} components
 * @returns {MoveOp[]}
 */
export function alignTop(components) {
  if (components.length < 2) return [];
  const minY = Math.min(...components.map(c => c.position.y));
  return components.map(c => ({ ref: c.ref, x_mm: c.position.x, y_mm: minY }));
}

/**
 * Align all components to the bottommost Y position.
 * @param {Component[]} components
 * @returns {MoveOp[]}
 */
export function alignBottom(components) {
  if (components.length < 2) return [];
  const maxY = Math.max(...components.map(c => c.position.y));
  return components.map(c => ({ ref: c.ref, x_mm: c.position.x, y_mm: maxY }));
}

/**
 * Centre all components on the horizontal axis (equal X for all).
 * @param {Component[]} components
 * @returns {MoveOp[]}
 */
export function alignCentreH(components) {
  if (components.length < 2) return [];
  const xs  = components.map(c => c.position.x);
  const mid = (Math.min(...xs) + Math.max(...xs)) / 2;
  return components.map(c => ({ ref: c.ref, x_mm: mid, y_mm: c.position.y }));
}

/**
 * Centre all components on the vertical axis (equal Y for all).
 * @param {Component[]} components
 * @returns {MoveOp[]}
 */
export function alignCentreV(components) {
  if (components.length < 2) return [];
  const ys  = components.map(c => c.position.y);
  const mid = (Math.min(...ys) + Math.max(...ys)) / 2;
  return components.map(c => ({ ref: c.ref, x_mm: c.position.x, y_mm: mid }));
}

// ── Distribution ──────────────────────────────────────────────────────────────

/**
 * Distribute components with equal horizontal spacing.
 * Keeps the leftmost and rightmost fixed; redistributes the ones between.
 * @param {Component[]} components
 * @returns {MoveOp[]}
 */
export function distributeH(components) {
  if (components.length < 3) return [];
  const sorted = [...components].sort((a, b) => a.position.x - b.position.x);
  const minX   = sorted[0].position.x;
  const maxX   = sorted[sorted.length - 1].position.x;
  const step   = (maxX - minX) / (sorted.length - 1);
  return sorted.map((c, i) => ({
    ref:   c.ref,
    x_mm:  minX + step * i,
    y_mm:  c.position.y,
  }));
}

/**
 * Distribute components with equal vertical spacing.
 * @param {Component[]} components
 * @returns {MoveOp[]}
 */
export function distributeV(components) {
  if (components.length < 3) return [];
  const sorted = [...components].sort((a, b) => a.position.y - b.position.y);
  const minY   = sorted[0].position.y;
  const maxY   = sorted[sorted.length - 1].position.y;
  const step   = (maxY - minY) / (sorted.length - 1);
  return sorted.map((c, i) => ({
    ref:   c.ref,
    x_mm:  c.position.x,
    y_mm:  minY + step * i,
  }));
}

// ── Grid snap ─────────────────────────────────────────────────────────────────

/**
 * Snap all component positions to the nearest grid point.
 * @param {Component[]} components
 * @param {number} [gridMm=0.5]  Grid spacing in millimetres.
 * @returns {MoveOp[]}
 */
export function snapToGrid(components, gridMm = 0.5) {
  if (gridMm <= 0) throw new RangeError('gridMm must be positive');
  return components.map(c => ({
    ref:  c.ref,
    x_mm: Math.round(c.position.x / gridMm) * gridMm,
    y_mm: Math.round(c.position.y / gridMm) * gridMm,
  }));
}

// ── Bounding box ──────────────────────────────────────────────────────────────

/**
 * Compute the axis-aligned bounding box of a set of components.
 * @param {Component[]} components
 * @returns {{ minX:number, minY:number, maxX:number, maxY:number, w:number, h:number }|null}
 */
export function boundingBox(components) {
  if (components.length === 0) return null;
  const xs = components.map(c => c.position.x);
  const ys = components.map(c => c.position.y);
  const minX = Math.min(...xs), maxX = Math.max(...xs);
  const minY = Math.min(...ys), maxY = Math.max(...ys);
  return { minX, minY, maxX, maxY, w: maxX - minX, h: maxY - minY };
}
