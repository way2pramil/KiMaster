/**
 * @element km-dialog
 * @summary Modal dialog — native <dialog> element with Linear-style surface.
 *
 * @attr {boolean} open       — present = visible
 * @attr {string}  heading    — dialog title text
 * @attr {'sm'|'md'|'lg'} size — content width (default 'md')
 *
 * @slot                      — main body content
 * @slot footer               — action buttons row
 *
 * @fires km-close            — when dialog is dismissed (Escape, backdrop, close btn)
 *
 * Usage:
 *   <km-dialog heading="Confirm export" open>
 *     <p>Export 3 layers to gerbers?</p>
 *     <div slot="footer">
 *       <km-button variant="ghost"   id="cancel">Cancel</km-button>
 *       <km-button variant="primary" id="confirm">Export</km-button>
 *     </div>
 *   </km-dialog>
 */

const TEMPLATE = document.createElement('template');
TEMPLATE.innerHTML = `
<style>
  /* ── Host ── */
  :host { display: contents; }
  :host(:not([open])) .overlay { display: none; }

  /* ── Overlay / backdrop ── */
  .overlay {
    position: fixed;
    inset: 0;
    z-index: var(--km-z-dialog, 400);
    display: flex;
    align-items: center;
    justify-content: center;
    background: rgba(0, 0, 0, 0.60);
    backdrop-filter: var(--km-backdrop-blur, none);
    -webkit-backdrop-filter: var(--km-backdrop-blur, none);
    animation: overlay-in var(--km-duration-base) var(--km-ease-compress) both;
  }

  /* ── Dialog panel ── */
  .panel {
    position: relative;
    display: flex;
    flex-direction: column;
    background: var(--km-bg-elevated);
    border: 1px solid var(--km-border);
    border-radius: var(--km-radius-lg);
    box-shadow: var(--km-shadow-lg), var(--km-bezel);
    max-height: calc(100vh - 80px);
    width: var(--dialog-width, 480px);
    overflow: hidden;
    animation: panel-in var(--km-duration-base) var(--km-ease-compress) both;
  }

  /* sizes */
  :host([size="sm"]) .panel { --dialog-width: 360px; }
  :host([size="md"]) .panel { --dialog-width: 480px; }
  :host([size="lg"]) .panel { --dialog-width: 640px; }

  /* ── Header ── */
  .header {
    display: flex;
    align-items: center;
    justify-content: space-between;
    padding: var(--km-space-4) var(--km-space-5);
    border-bottom: 1px solid var(--km-border);
    flex-shrink: 0;
  }
  .heading {
    font-family: var(--km-font);
    font-size: var(--km-font-size-base);
    font-weight: var(--km-font-weight-semibold);
    color: var(--km-text-primary);
    margin: 0;
  }
  .close-btn {
    display: flex;
    align-items: center;
    justify-content: center;
    width: 24px;
    height: 24px;
    border: none;
    background: transparent;
    border-radius: var(--km-radius-sm);
    color: var(--km-text-muted);
    cursor: pointer;
    padding: 0;
    transition: color var(--km-duration-compress) var(--km-ease-compress),
                background var(--km-duration-compress) var(--km-ease-compress);
  }
  .close-btn:hover  { color: var(--km-text-primary); background: var(--km-bg-surface); }
  .close-btn:active { transform: scale(0.94); }

  /* ── Body ── */
  .body {
    flex: 1;
    overflow-y: auto;
    padding: var(--km-space-5);
    color: var(--km-text-secondary);
    font-family: var(--km-font);
    font-size: var(--km-font-size-base);
    line-height: 1.55;
  }

  /* ── Footer ── */
  .footer {
    display: flex;
    align-items: center;
    justify-content: flex-end;
    gap: var(--km-space-2);
    padding: var(--km-space-3) var(--km-space-5);
    border-top: 1px solid var(--km-border);
    flex-shrink: 0;
  }
  /* hide footer if slot has no content */
  .footer:not(:has(slot[name="footer"] *)) { display: none; }

  /* ── Animations ── */
  @keyframes overlay-in {
    from { opacity: 0; }
    to   { opacity: 1; }
  }
  @keyframes panel-in {
    from { opacity: 0; transform: translateY(8px) scale(0.97); }
    to   { opacity: 1; transform: translateY(0)   scale(1);    }
  }
</style>

<div class="overlay" part="overlay" role="presentation">
  <div class="panel" part="panel" role="dialog" aria-modal="true" aria-labelledby="dlg-heading">
    <div class="header" part="header">
      <h2 class="heading" id="dlg-heading"></h2>
      <button class="close-btn" id="close-btn" aria-label="Close dialog" type="button">
        <svg width="14" height="14" viewBox="0 0 14 14" fill="none">
          <path d="M1 1l12 12M13 1L1 13" stroke="currentColor" stroke-width="1.8" stroke-linecap="round"/>
        </svg>
      </button>
    </div>
    <div class="body" part="body">
      <slot></slot>
    </div>
    <div class="footer" part="footer">
      <slot name="footer"></slot>
    </div>
  </div>
</div>
`;

export class KmDialog extends HTMLElement {
  static get observedAttributes() { return ['open', 'heading', 'size']; }

  constructor() {
    super();
    this.attachShadow({ mode: 'open' });
    this.shadowRoot.appendChild(TEMPLATE.content.cloneNode(true));

    this._overlay  = this.shadowRoot.querySelector('.overlay');
    this._panel    = this.shadowRoot.querySelector('.panel');
    this._heading  = this.shadowRoot.querySelector('.heading');
    this._closeBtn = this.shadowRoot.getElementById('close-btn');

    this._onOverlayClick = this._onOverlayClick.bind(this);
    this._onKeyDown      = this._onKeyDown.bind(this);
    this._onCloseBtn     = () => this.close();
  }

  connectedCallback() {
    this._overlay.addEventListener('click', this._onOverlayClick);
    this._closeBtn.addEventListener('click',  this._onCloseBtn);
    document.addEventListener('keydown', this._onKeyDown);
    this._heading.textContent = this.getAttribute('heading') || '';
  }

  disconnectedCallback() {
    this._overlay.removeEventListener('click', this._onOverlayClick);
    this._closeBtn.removeEventListener('click',  this._onCloseBtn);
    document.removeEventListener('keydown', this._onKeyDown);
  }

  attributeChangedCallback(name, _, value) {
    if (name === 'heading') this._heading.textContent = value || '';
    if (name === 'open' && value !== null) this._trapFocus();
  }

  /** Open the dialog programmatically. */
  show() { this.setAttribute('open', ''); }

  /** Close the dialog programmatically — fires km-close. */
  close() {
    this.removeAttribute('open');
    this.dispatchEvent(new CustomEvent('km-close', { bubbles: true, composed: true }));
  }

  // ── Private ────────────────────────────────────────────────────────────────

  _onOverlayClick(e) {
    // Close only if click lands on the overlay itself, not the panel
    if (e.target === this._overlay) this.close();
  }

  _onKeyDown(e) {
    if (!this.hasAttribute('open')) return;
    if (e.key === 'Escape') { e.preventDefault(); this.close(); }
    if (e.key === 'Tab') this._handleTab(e);
  }

  _trapFocus() {
    // Move focus into the dialog on open
    requestAnimationFrame(() => {
      const focusable = this._getFocusable();
      if (focusable.length) focusable[0].focus();
    });
  }

  _handleTab(e) {
    const focusable = this._getFocusable();
    if (!focusable.length) return;
    const first = focusable[0];
    const last  = focusable[focusable.length - 1];
    if (e.shiftKey) {
      if (document.activeElement === first) { e.preventDefault(); last.focus(); }
    } else {
      if (document.activeElement === last) { e.preventDefault(); first.focus(); }
    }
  }

  _getFocusable() {
    const sel = 'button, [href], input, select, textarea, [tabindex]:not([tabindex="-1"])';
    return [
      ...this._panel.querySelectorAll(sel),
      // Also check slotted content
      ...this.querySelectorAll(sel),
    ].filter(el => !el.disabled && !el.closest('[hidden]'));
  }
}

customElements.define('km-dialog', KmDialog);
