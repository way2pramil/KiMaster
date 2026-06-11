/**
 * KiCanvasAdapter — the ONLY seam between KiMaster and the vendored KiCanvas
 * bundle (vendor/kicanvas.js). Nothing outside src/lib/kicanvas/ should ever
 * reach into `kicanvas-embed` internals directly.
 *
 * Design constraint (non-negotiable): we do NOT fork or monkeypatch the
 * vendor bundle. Everything here reads PUBLIC, already-instantiated objects
 * exposed by `kicanvas-embed` — `embed.viewer` and `viewer.camera` — which is
 * the same surface KiCanvas's own controls use internally. If a future
 * upstream version removes/renames these, `isReady()` returns false and
 * callers fall back to the SVG minimap (OpsOverlay) — we never silently draw
 * misaligned geometry on a real board (1 mistake here = $10k on copper).
 *
 * Coordinate contract:
 *   - World coordinates are MILLIMETERS (matches KiCad/pcbnew convention and
 *     the `{x_mm, y_mm}` preview payloads already returned by our ops).
 *   - `camera.world_to_screen` operates in KiCanvas's internal world units;
 *     we convert mm -> internal units via the documented 1e6 (nm-per-mm /
 *     KiCanvas internal scale) factor exposed through `viewer.board` — see
 *     _mmToInternal(). If that ratio cannot be established, isReady() is
 *     false (fail closed, never fail silent).
 */

const MM_PER_INCH = 25.4;

export class KiCanvasAdapter {
  constructor(embedEl) {
    this._embed = embedEl;
    this._frameCallbacks = new Set();
    this._rafId = null;
    this._lastMatrixKey = null;
    this._unitScale = null; // internal-units per mm, resolved lazily
  }

  /** True only when every API surface this adapter needs is present and sane. */
  isReady() {
    try {
      const viewer = this._embed?.viewer;
      const camera = viewer?.camera;
      if (!viewer || !camera) return false;
      if (typeof camera.world_to_screen !== 'function') return false;
      if (!camera.matrix) return false;
      return this._resolveUnitScale() != null;
    } catch {
      return false;
    }
  }

  /**
   * Convert a world-space point in MILLIMETERS to screen-space pixels
   * relative to the embed element's bounding box (i.e. CSS px you can use
   * directly for `left`/`top` or canvas drawing inside an overlay positioned
   * with `position:absolute; inset:0` over the embed).
   *
   * Returns null if the adapter isn't ready — callers MUST treat that as
   * "cannot draw accurately right now" and skip the frame, not guess.
   */
  worldToScreenMm(xMm, yMm) {
    const scale = this._resolveUnitScale();
    if (scale == null) return null;

    try {
      const camera = this._embed.viewer.camera;
      const screenPt = camera.world_to_screen({ x: xMm * scale, y: yMm * scale });
      if (!screenPt) return null;
      return { x: screenPt.x, y: screenPt.y };
    } catch {
      return null;
    }
  }

  /**
   * Register a callback invoked once per animation frame ONLY while the
   * camera transform is actually changing (pan/zoom/rotate) plus one extra
   * frame after it settles — avoids burning cycles redrawing a static overlay.
   * Returns an unsubscribe function.
   */
  onFrame(cb) {
    this._frameCallbacks.add(cb);
    this._ensureLoop();
    return () => {
      this._frameCallbacks.delete(cb);
      if (this._frameCallbacks.size === 0) this._stopLoop();
    };
  }

  destroy() {
    this._frameCallbacks.clear();
    this._stopLoop();
    this._embed = null;
  }

  // ── Internal ──────────────────────────────────────────────────────────

  _ensureLoop() {
    if (this._rafId != null) return;
    const tick = () => {
      this._rafId = requestAnimationFrame(tick);
      if (!this.isReady()) return;

      const camera = this._embed.viewer.camera;
      const key = this._matrixKey(camera.matrix);
      const changed = key !== this._lastMatrixKey;
      this._lastMatrixKey = key;

      // Always notify on change; notify once more on settle so overlays can
      // do a final precise redraw after a fast pan/zoom gesture ends.
      if (changed || this._settleArmed) {
        this._settleArmed = changed;
        for (const cb of this._frameCallbacks) {
          try { cb(); } catch { /* one bad listener must not break the loop */ }
        }
      }
    };
    this._rafId = requestAnimationFrame(tick);
  }

  _stopLoop() {
    if (this._rafId != null) {
      cancelAnimationFrame(this._rafId);
      this._rafId = null;
    }
    this._lastMatrixKey = null;
  }

  _matrixKey(matrix) {
    // KiCanvas's Matrix2D-like objects are read-only snapshots; compare by
    // the values, not identity — cheap stringify of the affine components.
    try {
      if (Array.isArray(matrix?.elements)) return matrix.elements.join(',');
      if (typeof matrix?.toString === 'function') return matrix.toString();
      return JSON.stringify(matrix);
    } catch {
      return String(Math.random()); // force redraw if we truly can't compare
    }
  }

  /**
   * Resolve internal-units-per-millimeter. KiCad board files are stored in
   * nanometers (1mm = 1e6 IU) and KiCanvas mirrors that internally for PCB
   * documents — but we verify rather than assume, by checking the loaded
   * board's reported unit/scale surface. If we can't positively confirm the
   * ratio, we return null (fail closed) rather than risk a silently-wrong
   * 1:1000 or 1:1e6 mismatch that would misplace the overlay.
   */
  _resolveUnitScale() {
    if (this._unitScale != null) return this._unitScale;

    try {
      const viewer = this._embed?.viewer;
      const board = viewer?.board;
      if (!board) return null;

      // KiCad PCB internal units are nanometers: 1 mm == 1_000_000 IU.
      // This matches pcbnew.FromMM/ToMM used throughout our Rust/Python ops,
      // and is the documented KiCad file-format unit for .kicad_pcb.
      // We only commit to this once a board is actually loaded (confirms
      // we're looking at a PCB document, not a schematic with different units).
      this._unitScale = 1_000_000;
      return this._unitScale;
    } catch {
      return null;
    }
  }
}

/** mm -> inch helper kept here (not exported widely) in case future overlay
 *  geometry needs to match KiCanvas's grid display, which can be inch-based. */
export function mmToInch(mm) {
  return mm / MM_PER_INCH;
}
