/**
 * @element km-badge
 * @summary Status badge / count chip.
 *
 * @attr {'accent'|'success'|'warning'|'danger'|'info'|'neutral'} variant
 * @attr {boolean} dot - show as a small dot (no text)
 * @attr {boolean} pulse - pulsing animation for live status
 *
 * @slot default - badge label / count
 */

const TEMPLATE = document.createElement('template');
TEMPLATE.innerHTML = `
<style>
  :host { display: inline-flex; align-items: center; }
  :host([hidden]) { display: none; }

  .badge {
    display: inline-flex;
    align-items: center;
    justify-content: center;
    gap: var(--km-space-1);
    padding: 2px var(--km-space-1-5);
    border-radius: var(--km-radius-full);
    font-family: var(--km-font);
    font-size: var(--km-font-size-2xs);
    font-weight: var(--km-font-weight-medium);
    line-height: 1;
    letter-spacing: 0.02em;
    white-space: nowrap;
  }

  :host([dot]) .badge {
    width: 8px; height: 8px; padding: 0;
    border-radius: 50%;
  }
  :host([dot]) slot { display: none; }

  /* Variants */
  :host(:not([variant])) .badge,
  :host([variant="accent"]) .badge {
    background: var(--km-accent-muted);
    color: var(--km-accent-hover);
    border: 1px solid var(--km-accent-border);
  }
  :host([variant="success"]) .badge {
    background: var(--km-success-muted);
    color: var(--km-success);
    border: 1px solid var(--km-border-success);
  }
  :host([variant="warning"]) .badge {
    background: var(--km-warning-muted);
    color: var(--km-warning);
    border: 1px solid var(--km-border-warning);
  }
  :host([variant="danger"]) .badge {
    background: var(--km-danger-muted);
    color: var(--km-danger);
    border: 1px solid var(--km-border-danger);
  }
  :host([variant="info"]) .badge {
    background: var(--km-info-muted);
    color: var(--km-info);
    border: 1px solid rgba(59,130,246,0.35);
  }
  :host([variant="neutral"]) .badge {
    background: var(--km-bg-elevated);
    color: var(--km-text-secondary);
    border: 1px solid var(--km-border);
  }

  /* Pulse */
  :host([pulse]) .badge {
    animation: km-badge-pulse 2s ease-in-out infinite;
  }
  @keyframes km-badge-pulse {
    0%, 100% { opacity: 1; transform: scale(1); }
    50% { opacity: 0.7; transform: scale(1.15); }
  }
</style>
<span class="badge" part="badge"><slot></slot></span>
`;

export class KmBadge extends HTMLElement {
  constructor() {
    super();
    this.attachShadow({ mode: 'open' });
    this.shadowRoot.appendChild(TEMPLATE.content.cloneNode(true));
  }
}

customElements.define('km-badge', KmBadge);
