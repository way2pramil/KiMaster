/**
 * @element km-wgt-shell
 * @summary Frame for dashboard widgets. Owns the header (icon + label + badge)
 *          and the four-state body renderer (loading / ok / empty / error).
 *
 * @attr {string}  icon     - km-icon name (e.g. "folder-tree", "cpu")
 * @attr {string}  label    - widget title in the header
 * @attr {string}  badge    - optional badge text (e.g. count). Hidden when empty.
 * @attr {'loading'|'ok'|'empty'|'error'} state - current body state
 *
 * @slot header  - optional right-side header content (replaces badge)
 * @slot footer  - optional footer below the body
 *
 * Fires nothing. The parent widget is expected to set `state` and dispatch
 * `km-shell-render` when its render output changes.
 *
 * @example
 *   <km-wgt-shell icon="cpu" label="Board info" badge="12" state="ok">
 *     <div>...rendered content...</div>
 *     <button slot="footer">Refresh</button>
 *   </km-wgt-shell>
 */

const TEMPLATE = document.createElement('template');
TEMPLATE.innerHTML = /* html */`
<style>
  :host {
    display: flex;
    flex-direction: column;
    height: 100%;
    min-height: 0;
    font-family: var(--km-font);
    color: var(--km-text-primary);
    overflow: hidden;
    container-type: inline-size;
  }

  /* ── Header ─────────────────────────────────────────────────── */
  .hdr {
    display: flex;
    align-items: center;
    gap: 8px;
    padding: 14px 16px 0;
    flex-shrink: 0;
  }
  .hdr-icon {
    opacity: 0.5;
    flex-shrink: 0;
    display: inline-flex;
    align-items: center;
    transition: opacity 0.15s, color 0.15s;
  }
  :host(:hover) .hdr-icon { opacity: 0.75; }
  .hdr-label {
    font-size: 11px;
    font-weight: 600;
    color: var(--km-text-secondary);
    flex: 1;
    letter-spacing: 0.025em;
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
  }
  .hdr-right {
    display: inline-flex;
    align-items: center;
    gap: 6px;
    flex-shrink: 0;
  }
  .hdr-badge {
    font-size: 10px;
    font-family: var(--km-font-mono);
    font-weight: 600;
    color: var(--km-accent-hover);
    background: var(--km-accent-muted);
    border: 1px solid var(--km-accent-border);
    padding: 1px 6px;
    border-radius: 4px;
    font-variant-numeric: tabular-nums;
    line-height: 1.4;
  }
  .hdr-badge:empty { display: none; }
  ::slotted([slot="header"]) { display: contents; }

  /* ── Body ───────────────────────────────────────────────────── */
  .body {
    flex: 1;
    min-height: 0;
    overflow: hidden;
    padding: 12px 16px;
    display: flex;
    flex-direction: column;
    position: relative;
  }
  .body.scroll { overflow-y: auto; }
  .body.no-pad { padding: 0; }
  ::slotted([slot="footer"]) { display: contents; }

  /* ── Footer ─────────────────────────────────────────────────── */
  .ftr {
    padding: 0 16px 12px;
    display: flex;
    align-items: center;
    justify-content: flex-end;
    flex-shrink: 0;
    gap: 8px;
  }
  .ftr:empty { display: none; }

  /* ── State overlays ─────────────────────────────────────────── */
  .state {
    position: absolute;
    inset: 0;
    display: flex;
    flex-direction: column;
    align-items: center;
    justify-content: center;
    gap: 10px;
    text-align: center;
    padding: 20px;
    color: var(--km-text-muted);
    background: inherit;
    pointer-events: auto;
    animation: shell-state-in 0.18s var(--km-ease);
  }
  @keyframes shell-state-in {
    from { opacity: 0; transform: translateY(2px); }
    to   { opacity: 1; transform: translateY(0); }
  }
  .state-icon {
    width: 28px; height: 28px;
    display: inline-flex; align-items: center; justify-content: center;
    border-radius: 50%;
    background: var(--km-alpha-04);
    border: 1px solid var(--km-alpha-06);
    color: var(--km-text-muted);
  }
  :host([state="loading"]) .state-icon {
    color: var(--km-accent-hover);
    border-color: var(--km-accent-border);
    background: var(--km-accent-muted);
  }
  :host([state="error"]) .state-icon {
    color: var(--km-danger, #ef4444);
    border-color: var(--km-border-danger, rgba(239,68,68,0.25));
    background: var(--km-danger-muted, rgba(239,68,68,0.08));
  }
  :host([state="empty"]) .state-icon { opacity: 0.6; }
  .state-msg {
    font-size: 12px;
    line-height: 1.45;
    max-width: 22em;
  }
  .state-act { margin-top: 4px; }
  .state-act button {
    background: none;
    border: 1px solid var(--km-alpha-15);
    color: var(--km-text-secondary);
    font: 500 11px/1 var(--km-font);
    cursor: pointer;
    padding: 5px 10px;
    border-radius: 7px;
    transition: all 0.15s;
  }
  .state-act button:hover {
    border-color: var(--km-accent-border);
    color: var(--km-accent-hover);
    background: var(--km-accent-muted);
  }

  /* Spinner for loading */
  .spinner {
    width: 14px; height: 14px;
    border: 2px solid var(--km-accent-border);
    border-top-color: var(--km-accent-hover);
    border-radius: 50%;
    animation: shell-spin 0.8s linear infinite;
  }
  @keyframes shell-spin { to { transform: rotate(360deg); } }
</style>

<div class="hdr">
  <span class="hdr-icon"><km-icon name=""></km-icon></span>
  <span class="hdr-label"></span>
  <span class="hdr-right">
    <span class="hdr-badge"></span>
    <slot name="header"></slot>
  </span>
</div>

<div class="body" part="body">
  <slot></slot>
  <div class="state" part="state" hidden>
    <span class="state-icon"></span>
    <span class="state-msg"></span>
    <div class="state-act"></div>
  </div>
</div>

<div class="ftr" part="footer">
  <slot name="footer"></slot>
</div>
`;

class KmWgtShell extends HTMLElement {
  static get observedAttributes() { return ['icon', 'label', 'badge', 'state']; }

  constructor() {
    super();
    this.attachShadow({ mode: 'open' });
    this.shadowRoot.appendChild(TEMPLATE.content.cloneNode(true));
    this._$icon   = this.shadowRoot.querySelector('.hdr-icon km-icon');
    this._$label  = this.shadowRoot.querySelector('.hdr-label');
    this._$badge  = this.shadowRoot.querySelector('.hdr-badge');
    this._$state  = this.shadowRoot.querySelector('.state');
    this._$stateIcon = this.shadowRoot.querySelector('.state-icon');
    this._$stateMsg  = this.shadowRoot.querySelector('.state-msg');
    this._$stateAct  = this.shadowRoot.querySelector('.state-act');
    this._$body   = this.shadowRoot.querySelector('.body');
    this._$footer = this.shadowRoot.querySelector('.ftr');
  }

  connectedCallback() {
    this._syncAll();
  }

  attributeChangedCallback(name) {
    if (!this.isConnected) return;
    this._syncOne(name);
  }

  // ── Public helpers ─────────────────────────────────────────────

  /**
   * Programmatically show a state with a custom message, icon, and optional action.
   * @param {'loading'|'ok'|'empty'|'error'} state
   * @param {{ icon?: string, message?: string, action?: { label: string, onClick: () => void } }} [opts]
   */
  setStateMessage(state, opts = {}) {
    this.setAttribute('state', state);
    if (opts.message != null) this._$stateMsg.textContent = opts.message;
    if (opts.icon != null) this._$stateIcon.innerHTML = opts.icon;
    else this._setDefaultStateIcon(state);
    this._$stateAct.innerHTML = '';
    if (opts.action) {
      const btn = document.createElement('button');
      btn.textContent = opts.action.label;
      btn.addEventListener('click', opts.action.onClick);
      this._$stateAct.appendChild(btn);
    }
  }

  /**
   * Set body class to enable scroll or remove padding.
   * @param {'scroll'|'no-pad'|null} mod
   */
  setBodyMod(mod) {
    this._$body.classList.toggle('scroll', mod === 'scroll');
    this._$body.classList.toggle('no-pad', mod === 'no-pad');
  }

  // ── Sync ──────────────────────────────────────────────────────

  _syncAll() {
    this._syncOne('icon'); this._syncOne('label');
    this._syncOne('badge'); this._syncOne('state');
  }

  _syncOne(name) {
    switch (name) {
      case 'icon': {
        const v = this.getAttribute('icon') ?? '';
        if (this._$icon.getAttribute('name') !== v) this._$icon.setAttribute('name', v);
        break;
      }
      case 'label':  this._$label.textContent = this.getAttribute('label') ?? ''; break;
      case 'badge':  this._$badge.textContent = this.getAttribute('badge') ?? ''; break;
      case 'state':  this._syncState(); break;
    }
  }

  _syncState() {
    const s = this.getAttribute('state') || 'ok';
    const isOverlay = s === 'loading' || s === 'empty' || s === 'error';
    this._$state.hidden = !isOverlay;
    if (isOverlay) {
      this._$stateMsg.textContent = this._defaultStateMessage(s);
      this._setDefaultStateIcon(s);
      this._$stateAct.innerHTML = '';
    }
  }

  _setDefaultStateIcon(state) {
    if (state === 'loading') {
      this._$stateIcon.innerHTML = '<span class="spinner"></span>';
      return;
    }
    if (state === 'error') {
      // Alert-triangle SVG (inline so we don't depend on a km-icon entry)
      this._$stateIcon.innerHTML = `<svg viewBox="0 0 24 24" width="14" height="14" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="m21.73 18-8-14a2 2 0 0 0-3.48 0l-8 14A2 2 0 0 0 4 21h16a2 2 0 0 0 1.73-3Z"/><path d="M12 9v4"/><path d="M12 17h.01"/></svg>`;
      return;
    }
    // empty
    this._$stateIcon.innerHTML = `<svg viewBox="0 0 24 24" width="14" height="14" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="12" r="10"/><path d="M8 12h8"/></svg>`;
  }

  _defaultStateMessage(state) {
    return state === 'loading' ? 'Loading…'
         : state === 'empty'   ? 'Nothing to show yet'
         : state === 'error'   ? 'Something went wrong'
         : '';
  }
}

customElements.define('km-wgt-shell', KmWgtShell);
export { KmWgtShell };
