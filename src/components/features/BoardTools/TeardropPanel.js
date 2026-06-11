/**
 * @element km-teardrop-panel
 * @summary Teardrop apply/remove panel with dry-run preview.
 *
 * Sends apply_teardrops / remove_teardrops via bridge.
 * Op result arrives asynchronously via bridge:op_result event.
 */

import { store, subscribe }           from '../../../core/State.js';
import { invoke }                     from '../../../core/Ipc.js';
import { notify }                     from '../../../core/Notify.js';
import { Logger }                     from '../../../core/Logger.js';
import { BRIDGE_APPLY_TEARDROPS,
         BRIDGE_REMOVE_TEARDROPS }    from '../../../core/AppCommands.js';

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
  .field-row.full { grid-template-columns: 1fr; }
  .field-row:last-child { margin-bottom: 0; }

  label {
    display: flex;
    flex-direction: column;
    gap: 4px;
    font-size: var(--km-font-size-xs);
    color: var(--km-text-secondary);
  }

  input[type="number"], select {
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
  input[type="number"]:focus, select:focus { border-color: var(--km-accent); }

  /* Slider */
  .slider-row {
    display: flex;
    align-items: center;
    gap: var(--km-space-2);
    margin-bottom: var(--km-space-2);
  }
  .slider-label {
    font-size: var(--km-font-size-xs);
    color: var(--km-text-secondary);
    width: 90px;
    flex-shrink: 0;
  }
  input[type="range"] {
    flex: 1;
    accent-color: var(--km-accent);
    cursor: pointer;
  }
  .slider-value {
    font-size: var(--km-font-size-xs);
    font-family: var(--km-font-mono, monospace);
    color: var(--km-accent);
    width: 34px;
    text-align: right;
    flex-shrink: 0;
  }

  /* Target selector chips */
  .chip-row {
    display: flex;
    gap: var(--km-space-1);
    flex-wrap: wrap;
    margin-bottom: var(--km-space-2);
  }
  .chip {
    padding: 3px 10px;
    border-radius: 12px;
    font-size: var(--km-font-size-xs);
    border: 1px solid var(--km-border);
    background: var(--km-bg-surface);
    color: var(--km-text-secondary);
    cursor: pointer;
    transition: background 0.1s, border-color 0.1s, color 0.1s;
    user-select: none;
  }
  .chip:hover { color: var(--km-text-primary); background: var(--km-bg-elevated); }
  .chip.active {
    background: var(--km-accent-muted);
    border-color: var(--km-accent);
    color: var(--km-accent);
  }

  /* API info */
  .api-note {
    font-size: var(--km-font-size-xs);
    color: var(--km-text-muted);
    padding: var(--km-space-1) var(--km-space-3);
    font-family: var(--km-font-mono, monospace);
    min-height: 18px;
  }

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
    flex: 2;
  }
  .btn-preview:hover:not(:disabled) { background: var(--km-bg-surface); }

  .btn-apply {
    background: var(--km-accent);
    color: #fff;
    flex: 2;
  }
  .btn-apply:hover:not(:disabled) { background: var(--km-accent-hover); }

  .btn-remove {
    background: var(--km-bg-elevated);
    border: 1px solid var(--km-border);
    color: var(--km-error, #ef4444);
    flex: 1;
  }
  .btn-remove:hover:not(:disabled) {
    background: rgba(239,68,68,0.08);
    border-color: var(--km-error, #ef4444);
  }

  .status-bar {
    padding: 0 var(--km-space-3) var(--km-space-2);
    font-size: var(--km-font-size-xs);
    font-family: var(--km-font-mono, monospace);
    color: var(--km-text-muted);
    min-height: 18px;
  }
  .status-bar.ok  { color: var(--km-success, #22c55e); }
  .status-bar.err { color: var(--km-error, #ef4444); }
  .status-bar.warn { color: var(--km-warning, #f59e0b); }

  /* Preview pill */
  .preview-pill {
    display: inline-flex;
    align-items: center;
    gap: 6px;
    background: var(--km-accent-muted);
    border: 1px solid rgba(37,99,235,0.3);
    border-radius: 12px;
    padding: 4px 12px;
    font-size: var(--km-font-size-xs);
    color: var(--km-accent);
    font-family: var(--km-font-mono, monospace);
    margin: 0 var(--km-space-3) var(--km-space-3);
  }
  .preview-pill[hidden] { display: none; }

  .no-bridge {
    padding: var(--km-space-3);
    font-size: var(--km-font-size-xs);
    color: var(--km-text-muted);
    text-align: center;
    opacity: 0.7;
  }
</style>

<!-- Target -->
<section>
  <h4>Target</h4>
  <div class="chip-row" id="chip-row">
    <span class="chip active" data-target="all">All</span>
    <span class="chip" data-target="pads">Pads only</span>
    <span class="chip" data-target="vias">Vias only</span>
    <span class="chip" data-target="tracks">T-junctions</span>
  </div>
</section>

<!-- Parameters -->
<section>
  <h4>Parameters</h4>
  <div class="slider-row">
    <span class="slider-label">Width ratio</span>
    <input type="range" id="size-ratio" min="0.1" max="1.0" step="0.05" value="0.5"/>
    <span class="slider-value" id="size-ratio-val">0.5</span>
  </div>
  <div class="slider-row">
    <span class="slider-label">Length ratio</span>
    <input type="range" id="length-ratio" min="0.1" max="2.0" step="0.1" value="1.0"/>
    <span class="slider-value" id="length-ratio-val">1.0</span>
  </div>
  <div class="slider-row">
    <span class="slider-label">Curve points</span>
    <input type="range" id="curve-points" min="2" max="10" step="1" value="5"/>
    <span class="slider-value" id="curve-points-val">5</span>
  </div>
  <div class="field-row">
    <label>Max length (mm, 0=∞)
      <input type="number" id="max-len" value="1.0" min="0" step="0.1"/>
    </label>
    <label>Max width (mm, 0=∞)
      <input type="number" id="max-width" value="2.0" min="0" step="0.1"/>
    </label>
  </div>
</section>

<!-- Actions -->
<div class="btn-row">
  <button class="btn btn-preview" id="btn-preview">Preview count</button>
  <button class="btn btn-apply"   id="btn-apply">Apply</button>
  <button class="btn btn-remove"  id="btn-remove">Remove all</button>
</div>
<div class="status-bar" id="status-bar"></div>
<div class="preview-pill" id="preview-pill" hidden></div>
<div class="api-note" id="api-note"></div>

<div class="no-bridge" id="no-bridge" style="display:none">
  Connect the KiCad Bridge to use board tools.
</div>
`;

export class KmTeardropPanel extends HTMLElement {
  constructor() {
    super();
    this.attachShadow({ mode: 'open' });
    this.shadowRoot.appendChild(TEMPLATE.content.cloneNode(true));

    this._chipRow    = this.shadowRoot.getElementById('chip-row');
    this._sizeRatio  = this.shadowRoot.getElementById('size-ratio');
    this._sizeVal    = this.shadowRoot.getElementById('size-ratio-val');
    this._lenRatio   = this.shadowRoot.getElementById('length-ratio');
    this._lenVal     = this.shadowRoot.getElementById('length-ratio-val');
    this._curvePoints= this.shadowRoot.getElementById('curve-points');
    this._curveVal   = this.shadowRoot.getElementById('curve-points-val');
    this._maxLen     = this.shadowRoot.getElementById('max-len');
    this._maxWidth   = this.shadowRoot.getElementById('max-width');
    this._btnPreview = this.shadowRoot.getElementById('btn-preview');
    this._btnApply   = this.shadowRoot.getElementById('btn-apply');
    this._btnRemove  = this.shadowRoot.getElementById('btn-remove');
    this._statusBar  = this.shadowRoot.getElementById('status-bar');
    this._previewPill= this.shadowRoot.getElementById('preview-pill');
    this._apiNote    = this.shadowRoot.getElementById('api-note');
    this._noBridge   = this.shadowRoot.getElementById('no-bridge');

    this._target = 'all';
    this._busy   = false;
    this._onOpResultBound = this._onOpResult.bind(this);
  }

  connectedCallback() {
    // Slider live values
    this._sizeRatio.addEventListener('input', () => {
      this._sizeVal.textContent = parseFloat(this._sizeRatio.value).toFixed(2);
    });
    this._lenRatio.addEventListener('input', () => {
      this._lenVal.textContent = parseFloat(this._lenRatio.value).toFixed(1);
    });
    this._curvePoints.addEventListener('input', () => {
      this._curveVal.textContent = this._curvePoints.value;
    });

    // Target chips
    this._chipRow.addEventListener('click', (e) => {
      const chip = e.target.closest('.chip');
      if (!chip) return;
      this._chipRow.querySelectorAll('.chip').forEach(c => c.classList.remove('active'));
      chip.classList.add('active');
      this._target = chip.dataset.target;
    });

    // Buttons
    this._btnPreview.addEventListener('click', () => this._runPreview());
    this._btnApply.addEventListener('click',   () => this._runApply());
    this._btnRemove.addEventListener('click',  () => this._runRemove());

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
    this._btnApply.disabled   = !connected;
    this._btnRemove.disabled  = !connected;
  }

  // ── Actions ───────────────────────────────────────────────────────────────

  async _runPreview() {
    if (this._busy) return;
    this._setBusy(true);
    this._setStatus('Counting eligible items…', '');
    this._previewPill.hidden = true;
    const params = { ...this._collectParams(), dry_run: true };
    Logger.debug('Teardrops', 'invoke preview', params);
    try {
      await invoke(BRIDGE_APPLY_TEARDROPS, params);
    } catch (err) {
      Logger.error('Teardrops', err, 'preview invoke failed');
      this._setStatus(`Error: ${err}`, 'err');
      this._setBusy(false);
    }
  }

  async _runApply() {
    if (this._busy) return;
    this._setBusy(true);
    this._setStatus('Applying teardrops…', '');
    this._previewPill.hidden = true;
    const params = { ...this._collectParams(), dry_run: false };
    Logger.debug('Teardrops', 'invoke apply', params);
    try {
      await invoke(BRIDGE_APPLY_TEARDROPS, params);
    } catch (err) {
      Logger.error('Teardrops', err, 'apply invoke failed');
      this._setStatus(`Error: ${err}`, 'err');
      this._setBusy(false);
    }
  }

  async _runRemove() {
    if (this._busy) return;
    this._setBusy(true);
    this._setStatus('Removing teardrops…', '');
    this._previewPill.hidden = true;
    Logger.debug('Teardrops', 'invoke remove');
    try {
      await invoke(BRIDGE_REMOVE_TEARDROPS, {});
    } catch (err) {
      Logger.error('Teardrops', err, 'remove invoke failed');
      this._setStatus(`Error: ${err}`, 'err');
      this._setBusy(false);
    }
  }

  // ── Op result ─────────────────────────────────────────────────────────────

  _onOpResult(e) {
    const { op, success, message,
            applied_count, removed_count, preview_count,
            kicad_api_used, kicad_version } = e.detail ?? {};

    if (op !== 'apply_teardrops' && op !== 'remove_teardrops') return;
    Logger.debug('Teardrops', 'op_result received', e.detail);
    this._setBusy(false);

    if (!success) {
      const isUnsupported = (kicad_api_used === 'unsupported');
      this._setStatus(message || 'Operation failed', isUnsupported ? 'warn' : 'err');
      if (kicad_version) this._apiNote.textContent = `KiCad ${kicad_version}`;
      return;
    }

    if (kicad_api_used === 'preview') {
      // Dry-run result
      this._previewPill.hidden = false;
      this._previewPill.textContent = `${preview_count ?? 0} item${(preview_count ?? 0) !== 1 ? 's' : ''} eligible`;
      this._setStatus('Preview complete — click Apply to write teardrops.', 'ok');
    } else if (op === 'remove_teardrops') {
      this._setStatus(`Removed ${removed_count ?? 0} teardrops`, 'ok');
      notify({ type: 'success', title: 'Teardrops', message: message });
    } else {
      this._setStatus(message, 'ok');
      notify({ type: 'success', title: 'Teardrops', message: message });
    }

    if (kicad_api_used && kicad_api_used !== 'preview') {
      this._apiNote.textContent = `API: ${kicad_api_used}  ·  KiCad ${kicad_version ?? ''}`;
    }
  }

  // ── Helpers ───────────────────────────────────────────────────────────────

  _collectParams() {
    return {
      targets:      this._target,
      size_ratio:   parseFloat(this._sizeRatio.value),
      length_ratio: parseFloat(this._lenRatio.value),
      curve_points: parseInt(this._curvePoints.value, 10),
      max_len_mm:   parseFloat(this._maxLen.value)   || 0,
      max_width_mm: parseFloat(this._maxWidth.value) || 0,
    };
  }

  _setBusy(busy) {
    this._busy = busy;
    const ok = !busy && store.bridgeConnected;
    this._btnPreview.disabled = !ok;
    this._btnApply.disabled   = !ok;
    this._btnRemove.disabled  = !ok;
  }

  _setStatus(msg, cls) {
    this._statusBar.textContent = msg;
    this._statusBar.className   = `status-bar${cls ? ' ' + cls : ''}`;
  }
}

customElements.define('km-teardrop-panel', KmTeardropPanel);
