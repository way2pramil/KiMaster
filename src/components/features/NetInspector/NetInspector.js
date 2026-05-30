/**
 * @element km-net-inspector
 * @summary Net analytics panel — pad/via/track counts, total trace length,
 *          min/max width, layer usage, connected components.
 *
 * Subscribes to `store.netInfo` which is populated by `BridgeClient._onNetInfo`
 * after `requestNetInfo(net)` fires the `bridge:net_info` Tauri event.
 *
 * Set the inspected net by calling `inspect(netName)` or by setting the
 * `net` attribute. Empty state otherwise.
 *
 * @fires km-net-inspector-ref-click — { ref }  (user clicked a connected component)
 */

import { store, subscribe } from '../../../core/State.js';
import { Logger             } from '../../../core/Logger.js';
import { requestNetInfo, highlightComponent } from '../../../modules/kicad-bridge/BridgeClient.js';

const TEMPLATE = document.createElement('template');
TEMPLATE.innerHTML = `
<style>
  :host {
    display: flex;
    flex-direction: column;
    height: 100%;
    overflow: hidden;
    background: var(--km-bg-surface);
    border: 1px solid var(--km-border);
    border-radius: var(--km-radius-md);
    font-family: var(--km-font);
    color: var(--km-text-primary);
  }

  /* ── Header ── */
  .header {
    display: flex;
    align-items: center;
    gap: var(--km-space-2);
    padding: var(--km-space-2) var(--km-space-3);
    border-bottom: 1px solid var(--km-border);
    background: var(--km-bg-elevated);
    flex-shrink: 0;
  }
  .header__icon {
    color: var(--km-cyan);
    flex-shrink: 0;
  }
  .header__net {
    font-family: var(--km-font-mono);
    font-size: var(--km-font-size-md);
    color: var(--km-text-primary);
    flex: 1;
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
  }
  .header__net.empty { color: var(--km-text-muted); font-family: var(--km-font); font-style: italic; }
  .header__close {
    background: none;
    border: none;
    color: var(--km-text-muted);
    cursor: pointer;
    padding: 2px;
    line-height: 1;
    font-size: 14px;
  }
  .header__close:hover { color: var(--km-text-primary); }
  .header__close.hidden { display: none; }

  /* ── Body ── */
  .body {
    flex: 1;
    overflow: auto;
    padding: var(--km-space-3);
  }

  /* ── Stats grid ── */
  .stats-grid {
    display: grid;
    grid-template-columns: 1fr 1fr;
    gap: var(--km-space-2);
    margin-bottom: var(--km-space-3);
  }
  .stat-tile {
    background: var(--km-bg-primary);
    border: 1px solid var(--km-border);
    border-radius: var(--km-radius-sm);
    padding: var(--km-space-2);
  }
  .stat-tile__label {
    font-size: var(--km-font-size-xs);
    color: var(--km-text-muted);
    margin-bottom: 2px;
  }
  .stat-tile__value {
    font-family: var(--km-font-mono);
    font-size: var(--km-font-size-md);
    font-variant-numeric: tabular-nums;
    color: var(--km-text-primary);
  }
  .stat-tile__value.accent { color: var(--km-cyan); }
  .stat-tile__value.trace  { color: var(--km-trace); }
  .stat-tile__sub {
    font-size: var(--km-font-size-xs);
    color: var(--km-text-muted);
    font-variant-numeric: tabular-nums;
    margin-top: 2px;
  }

  /* ── Section ── */
  .section {
    margin-top: var(--km-space-3);
  }
  .section__title {
    font-size: var(--km-font-size-xs);
    color: var(--km-text-muted);
    text-transform: lowercase;
    margin-bottom: var(--km-space-1);
    letter-spacing: 0.02em;
  }
  .section__title .count {
    font-variant-numeric: tabular-nums;
    color: var(--km-text-secondary);
    margin-left: 4px;
  }

  /* ── Chip list ── */
  .chips {
    display: flex;
    flex-wrap: wrap;
    gap: var(--km-space-1);
  }
  .chip {
    display: inline-flex;
    align-items: center;
    padding: 2px 7px;
    background: var(--km-bg-primary);
    border: 1px solid var(--km-border);
    border-radius: var(--km-radius-xs);
    font-family: var(--km-font-mono);
    font-size: var(--km-font-size-xs);
    color: var(--km-text-secondary);
    cursor: default;
    transition: color var(--km-duration-fast) var(--km-ease),
                border-color var(--km-duration-fast) var(--km-ease);
  }
  .chip.layer-chip { color: var(--km-text-secondary); }
  .chip.ref-chip {
    color: var(--km-accent);
    border-color: var(--km-accent-border);
    cursor: pointer;
  }
  .chip.ref-chip:hover {
    background: var(--km-accent-muted);
    border-color: var(--km-accent);
  }

  /* ── Empty / loading state ── */
  .empty,
  .loading,
  .err {
    display: flex;
    flex-direction: column;
    align-items: center;
    justify-content: center;
    height: 100%;
    gap: var(--km-space-2);
    color: var(--km-text-muted);
    font-size: var(--km-font-size-sm);
    text-align: center;
    padding: var(--km-space-6) var(--km-space-3);
  }
  .empty km-icon { opacity: 0.3; }
  .err { color: var(--km-red); }

  .spinner {
    width: 22px;
    height: 22px;
    border: 2px solid var(--km-border);
    border-top-color: var(--km-cyan);
    border-radius: 50%;
    animation: spin 0.8s linear infinite;
  }
  @keyframes spin { to { transform: rotate(360deg); } }

  /* ── Footer ── */
  .footer {
    padding: var(--km-space-2) var(--km-space-3);
    border-top: 1px solid var(--km-border);
    background: var(--km-bg-elevated);
    display: flex;
    gap: var(--km-space-2);
    flex-shrink: 0;
  }
  .footer.hidden { display: none; }
  .footer km-button { flex: 1; }
</style>

<div class="header">
  <km-icon name="net" size="sm" class="header__icon"></km-icon>
  <span class="header__net empty" id="net-name">No net selected</span>
  <button class="header__close hidden" id="btn-close" title="Clear">✕</button>
</div>

<div class="body" id="body">
  <div class="empty">
    <km-icon name="net" size="xl"></km-icon>
    <span>Select a net to see traces, vias, layers,<br/>and connected components.</span>
  </div>
</div>

<div class="footer hidden" id="footer">
  <km-button variant="ghost"     size="sm" id="btn-highlight">Highlight in KiCad</km-button>
  <km-button variant="secondary" size="sm" id="btn-refresh">Refresh</km-button>
</div>
`;

export class KmNetInspector extends HTMLElement {
  static get observedAttributes() { return ['net']; }

  constructor() {
    super();
    this.attachShadow({ mode: 'open' });
    this.shadowRoot.appendChild(TEMPLATE.content.cloneNode(true));

    /** @type {string|null} */
    this._currentNet = null;
    this._unsubs = [];
  }

  connectedCallback() {
    this._unsubs.push(
      subscribe('netInfo', () => this._render()),
    );

    this.shadowRoot.getElementById('btn-close')
      ?.addEventListener('click', () => this.clear());
    this.shadowRoot.getElementById('btn-highlight')
      ?.addEventListener('km-click', () => {
        if (this._currentNet) {
          import('../../../modules/kicad-bridge/BridgeClient.js')
            .then(m => m.highlightNet(this._currentNet))
            .catch(err => Logger.warn('NetInspector', 'highlightNet failed', err));
        }
      });
    this.shadowRoot.getElementById('btn-refresh')
      ?.addEventListener('km-click', () => {
        if (this._currentNet) this.inspect(this._currentNet);
      });

    this._render();
  }

  disconnectedCallback() {
    for (const u of this._unsubs) u();
    this._unsubs = [];
  }

  attributeChangedCallback(name, _old, value) {
    if (name === 'net' && value) this.inspect(value);
  }

  // ── Public API ────────────────────────────────────────────────────────────

  /**
   * Inspect a net by name. Triggers `requestNetInfo` and updates the UI.
   * @param {string} net
   */
  inspect(net) {
    if (!net) return;
    this._currentNet = net;
    requestNetInfo(net).catch(err => Logger.warn('NetInspector', 'requestNetInfo failed', err));
  }

  /** Clear the panel. */
  clear() {
    this._currentNet = null;
    store.netInfo = null;
    this._render();
  }

  // ── Render ────────────────────────────────────────────────────────────────

  _render() {
    const body    = this.shadowRoot.getElementById('body');
    const footer  = this.shadowRoot.getElementById('footer');
    const netName = this.shadowRoot.getElementById('net-name');
    const close   = this.shadowRoot.getElementById('btn-close');

    if (!this._currentNet) {
      netName.textContent = 'No net selected';
      netName.classList.add('empty');
      close.classList.add('hidden');
      footer.classList.add('hidden');
      body.innerHTML = `
        <div class="empty">
          <km-icon name="net" size="xl"></km-icon>
          <span>Select a net to see traces, vias, layers,<br/>and connected components.</span>
        </div>
      `;
      return;
    }

    netName.textContent = this._currentNet;
    netName.classList.remove('empty');
    close.classList.remove('hidden');
    footer.classList.remove('hidden');

    const info = store.netInfo;

    // Loading
    if (!info || (info.loading && info.net === this._currentNet)) {
      body.innerHTML = `
        <div class="loading">
          <div class="spinner"></div>
          <span>Querying KiCad …</span>
        </div>
      `;
      return;
    }

    // Stale (info is for a different net)
    if (info.net && info.net !== this._currentNet) {
      body.innerHTML = `<div class="loading"><div class="spinner"></div></div>`;
      return;
    }

    // Error or not found
    if (info.error || info.found === false) {
      body.innerHTML = `
        <div class="err">
          <km-icon name="warning" size="lg"></km-icon>
          <span>${esc(info.error || `Net "${this._currentNet}" not found`)}</span>
        </div>
      `;
      return;
    }

    // Render full report
    body.innerHTML = `
      <div class="stats-grid">
        <div class="stat-tile">
          <div class="stat-tile__label">Pads</div>
          <div class="stat-tile__value accent">${info.pad_count ?? 0}</div>
        </div>
        <div class="stat-tile">
          <div class="stat-tile__label">Vias</div>
          <div class="stat-tile__value">${info.via_count ?? 0}</div>
        </div>
        <div class="stat-tile">
          <div class="stat-tile__label">Tracks</div>
          <div class="stat-tile__value">${info.track_count ?? 0}</div>
        </div>
        <div class="stat-tile">
          <div class="stat-tile__label">Total length</div>
          <div class="stat-tile__value trace">${_fmtMm(info.total_length_mm)}</div>
          <div class="stat-tile__sub">${_fmtIn(info.total_length_mm)}</div>
        </div>
      </div>

      ${(info.min_width_mm > 0 || info.max_width_mm > 0) ? `
        <div class="stats-grid">
          <div class="stat-tile">
            <div class="stat-tile__label">Min width</div>
            <div class="stat-tile__value">${_fmtMm(info.min_width_mm)}</div>
          </div>
          <div class="stat-tile">
            <div class="stat-tile__label">Max width</div>
            <div class="stat-tile__value">${_fmtMm(info.max_width_mm)}</div>
          </div>
        </div>
      ` : ''}

      <div class="section">
        <div class="section__title">Layers <span class="count">${(info.layers ?? []).length}</span></div>
        <div class="chips">
          ${(info.layers ?? []).map(l => `<span class="chip layer-chip">${esc(l)}</span>`).join('')
            || '<span class="chip layer-chip" style="opacity:0.5">none</span>'}
        </div>
      </div>

      <div class="section">
        <div class="section__title">Connected components <span class="count">${(info.connected_refs ?? []).length}</span></div>
        <div class="chips" id="ref-chips">
          ${(info.connected_refs ?? []).map(r =>
            `<button class="chip ref-chip" data-ref="${esc(r)}" title="Highlight ${esc(r)}">${esc(r)}</button>`
          ).join('') || '<span class="chip" style="opacity:0.5">none</span>'}
        </div>
      </div>
    `;

    // Wire ref-chip clicks
    for (const btn of body.querySelectorAll('.ref-chip[data-ref]')) {
      btn.addEventListener('click', () => {
        const ref = btn.dataset.ref;
        highlightComponent(ref).catch(err => Logger.warn('NetInspector', 'highlightComponent failed', err));
        this.dispatchEvent(new CustomEvent('km-net-inspector-ref-click', {
          bubbles: true, composed: true,
          detail: { ref },
        }));
      });
    }
  }
}

// ── Helpers ───────────────────────────────────────────────────────────────────

function esc(s) {
  const d = document.createElement('div');
  d.textContent = String(s ?? '');
  return d.innerHTML;
}

/** Format mm with 2-3 decimal places. */
function _fmtMm(v) {
  if (v == null || isNaN(v)) return '—';
  const n = Number(v);
  if (Math.abs(n) >= 100) return `${n.toFixed(1)} mm`;
  if (Math.abs(n) >= 10)  return `${n.toFixed(2)} mm`;
  return `${n.toFixed(3)} mm`;
}

/** Convert mm → inches for "sub" display. */
function _fmtIn(mm) {
  if (mm == null || isNaN(mm) || mm <= 0) return '';
  return `${(Number(mm) / 25.4).toFixed(3)} in`;
}

customElements.define('km-net-inspector', KmNetInspector);
