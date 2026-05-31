/**
 * @element km-bridge-permissions-modal
 * @summary First-time bridge activation — explains what it does and why it needs permission
 *
 * Simple, warm, human-friendly explanation of the bridge with one expandable section.
 * Shows what the bridge can do (read-only by default, writes need confirmation).
 * Language is for humans, not developers.
 */

import { Logger } from '../../../core/Logger.js';

const T = document.createElement('template');
T.innerHTML = /* html */`
<style>
  :host {
    --km-modal-width: 420px;
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
    max-height: 85vh;
    overflow-y: auto;
    box-shadow: 0 20px 60px rgba(0, 0, 0, 0.5);
    animation: slide-up 0.3s var(--km-ease);
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

  .modal-header {
    display: flex;
    align-items: center;
    gap: var(--km-space-2);
    padding: var(--km-space-5);
    border-bottom: 1px solid var(--km-border);
    flex-shrink: 0;
  }

  .modal-icon {
    font-size: 28px;
    line-height: 1;
  }

  .modal-title {
    flex: 1;
    font-size: var(--km-font-size-lg);
    font-weight: var(--km-font-weight-bold);
    color: var(--km-text-primary);
  }

  .modal-body {
    padding: var(--km-space-5);
    display: flex;
    flex-direction: column;
    gap: var(--km-space-4);
  }

  .section {
    display: flex;
    flex-direction: column;
    gap: var(--km-space-2);
  }

  .section-title {
    font-size: var(--km-font-size-sm);
    font-weight: var(--km-font-weight-semibold);
    color: var(--km-text-secondary);
    text-transform: uppercase;
    letter-spacing: 0.05em;
    opacity: 0.7;
  }

  .section-text {
    font-size: var(--km-font-size-sm);
    line-height: 1.6;
    color: var(--km-text-secondary);
  }

  /* Expandable permissions section */
  .permissions-toggle {
    display: flex;
    align-items: center;
    gap: var(--km-space-2);
    padding: var(--km-space-3);
    background: var(--km-bg-elevated);
    border: 1px solid var(--km-border);
    border-radius: var(--km-radius-md);
    cursor: pointer;
    transition: background 0.2s var(--km-ease), border-color 0.2s var(--km-ease);
    font-size: var(--km-font-size-sm);
    color: var(--km-text-primary);
    font-weight: var(--km-font-weight-medium);
    user-select: none;
  }

  .permissions-toggle:hover {
    background: rgba(255, 255, 255, 0.08);
    border-color: var(--km-accent-border);
  }

  .permissions-chevron {
    font-size: 12px;
    transition: transform 0.2s var(--km-ease);
    opacity: 0.6;
  }

  .permissions-toggle.open .permissions-chevron {
    transform: rotate(90deg);
  }

  .permissions-list {
    display: none;
    max-height: 0;
    overflow: hidden;
    transition: max-height 0.3s var(--km-ease);
  }

  .permissions-toggle.open ~ .permissions-list {
    display: block;
    max-height: 500px;
  }

  .permissions-item {
    display: flex;
    align-items: flex-start;
    gap: var(--km-space-2);
    padding: var(--km-space-2-5) var(--km-space-3);
    font-size: var(--km-font-size-xs);
    color: var(--km-text-secondary);
    border-bottom: 1px solid rgba(255, 255, 255, 0.05);
  }

  .permissions-item:last-child {
    border-bottom: none;
  }

  .permission-icon {
    flex-shrink: 0;
    width: 20px;
    text-align: center;
    color: var(--km-trace);
    font-size: 14px;
  }

  .permission-text {
    flex: 1;
    line-height: 1.5;
  }

  .permission-badge {
    display: inline-block;
    padding: 2px 6px;
    background: rgba(16, 185, 129, 0.15);
    color: var(--km-trace);
    border-radius: var(--km-radius-sm);
    font-size: 10px;
    font-weight: var(--km-font-weight-semibold);
    margin-top: 4px;
  }

  .permission-badge.write {
    background: rgba(37, 99, 235, 0.15);
    color: var(--km-accent);
  }

  /* Warning box */
  .warning-box {
    display: flex;
    gap: var(--km-space-2);
    padding: var(--km-space-3);
    background: rgba(37, 99, 235, 0.08);
    border: 1px solid rgba(37, 99, 235, 0.2);
    border-radius: var(--km-radius-md);
    font-size: var(--km-font-size-xs);
    color: var(--km-text-secondary);
    line-height: 1.5;
  }

  .warning-icon {
    flex-shrink: 0;
    color: var(--km-accent);
    font-size: 16px;
    line-height: 1.2;
  }

  .modal-footer {
    display: flex;
    gap: var(--km-space-2);
    padding: var(--km-space-4) var(--km-space-5);
    border-top: 1px solid var(--km-border);
    background: var(--km-bg-elevated);
    flex-shrink: 0;
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

  .link {
    color: var(--km-accent);
    text-decoration: none;
    cursor: pointer;
    border-bottom: 1px solid transparent;
    transition: border-color 0.2s var(--km-ease);
  }

  .link:hover {
    border-bottom-color: var(--km-accent);
  }
</style>

<div class="backdrop" id="backdrop">
  <div class="modal">
    <!-- Header -->
    <div class="modal-header">
      <div class="modal-icon">📡</div>
      <div class="modal-title">Connect to KiCad</div>
    </div>

    <!-- Body -->
    <div class="modal-body">
      <!-- What it does -->
      <div class="section">
        <div class="section-title">What this does</div>
        <div class="section-text">
          The KiCad bridge lets you and KiCad work together. You'll see board changes live,
          select components in both apps at the same time, and make changes from KiMaster
          when you want to.
        </div>
      </div>

      <!-- Permissions section (expandable) -->
      <div class="section">
        <button class="permissions-toggle" id="perm-toggle">
          <span>📋 What it can do</span>
          <span class="permissions-chevron">›</span>
        </button>

        <div class="permissions-list" id="perm-list">
          <div class="permissions-item">
            <div class="permission-icon">👁️</div>
            <div class="permission-text">
              See your board layout, components, nets
              <div class="permission-badge">Read-only</div>
            </div>
          </div>

          <div class="permissions-item">
            <div class="permission-icon">🔗</div>
            <div class="permission-text">
              Highlight parts and signals in both apps
              <div class="permission-badge">Read-only</div>
            </div>
          </div>

          <div class="permissions-item">
            <div class="permission-icon">🎯</div>
            <div class="permission-text">
              Move and rotate footprints (you'll confirm each time)
              <div class="permission-badge write">Requires approval</div>
            </div>
          </div>

          <div class="permissions-item">
            <div class="permission-icon">✓</div>
            <div class="permission-text">
              Run design checks to catch problems
              <div class="permission-badge">Read-only</div>
            </div>
          </div>

          <div class="permissions-item">
            <div class="permission-icon">💾</div>
            <div class="permission-text">
              Changes are saved to your board file automatically
              <div class="permission-badge">Safe</div>
            </div>
          </div>
        </div>
      </div>

      <!-- Safety message -->
      <div class="warning-box">
        <div class="warning-icon">ℹ️</div>
        <div>
          Your board is safe — changes only happen when you ask for them.
          <span class="link" id="learn-link">Learn more</span>
        </div>
      </div>
    </div>

    <!-- Footer -->
    <div class="modal-footer">
      <button class="btn secondary" id="btn-cancel">Not now</button>
      <button class="btn primary" id="btn-connect">Let's connect</button>
    </div>
  </div>
</div>
`;

export class BridgePermissionsModal extends HTMLElement {
  constructor() {
    super();
    this.attachShadow({ mode: 'open' });
    this.shadowRoot.appendChild(T.content.cloneNode(true));
  }

  connectedCallback() {
    this._setup();
  }

  _setup() {
    const toggle = this.shadowRoot.getElementById('perm-toggle');
    const backdrop = this.shadowRoot.getElementById('backdrop');
    const btnCancel = this.shadowRoot.getElementById('btn-cancel');
    const btnConnect = this.shadowRoot.getElementById('btn-connect');
    const learnLink = this.shadowRoot.getElementById('learn-link');

    toggle.addEventListener('click', () => {
      toggle.classList.toggle('open');
    });

    backdrop.addEventListener('click', (e) => {
      if (e.target === backdrop) this._close(false);
    });

    btnCancel.addEventListener('click', () => this._close(false));
    btnConnect.addEventListener('click', () => this._close(true));
    learnLink.addEventListener('click', () => this._openLearnMore());
  }

  _close(approved) {
    this.dispatchEvent(new CustomEvent('km-bridge-permissions-response', {
      detail: { approved },
      bubbles: true,
      composed: true,
    }));
    this.remove();
  }

  _openLearnMore() {
    Logger.info('Bridge', 'Open learn more — would open docs or link');
    // In real implementation: open a help doc or external link
    // For now, just log
  }

  static show() {
    const modal = new BridgePermissionsModal();
    document.body.appendChild(modal);
    return new Promise((resolve) => {
      modal.addEventListener('km-bridge-permissions-response', (e) => {
        resolve(e.detail.approved);
      });
    });
  }
}

customElements.define('km-bridge-permissions-modal', BridgePermissionsModal);
