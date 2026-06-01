/**
 * @element km-vault-pp-panel
 * @summary Post-processing configuration panel for the Component Vault.
 *
 * Opened by the "Advanced" button in the vault toolbar.
 * Settings are persisted to localStorage and sent to Rust on every "Add to vault" call.
 *
 * Sections:
 *   1. Pin Settings  — type override, length, text sizes
 *   2. Symbol Identity — name source, footprint naming
 *   3. Symbol Fields  — per-field enable/disable checkboxes
 */

import { load as loadCfg, save as saveCfg, DEFAULTS, FIELD_META } from '../../../modules/uce/PostProcessConfig.js';

const TEMPLATE = document.createElement('template');
TEMPLATE.innerHTML = `
<style>
  :host {
    display: flex;
    flex-direction: column;
    font-family: var(--km-font);
    color: var(--km-text-primary);
    background: var(--km-bg-primary);
    height: 100%;
    overflow: hidden;
  }

  /* ── Header ── */
  .pp-header {
    display: flex;
    align-items: center;
    justify-content: space-between;
    padding: 14px 16px 12px;
    border-bottom: 1px solid var(--km-border);
    flex-shrink: 0;
  }
  .pp-title {
    font-size: 13px;
    font-weight: 600;
    letter-spacing: -0.01em;
    color: var(--km-text-primary);
  }
  .pp-close {
    width: 24px; height: 24px;
    background: none; border: none; cursor: pointer;
    color: var(--km-text-muted); font-size: 16px; line-height: 1;
    border-radius: var(--km-radius-xs);
    display: flex; align-items: center; justify-content: center;
    transition: color var(--km-duration-fast), background var(--km-duration-fast);
  }
  .pp-close:hover { color: var(--km-text-primary); background: rgba(255,255,255,0.06); }

  /* ── Scroll body ── */
  .pp-body {
    flex: 1;
    overflow-y: auto;
    padding: 12px 16px 16px;
    scrollbar-width: thin;
    scrollbar-color: var(--km-scrollbar-thumb) transparent;
  }

  /* ── Section ── */
  .pp-section { margin-bottom: 16px; }
  .pp-section-title {
    font-size: 9px;
    font-weight: 600;
    letter-spacing: 0.07em;
    text-transform: uppercase;
    color: var(--km-text-muted);
    margin-bottom: 6px;
    padding: 0 2px;
  }
  .pp-card {
    background: var(--km-bg-surface);
    border: 1px solid var(--km-border);
    border-radius: var(--km-radius-md);
    overflow: hidden;
  }

  /* ── Row ── */
  .pp-row {
    display: flex;
    align-items: center;
    justify-content: space-between;
    gap: 8px;
    padding: 8px 12px;
    border-bottom: 1px solid var(--km-border);
    min-height: 38px;
  }
  .pp-row:last-child { border-bottom: none; }

  .pp-row-info { flex: 1; min-width: 0; }
  .pp-row-label {
    font-size: 12px;
    font-weight: 500;
    color: var(--km-text-primary);
    white-space: nowrap;
  }
  .pp-row-sub {
    font-size: 10px;
    color: var(--km-text-muted);
    margin-top: 1px;
    line-height: 1.35;
  }
  .pp-row-ctrl { flex-shrink: 0; }

  /* ── Select ── */
  .pp-select {
    height: 26px;
    padding: 0 24px 0 8px;
    background: var(--km-bg-elevated);
    border: 1px solid var(--km-border);
    border-radius: var(--km-radius-sm);
    color: var(--km-text-primary);
    font-family: var(--km-font);
    font-size: 11px;
    cursor: pointer;
    outline: none;
    box-shadow: var(--km-bezel);
    appearance: none;
    -webkit-appearance: none;
    background-image: url("data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' width='8' height='5' viewBox='0 0 8 5'%3E%3Cpath d='M1 1l3 3 3-3' stroke='rgba(255,255,255,0.3)' stroke-width='1.5' fill='none' stroke-linecap='round' stroke-linejoin='round'/%3E%3C/svg%3E");
    background-repeat: no-repeat;
    background-position: right 8px center;
    min-width: 110px;
    transition: border-color var(--km-duration-fast);
  }
  .pp-select:hover  { border-color: var(--km-border-strong); }
  .pp-select:focus  { border-color: var(--km-accent); }
  .pp-select option { background: var(--km-bg-elevated); }

  /* ── Checkbox ── */
  .pp-check {
    width: 14px; height: 14px;
    accent-color: var(--km-accent);
    cursor: pointer;
    flex-shrink: 0;
  }

  /* ── Toggle ── */
  .pp-toggle {
    position: relative; width: 30px; height: 16px; cursor: pointer; flex-shrink: 0;
  }
  .pp-toggle input { opacity: 0; width: 0; height: 0; position: absolute; }
  .pp-toggle-track {
    position: absolute; inset: 0;
    border-radius: 8px;
    background: var(--km-bg-elevated);
    border: 1px solid var(--km-border-strong);
    transition: background var(--km-duration-fast), border-color var(--km-duration-fast);
  }
  .pp-toggle-thumb {
    position: absolute; top: 2px; left: 2px;
    width: 10px; height: 10px; border-radius: 50%;
    background: var(--km-text-muted);
    transition: transform var(--km-duration-compress) var(--km-ease-compress), background var(--km-duration-fast);
  }
  .pp-toggle input:checked ~ .pp-toggle-track { background: var(--km-accent-muted); border-color: var(--km-accent-border); }
  .pp-toggle input:checked ~ .pp-toggle-thumb { transform: translateX(14px); background: var(--km-accent-hover); }

  /* ── Footer ── */
  .pp-footer {
    display: flex;
    align-items: center;
    justify-content: space-between;
    gap: 8px;
    padding: 10px 16px;
    border-top: 1px solid var(--km-border);
    flex-shrink: 0;
  }
  .pp-reset {
    font-size: 11px;
    color: var(--km-text-muted);
    cursor: pointer;
    background: none;
    border: none;
    padding: 4px 6px;
    border-radius: var(--km-radius-xs);
    transition: color var(--km-duration-fast);
  }
  .pp-reset:hover { color: var(--km-text-secondary); }
  .pp-saved {
    font-size: 10px;
    color: var(--km-success);
    opacity: 0;
    transition: opacity 0.4s;
  }
  .pp-saved.show { opacity: 1; }
</style>

<div class="pp-header">
  <span class="pp-title">⚙ Post-processing</span>
  <button class="pp-close" id="pp-close">✕</button>
</div>

<div class="pp-body" id="pp-body"></div>

<div class="pp-footer">
  <button class="pp-reset" id="pp-reset">Reset to defaults</button>
  <span class="pp-saved" id="pp-saved">Saved</span>
</div>
`;

export class VaultPostProcessPanel extends HTMLElement {
  constructor() {
    super();
    this.attachShadow({ mode: 'open' });
    this.shadowRoot.appendChild(TEMPLATE.content.cloneNode(true));
    this._cfg = loadCfg();
  }

  connectedCallback() {
    this._render();
    this._attach();
  }

  get config() { return { ...this._cfg }; }

  // ── Render ────────────────────────────────────────────────────────────────

  _render() {
    const c = this._cfg;
    this.shadowRoot.getElementById('pp-body').innerHTML = `

      <!-- Pin Settings -->
      <div class="pp-section">
        <div class="pp-section-title">Pin Settings</div>
        <div class="pp-card">
          ${this._row('Pin type', 'Override all pin electrical types',
            `<select class="pp-select" data-cfg="pin_type">
              <option value="passive"     ${c.pin_type==='passive'?'selected':''}>Passive</option>
              <option value="unspecified" ${c.pin_type==='unspecified'?'selected':''}>Unspecified</option>
              <option value="keep"        ${c.pin_type==='keep'?'selected':''}>Keep original</option>
            </select>`
          )}
          ${this._row('Pin length', 'Stub length in mils',
            `<select class="pp-select" data-cfg="pin_length_mil">
              ${[100,150,200,250,300].map(v=>`<option value="${v}" ${c.pin_length_mil===v?'selected':''}>${v} mil</option>`).join('')}
            </select>`
          )}
          ${this._row('Number size', 'Pin number label font size',
            `<select class="pp-select" data-cfg="pin_number_size_mil">
              ${[30,40,50].map(v=>`<option value="${v}" ${c.pin_number_size_mil===v?'selected':''}>${v} mil</option>`).join('')}
            </select>`
          )}
          ${this._row('Name size', 'Pin name label font size',
            `<select class="pp-select" data-cfg="pin_name_size_mil">
              ${[30,40,50].map(v=>`<option value="${v}" ${c.pin_name_size_mil===v?'selected':''}>${v} mil</option>`).join('')}
            </select>`
          )}
        </div>
      </div>

      <!-- Symbol Identity -->
      <div class="pp-section">
        <div class="pp-section-title">Symbol Identity</div>
        <div class="pp-card">
          ${this._row('Symbol name', 'What to use as the KiCad symbol name',
            `<select class="pp-select" data-cfg="symbol_name_source">
              <option value="mpn"  ${c.symbol_name_source==='mpn'?'selected':''}>MPN (e.g. STM32F103C8T6)</option>
              <option value="lcsc" ${c.symbol_name_source==='lcsc'?'selected':''}>LCSC ID (e.g. C8734)</option>
            </select>`
          )}
          ${this._row('Footprint naming', '.kicad_mod filename and symbol Footprint reference',
            `<select class="pp-select" data-cfg="footprint_naming">
              <option value="lcsc"    ${c.footprint_naming==='lcsc'?'selected':''}>LCSC ID (unique per part)</option>
              <option value="package" ${c.footprint_naming==='package'?'selected':''}>Package name (shared)</option>
            </select>`
          )}
        </div>
      </div>

      <!-- Symbol Fields -->
      <div class="pp-section">
        <div class="pp-section-title">Symbol Fields</div>
        <div class="pp-card">
          ${Object.entries(FIELD_META).map(([key, meta]) => `
            <div class="pp-row">
              <div class="pp-row-info">
                <div class="pp-row-label">${meta.label}</div>
                <div class="pp-row-sub">${meta.desc}</div>
              </div>
              <div class="pp-row-ctrl">
                <input type="checkbox" class="pp-check" data-cfg="${key}" ${c[key] ? 'checked' : ''}>
              </div>
            </div>
          `).join('')}
        </div>
      </div>
    `;
  }

  _row(label, sub, ctrl) {
    return `
      <div class="pp-row">
        <div class="pp-row-info">
          <div class="pp-row-label">${label}</div>
          <div class="pp-row-sub">${sub}</div>
        </div>
        <div class="pp-row-ctrl">${ctrl}</div>
      </div>
    `;
  }

  // ── Events ────────────────────────────────────────────────────────────────

  _attach() {
    const root = this.shadowRoot;

    root.getElementById('pp-close').addEventListener('click', () => {
      this.dispatchEvent(new CustomEvent('pp-close', { bubbles: true, composed: true }));
    });

    root.getElementById('pp-reset').addEventListener('click', () => {
      this._cfg = { ...DEFAULTS };
      saveCfg(this._cfg);
      this._render();
      this._attach();
      this._flash();
    });

    // Selects
    for (const el of root.querySelectorAll('select[data-cfg]')) {
      el.addEventListener('change', () => {
        const key = el.dataset.cfg;
        const val = ['pin_length_mil','pin_number_size_mil','pin_name_size_mil'].includes(key)
          ? Number(el.value) : el.value;
        this._cfg[key] = val;
        this._save();
      });
    }

    // Checkboxes
    for (const el of root.querySelectorAll('input[type="checkbox"][data-cfg]')) {
      el.addEventListener('change', () => {
        this._cfg[el.dataset.cfg] = el.checked;
        this._save();
      });
    }
  }

  _save() {
    saveCfg(this._cfg);
    this._flash();
    // Notify parent that config changed
    this.dispatchEvent(new CustomEvent('pp-change', {
      bubbles: true, composed: true, detail: this._cfg,
    }));
  }

  _flash() {
    const el = this.shadowRoot.getElementById('pp-saved');
    el.classList.add('show');
    clearTimeout(this._flashTimer);
    this._flashTimer = setTimeout(() => el.classList.remove('show'), 1500);
  }
}

customElements.define('km-vault-pp-panel', VaultPostProcessPanel);
