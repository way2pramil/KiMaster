/**
 * @element km-wgt-board-render
 * @summary 3D render widget — shows cached top-view render or triggers one.
 *          Auto-triggers a background render when a project is first opened.
 */

import { store, subscribe }            from '../../../../core/State.js';
import { Logger }                      from '../../../../core/Logger.js';
import { renderSide }                  from '../../../../modules/render/RenderService.js';
import { WIDGET_BASE_CSS, navTo, esc } from './WidgetShell.js';

const CACHE_KEY = (path) => `km-render-cache-${btoa(path).replace(/[^a-z0-9]/gi,'_').slice(0,48)}`;

const T = document.createElement('template');
T.innerHTML = /* html */`
<style>
${WIDGET_BASE_CSS}

/* ── Image fill ───────────────────────────────────────────────── */
.render-wrap {
  flex: 1; position: relative; overflow: hidden;
  background: #0a0a0a;
}
.render-img {
  width: 100%; height: 100%;
  object-fit: cover; object-position: center;
  display: block;
  transition: opacity 0.3s;
}
.render-img.loading { opacity: 0; }

.img-overlay {
  position: absolute; inset: 0;
  display: flex; align-items: flex-end;
  background: linear-gradient(to top, var(--km-shadow-card-strong) 0%, transparent 50%);
  padding: 12px 14px;
  opacity: 0; transition: opacity 0.2s;
  pointer-events: none;
}
.render-wrap:hover .img-overlay { opacity: 1; }
.side-label {
  font-size: 10px; color: var(--km-alpha-70);
  background: var(--km-shadow-card-strong); backdrop-filter: blur(6px);
  padding: 3px 8px; border-radius: 4px;
  font-family: var(--km-font-mono);
  pointer-events: none;
}
.img-cta {
  position: absolute; inset: 0;
  display: flex; align-items: center; justify-content: center;
  background: var(--km-shadow-card-strong); backdrop-filter: blur(4px);
  cursor: pointer; opacity: 0; transition: opacity 0.2s;
}
.render-wrap:hover .img-cta { opacity: 1; }
.cta-chip {
  font-size: 11px; font-weight: 500;
  color: var(--km-alpha-85);
  background: rgba(37,99,235,0.25); border: 1px solid rgba(37,99,235,0.4);
  padding: 6px 12px; border-radius: 7px;
  display: flex; align-items: center; gap: 6px;
}

/* ── Progress bar ─────────────────────────────────────────────── */
.progress-bar {
  position: absolute; bottom: 0; left: 0; right: 0;
  height: 2px; background: var(--km-alpha-05);
}
.progress-fill {
  height: 100%; background: var(--km-accent);
  box-shadow: 0 0 6px var(--km-accent);
  transition: width 0.4s;
  border-radius: 0 2px 2px 0;
}

/* ── CTA state (no project / no render) ───────────────────────── */
.cta-state {
  flex: 1; display: flex; flex-direction: column;
  align-items: center; justify-content: center;
  gap: 12px; padding: 20px; text-align: center;
}
.side-tabs {
  display: flex; gap: 4px;
  padding: 0 14px 10px; flex-shrink: 0;
}
.side-tab {
  background: none; border: 1px solid var(--km-alpha-08);
  color: var(--km-alpha-30); font-family: var(--km-font); font-size: 10px;
  padding: 3px 8px; border-radius: 5px; cursor: pointer;
  transition: all 0.1s;
}
.side-tab.active { border-color: var(--km-accent); color: var(--km-accent-hover); background: rgba(37,99,235,0.08); }
.side-tab:hover:not(.active) { color: var(--km-alpha-55); }
</style>

<div class="wgt-hdr">
  <km-icon class="wgt-icon" name="render" size="sm"></km-icon>
  <span class="wgt-label">3D render</span>
  <button class="btn-link" id="btn-rerender" style="display:none">
    <km-icon name="refresh" size="sm"></km-icon>
  </button>
</div>
<div id="body" style="display:flex;flex-direction:column;flex:1;overflow:hidden"></div>
`;

const SIDES = ['top', 'bottom', 'front', 'back'];

export class WidgetBoardRender extends HTMLElement {
  constructor() {
    super();
    this.attachShadow({ mode: 'open' });
    this.shadowRoot.appendChild(T.content.cloneNode(true));
    this._unsubs     = [];
    this._rendering  = false;
    this._side       = 'top';
    this._cachedPath = null;
  }

  connectedCallback() {
    this._tryLoadCache();
    this.shadowRoot.getElementById('btn-rerender')
      ?.addEventListener('click', () => this._triggerRender(true));
    this._unsubs.push(
      subscribe('project', () => {
        this._cachedPath = null;
        this._tryLoadCache();
      }),
    );
  }

  disconnectedCallback() { this._unsubs.forEach(u => u()); this._unsubs = []; }

  _tryLoadCache() {
    const proj = store.project;
    if (!proj?.pcb_file) { this._renderCta(); return; }

    const key    = CACHE_KEY(proj.pcb_file);
    const cached = localStorage.getItem(key);
    if (cached) {
      try {
        const { path, side } = JSON.parse(cached);
        this._side       = side || 'top';
        this._cachedPath = path;
        this._showImage(path);
        return;
      } catch (_) { /* fall through */ }
    }
    // No cache — auto-trigger a background render once
    this._triggerRender(false);
  }

  _renderCta() {
    const body = this.shadowRoot.getElementById('body');
    this.shadowRoot.getElementById('btn-rerender').style.display = 'none';
    body.innerHTML = `
      <div class="cta-state">
        <km-icon name="render" size="xl" style="opacity:0.2"></km-icon>
        <span style="font-size:12px;color:var(--km-alpha-25)">Open a project<br>to render the board</span>
      </div>`;
  }

  async _triggerRender(force = false) {
    if (this._rendering && !force) return;
    if (!store.project?.pcb_file && !store.boardState?.board_name) {
      this._renderCta(); return;
    }
    this._rendering = true;
    this._showProgress();

    try {
      const res = await renderSide({ side: this._side, width_px: 800, height_px: 600, quality: 'high' });
      if (!this.isConnected) return;
      if (res.success && res.output_path) {
        const key = CACHE_KEY(store.project?.pcb_file || store.boardState?.board_name || '');
        localStorage.setItem(key, JSON.stringify({ path: res.output_path, side: this._side }));
        this._cachedPath = res.output_path;
        this._showImage(res.output_path);
      } else {
        this._renderError(res.message);
      }
    } catch (err) {
      Logger.warn('WidgetBoardRender', 'render failed', err);
      this._renderError(String(err));
    } finally {
      this._rendering = false;
    }
  }

  _showProgress() {
    const body = this.shadowRoot.getElementById('body');
    body.innerHTML = `
      <div class="cta-state">
        <km-icon name="render" size="xl" style="opacity:0.3;animation:spin 1.5s linear infinite"></km-icon>
        <span style="font-size:11px;color:var(--km-alpha-30)">Rendering ${this._side} view…</span>
        <div class="progress-bar" style="position:static;width:80%;border-radius:2px">
          <div class="progress-fill" id="pf" style="width:0%"></div>
        </div>
      </div>`;
    let pct = 0;
    const timer = setInterval(() => {
      pct = Math.min(pct + Math.random() * 12, 88);
      const pf = this.shadowRoot.getElementById('pf');
      if (pf) pf.style.width = pct + '%'; else clearInterval(timer);
    }, 400);
    this._clearTimer = () => clearInterval(timer);
  }

  _showImage(path) {
    this._clearTimer?.();
    const body = this.shadowRoot.getElementById('body');
    const rrBtn = this.shadowRoot.getElementById('btn-rerender');
    rrBtn.style.display = 'inline-flex';

    // Tauri asset protocol
    let src = path;
    try {
      if (window.__TAURI_INTERNALS__) {
        src = window.__TAURI_INTERNALS__.convertFileSrc
          ? window.__TAURI_INTERNALS__.convertFileSrc(path)
          : `asset://localhost/${path.replace(/\\/g,'/')}`;
      }
    } catch (_) { /* browser fallback */ }

    body.innerHTML = `
      <div class="side-tabs" id="side-tabs">
        ${SIDES.map(s => `<button class="side-tab${s===this._side?' active':''}" data-side="${s}">${s}</button>`).join('')}
      </div>
      <div class="render-wrap">
        <img class="render-img loading" id="rimg" src="${esc(src)}" alt="3D render" />
        <div class="img-overlay"><span class="side-label">${this._side} view</span></div>
        <div class="img-cta" id="full-cta">
          <span class="cta-chip"><km-icon name="render" size="sm"></km-icon>Open 3D view</span>
        </div>
      </div>`;

    const img = body.querySelector('#rimg');
    img.addEventListener('load',  () => img.classList.remove('loading'));
    img.addEventListener('error', () => this._renderError('Render file not found'));

    body.querySelector('#full-cta')?.addEventListener('click', () => navTo(this, '/render'));

    body.querySelectorAll('.side-tab').forEach(tab =>
      tab.addEventListener('click', () => {
        this._side = tab.dataset.side;
        this._triggerRender(true);
      }));
  }

  _renderError(msg) {
    this._clearTimer?.();
    const body = this.shadowRoot.getElementById('body');
    this.shadowRoot.getElementById('btn-rerender').style.display = 'inline-flex';
    body.innerHTML = `
      <div class="cta-state" style="gap:10px">
        <km-icon name="warning" size="xl" style="opacity:0.3;color:var(--km-warning)"></km-icon>
        <span style="font-size:11px;color:var(--km-alpha-25)">Render failed</span>
        <button class="btn-primary" id="retry">Try again</button>
      </div>`;
    body.querySelector('#retry')?.addEventListener('click', () => this._triggerRender(true));
  }
}

customElements.define('km-wgt-board-render', WidgetBoardRender);
