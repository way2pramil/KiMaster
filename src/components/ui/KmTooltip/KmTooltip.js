/**
 * @element km-tooltip
 * @summary Liquid glass tooltip — backdrop blur, OLED surface, no border decoration.
 *
 * @attr {string} text
 * @attr {'top'|'bottom'|'left'|'right'} placement
 * @attr {number} delay
 */

const TEMPLATE = document.createElement('template');
TEMPLATE.innerHTML = `
<style>
  :host { display: inline-block; position: relative; }

  .tip {
    position: fixed;
    z-index: var(--km-z-tooltip);
    padding: var(--km-space-1-5) var(--km-space-2-5);
    /* Liquid glass — solid fallback avoids GPU compositor stall */
    background: #0e0e10;
    backdrop-filter: var(--km-backdrop-blur, none);
    -webkit-backdrop-filter: var(--km-backdrop-blur, none);
    border: 1px solid var(--km-border);
    border-radius: var(--km-radius-md);
    font-family: var(--km-font);
    font-size: var(--km-font-size-xs);
    color: var(--km-text-primary);
    white-space: nowrap;
    box-shadow: var(--km-shadow-md);
    pointer-events: none;
    opacity: 0;
    transform: translateY(4px) scale(0.97);
    transition:
      opacity   var(--km-duration-compress) var(--km-ease-compress),
      transform var(--km-duration-compress) var(--km-ease-compress);
    max-width: 260px;
    white-space: normal;
    text-align: center;
    line-height: 1.4;
  }
  .tip.visible {
    opacity: 1;
    transform: translateY(0) scale(1);
  }
</style>
<slot></slot>
<div class="tip" role="tooltip" part="tip"></div>
`;

export class KmTooltip extends HTMLElement {
  static get observedAttributes() { return ['text', 'placement']; }

  constructor() {
    super();
    this.attachShadow({ mode: 'open' });
    this.shadowRoot.appendChild(TEMPLATE.content.cloneNode(true));
    this._tip = this.shadowRoot.querySelector('.tip');
    this._showTimer = null;
  }

  connectedCallback() {
    this.addEventListener('mouseenter', this._onEnter);
    this.addEventListener('mouseleave', this._onLeave);
    this.addEventListener('focusin',    this._onEnter);
    this.addEventListener('focusout',   this._onLeave);
    this._tip.textContent = this.getAttribute('text') || '';
  }

  disconnectedCallback() {
    clearTimeout(this._showTimer);
    this.removeEventListener('mouseenter', this._onEnter);
    this.removeEventListener('mouseleave', this._onLeave);
    this.removeEventListener('focusin',    this._onEnter);
    this.removeEventListener('focusout',   this._onLeave);
  }

  attributeChangedCallback(name, _, value) {
    if (name === 'text') this._tip.textContent = value || '';
  }

  _onEnter = () => {
    const delay = parseInt(this.getAttribute('delay') ?? '380', 10);
    this._showTimer = setTimeout(() => this._show(), delay);
  };
  _onLeave = () => { clearTimeout(this._showTimer); this._hide(); };

  _show() {
    const placement = this.getAttribute('placement') || 'top';
    const rect = this.getBoundingClientRect();
    const gap  = 8;
    const tw   = 220;
    const th   = 32;

    let top, left;
    if (placement === 'top')    { top = rect.top - th - gap;                     left = rect.left + rect.width / 2 - tw / 2; }
    else if (placement === 'bottom') { top = rect.bottom + gap;                  left = rect.left + rect.width / 2 - tw / 2; }
    else if (placement === 'left')   { top = rect.top + rect.height / 2 - th / 2; left = rect.left - tw - gap; }
    else                             { top = rect.top + rect.height / 2 - th / 2; left = rect.right + gap; }

    this._tip.style.top  = `${Math.max(8, Math.min(top,  window.innerHeight - th  - 8))}px`;
    this._tip.style.left = `${Math.max(8, Math.min(left, window.innerWidth  - tw - 8))}px`;
    this._tip.classList.add('visible');
  }
  _hide() { this._tip.classList.remove('visible'); }
}

customElements.define('km-tooltip', KmTooltip);
