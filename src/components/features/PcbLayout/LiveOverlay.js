/**
 * @element km-live-overlay
 * @summary Canvas overlay drawn IN SYNC with the live KiCanvas PCB viewport —
 *          renders board-tool preview geometry (via points, panel outlines)
 *          at true board-relative position so users preview exactly where
 *          changes will land before pushing to KiCad.
 *
 * Precision contract: this overlay NEVER guesses. Every redraw asks
 * KiCanvasAdapter for the current world->screen transform; if the adapter
 * reports not-ready (vendor surface unavailable, board not loaded, unit
 * scale unconfirmed), the overlay draws NOTHING and emits 'km-overlay-status'
 * with { ready: false } so the host (PcbLayout) can show the OpsOverlay
 * (SVG minimap) fallback instead. A misaligned dot on a real board is a
 * $10k mistake; an empty overlay is just an inconvenience — fail closed.
 *
 * API:
 *   el.attachAdapter(adapter)         — KiCanvasAdapter instance (or null to detach)
 *   el.setPreview(kind, payload)      — kind: 'via_points' | 'panel_outline' | 'clear'
 *   el.clear()
 */

const TEMPLATE = document.createElement('template');
TEMPLATE.innerHTML = `
<style>
  :host {
    position: absolute;
    inset: 0;
    pointer-events: none;
    display: block;
  }
  canvas {
    position: absolute;
    inset: 0;
    width: 100%;
    height: 100%;
    display: block;
  }
  .status-chip {
    position: absolute;
    bottom: 10px;
    left: 10px;
    font-size: 10px;
    font-family: var(--km-font-mono, monospace);
    letter-spacing: 0.04em;
    color: var(--km-text-muted, rgba(255,255,255,0.4));
    background: var(--km-bg-elevated, rgba(20,20,20,0.7));
    border: 1px solid var(--km-border, rgba(255,255,255,0.08));
    border-radius: 10px;
    padding: 2px 9px;
    display: none;
  }
  .status-chip.show { display: inline-block; }
</style>
<canvas id="canvas"></canvas>
<span class="status-chip" id="status-chip">live preview unavailable — using minimap</span>
`;

const VIA_DOT_RADIUS_PX = 5;
const VIA_FILL          = 'rgba(37, 99, 235, 0.55)';
const VIA_STROKE        = 'rgba(37, 99, 235, 0.9)';
const PANEL_FILL        = 'rgba(37, 99, 235, 0.08)';
const PANEL_STROKE      = 'rgba(37, 99, 235, 0.85)';

export class KmLiveOverlay extends HTMLElement {
  constructor() {
    super();
    this.attachShadow({ mode: 'open' });
    this.shadowRoot.appendChild(TEMPLATE.content.cloneNode(true));

    this._canvas = this.shadowRoot.getElementById('canvas');
    this._ctx    = this._canvas.getContext('2d');
    this._chip   = this.shadowRoot.getElementById('status-chip');

    this._adapter   = null;
    this._unsub     = null;
    this._kind      = 'clear';
    this._payload   = null;
    this._ready     = false;
    this._resizeObs = new ResizeObserver(() => this._resizeCanvas());
  }

  connectedCallback() {
    this._resizeObs.observe(this);
    this._resizeCanvas();
  }

  disconnectedCallback() {
    this._resizeObs.disconnect();
    this.attachAdapter(null);
  }

  // ── Public API ────────────────────────────────────────────────────────────

  attachAdapter(adapter) {
    if (this._unsub) { this._unsub(); this._unsub = null; }
    this._adapter = adapter;
    this._setReady(false);

    if (adapter) {
      this._unsub = adapter.onFrame(() => this._redraw());
      this._redraw();
    } else {
      this._clearCanvas();
    }
  }

  setPreview(kind, payload) {
    this._kind    = kind;
    this._payload = payload;
    this._redraw();
  }

  clear() {
    this.setPreview('clear', null);
  }

  // ── Internal ──────────────────────────────────────────────────────────────

  _resizeCanvas() {
    const rect = this.getBoundingClientRect();
    const dpr  = window.devicePixelRatio || 1;
    this._canvas.width  = Math.max(1, Math.round(rect.width  * dpr));
    this._canvas.height = Math.max(1, Math.round(rect.height * dpr));
    this._ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    this._redraw();
  }

  _setReady(ready) {
    if (this._ready === ready) return;
    this._ready = ready;
    this._chip.classList.toggle('show', !ready);
    this.dispatchEvent(new CustomEvent('km-overlay-status', {
      bubbles: true,
      composed: true,
      detail: { ready },
    }));
  }

  _clearCanvas() {
    const { width, height } = this._canvas;
    this._ctx.clearRect(0, 0, width, height);
  }

  _redraw() {
    this._clearCanvas();

    if (this._kind === 'clear' || !this._payload) return;
    if (!this._adapter || !this._adapter.isReady()) {
      this._setReady(false);
      return; // fail closed — never draw without a confirmed live transform
    }
    this._setReady(true);

    if (this._kind === 'via_points') {
      this._drawViaPoints(this._payload);
    } else if (this._kind === 'panel_outline') {
      this._drawPanelOutline(this._payload);
    }
  }

  _drawViaPoints(points) {
    const ctx = this._ctx;
    ctx.save();
    ctx.lineWidth = 1.5;

    for (const pt of points) {
      const screen = this._adapter.worldToScreenMm(pt.x_mm, pt.y_mm);
      if (!screen) continue; // point fell outside a confirmable transform — skip, don't guess

      ctx.beginPath();
      ctx.arc(screen.x, screen.y, VIA_DOT_RADIUS_PX, 0, Math.PI * 2);
      ctx.fillStyle = VIA_FILL;
      ctx.fill();
      ctx.strokeStyle = VIA_STROKE;
      ctx.stroke();
    }
    ctx.restore();
  }

  _drawPanelOutline(outline) {
    if (!outline || outline.length < 3) return;
    const ctx = this._ctx;

    const screenPts = [];
    for (const pt of outline) {
      const screen = this._adapter.worldToScreenMm(pt.x_mm, pt.y_mm);
      if (!screen) {
        // Partial transform confidence — abort the whole polygon rather than
        // draw a geometrically-wrong shape.
        return;
      }
      screenPts.push(screen);
    }

    ctx.save();
    ctx.beginPath();
    ctx.moveTo(screenPts[0].x, screenPts[0].y);
    for (let i = 1; i < screenPts.length; i++) ctx.lineTo(screenPts[i].x, screenPts[i].y);
    ctx.closePath();
    ctx.fillStyle = PANEL_FILL;
    ctx.fill();
    ctx.strokeStyle = PANEL_STROKE;
    ctx.lineWidth = 2;
    ctx.setLineDash([6, 4]);
    ctx.stroke();
    ctx.restore();
  }
}

customElements.define('km-live-overlay', KmLiveOverlay);
