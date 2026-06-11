/**
 * @element km-panelize-panel
 * @summary Panelization config — dry-run preview then write panel file.
 *
 * All writes go through the bridge's op_result event (op = 'panelize_board').
 * Preview draws the panel outline directly on the live KiCanvas board view
 * (broadcast as km-board-preview, rendered by PcbLayout's km-live-overlay).
 * Apply saves <board>_panel.kicad_pcb beside the source board.
 */

import { store, subscribe }        from '../../../core/State.js';
import { invoke }                  from '../../../core/Ipc.js';
import { notify }                  from '../../../core/Notify.js';
import { Logger }                  from '../../../core/Logger.js';
import { BRIDGE_PANELIZE_BOARD }   from '../../../core/AppCommands.js';

const TEMPLATE = document.createElement('template');
TEMPLATE.innerHTML = `
<style>
  :host {
    display: flex;
    flex-direction: column;
    height: 100%;
    overflow-y: auto;
    color: var(--km-text-primary);
    font-family: var(--km-font);
    font-size: var(--km-font-size-sm);
  }

  section {
    padding: var(--km-space-3);
    border-bottom: 1px solid var(--km-border);
  }
  section:last-child { border-bottom: none; }

  h4 {
    margin: 0 0 var(--km-space-2) 0;
    font-size: var(--km-font-size-xs);
    font-weight: var(--km-font-weight-medium);
    color: var(--km-text-secondary);
    text-transform: uppercase;
    letter-spacing: 0.07em;
  }

  .field-row {
    display: grid;
    grid-template-columns: 1fr 1fr;
    gap: var(--km-space-2);
    margin-bottom: var(--km-space-2);
  }
  .field-row.tri { grid-template-columns: 1fr 1fr 1fr; }
  .field-row:last-child { margin-bottom: 0; }

  label {
    display: flex;
    flex-direction: column;
    gap: 4px;
    font-size: var(--km-font-size-xs);
    color: var(--km-text-secondary);
  }

  input[type="number"] {
    background: var(--km-bg-input, #1a1a1a);
    border: 1px solid var(--km-border);
    color: var(--km-text-primary);
    border-radius: var(--km-radius-sm);
    padding: 4px 8px;
    font-size: var(--km-font-size-sm);
    font-family: var(--km-font-mono, monospace);
    outline: none;
    width: 100%;
    box-sizing: border-box;
    transition: border-color 0.12s;
  }
  input[type="number"]:focus { border-color: var(--km-accent); }

  /* Toggle row */
  .toggle-row {
    display: flex;
    flex-direction: column;
    gap: var(--km-space-1-5);
  }
  .toggle-item {
    display: flex;
    align-items: center;
    justify-content: space-between;
    gap: var(--km-space-2);
  }
  .toggle-label {
    font-size: var(--km-font-size-xs);
    color: var(--km-text-secondary);
  }

  /* Tiny toggle switch */
  .switch { position: relative; display: inline-block; width: 32px; height: 18px; flex-shrink: 0; }
  .switch input { opacity: 0; width: 0; height: 0; }
  .slider-sw {
    position: absolute; cursor: pointer; inset: 0;
    background: var(--km-bg-elevated);
    border: 1px solid var(--km-border);
    border-radius: 9px;
    transition: background 0.15s, border-color 0.15s;
  }
  .slider-sw::before {
    content: '';
    position: absolute;
    width: 12px; height: 12px;
    left: 2px; top: 2px;
    background: var(--km-text-muted);
    border-radius: 50%;
    transition: transform 0.15s, background 0.15s;
  }
  .switch input:checked + .slider-sw { background: var(--km-accent-muted); border-color: var(--km-accent); }
  .switch input:checked + .slider-sw::before { transform: translateX(14px); background: var(--km-accent); }

  /* Bite params — shown/hidden depending on mouse_bites toggle */
  .sub-params {
    margin-top: var(--km-space-2);
    padding-top: var(--km-space-2);
    border-top: 1px solid var(--km-border);
    display: none;
  }
  .sub-params.visible { display: block; }

  /* Size preview pill */
  .size-pill {
    display: inline-flex;
    align-items: center;
    gap: 6px;
    background: var(--km-bg-elevated);
    border: 1px solid var(--km-border);
    border-radius: 10px;
    padding: 3px 10px;
    font-size: var(--km-font-size-xs);
    font-family: var(--km-font-mono, monospace);
    color: var(--km-text-secondary);
    margin-top: var(--km-space-2);
  }
  .size-pill .accent { color: var(--km-accent); }

  /* Buttons */
  .btn-row {
    display: flex;
    gap: var(--km-space-2);
    padding: var(--km-space-3);
  }
  .btn {
    flex: 1;
    padding: var(--km-space-2) var(--km-space-3);
    border-radius: var(--km-radius-sm);
    font-size: var(--km-font-size-sm);
    font-weight: var(--km-font-weight-medium);
    cursor: pointer;
    border: none;
    transition: background 0.12s, opacity 0.12s;
  }
  .btn:disabled { opacity: 0.4; cursor: not-allowed; }
  .btn-preview {
    background: var(--km-bg-elevated);
    border: 1px solid var(--km-border);
    color: var(--km-text-primary);
    flex: 1;
  }
  .btn-preview:hover:not(:disabled) { background: var(--km-bg-surface); }
  .btn-apply {
    background: var(--km-accent);
    color: #fff;
    flex: 2;
  }
  .btn-apply:hover:not(:disabled) { background: var(--km-accent-hover); }

  .status-bar {
    padding: 0 var(--km-space-3) var(--km-space-2);
    font-size: var(--km-font-size-xs);
    font-family: var(--km-font-mono, monospace);
    color: var(--km-text-muted);
    min-height: 18px;
  }
  .status-bar.ok  { color: var(--km-success, #22c55e); }
  .status-bar.err { color: var(--km-error, #ef4444); }

  .output-note {
    padding: 0 var(--km-space-3) var(--km-space-2);
    font-size: var(--km-font-size-xs);
    color: var(--km-text-muted);
    font-family: var(--km-font-mono, monospace);
    word-break: break-all;
    min-height: 18px;
  }

  .no-bridge {
    padding: var(--km-space-3);
    font-size: var(--km-font-size-xs);
    color: var(--km-text-muted);
    text-align: center;
    opacity: 0.7;
  }

  .warn-note {
    padding: var(--km-space-2) var(--km-space-3);
    font-size: var(--km-font-size-xs);
    color: var(--km-warning, #f59e0b);
    background: rgba(245,158,11,0.07);
    border-top: 1px solid rgba(245,158,11,0.2);
  }
</style>

<!-- Grid -->
<section>
  <h4>Grid</h4>
  <div class="field-row tri">
    <label>Columns
      <input type="number" id="cols" value="2" min="1" max="10" step="1"/>
    </label>
    <label>Rows
      <input type="number" id="rows" value="2" min="1" max="10" step="1"/>
    </label>
    <label>Gap (mm)
      <input type="number" id="gap" value="2.0" min="0" max="50" step="0.1"/>
    </label>
  </div>
</section>

<!-- Rails -->
<section>
  <h4>Rails</h4>
  <div class="field-row">
    <label>Rail width (mm, 0 = none)
      <input type="number" id="rail" value="5.0" min="0" max="30" step="0.5"/>
    </label>
  </div>
</section>

<!-- Cuts -->
<section>
  <h4>Board separation</h4>
  <div class="toggle-row">

    <div class="toggle-item">
      <span class="toggle-label">Mouse bites</span>
      <label class="switch">
        <input type="checkbox" id="mouse-bites" checked/>
        <span class="slider-sw"></span>
      </label>
    </div>

    <div class="toggle-item">
      <span class="toggle-label">V-score lines</span>
      <label class="switch">
        <input type="checkbox" id="v-score"/>
        <span class="slider-sw"></span>
      </label>
    </div>

  </div>

  <!-- Mouse bite params (shown when enabled) -->
  <div class="sub-params visible" id="bite-params">
    <div class="field-row">
      <label>Bite diameter (mm)
        <input type="number" id="bite-dia" value="0.5" min="0.2" max="2" step="0.05"/>
      </label>
      <label>Spacing (mm)
        <input type="number" id="bite-spacing" value="0.8" min="0.3" max="5" step="0.1"/>
      </label>
    </div>
  </div>
</section>

<!-- Actions -->
<div class="btn-row">
  <button class="btn btn-preview" id="btn-preview">Preview</button>
  <button class="btn btn-apply"   id="btn-apply" disabled>Apply</button>
</div>
<div class="status-bar"  id="status-bar"></div>
<div class="output-note" id="output-note"></div>

<div class="warn-note">
  Net names are prefixed per copy (P1_, P2_, …) — panel passes DRC.
  Output saves as a separate <em>_panel.kicad_pcb</em> file.
</div>

<div class="no-bridge" id="no-bridge" style="display:none">
  Connect the KiCad Bridge to use board tools.
</div>
`;

export class KmPanelizePanel extends HTMLElement {
  constructor() {
    super();
    this.attachShadow({ mode: 'open' });
    this.shadowRoot.appendChild(TEMPLATE.content.cloneNode(true));

    this._cols        = this.shadowRoot.getElementById('cols');
    this._rows        = this.shadowRoot.getElementById('rows');
    this._gap         = this.shadowRoot.getElementById('gap');
    this._rail        = this.shadowRoot.getElementById('rail');
    this._mouseBites  = this.shadowRoot.getElementById('mouse-bites');
    this._vScore      = this.shadowRoot.getElementById('v-score');
    this._biteDia     = this.shadowRoot.getElementById('bite-dia');
    this._biteSpacing = this.shadowRoot.getElementById('bite-spacing');
    this._biteParams  = this.shadowRoot.getElementById('bite-params');
    this._btnPreview  = this.shadowRoot.getElementById('btn-preview');
    this._btnApply    = this.shadowRoot.getElementById('btn-apply');
    this._statusBar   = this.shadowRoot.getElementById('status-bar');
    this._outputNote  = this.shadowRoot.getElementById('output-note');
    this._noBridge    = this.shadowRoot.getElementById('no-bridge');

    this._previewDone = false;
    this._busy        = false;
    this._onOpResultBound = this._onOpResult.bind(this);
  }

  connectedCallback() {
    this._mouseBites.addEventListener('change', () => {
      this._biteParams.classList.toggle('visible', this._mouseBites.checked);
    });

    this._btnPreview.addEventListener('click', () => this._runPreview());
    this._btnApply.addEventListener('click',   () => this._runApply());

    // BridgeClient re-dispatches Tauri op_result events as a DOM CustomEvent
    // on `document` (see BridgeClient._onOpResult) — not `window`/BRIDGE_OP_RESULT,
    // which is the Tauri-side event name from Rust.
    document.addEventListener('km-bridge-op-result', this._onOpResultBound);

    this._unsubs = [
      subscribe('bridgeConnected', () => this._refresh()),
    ];
    this._refresh();
  }

  disconnectedCallback() {
    document.removeEventListener('km-bridge-op-result', this._onOpResultBound);
    this._unsubs?.forEach(fn => fn?.());
  }

  // ── State ─────────────────────────────────────────────────────────────────

  _refresh() {
    const connected = store.bridgeConnected;
    this._noBridge.style.display = connected ? 'none' : '';
    this._btnPreview.disabled = !connected;
    this._btnApply.disabled   = !connected || !this._previewDone;
  }

  // ── Actions ───────────────────────────────────────────────────────────────

  async _runPreview() {
    if (this._busy) return;
    this._setBusy(true);
    this._setStatus('Computing panel dimensions…', '');
    this._broadcastPreview('clear', null);
    this._previewDone = false;
    this._btnApply.disabled = true;
    this._outputNote.textContent = '';

    const params = { ...this._collectParams(), dry_run: true };
    Logger.debug('Panelize', 'invoke preview', params);
    try {
      await invoke(BRIDGE_PANELIZE_BOARD, params);
    } catch (err) {
      Logger.error('Panelize', err, 'preview invoke failed');
      this._setStatus(`Error: ${err}`, 'err');
      this._setBusy(false);
    }
  }

  async _runApply() {
    if (this._busy || !this._previewDone) return;
    this._setBusy(true);
    this._setStatus('Building panel…', '');

    const params = { ...this._collectParams(), dry_run: false };
    Logger.debug('Panelize', 'invoke apply', params);
    try {
      await invoke(BRIDGE_PANELIZE_BOARD, params);
    } catch (err) {
      Logger.error('Panelize', err, 'apply invoke failed');
      this._setStatus(`Error: ${err}`, 'err');
      this._setBusy(false);
    }
  }

  // ── Op result ─────────────────────────────────────────────────────────────

  _onOpResult(e) {
    const { op, success, message,
            panel_width_mm, panel_height_mm, board_count,
            output_path, preview_outline } = e.detail ?? {};

    if (op !== 'panelize_board') return;
    Logger.debug('Panelize', 'op_result received', e.detail);
    this._setBusy(false);

    if (!success) {
      this._setStatus(message || 'Panelize failed', 'err');
      this._previewDone = false;
      this._btnApply.disabled = true;
      return;
    }

    if (preview_outline?.length) {
      this._broadcastPreview('panel_outline', preview_outline);
    }

    const cols = parseInt(this._cols.value, 10);
    const rows = parseInt(this._rows.value, 10);

    if (message?.includes('Preview')) {
      // Dry run result
      this._previewDone = true;
      this._btnApply.disabled = false;
      this._setStatus(
        `${cols}×${rows} = ${board_count} boards · ` +
        `${panel_width_mm?.toFixed(1)} × ${panel_height_mm?.toFixed(1)} mm`,
        'ok'
      );
      this._outputNote.textContent = `→ ${output_path || ''}`;
    } else {
      // Apply result
      this._previewDone = false;
      this._btnApply.disabled = true;
      this._setStatus(message, 'ok');
      this._outputNote.textContent = output_path ? `Saved: ${output_path}` : '';
      notify({
        type: 'success',
        title: 'Panel Created',
        message: `${cols}×${rows} panel saved as ${output_path?.split(/[\\/]/).pop() ?? ''}`,
      });
    }
  }

  // ── Helpers ───────────────────────────────────────────────────────────────

  _collectParams() {
    return {
      cols:                  parseInt(this._cols.value, 10)    || 2,
      rows:                  parseInt(this._rows.value, 10)    || 2,
      gap_mm:                parseFloat(this._gap.value)       || 2.0,
      rail_mm:               parseFloat(this._rail.value)      || 0.0,
      mouse_bites:           this._mouseBites.checked,
      mouse_bite_dia_mm:     parseFloat(this._biteDia.value)   || 0.5,
      mouse_bite_spacing_mm: parseFloat(this._biteSpacing.value) || 0.8,
      v_score:               this._vScore.checked,
    };
  }

  _broadcastPreview(kind, payload) {
    this.dispatchEvent(new CustomEvent('km-board-preview', {
      bubbles: true,
      composed: true,
      detail: { source: 'panelize', kind, payload },
    }));
  }

  _setBusy(busy) {
    this._busy = busy;
    this._btnPreview.disabled = busy || !store.bridgeConnected;
    if (busy) this._btnApply.disabled = true;
    else      this._btnApply.disabled = !this._previewDone || !store.bridgeConnected;
  }

  _setStatus(msg, cls) {
    this._statusBar.textContent = msg;
    this._statusBar.className   = `status-bar${cls ? ' ' + cls : ''}`;
  }
}

customElements.define('km-panelize-panel', KmPanelizePanel);
