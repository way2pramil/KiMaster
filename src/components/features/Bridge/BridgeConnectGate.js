/**
 * @element km-bridge-connect-gate
 * @summary Connection confirmation gate — warm, simple, no fear
 *
 * Shown when user clicks "Connect" button. Explains what's about to happen
 * and reassures the user. Single decision: connect or cancel.
 * Zero friction: 1 click to confirm.
 */

const T = document.createElement('template');
T.innerHTML = /* html */`
<style>
  :host {
    --km-modal-width: 400px;
  }

  .backdrop {
    position: fixed;
    top: 0; left: 0; right: 0; bottom: 0;
    background: rgba(0, 0, 0, 0.6);
    display: flex;
    align-items: center;
    justify-content: center;
    z-index: 600;
    animation: fade-in 0.2s var(--km-ease);
  }

  @keyframes fade-in {
    from { opacity: 0; }
    to { opacity: 1; }
  }

  .modal {
    background: var(--km-bg-surface);
    border: 1px solid var(--km-border);
    border-radius: var(--km-radius-xl);
    width: var(--km-modal-width);
    box-shadow: 0 20px 60px rgba(0, 0, 0, 0.5);
    animation: slide-up 0.3s var(--km-ease);
    overflow: hidden;
  }

  @keyframes slide-up {
    from {
      opacity: 0;
      transform: translateY(20px);
    }
    to {
      opacity: 1;
      transform: translateY(0);
    }
  }

  .modal-body {
    padding: var(--km-space-6);
    display: flex;
    flex-direction: column;
    gap: var(--km-space-4);
  }

  .icon-row {
    display: flex;
    align-items: center;
    justify-content: center;
    gap: var(--km-space-2);
    font-size: 32px;
  }

  .title {
    font-size: var(--km-font-size-xl);
    font-weight: var(--km-font-weight-bold);
    color: var(--km-text-primary);
    text-align: center;
  }

  .description {
    font-size: var(--km-font-size-sm);
    line-height: 1.6;
    color: var(--km-text-secondary);
    text-align: center;
  }

  .checklist {
    display: flex;
    flex-direction: column;
    gap: var(--km-space-2);
    background: var(--km-bg-elevated);
    padding: var(--km-space-3);
    border-radius: var(--km-radius-md);
  }

  .checklist-item {
    display: flex;
    align-items: flex-start;
    gap: var(--km-space-2);
    font-size: var(--km-font-size-xs);
    color: var(--km-text-secondary);
    line-height: 1.5;
  }

  .checklist-icon {
    flex-shrink: 0;
    color: var(--km-trace);
    font-size: 14px;
    margin-top: 2px;
  }

  .safety-tip {
    display: flex;
    gap: var(--km-space-2);
    padding: var(--km-space-3);
    background: rgba(16, 185, 129, 0.08);
    border: 1px solid rgba(16, 185, 129, 0.2);
    border-radius: var(--km-radius-md);
    font-size: var(--km-font-size-xs);
    color: var(--km-text-secondary);
    line-height: 1.5;
  }

  .safety-icon {
    flex-shrink: 0;
    color: var(--km-trace);
    font-size: 16px;
  }

  .modal-footer {
    display: flex;
    gap: var(--km-space-2);
    padding: var(--km-space-4) var(--km-space-6);
    border-top: 1px solid var(--km-border);
    background: var(--km-bg-elevated);
  }

  .btn {
    flex: 1;
    padding: var(--km-space-2) var(--km-space-3);
    border: none;
    border-radius: var(--km-radius-md);
    font-size: var(--km-font-size-sm);
    font-weight: var(--km-font-weight-semibold);
    cursor: pointer;
    transition: all 0.2s var(--km-ease);
    display: flex;
    align-items: center;
    justify-content: center;
    gap: var(--km-space-1);
  }

  .btn.secondary {
    background: transparent;
    color: var(--km-text-secondary);
    border: 1px solid var(--km-border);
  }

  .btn.secondary:hover {
    background: var(--km-bg-surface);
    border-color: var(--km-accent-border);
    color: var(--km-text-primary);
  }

  .btn.primary {
    background: var(--km-accent);
    color: white;
  }

  .btn.primary:hover {
    background: var(--km-accent-hover);
  }

  .btn:active {
    transform: scale(0.98);
  }

  .loading {
    display: none;
    font-size: 12px;
    color: var(--km-text-muted);
    text-align: center;
  }

  .loading.show {
    display: block;
  }

  .spinner {
    display: inline-block;
    width: 12px;
    height: 12px;
    border: 2px solid rgba(37, 99, 235, 0.2);
    border-top-color: var(--km-accent);
    border-radius: 50%;
    animation: spin 0.6s linear infinite;
  }

  @keyframes spin {
    to { transform: rotate(360deg); }
  }
</style>

<div class="backdrop" id="backdrop">
  <div class="modal">
    <div class="modal-body">
      <!-- Icon + Title -->
      <div class="icon-row">
        <span>🔌</span>
        <span>🔗</span>
      </div>

      <div class="title">Ready to connect?</div>

      <!-- Description -->
      <div class="description">
        KiMaster will sync with KiCad in real time. You can browse, select, and modify your
        board from here.
      </div>

      <!-- What happens -->
      <div class="checklist">
        <div class="checklist-item">
          <div class="checklist-icon">✓</div>
          <div>See your board layout and components live</div>
        </div>
        <div class="checklist-item">
          <div class="checklist-icon">✓</div>
          <div>Select parts in both KiCad and KiMaster together</div>
        </div>
        <div class="checklist-item">
          <div class="checklist-icon">✓</div>
          <div>Make changes (you'll be asked to confirm each one)</div>
        </div>
      </div>

      <!-- Safety reassurance -->
      <div class="safety-tip">
        <div class="safety-icon">🛡️</div>
        <div>
          Your board is safe. Changes only happen when you ask, and you can undo them in KiCad.
        </div>
      </div>

      <!-- Loading state -->
      <div class="loading" id="loading">
        <span class="spinner"></span> Connecting…
      </div>
    </div>

    <!-- Footer -->
    <div class="modal-footer">
      <button class="btn secondary" id="btn-cancel">Cancel</button>
      <button class="btn primary" id="btn-confirm">Connect</button>
    </div>
  </div>
</div>
`;

export class BridgeConnectGate extends HTMLElement {
  constructor() {
    super();
    this.attachShadow({ mode: 'open' });
    this.shadowRoot.appendChild(T.content.cloneNode(true));
  }

  connectedCallback() {
    this._setup();
  }

  _setup() {
    const backdrop = this.shadowRoot.getElementById('backdrop');
    const btnCancel = this.shadowRoot.getElementById('btn-cancel');
    const btnConfirm = this.shadowRoot.getElementById('btn-confirm');

    backdrop.addEventListener('click', (e) => {
      if (e.target === backdrop) this._close(false);
    });

    btnCancel.addEventListener('click', () => this._close(false));
    btnConfirm.addEventListener('click', () => this._confirm());
  }

  _confirm() {
    this.dispatchEvent(new CustomEvent('km-bridge-connect-response', {
      detail: { approved: true },
      bubbles: true,
      composed: true,
    }));
    this.remove();
  }

  _close(approved) {
    this.dispatchEvent(new CustomEvent('km-bridge-connect-response', {
      detail: { approved },
      bubbles: true,
      composed: true,
    }));
    this.remove();
  }

  static show() {
    const gate = new BridgeConnectGate();
    document.body.appendChild(gate);
    return new Promise((resolve) => {
      gate.addEventListener('km-bridge-connect-response', (e) => {
        resolve(e.detail.approved);
      });
    });
  }
}

customElements.define('km-bridge-connect-gate', BridgeConnectGate);
