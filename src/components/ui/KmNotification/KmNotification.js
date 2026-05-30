/**
 * @element km-notification
 * @summary Armory Crate style toast — accent left bar, dark surface, smooth slide.
 *
 * @attr {'success'|'warning'|'error'|'info'} type
 * @attr {number} duration
 * @attr {string} message
 * @attr {string} title
 *
 * @fires km-dismiss
 */

import { AnimationKit } from '../../../design/animations/index.js';

const TYPE_CONFIG = {
  success: { color: 'var(--km-success)', icon: `<svg viewBox="0 0 16 16"><path d="M3 8l3.5 3.5L13 5" stroke="currentColor" stroke-width="1.8" fill="none" stroke-linecap="round" stroke-linejoin="round"/></svg>` },
  warning: { color: 'var(--km-warning)', icon: `<svg viewBox="0 0 16 16"><path d="M8 2L14 13H2L8 2z" stroke="currentColor" stroke-width="1.5" fill="none" stroke-linejoin="round"/><path d="M8 6v3.5M8 11v.5" stroke="currentColor" stroke-width="1.5" stroke-linecap="round"/></svg>` },
  error:   { color: 'var(--km-danger)',  icon: `<svg viewBox="0 0 16 16"><circle cx="8" cy="8" r="6" stroke="currentColor" stroke-width="1.5" fill="none"/><path d="M6 6l4 4M10 6l-4 4" stroke="currentColor" stroke-width="1.5" stroke-linecap="round"/></svg>` },
  info:    { color: 'var(--km-accent)',  icon: `<svg viewBox="0 0 16 16"><circle cx="8" cy="8" r="6" stroke="currentColor" stroke-width="1.5" fill="none"/><path d="M8 7v4M8 5.5v.5" stroke="currentColor" stroke-width="1.5" stroke-linecap="round"/></svg>` },
};

const TEMPLATE = document.createElement('template');
TEMPLATE.innerHTML = `
<style>
  :host {
    display: block;
    font-family: var(--km-font);
    width: 320px;
    max-width: calc(100vw - 32px);
  }
  :host([hidden]) { display: none; }

  .toast {
    position: relative;
    display: flex;
    align-items: flex-start;
    gap: var(--km-space-3);
    padding: var(--km-space-3) var(--km-space-4);
    background: var(--km-bg-elevated);
    border: 1px solid var(--km-border-strong);
    border-left: 2px solid var(--km-type-color, var(--km-accent));
    border-radius: var(--km-radius-md);
    box-shadow: var(--km-shadow-lg), 0 0 20px rgba(0,0,0,0.4);
    overflow: hidden;
    pointer-events: all;
  }

  .icon {
    flex-shrink: 0;
    width: 15px;
    height: 15px;
    margin-top: 1px;
    color: var(--km-type-color, var(--km-accent));
  }
  .icon svg { width: 100%; height: 100%; }

  .body  { flex: 1; min-width: 0; }
  .title {
    font-size: var(--km-font-size-sm);
    font-weight: var(--km-font-weight-semibold);
    color: var(--km-text-primary);
    line-height: 1.3;
    margin-bottom: 2px;
  }
  .title:empty { display: none; }
  .message {
    font-size: var(--km-font-size-sm);
    color: var(--km-text-secondary);
    line-height: var(--km-line-height-base);
    word-break: break-word;
  }

  .close {
    flex-shrink: 0;
    width: 18px;
    height: 18px;
    display: flex;
    align-items: center;
    justify-content: center;
    border-radius: var(--km-radius-xs);
    color: var(--km-text-muted);
    cursor: pointer;
    transition: color var(--km-duration-fast) var(--km-ease),
                background var(--km-duration-fast) var(--km-ease);
  }
  .close:hover { color: var(--km-text-primary); background: var(--km-bg-surface); }
  .close svg { width: 10px; height: 10px; }

  .progress {
    position: absolute;
    bottom: 0;
    left: 0;
    height: 2px;
    width: 100%;
    transform-origin: left;
    background: var(--km-type-color, var(--km-accent));
    opacity: 0.6;
  }
</style>

<div class="toast" part="toast" role="alert">
  <span class="icon" part="icon"></span>
  <div class="body">
    <div class="title"   part="title"></div>
    <div class="message" part="message"></div>
  </div>
  <span class="close" part="close" role="button" aria-label="Dismiss" tabindex="0">
    <svg viewBox="0 0 10 10" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round">
      <path d="M1 1l8 8M9 1l-8 8"/>
    </svg>
  </span>
  <div class="progress" part="progress"></div>
</div>
`;

export class KmNotification extends HTMLElement {
  static get observedAttributes() { return ['type', 'message', 'title', 'duration']; }

  constructor() {
    super();
    this.attachShadow({ mode: 'open' });
    this.shadowRoot.appendChild(TEMPLATE.content.cloneNode(true));
    this._toast    = this.shadowRoot.querySelector('.toast');
    this._icon     = this.shadowRoot.querySelector('.icon');
    this._titleEl  = this.shadowRoot.querySelector('.title');
    this._msgEl    = this.shadowRoot.querySelector('.message');
    this._progress = this.shadowRoot.querySelector('.progress');
    this._close    = this.shadowRoot.querySelector('.close');
    this._timer    = null;
  }

  connectedCallback() {
    this._render();
    this._close.addEventListener('click', () => this.dismiss());
    this._close.addEventListener('keydown', (e) => {
      if (e.key === 'Enter' || e.key === ' ') this.dismiss();
    });
    AnimationKit.notificationEnter(this);
    this._startTimer();
  }

  disconnectedCallback() { clearTimeout(this._timer); }
  attributeChangedCallback() { if (this.isConnected) this._render(); }

  _render() {
    const type    = this.getAttribute('type') || 'info';
    const title   = this.getAttribute('title') || '';
    const message = this.getAttribute('message') || '';
    const cfg     = TYPE_CONFIG[type] || TYPE_CONFIG.info;

    this._toast.style.setProperty('--km-type-color', cfg.color);
    this._icon.innerHTML = cfg.icon;
    this._titleEl.textContent  = title;
    this._msgEl.textContent    = message;
  }

  _startTimer() {
    const duration = parseInt(this.getAttribute('duration') ?? '4000', 10);
    if (!duration) return;
    this._progress.style.transition = `transform ${duration}ms linear`;
    requestAnimationFrame(() => { this._progress.style.transform = 'scaleX(0)'; });
    this._timer = setTimeout(() => this.dismiss(), duration);
  }

  async dismiss() {
    clearTimeout(this._timer);
    await AnimationKit.notificationExit(this);
    this.dispatchEvent(new CustomEvent('km-dismiss', { bubbles: true, composed: true }));
    this.remove();
  }
}

customElements.define('km-notification', KmNotification);
