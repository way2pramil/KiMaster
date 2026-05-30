/**
 * @element km-card
 * @summary Skeuomorphic Minimalism card — edge-lit bezel, OLED surface, tiered hover.
 *
 * @attr {boolean} hoverable
 * @attr {boolean} selected
 * @attr {'sm'|'md'|'lg'} padding
 * @attr {'default'|'live'|'accent'} variant
 *
 * @slot header
 * @slot default
 * @slot footer
 */

import { AnimationKit } from '../../../design/animations/index.js';

const TEMPLATE = document.createElement('template');
TEMPLATE.innerHTML = `
<style>
  :host { display: block; font-family: var(--km-font); }
  :host([hidden]) { display: none; }

  .card {
    background: var(--km-bg-surface);
    border: 1px solid var(--km-border);
    border-radius: var(--km-radius-md);
    /* Skeuomorphic top-edge bezel sheen */
    box-shadow: var(--km-bezel);
    overflow: hidden;
    transition:
      background      var(--km-duration-compress) var(--km-ease-compress),
      border-color    var(--km-duration-compress) var(--km-ease-compress),
      box-shadow      var(--km-duration-compress) var(--km-ease-compress),
      transform       var(--km-duration-compress) var(--km-ease-compress);
  }

  /* Hoverable: tier up one level on hover */
  :host([hoverable]) .card:hover {
    background: var(--km-bg-elevated);
    border-color: var(--km-border-strong);
    box-shadow: var(--km-bezel-strong), var(--km-shadow-sm);
  }

  /* Live variant — Safety Cyan accent */
  :host([variant="live"]) .card {
    border-color: var(--km-live-border);
    box-shadow: var(--km-bezel), inset 0 0 0 1px var(--km-live-border);
  }

  /* Accent variant — Cobalt Blue */
  :host([variant="accent"]) .card {
    border-color: var(--km-accent-border);
    box-shadow: var(--km-bezel), var(--km-shadow-glow);
  }

  /* Selected — Cobalt Blue ring */
  :host([selected]) .card {
    border-color: var(--km-accent-border);
    box-shadow: var(--km-bezel), 0 0 0 1px var(--km-accent-border), var(--km-shadow-glow);
  }

  .header {
    padding: var(--km-space-2-5) var(--km-space-4);
    border-bottom: 1px solid var(--km-border);
    font-size: var(--km-font-size-sm);
    font-weight: var(--km-font-weight-medium);
    color: var(--km-text-primary);
    background: var(--km-bg-elevated);
  }
  .header:empty { display: none; }

  .body { padding: var(--km-space-4); }
  :host([padding="sm"]) .body { padding: var(--km-space-2-5); }
  :host([padding="lg"]) .body { padding: var(--km-space-6); }
  :host([padding="none"]) .body { padding: 0; }

  .footer {
    padding: var(--km-space-2-5) var(--km-space-4);
    border-top: 1px solid var(--km-border);
    background: var(--km-bg-elevated);
  }
  .footer:empty { display: none; }
</style>
<div class="card" part="card">
  <div class="header" part="header"><slot name="header"></slot></div>
  <div class="body"   part="body"  ><slot></slot></div>
  <div class="footer" part="footer"><slot name="footer"></slot></div>
</div>
`;

export class KmCard extends HTMLElement {
  static get observedAttributes() { return ['hoverable', 'selected', 'variant']; }

  constructor() {
    super();
    this.attachShadow({ mode: 'open' });
    this.shadowRoot.appendChild(TEMPLATE.content.cloneNode(true));
    this._card = this.shadowRoot.querySelector('.card');
  }

  connectedCallback() {
    if (this.hasAttribute('hoverable')) this._attachHover();
  }

  disconnectedCallback() {
    this._card.removeEventListener('mouseenter', this._onEnter);
    this._card.removeEventListener('mouseleave', this._onLeave);
  }

  attributeChangedCallback(name) {
    if (name === 'hoverable') {
      if (this.hasAttribute('hoverable')) this._attachHover();
      else {
        this._card.removeEventListener('mouseenter', this._onEnter);
        this._card.removeEventListener('mouseleave', this._onLeave);
      }
    }
  }

  _attachHover() {
    this._card.addEventListener('mouseenter', this._onEnter);
    this._card.addEventListener('mouseleave', this._onLeave);
  }

  _onEnter = () => AnimationKit.hoverLift(this._card, 1);
  _onLeave = () => AnimationKit.hoverLiftReset(this._card);
}

customElements.define('km-card', KmCard);
