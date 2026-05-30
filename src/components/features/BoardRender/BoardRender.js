/**
 * @element km-board-render
 * @summary 3D PCB render gallery — renders the active project's board
 *          via `kicad-cli pcb render` and displays the result.
 *
 * Two modes:
 *   - "Single view"  → big preview + side selector + render-now button
 *   - "All views"    → 6-up grid (top/bottom/front/back/left/right) rendered in parallel
 *
 * Output PNGs land in `.kimaster/renders/<timestamp>/`.
 * Displayed via Tauri's `convertFileSrc` (custom asset protocol) so KiCad-produced
 * PNGs can be shown directly without copying into the webview origin.
 *
 * @fires km-render-done  — { side, output_path }
 * @fires km-render-error — { side, message }
 */

import { store, subscribe } from '../../../core/State.js';
import { Logger             } from '../../../core/Logger.js';
import { renderSide, renderAllSides } from '../../../modules/render/RenderService.js';

const SIDES_6 = ['top', 'bottom', 'front', 'back', 'left', 'right'];

const TEMPLATE = document.createElement('template');
TEMPLATE.innerHTML = `
<style>
  :host {
    display: flex;
    flex-direction: column;
    height: 100%;
    background: var(--km-bg-primary);
    color: var(--km-text-primary);
    font-family: var(--km-font);
    overflow: hidden;
  }

  /* ── Tabs ── */
  .tabs {
    display: flex;
    align-items: center;
    gap: var(--km-space-2);
    padding: 0 var(--km-space-3);
    height: 38px;
    border-bottom: 1px solid var(--km-border);
    background: var(--km-bg-elevated);
    flex-shrink: 0;
  }
  .tab {
    background: none;
    border: none;
    padding: var(--km-space-1) var(--km-space-3);
    border-radius: var(--km-radius-sm);
    color: var(--km-text-secondary);
    font-size: var(--km-font-size-sm);
    cursor: pointer;
    transition: color var(--km-duration-fast) var(--km-ease),
                background var(--km-duration-fast) var(--km-ease);
  }
  .tab:hover { color: var(--km-text-primary); background: var(--km-bg-surface); }
  .tab.active { color: var(--km-accent); background: var(--km-accent-muted); }
  .tab-sep { flex: 1; }
  .resolution {
    font-size: var(--km-font-size-xs);
    color: var(--km-text-muted);
    font-variant-numeric: tabular-nums;
  }

  /* ── Toolbar ── */
  .toolbar {
    display: flex;
    align-items: center;
    gap: var(--km-space-2);
    padding: var(--km-space-2) var(--km-space-3);
    border-bottom: 1px solid var(--km-border);
    flex-shrink: 0;
    background: var(--km-bg-surface);
    flex-wrap: wrap;
  }
  .toolbar label {
    color: var(--km-text-secondary);
    font-size: var(--km-font-size-xs);
  }
  .toolbar select {
    background: var(--km-bg-input);
    border: 1px solid var(--km-border);
    color: var(--km-text-primary);
    border-radius: var(--km-radius-sm);
    padding: 2px var(--km-space-2);
    font-family: var(--km-font);
    font-size: var(--km-font-size-sm);
    outline: none;
    cursor: pointer;
  }
  .toolbar select:focus { border-color: var(--km-accent); }
  .toolbar-sep { width: 1px; height: 14px; background: var(--km-border); }

  .btn-primary {
    background: var(--km-accent);
    border: none;
    color: #fff;
    padding: var(--km-space-1) var(--km-space-3);
    border-radius: var(--km-radius-sm);
    font-size: var(--km-font-size-sm);
    font-weight: var(--km-font-weight-medium);
    cursor: pointer;
    transition: background var(--km-duration-fast) var(--km-ease);
  }
  .btn-primary:hover:not(:disabled) { background: var(--km-accent-hover); }
  .btn-primary:disabled { background: var(--km-bg-elevated); color: var(--km-text-muted); cursor: not-allowed; }

  /* ── Body ── */
  .body {
    flex: 1;
    overflow: auto;
    padding: var(--km-space-3);
  }

  /* ── Single-view canvas ── */
  .single-canvas {
    display: flex;
    align-items: center;
    justify-content: center;
    height: 100%;
    background: var(--km-bg-secondary);
    border-radius: var(--km-radius-md);
    border: 1px solid var(--km-border);
    overflow: hidden;
    position: relative;
  }
  .single-canvas img {
    max-width: 100%;
    max-height: 100%;
    object-fit: contain;
    border-radius: var(--km-radius-sm);
    background: #000;
  }
  .single-canvas.empty {
    color: var(--km-text-muted);
    font-size: var(--km-font-size-sm);
    flex-direction: column;
    gap: var(--km-space-3);
  }
  .single-canvas.empty km-icon { opacity: 0.25; }

  /* ── 6-up grid ── */
  .grid {
    display: grid;
    grid-template-columns: repeat(3, 1fr);
    gap: var(--km-space-3);
  }
  @media (max-width: 900px) {
    .grid { grid-template-columns: repeat(2, 1fr); }
  }
  @media (max-width: 600px) {
    .grid { grid-template-columns: 1fr; }
  }

  .tile {
    background: var(--km-bg-surface);
    border: 1px solid var(--km-border);
    border-radius: var(--km-radius-md);
    overflow: hidden;
    display: flex;
    flex-direction: column;
    aspect-ratio: 16 / 10;
    position: relative;
  }
  .tile__label {
    position: absolute;
    top: var(--km-space-1);
    left: var(--km-space-2);
    padding: 1px 6px;
    font-size: var(--km-font-size-xs);
    background: var(--km-bg-overlay);
    color: var(--km-text-primary);
    border-radius: var(--km-radius-xs);
    backdrop-filter: blur(8px);
    text-transform: lowercase;
    font-family: var(--km-font-mono);
  }
  .tile__img {
    width: 100%;
    height: 100%;
    object-fit: contain;
    background: #000;
  }
  .tile.empty {
    background: var(--km-bg-secondary);
    display: flex;
    align-items: center;
    justify-content: center;
    color: var(--km-text-muted);
    font-size: var(--km-font-size-xs);
  }
  .tile.spinning::after {
    content: '';
    position: absolute;
    inset: 0;
    background: var(--km-bg-overlay);
    backdrop-filter: blur(4px);
    border-radius: var(--km-radius-md);
  }
  .tile.spinning::before {
    content: '⟳ rendering…';
    position: absolute;
    z-index: 2;
    inset: 0;
    display: flex;
    align-items: center;
    justify-content: center;
    color: var(--km-text-primary);
    font-size: var(--km-font-size-sm);
    font-family: var(--km-font-mono);
  }

  /* ── No-project state ── */
  .no-project {
    flex: 1;
    display: flex;
    flex-direction: column;
    align-items: center;
    justify-content: center;
    gap: var(--km-space-3);
    color: var(--km-text-muted);
    font-size: var(--km-font-size-sm);
  }
  .no-project.hidden { display: none; }

  /* ── Status line ── */
  .status {
    padding: 3px var(--km-space-3);
    font-size: var(--km-font-size-xs);
    color: var(--km-text-muted);
    border-top: 1px solid var(--km-border);
    background: var(--km-bg-elevated);
    flex-shrink: 0;
    font-variant-numeric: tabular-nums;
  }
  .status.ok    { color: var(--km-trace); }
  .status.error { color: var(--km-red); }

  /* ── Hidden helper ── */
  .hidden { display: none !important; }
</style>

<!-- Tabs -->
<div class="tabs">
  <button class="tab active" data-tab="single">Single view</button>
  <button class="tab"        data-tab="all">All sides</button>
  <span class="tab-sep"></span>
  <span class="resolution" id="resolution">1280 × 720</span>
</div>

<!-- No project state -->
<div class="no-project hidden" id="no-project">
  <km-icon name="pcb" size="xl"></km-icon>
  <span>Open a KiCad project with a PCB file to render in 3D.</span>
</div>

<!-- Toolbar -->
<div class="toolbar" id="toolbar">
  <label>Side</label>
  <select id="sel-side">
    <option value="top">top</option>
    <option value="bottom">bottom</option>
    <option value="front">front</option>
    <option value="back">back</option>
    <option value="left">left</option>
    <option value="right">right</option>
    <option value="top_front">top-front</option>
    <option value="top_back">top-back</option>
  </select>

  <div class="toolbar-sep"></div>
  <label>Size</label>
  <select id="sel-size">
    <option value="1280x720">1280 × 720</option>
    <option value="1920x1080">1920 × 1080</option>
    <option value="2560x1440">2560 × 1440</option>
    <option value="800x600">800 × 600</option>
  </select>

  <div class="toolbar-sep"></div>
  <label>Quality</label>
  <select id="sel-quality">
    <option value="high">high</option>
    <option value="basic">basic</option>
  </select>

  <div class="toolbar-sep"></div>
  <label>Background</label>
  <select id="sel-bg">
    <option value="default">default</option>
    <option value="transparent">transparent</option>
    <option value="opaque">opaque</option>
  </select>

  <div class="toolbar-sep"></div>
  <button class="btn-primary" id="btn-render">Render</button>
</div>

<!-- Body -->
<div class="body" id="body"></div>

<!-- Status -->
<div class="status" id="status">Ready.</div>
`;

export class KmBoardRender extends HTMLElement {
  constructor() {
    super();
    this.attachShadow({ mode: 'open' });
    this.shadowRoot.appendChild(TEMPLATE.content.cloneNode(true));

    this._activeTab = 'single';
    /** @type {string|null} */
    this._lastSingle = null;
    /** @type {Record<string, string>} side → png path */
    this._allViews = {};
    this._busy = false;
    this._unsubs = [];
  }

  connectedCallback() {
    this._unsubs.push(subscribe('project', () => this._onProjectChange()));

    this._wireTabs();
    this._wireToolbar();
    this._onProjectChange();
  }

  disconnectedCallback() {
    for (const u of this._unsubs) u();
    this._unsubs = [];
  }

  // ── Tabs ──────────────────────────────────────────────────────────────────

  _wireTabs() {
    const tabs = this.shadowRoot.querySelectorAll('.tab');
    for (const tab of tabs) {
      tab.addEventListener('click', () => {
        this._activeTab = tab.dataset.tab;
        tabs.forEach(t => t.classList.toggle('active', t.dataset.tab === this._activeTab));
        this._renderBody();
      });
    }
  }

  // ── Toolbar ───────────────────────────────────────────────────────────────

  _wireToolbar() {
    const btn  = this.shadowRoot.getElementById('btn-render');
    const size = this.shadowRoot.getElementById('sel-size');
    const res  = this.shadowRoot.getElementById('resolution');

    size.addEventListener('change', () => {
      res.textContent = size.value.replace('x', ' × ');
    });

    btn.addEventListener('click', () => {
      if (this._activeTab === 'single') this._runSingle();
      else                              this._runAll();
    });
  }

  _readToolbarOptions() {
    const sel = (id) => this.shadowRoot.getElementById(id)?.value;
    const [w, h] = (sel('sel-size') ?? '1280x720').split('x').map(n => parseInt(n, 10));
    return {
      side:       sel('sel-side')    ?? 'top',
      width_px:   w,
      height_px:  h,
      quality:    sel('sel-quality') ?? 'high',
      background: sel('sel-bg')      ?? 'default',
    };
  }

  // ── Project change ────────────────────────────────────────────────────────

  _onProjectChange() {
    const hasPcb = !!store.project?.pcb_file;
    this.shadowRoot.getElementById('no-project').classList.toggle('hidden', hasPcb);
    this.shadowRoot.getElementById('toolbar').classList.toggle('hidden', !hasPcb);
    this.shadowRoot.getElementById('body').classList.toggle('hidden', !hasPcb);
    // Reset cached renders when project changes
    this._lastSingle = null;
    this._allViews   = {};
    this._renderBody();
  }

  // ── Body render ───────────────────────────────────────────────────────────

  _renderBody() {
    const body = this.shadowRoot.getElementById('body');
    body.innerHTML = '';
    if (this._activeTab === 'single') {
      const wrap = document.createElement('div');
      wrap.className = 'single-canvas' + (this._lastSingle ? '' : ' empty');
      if (this._lastSingle) {
        const img = document.createElement('img');
        img.src = _toAssetUrl(this._lastSingle);
        img.alt = 'Rendered PCB view';
        wrap.appendChild(img);
      } else {
        wrap.innerHTML = `
          <km-icon name="pcb" size="xl"></km-icon>
          <span>Click <b>Render</b> to generate a 3D view of your board.</span>
        `;
      }
      body.appendChild(wrap);
    } else {
      const grid = document.createElement('div');
      grid.className = 'grid';
      for (const side of SIDES_6) {
        const tile = document.createElement('div');
        tile.dataset.side = side;
        tile.className = 'tile';
        const path = this._allViews[side];
        if (path) {
          tile.innerHTML = `
            <span class="tile__label">${side}</span>
            <img class="tile__img" src="${_toAssetUrl(path)}" alt="${side} view"/>
          `;
        } else {
          tile.classList.add('empty');
          tile.innerHTML = `<span class="tile__label">${side}</span><span>—</span>`;
        }
        grid.appendChild(tile);
      }
      body.appendChild(grid);
    }
  }

  _markTileBusy(side, busy) {
    const body = this.shadowRoot.getElementById('body');
    const tile = body.querySelector(`.tile[data-side="${side}"]`);
    if (tile) tile.classList.toggle('spinning', busy);
  }

  // ── Single render ─────────────────────────────────────────────────────────

  async _runSingle() {
    if (this._busy) return;
    const opts = this._readToolbarOptions();
    this._setStatus(`Rendering ${opts.side} (${opts.width_px}×${opts.height_px}) …`, '');
    this._busy = true;
    this._setRenderBtn(true);
    try {
      const r = await renderSide(opts);
      if (r.success) {
        this._lastSingle = r.output_path;
        this._setStatus(`✓ Rendered ${opts.side} → ${r.output_path}`, 'ok');
        this.dispatchEvent(new CustomEvent('km-render-done', {
          bubbles: true, composed: true,
          detail: { side: opts.side, output_path: r.output_path },
        }));
      } else {
        this._setStatus(`✗ Render failed: ${r.message}`, 'error');
        this.dispatchEvent(new CustomEvent('km-render-error', {
          bubbles: true, composed: true,
          detail: { side: opts.side, message: r.message },
        }));
      }
      this._renderBody();
    } catch (err) {
      Logger.error('BoardRender', 'Single render failed', err);
      this._setStatus(`✗ Render error: ${err}`, 'error');
    } finally {
      this._busy = false;
      this._setRenderBtn(false);
    }
  }

  // ── All-sides render ──────────────────────────────────────────────────────

  async _runAll() {
    if (this._busy) return;
    const opts = this._readToolbarOptions();
    this._busy = true;
    this._setRenderBtn(true);
    this._setStatus(`Rendering 6 views in parallel (${opts.width_px}×${opts.height_px}) …`, '');

    // Reset cached views and show spinners
    this._allViews = {};
    this._renderBody();
    for (const side of SIDES_6) this._markTileBusy(side, true);

    try {
      const r = await renderAllSides({
        sides:      SIDES_6,
        width_px:   opts.width_px,
        height_px:  opts.height_px,
        quality:    opts.quality,
        background: opts.background,
      });

      // Map output file paths back to sides by filename
      for (const path of r.files ?? []) {
        const m = path.match(/render_([a-z_]+)\.(png|jpg|jpeg)/i);
        if (m) this._allViews[m[1]] = path;
      }

      const okCount = Object.keys(this._allViews).length;
      const failCount = (r.failures ?? []).length;
      if (r.success) {
        this._setStatus(`✓ Rendered ${okCount} views → ${r.output_dir}`, 'ok');
      } else {
        this._setStatus(`Partial: ${okCount} ok, ${failCount} failed — ${(r.failures ?? []).join('; ')}`, 'error');
      }

      this._renderBody();
    } catch (err) {
      Logger.error('BoardRender', 'All-sides render failed', err);
      this._setStatus(`✗ Render error: ${err}`, 'error');
    } finally {
      for (const side of SIDES_6) this._markTileBusy(side, false);
      this._busy = false;
      this._setRenderBtn(false);
    }
  }

  // ── Helpers ───────────────────────────────────────────────────────────────

  _setStatus(text, kind = '') {
    const el = this.shadowRoot.getElementById('status');
    if (!el) return;
    el.textContent = text;
    el.classList.remove('ok', 'error');
    if (kind) el.classList.add(kind);
  }

  _setRenderBtn(busy) {
    const btn = this.shadowRoot.getElementById('btn-render');
    if (!btn) return;
    btn.disabled = busy;
    btn.textContent = busy ? 'Rendering…' : 'Render';
  }
}

/**
 * Convert an absolute filesystem path to a webview-loadable URL using
 * Tauri's `convertFileSrc` if available, otherwise fall back to `file://`.
 * @param {string} path
 */
function _toAssetUrl(path) {
  if (!path) return '';
  // Tauri 2 exposes convertFileSrc; outside Tauri we fall back to a basic file URL.
  if (window.__TAURI_INTERNALS__?.convertFileSrc) {
    try { return window.__TAURI_INTERNALS__.convertFileSrc(path); }
    catch { /* fall through */ }
  }
  // Normalise Windows backslashes
  return 'file:///' + path.replace(/\\/g, '/');
}

customElements.define('km-board-render', KmBoardRender);
