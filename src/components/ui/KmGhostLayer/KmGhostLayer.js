/**
 * @element km-ghost-layer
 * @summary SVG canvas — renders live board layout, selected component,
 *          and Ghost Layer preview (proposed move as dashed overlay).
 *
 * Reads: store.boardComponents, store.boardState, store.selectedRefs
 * Ghost:  set ghostComponent = { ref, x_mm, y_mm, rotation } to show
 *         a dashed preview overlay before applying a move.
 *
 * @fires km-ghost-confirm  — user clicked "Apply" on the ghost overlay
 * @fires km-ghost-cancel   — user cancelled the ghost overlay
 */

import { store, subscribe } from '../../../core/State.js';
import { Logger } from '../../../core/Logger.js';
import { boundingBox } from '../../../modules/board/AlignService.js';

const TEMPLATE = document.createElement('template');
TEMPLATE.innerHTML = `
<style>
  :host {
    display: block;
    width: 100%;
    height: 100%;
    background: var(--km-bg-surface);
    border-radius: var(--km-radius-md);
    overflow: hidden;
    position: relative;
  }

  .canvas-wrap {
    width: 100%;
    height: 100%;
    display: flex;
    align-items: center;
    justify-content: center;
    overflow: hidden;
  }

  svg {
    width: 100%;
    height: 100%;
    cursor: crosshair;
  }

  /* board outline */
  .board-outline {
    fill: #0a1628;
    stroke: rgba(16, 185, 129, 0.35);
    stroke-width: 1px;
  }

  /* component dots */
  .comp-front {
    fill: rgba(37, 99, 235, 0.55);
    stroke: rgba(37, 99, 235, 0.8);
    stroke-width: 0.5px;
    cursor: pointer;
    transition: fill 80ms ease;
  }
  .comp-front:hover { fill: rgba(37, 99, 235, 0.85); }
  .comp-back  {
    fill: rgba(6, 182, 212, 0.45);
    stroke: rgba(6, 182, 212, 0.7);
    stroke-width: 0.5px;
    cursor: pointer;
    transition: fill 80ms ease;
  }
  .comp-back:hover { fill: rgba(6, 182, 212, 0.75); }

  /* selected */
  .comp-selected {
    fill: rgba(255, 255, 255, 0.15);
    stroke: var(--km-text-primary);
    stroke-width: 1px;
  }

  /* ghost overlay (proposed position) */
  .comp-ghost {
    fill: rgba(37, 99, 235, 0.12);
    stroke: var(--km-accent);
    stroke-width: 1.2px;
    stroke-dasharray: 4 3;
    pointer-events: none;
    animation: ghost-pulse 1.4s ease-in-out infinite;
  }
  @keyframes ghost-pulse {
    0%, 100% { opacity: 1; }
    50%       { opacity: 0.45; }
  }

  /* multi-select bounding box */
  .bbox-rect {
    fill: none;
    stroke: var(--km-accent);
    stroke-width: 0.8px;
    stroke-dasharray: 3 2;
    opacity: 0.7;
    pointer-events: none;
  }
  .bbox-count {
    fill: var(--km-accent);
    font-family: var(--km-font-mono);
    font-size: 6px;
    pointer-events: none;
  }

  /* ghost action bar */
  .ghost-bar {
    position: absolute;
    bottom: var(--km-space-3);
    left: 50%;
    transform: translateX(-50%);
    display: flex;
    align-items: center;
    gap: var(--km-space-2);
    padding: var(--km-space-2) var(--km-space-4);
    background: var(--km-bg-elevated);
    border: 1px solid var(--km-accent);
    border-radius: var(--km-radius-full);
    box-shadow: var(--km-shadow-md), 0 0 0 1px var(--km-accent) inset;
    font-family: var(--km-font);
    font-size: var(--km-font-size-xs);
    color: var(--km-text-secondary);
  }
  .ghost-bar.hidden { display: none; }
  .ghost-label { color: var(--km-accent); font-weight: var(--km-font-weight-medium); }

  /* empty state */
  .empty-state {
    position: absolute;
    inset: 0;
    display: flex;
    flex-direction: column;
    align-items: center;
    justify-content: center;
    gap: var(--km-space-3);
    color: var(--km-text-muted);
    font-family: var(--km-font);
    font-size: var(--km-font-size-sm);
    pointer-events: none;
  }
  .empty-state.hidden { display: none; }
  .empty-state km-icon { opacity: 0.25; }

  /* ref label */
  .comp-label {
    font-family: var(--km-font-mono);
    font-size: 6px;
    fill: var(--km-text-muted);
    pointer-events: none;
    user-select: none;
  }
</style>

<div class="canvas-wrap">
  <svg id="svg" viewBox="0 0 100 100" preserveAspectRatio="xMidYMid meet">
    <g id="board-group"></g>
    <g id="comp-group"></g>
    <g id="ghost-group"></g>
  </svg>
</div>

<div class="empty-state" id="empty-state">
  <km-icon name="pcb" size="xl"></km-icon>
  <span>Connect to KiCad Bridge to see the board layout.</span>
</div>

<div class="ghost-bar hidden" id="ghost-bar">
  <span class="ghost-label" id="ghost-label">Ghost preview</span>
  <km-button variant="ghost"   size="sm" id="ghost-cancel">Cancel</km-button>
  <km-button variant="primary" size="sm" id="ghost-apply">Apply Move</km-button>
</div>
`;

export class KmGhostLayer extends HTMLElement {
  constructor() {
    super();
    this.attachShadow({ mode: 'open' });
    this.shadowRoot.appendChild(TEMPLATE.content.cloneNode(true));

    /** @type {{ ref:string, x_mm:number, y_mm:number, rotation?:number }|null} */
    this._ghost  = null;
    this._unsubs = [];
    this._scale  = 1;  // mm → svg-units scaling factor
    this._originX = 0; // board left-edge offset (mm)
    this._originY = 0;
  }

  connectedCallback() {
    this._unsubs.push(
      subscribe('boardComponents', () => this._render()),
      subscribe('boardState',      () => this._render()),
      subscribe('selectedRefs',    () => this._renderComponents()),
    );

    this.shadowRoot.getElementById('ghost-cancel')
      ?.addEventListener('km-click', () => this._cancelGhost());
    this.shadowRoot.getElementById('ghost-apply')
      ?.addEventListener('km-click', () => this._applyGhost());

    this._render();
  }

  disconnectedCallback() {
    for (const unsub of this._unsubs) unsub();
    this._unsubs = [];
  }

  // ── Public API ──────────────────────────────────────────────────────────────

  /**
   * Show a ghost (dashed preview) at the proposed position.
   * @param {{ ref:string, x_mm:number, y_mm:number, rotation?:number }} ghost
   */
  setGhost(ghost) {
    this._ghost = ghost;
    this._renderGhost();
    const bar = this.shadowRoot.getElementById('ghost-bar');
    const lbl = this.shadowRoot.getElementById('ghost-label');
    bar.classList.remove('hidden');
    lbl.textContent = `Move ${ghost.ref} → (${ghost.x_mm.toFixed(2)}, ${ghost.y_mm.toFixed(2)}) mm`;
  }

  /** Clear the ghost overlay without confirming. */
  clearGhost() {
    this._ghost = null;
    this.shadowRoot.getElementById('ghost-group').innerHTML = '';
    this.shadowRoot.getElementById('ghost-bar').classList.add('hidden');
  }

  /**
   * Highlight multiple selected components and draw their bounding box.
   * Pass null or empty array to clear.
   * @param {string[]} refs
   */
  setMultiSelect(refs) {
    const components = store.boardComponents ?? [];
    const selected   = refs?.length
      ? components.filter(c => refs.includes(c.ref))
      : [];

    // Re-render with multi-select highlighting
    this._renderComponents(new Set(refs ?? []));
    this._renderBbox(selected);
  }

  _renderBbox(components) {
    const group = this.shadowRoot.getElementById('ghost-group');
    if (components.length < 2) {
      // Don't draw bbox for single selection — handled by circle stroke
      if (!this._ghost) group.innerHTML = '';
      return;
    }

    const bb = boundingBox(components);
    if (!bb) return;

    const PAD = 2;
    const x   = this._toSvgX(bb.minX) - PAD;
    const y   = this._toSvgY(bb.minY) - PAD;
    const w   = (bb.maxX - bb.minX) * this._scale + PAD * 2;
    const h   = (bb.maxY - bb.minY) * this._scale + PAD * 2;

    const existing = this._ghost ? this.shadowRoot.querySelector('.comp-ghost')?.outerHTML ?? '' : '';
    group.innerHTML = `
      <rect class="bbox-rect" x="${x}" y="${y}" width="${Math.max(w, 1)}" height="${Math.max(h, 1)}" rx="0.5"/>
      <text class="bbox-count" x="${x + 2}" y="${y - 1}">${components.length} selected</text>
      ${existing}
    `;
  }

  // ── Render ──────────────────────────────────────────────────────────────────

  _render() {
    const components = store.boardComponents ?? [];
    const boardState = store.boardState;
    const empty      = this.shadowRoot.getElementById('empty-state');

    if (components.length === 0) {
      empty.classList.remove('hidden');
      this.shadowRoot.getElementById('board-group').innerHTML = '';
      this.shadowRoot.getElementById('comp-group').innerHTML  = '';
      return;
    }
    empty.classList.add('hidden');

    this._computeScale(components, boardState);
    this._renderBoard(boardState);
    this._renderComponents();
    if (this._ghost) this._renderGhost();
  }

  /**
   * Compute the scale factor (mm → SVG units) and origin offsets.
   * We normalise to a 100×100 SVG viewport with 5-unit padding.
   */
  _computeScale(components, boardState) {
    const PAD = 6;

    let minX, maxX, minY, maxY;

    if (boardState?.board_size) {
      const bs = boardState.board_size;
      minX = bs.x_mm   ?? 0;
      minY = bs.y_mm   ?? 0;
      maxX = minX + (bs.width_mm  || 80);
      maxY = minY + (bs.height_mm || 60);
    } else {
      // Fall back to component bounding box
      const xs = components.map(c => c.position?.x ?? 0);
      const ys = components.map(c => c.position?.y ?? 0);
      minX = Math.min(...xs); maxX = Math.max(...xs);
      minY = Math.min(...ys); maxY = Math.max(...ys);
    }

    const boardW = Math.max(maxX - minX, 1);
    const boardH = Math.max(maxY - minY, 1);
    const svgW   = 100 - PAD * 2;
    const svgH   = 100 - PAD * 2;

    this._scale   = Math.min(svgW / boardW, svgH / boardH);
    this._originX = minX;
    this._originY = minY;

    // Update SVG viewBox to keep square aspect ratio
    const vw = boardW * this._scale + PAD * 2;
    const vh = boardH * this._scale + PAD * 2;
    this.shadowRoot.getElementById('svg').setAttribute('viewBox', `0 0 ${vw} ${vh}`);
    this._padX = PAD;
    this._padY = PAD;
  }

  /** mm → SVG x coordinate */
  _toSvgX(mm) { return (mm - this._originX) * this._scale + (this._padX ?? 6); }
  /** mm → SVG y coordinate */
  _toSvgY(mm) { return (mm - this._originY) * this._scale + (this._padY ?? 6); }

  _renderBoard(boardState) {
    const group = this.shadowRoot.getElementById('board-group');
    if (!boardState?.board_size) { group.innerHTML = ''; return; }

    const bs = boardState.board_size;
    const x  = this._toSvgX(bs.x_mm ?? 0);
    const y  = this._toSvgY(bs.y_mm ?? 0);
    const w  = (bs.width_mm  || 80) * this._scale;
    const h  = (bs.height_mm || 60) * this._scale;

    group.innerHTML = `
      <rect class="board-outline" x="${x}" y="${y}" width="${w}" height="${h}" rx="0.5"/>
    `;
  }

  _renderComponents(multiSelectSet = null) {
    const components  = store.boardComponents ?? [];
    const selectedSet = multiSelectSet ?? new Set(store.selectedRefs ?? []);
    const group       = this.shadowRoot.getElementById('comp-group');

    const DOT = Math.max(0.8, Math.min(2.2, 60 / Math.max(components.length, 1)));

    group.innerHTML = components.map(c => {
      const cx  = this._toSvgX(c.position?.x ?? 0);
      const cy  = this._toSvgY(c.position?.y ?? 0);
      const cls = selectedSet.has(c.ref)
        ? 'comp-selected'
        : c.on_back ? 'comp-back' : 'comp-front';
      return `
        <circle class="${cls}" cx="${cx}" cy="${cy}" r="${DOT}"
                data-ref="${esc(c.ref)}" title="${esc(c.ref)}: ${esc(c.value)}"/>
        ${DOT > 1.5 ? `<text class="comp-label" x="${cx + DOT + 0.5}" y="${cy + 2}">${esc(c.ref)}</text>` : ''}
      `;
    }).join('');

    // Click to select
    for (const el of group.querySelectorAll('circle[data-ref]')) {
      el.addEventListener('click', () => {
        const ref  = el.dataset.ref;
        const comp = components.find(c => c.ref === ref);
        if (!comp) return;
        store.selectedRefs = [ref];
        this.dispatchEvent(new CustomEvent('km-component-select', {
          bubbles: true, composed: true,
          detail: { component: comp },
        }));
      });
    }
  }

  _renderGhost() {
    const group = this.shadowRoot.getElementById('ghost-group');
    if (!this._ghost) { group.innerHTML = ''; return; }

    const cx  = this._toSvgX(this._ghost.x_mm);
    const cy  = this._toSvgY(this._ghost.y_mm);
    const DOT = Math.max(1.2, Math.min(3, 60 / Math.max((store.boardComponents?.length ?? 1), 1)));

    group.innerHTML = `
      <circle class="comp-ghost" cx="${cx}" cy="${cy}" r="${DOT * 1.4}"/>
      <text class="comp-label" x="${cx + DOT + 1}" y="${cy + 2}"
            style="fill:var(--km-accent);font-size:7px;">${esc(this._ghost.ref)}</text>
    `;
  }

  // ── Ghost actions ────────────────────────────────────────────────────────────

  _applyGhost() {
    if (!this._ghost) return;
    this.dispatchEvent(new CustomEvent('km-ghost-confirm', {
      bubbles: true, composed: true,
      detail: { ...this._ghost },
    }));
    this.clearGhost();
  }

  _cancelGhost() {
    this.dispatchEvent(new CustomEvent('km-ghost-cancel', {
      bubbles: true, composed: true,
    }));
    this.clearGhost();
  }
}

function esc(s) {
  const d = document.createElement('div');
  d.textContent = String(s ?? '');
  return d.innerHTML;
}

customElements.define('km-ghost-layer', KmGhostLayer);
