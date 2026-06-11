/**
 * KiCanvasView — permanent kicanvas-embed overlay with refresh toolbar.
 *
 * kicanvas-embed calls attachShadow in connectedCallback, so elements must
 * never be moved between DOM parents. Solution: mount once, show/hide via CSS.
 *
 * Public API:
 *   kcvOverlay.preload(pcbSrc, schSrc)  — start parsing in background
 *   kcvOverlay.show('pcb' | 'sch')      — show pane
 *   kcvOverlay.hide()                    — hide overlay
 *   kcvOverlay.reset()                   — tear down on project change
 *
 * @module KiCanvasView
 */

import '../../components/features/PcbLayout/LiveOverlay.js';
import '../../components/features/PcbLayout/BoardToolsRail.js';
import { KiCanvasAdapter } from '../../lib/kicanvas/KiCanvasAdapter.js';

const AUTO_INTERVALS = [
  { label: 'Off',   ms: 0 },
  { label: '5 s',   ms: 5_000 },
  { label: '15 s',  ms: 15_000 },
  { label: '30 s',  ms: 30_000 },
  { label: '1 min', ms: 60_000 },
];

const STYLE = `
  #kcv-overlay {
    position: absolute;
    top: 0; left: 0; right: 0; bottom: 0;
    display: none;
    flex-direction: column;
    z-index: 2;
    background: var(--km-bg-primary, #0d0d0d);
  }
  #kcv-overlay.visible { display: flex; }

  /* ── Refresh toolbar ── */
  .kcv-toolbar {
    display: flex;
    align-items: center;
    gap: 8px;
    padding: 0 12px;
    height: 36px;
    border-bottom: 1px solid var(--km-border, rgba(255,255,255,0.07));
    background: var(--km-bg-elevated, #161616);
    flex-shrink: 0;
  }

  .kcv-toolbar-sep { flex: 1; }

  .kcv-last-refresh {
    font-family: var(--km-font-mono, monospace);
    font-size: 10px;
    color: var(--km-text-muted, rgba(255,255,255,0.35));
  }

  .kcv-interval-label {
    font-size: 11px;
    color: var(--km-text-secondary, rgba(255,255,255,0.55));
  }

  .kcv-interval-select {
    background: var(--km-bg-input, #1a1a1a);
    border: 1px solid var(--km-border, rgba(255,255,255,0.07));
    color: var(--km-text-primary, #fff);
    border-radius: 4px;
    padding: 2px 6px;
    font-size: 11px;
    font-family: var(--km-font-mono, monospace);
    cursor: pointer;
    outline: none;
  }
  .kcv-interval-select:focus { border-color: var(--km-accent, #2563EB); }

  .kcv-btn-refresh {
    display: flex;
    align-items: center;
    justify-content: center;
    width: 26px;
    height: 26px;
    border: 1px solid var(--km-border, rgba(255,255,255,0.07));
    border-radius: 4px;
    background: var(--km-bg-surface, #1e1e1e);
    color: var(--km-text-primary, #fff);
    cursor: pointer;
    font-size: 14px;
    transition: background 0.15s ease, color 0.15s ease, transform 0.2s ease;
  }
  .kcv-btn-refresh:hover { background: var(--km-bg-elevated, #222); color: var(--km-accent, #2563EB); }
  .kcv-btn-refresh.spinning { animation: kcv-btn-spin 0.5s linear; }

  @keyframes kcv-btn-spin { to { transform: rotate(360deg); } }

  /* ── Pane ── */
  .kcv-pane {
    display: none;
    flex: 1;
    position: relative;
    overflow: hidden;
  }
  .kcv-pane.active { display: flex; }

  /* ── PCB pane: board area (embed + live overlay) + tools rail ── */
  .kcv-board-row {
    display: flex;
    flex: 1;
    min-height: 0;
    width: 100%;
  }
  .kcv-board-area {
    position: relative;
    flex: 1;
    min-width: 0;
    display: flex;
  }

  kicanvas-embed {
    display: block;
    flex: 1;
    width: 100%;
    height: 100%;
    opacity: 0;
    transition: opacity 0.2s ease;
  }
  kicanvas-embed.loaded { opacity: 1; }

  /* ── Loading skeleton ── */
  .kcv-loading {
    position: absolute;
    inset: 0;
    display: flex;
    flex-direction: column;
    align-items: center;
    justify-content: center;
    gap: 16px;
    background: var(--km-bg-primary, #0d0d0d);
    transition: opacity 0.2s ease;
    pointer-events: none;
    z-index: 10;
  }
  .kcv-loading.hidden { opacity: 0; pointer-events: none; }

  .kcv-spinner {
    position: relative;
    width: 48px;
    height: 48px;
  }
  .kcv-spinner::before, .kcv-spinner::after {
    content: '';
    position: absolute;
    border-radius: 50%;
    border: 2px solid transparent;
  }
  .kcv-spinner::before {
    inset: 0;
    border-top-color: var(--km-accent, #2563EB);
    border-right-color: var(--km-accent, #2563EB);
    animation: kcv-spin 0.9s linear infinite;
  }
  .kcv-spinner::after {
    inset: 8px;
    border-bottom-color: var(--km-accent-hover, #3B82F6);
    border-left-color: var(--km-accent-hover, #3B82F6);
    opacity: 0.55;
    animation: kcv-spin 0.9s linear infinite reverse;
  }
  @keyframes kcv-spin { to { transform: rotate(360deg); } }

  .kcv-loading-label {
    font-family: var(--km-font-mono, monospace);
    font-size: 11px;
    color: var(--km-text-muted, rgba(255,255,255,0.35));
    letter-spacing: 0.06em;
    animation: kcv-pulse 1.8s ease-in-out infinite;
  }
  @keyframes kcv-pulse {
    0%, 100% { opacity: 0.35; }
    50%       { opacity: 0.75; }
  }
`;

let _styleInjected = false;
function _injectStyle() {
  if (_styleInjected) return;
  _styleInjected = true;
  const s = document.createElement('style');
  s.textContent = STYLE;
  document.head.appendChild(s);
}

function _fmtTime(date) {
  return date.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit', second: '2-digit' });
}

// ── Overlay singleton ─────────────────────────────────────────────────────────

class KiCanvasOverlay {
  constructor() {
    _injectStyle();

    const mainContent = document.getElementById('main-content');
    if (mainContent) mainContent.style.position = 'relative';

    this._el = document.createElement('div');
    this._el.id = 'kcv-overlay';
    (mainContent ?? document.body).appendChild(this._el);

    /** @type {Map<string, PaneState>} */
    this._panes = new Map();

    /** @type {number|null} auto-refresh timer id */
    this._timer = null;

    /** @type {number} active interval ms (0 = off) */
    this._intervalMs = 0;

    /** @type {string|null} currently visible pane key */
    this._activeKey = null;

    // Shared toolbar — one strip at the top of the overlay
    this._toolbar = this._buildToolbar();
    this._el.appendChild(this._toolbar);
  }

  // ── Public API ────────────────────────────────────────────────────────────

  preload(pcbSrc, schSrc) {
    if (pcbSrc) this._ensurePane('pcb', pcbSrc, 'Loading PCB layout…');
    if (schSrc) this._ensurePane('sch', schSrc, 'Loading schematic…');
  }

  show(key) {
    this._activeKey = key;
    this._el.classList.add('visible');
    for (const [k, state] of this._panes) {
      state.pane.classList.toggle('active', k === key);
    }
  }

  hide() {
    this._activeKey = null;
    this._el.classList.remove('visible');
  }

  reset() {
    this._stopTimer();
    // Remove all panes (toolbar stays); destroy any live adapters to stop
    // their rAF loops before the embed is torn down.
    for (const { pane, getAdapter } of this._panes.values()) {
      try { getAdapter?.()?.destroy(); } catch { /* noop */ }
      pane.remove();
    }
    this._panes.clear();
    this._activeKey = null;
    this.hide();
  }

  refresh() {
    const key = this._activeKey;
    if (!key) return;
    const state = this._panes.get(key);
    if (!state) return;
    this._doRefresh(state);
  }

  // ── Toolbar ───────────────────────────────────────────────────────────────

  _buildToolbar() {
    const bar = document.createElement('div');
    bar.className = 'kcv-toolbar';

    const lastRefreshEl = document.createElement('span');
    lastRefreshEl.className = 'kcv-last-refresh';
    lastRefreshEl.textContent = '';
    this._lastRefreshEl = lastRefreshEl;

    const sep = document.createElement('span');
    sep.className = 'kcv-toolbar-sep';

    const intervalLabel = document.createElement('span');
    intervalLabel.className = 'kcv-interval-label';
    intervalLabel.textContent = 'Auto-refresh:';

    const intervalSelect = document.createElement('select');
    intervalSelect.className = 'kcv-interval-select';
    for (const opt of AUTO_INTERVALS) {
      const o = document.createElement('option');
      o.value = String(opt.ms);
      o.textContent = opt.label;
      intervalSelect.appendChild(o);
    }
    intervalSelect.addEventListener('change', () => {
      this._intervalMs = parseInt(intervalSelect.value, 10);
      this._restartTimer();
    });
    this._intervalSelect = intervalSelect;

    const refreshBtn = document.createElement('button');
    refreshBtn.className = 'kcv-btn-refresh';
    refreshBtn.title = 'Refresh now';
    refreshBtn.innerHTML = '↻';
    refreshBtn.addEventListener('click', () => {
      refreshBtn.classList.remove('spinning');
      void refreshBtn.offsetWidth; // reflow to restart animation
      refreshBtn.classList.add('spinning');
      refreshBtn.addEventListener('animationend', () => refreshBtn.classList.remove('spinning'), { once: true });
      this.refresh();
    });

    bar.appendChild(lastRefreshEl);
    bar.appendChild(sep);
    bar.appendChild(intervalLabel);
    bar.appendChild(intervalSelect);
    bar.appendChild(refreshBtn);
    return bar;
  }

  _updateLastRefresh() {
    if (this._lastRefreshEl) {
      this._lastRefreshEl.textContent = `Refreshed ${_fmtTime(new Date())}`;
    }
  }

  // ── Auto-refresh timer ────────────────────────────────────────────────────

  _restartTimer() {
    this._stopTimer();
    if (this._intervalMs > 0) {
      this._timer = setInterval(() => {
        // Only refresh if the overlay is currently visible
        if (this._el.classList.contains('visible')) this.refresh();
      }, this._intervalMs);
    }
  }

  _stopTimer() {
    if (this._timer !== null) {
      clearInterval(this._timer);
      this._timer = null;
    }
  }

  // ── Pane management ───────────────────────────────────────────────────────

  _ensurePane(key, src, loadingLabel) {
    if (this._panes.has(key)) return;

    const pane = document.createElement('div');
    pane.className = 'kcv-pane';

    const loading = document.createElement('div');
    loading.className = 'kcv-loading';
    loading.innerHTML = `<div class="kcv-spinner"></div><span class="kcv-loading-label">${loadingLabel}</span>`;

    const embed = this._createEmbed(src, loading);

    let liveOverlay = null;
    let rail        = null;
    let adapter     = null;

    if (key === 'pcb') {
      // Board area: embed + precision live-preview overlay drawn in lockstep
      // with the real KiCanvas viewport (see LiveOverlay/KiCanvasAdapter).
      const boardArea = document.createElement('div');
      boardArea.className = 'kcv-board-area';

      liveOverlay = document.createElement('km-live-overlay');

      boardArea.appendChild(embed);
      boardArea.appendChild(loading);
      boardArea.appendChild(liveOverlay);

      rail = document.createElement('km-board-tools-rail');
      rail.addEventListener('km-board-preview', (e) => {
        const { kind, payload } = e.detail ?? {};
        liveOverlay.setPreview(kind ?? 'clear', payload ?? null);
      });

      const row = document.createElement('div');
      row.className = 'kcv-board-row';
      row.appendChild(boardArea);
      row.appendChild(rail);

      pane.appendChild(row);

      // Wire the adapter only once KiCanvas reports it has actually loaded a
      // board — `embed.viewer`/`viewer.camera` aren't guaranteed to exist
      // (or be meaningful) before that point.
      const wireAdapter = () => {
        if (adapter) adapter.destroy();
        adapter = new KiCanvasAdapter(embed);
        liveOverlay.attachAdapter(adapter);
      };
      embed.addEventListener('kicanvas:load', wireAdapter);
    } else {
      pane.appendChild(loading);
      pane.appendChild(embed);
    }

    this._el.appendChild(pane);

    this._panes.set(key, { pane, embed, src, loading, liveOverlay, rail, getAdapter: () => adapter });
  }

  _createEmbed(src, loadingEl) {
    const embed = document.createElement('kicanvas-embed');
    embed.setAttribute('src', src);
    embed.setAttribute('controls', '');

    const onLoad = () => {
      embed.classList.add('loaded');
      if (loadingEl) {
        loadingEl.classList.add('hidden');
        loadingEl.addEventListener('transitionend', () => loadingEl.remove(), { once: true });
      }
      this._updateLastRefresh();
    };

    embed.addEventListener('kicanvas:load', onLoad, { once: true });
    setTimeout(() => { if (!embed.classList.contains('loaded')) onLoad(); }, 10_000);

    return embed;
  }

  _doRefresh(state) {
    // Bust the URL so kicanvas re-fetches from disk (appends/updates ?t= param)
    const base = state.src.split('?')[0];
    const busted = `${base}?t=${Date.now()}`;

    // Show a brief loading overlay while re-parsing
    const loading = document.createElement('div');
    loading.className = 'kcv-loading';
    loading.innerHTML = `<div class="kcv-spinner"></div><span class="kcv-loading-label">Refreshing…</span>`;
    state.pane.appendChild(loading);

    state.embed.classList.remove('loaded');

    // Changing src triggers kicanvas attributeChangedCallback → reload
    state.embed.addEventListener('kicanvas:load', () => {
      state.embed.classList.add('loaded');
      loading.classList.add('hidden');
      loading.addEventListener('transitionend', () => loading.remove(), { once: true });
      this._updateLastRefresh();
    }, { once: true });

    // Safety fallback
    setTimeout(() => {
      if (!state.embed.classList.contains('loaded')) {
        state.embed.classList.add('loaded');
        loading.classList.add('hidden');
      }
    }, 10_000);

    state.embed.setAttribute('src', busted);
  }
}

export const kcvOverlay = new KiCanvasOverlay();
