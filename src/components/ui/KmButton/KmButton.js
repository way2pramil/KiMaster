/**
 * @element km-button
 * @summary Linear-style button — compression feedback, edge-lit borders, no uppercase.
 *
 * @attr {'primary'|'secondary'|'ghost'|'danger'|'success'|'live'} variant
 * @attr {'sm'|'md'|'lg'} size
 * @attr {boolean} loading
 * @attr {boolean} disabled
 * @attr {boolean} icon-only
 *
 * @fires km-click
 */

import { AnimationKit } from '../../../design/animations/index.js';

const TEMPLATE = document.createElement('template');
TEMPLATE.innerHTML = `
<style>
  :host { display: inline-block; font-family: var(--km-font); flex-shrink: 0; }
  :host([hidden]) { display: none; }
  :host([disabled]) { pointer-events: none; }

  button {
    position: relative;
    overflow: hidden;
    display: inline-flex;
    align-items: center;
    justify-content: center;
    gap: var(--km-space-1-5);
    border: 1px solid transparent;
    border-radius: var(--km-radius-md);
    font-family: var(--km-font);
    font-weight: var(--km-font-weight-medium);
    cursor: pointer;
    white-space: nowrap;
    outline: none;
    user-select: none;
    -webkit-user-select: none;
    /* Compression transition — hardware-accelerated only */
    transition:
      background      var(--km-duration-compress) var(--km-ease-compress),
      border-color    var(--km-duration-compress) var(--km-ease-compress),
      box-shadow      var(--km-duration-compress) var(--km-ease-compress),
      color           var(--km-duration-compress) var(--km-ease-compress),
      transform       var(--km-duration-compress) var(--km-ease-compress),
      opacity         var(--km-duration-compress) var(--km-ease-compress);
  }

  /* ── Sizes ── */
  button.sm { height: 26px; padding: 0 var(--km-space-3);   font-size: var(--km-font-size-xs);  }
  button.md { height: 30px; padding: 0 var(--km-space-4);   font-size: var(--km-font-size-sm);  }
  button.lg { height: 36px; padding: 0 var(--km-space-5);   font-size: var(--km-font-size-md);  }

  button.icon-only.sm { width: 26px; padding: 0; }
  button.icon-only.md { width: 30px; padding: 0; }
  button.icon-only.lg { width: 36px; padding: 0; }

  /* ── Compression on press ── */
  button:active { transform: scale(0.98); }

  /* ── Primary — Cobalt Blue ── */
  button.primary {
    background: var(--km-accent);
    color: #fff;
    border-color: var(--km-accent);
    box-shadow: var(--km-bezel);
  }
  button.primary:hover  {
    background: var(--km-accent-hover);
    border-color: var(--km-accent-hover);
    box-shadow: var(--km-bezel), var(--km-shadow-glow);
  }
  button.primary:active { background: var(--km-accent-active); }

  /* ── Secondary ── */
  button.secondary {
    background: var(--km-bg-elevated);
    color: var(--km-text-primary);
    border-color: var(--km-border);
    box-shadow: var(--km-bezel);
  }
  button.secondary:hover {
    background: var(--km-bg-surface);
    border-color: var(--km-border-strong);
    color: var(--km-text-primary);
  }
  button.secondary:active { background: var(--km-bg-secondary); }

  /* ── Ghost ── */
  button.ghost {
    background: transparent;
    color: var(--km-text-secondary);
    border-color: transparent;
  }
  button.ghost:hover  { background: var(--km-bg-elevated); color: var(--km-text-primary); border-color: var(--km-border); }
  button.ghost:active { background: var(--km-bg-surface); }

  /* ── Danger ── */
  button.danger {
    background: var(--km-danger-muted);
    color: var(--km-danger);
    border-color: var(--km-border-danger);
    box-shadow: var(--km-bezel);
  }
  button.danger:hover  { background: var(--km-danger); color: #fff; box-shadow: var(--km-bezel), 0 0 12px rgba(239,68,68,0.35); }
  button.danger:active { filter: brightness(0.9); }

  /* ── Success ── */
  button.success {
    background: var(--km-success-muted);
    color: var(--km-success);
    border-color: var(--km-border-success);
    box-shadow: var(--km-bezel);
  }
  button.success:hover { background: var(--km-success); color: #000; }

  /* ── Live — Safety Cyan ── */
  button.live {
    background: var(--km-live-muted);
    color: var(--km-live);
    border-color: var(--km-live-border);
    box-shadow: var(--km-bezel);
  }
  button.live:hover { background: var(--km-live); color: #000; box-shadow: var(--km-bezel), var(--km-live-glow); }

  /* ── Disabled ── */
  button:disabled,
  button[disabled] {
    opacity: 0.35;
    cursor: not-allowed;
    pointer-events: none;
    transform: none;
    box-shadow: none;
  }

  /* ── Focus ── */
  button:focus-visible {
    outline: none;
    box-shadow: var(--km-focus-ring);
  }

  /* ── Loading ── */
  .spinner {
    display: none;
    width: 12px;
    height: 12px;
    border: 1.5px solid rgba(255,255,255,0.2);
    border-top-color: currentColor;
    border-radius: 50%;
    flex-shrink: 0;
  }
  button.loading .spinner { display: block; }
  button.loading .slot-content { opacity: 0.45; }

  slot[name="icon-left"], slot[name="icon-right"] { display: contents; line-height: 1; }
</style>
<button part="button">
  <span class="spinner" part="spinner"></span>
  <slot name="icon-left"></slot>
  <span class="slot-content"><slot></slot></span>
  <slot name="icon-right"></slot>
</button>
`;

export class KmButton extends HTMLElement {
  static get observedAttributes() {
    return ['variant', 'size', 'loading', 'disabled', 'icon-only', 'title', 'aria-label'];
  }

  constructor() {
    super();
    this.attachShadow({ mode: 'open' });
    this.shadowRoot.appendChild(TEMPLATE.content.cloneNode(true));
    this._btn = this.shadowRoot.querySelector('button');
    this._spinCancel = null;
  }

  connectedCallback() {
    this._render();
    this._btn.addEventListener('pointerdown', this._onPointerDown);
    this._btn.addEventListener('click', this._onClick);
  }

  disconnectedCallback() {
    this._btn.removeEventListener('pointerdown', this._onPointerDown);
    this._btn.removeEventListener('click', this._onClick);
    this._spinCancel?.();
  }

  attributeChangedCallback() { this._render(); }

  _render() {
    const variant  = this.getAttribute('variant') || 'primary';
    const size     = this.getAttribute('size') || 'md';
    const loading  = this.hasAttribute('loading');
    const disabled = this.hasAttribute('disabled');
    const iconOnly = this.hasAttribute('icon-only');

    this._btn.className = [variant, size,
      loading  ? 'loading'   : '',
      iconOnly ? 'icon-only' : '',
    ].filter(Boolean).join(' ');

    this._btn.disabled = disabled || loading;
    this._btn.setAttribute('aria-busy', String(loading));

    if (loading && !this._spinCancel) {
      this._spinCancel = AnimationKit.spin(this.shadowRoot.querySelector('.spinner'));
    } else if (!loading && this._spinCancel) {
      this._spinCancel();
      this._spinCancel = null;
    }

    // Forward tooltip + a11y attrs to the inner button. Critical for
    // icon-only buttons (no visible text), and for screen readers in
    // general.
    const title = this.getAttribute('title');
    const aria  = this.getAttribute('aria-label');
    if (title) this._btn.setAttribute('title', title); else this._btn.removeAttribute('title');
    if (aria)  this._btn.setAttribute('aria-label', aria); else this._btn.removeAttribute('aria-label');
  }

  _onPointerDown = (e) => { AnimationKit.ripple(this._btn, e); };
  _onClick = () => {
    this.dispatchEvent(new CustomEvent('km-click', { bubbles: true, composed: true }));
  };

  set loading(v) { v ? this.setAttribute('loading', '') : this.removeAttribute('loading'); }
  get loading()  { return this.hasAttribute('loading'); }
  set disabled(v) { v ? this.setAttribute('disabled', '') : this.removeAttribute('disabled'); }
  get disabled()  { return this.hasAttribute('disabled'); }
}

customElements.define('km-button', KmButton);
