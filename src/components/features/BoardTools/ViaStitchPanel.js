/**
 * @element km-via-stitch-panel
 * @summary Via stitching config panel — preview then apply.
 *
 * Listens for the bridge's km-bridge-op-result DOM event (re-dispatched by
 * BridgeClient from the Tauri op_result event) and broadcasts dry-run preview
 * geometry as km-board-preview, drawn directly on the live KiCanvas board view
 * by PcbLayout's km-live-overlay — no separate preview widget needed.
 * Subscribes to store.bridgeBoardState for net list + layer list.
 */

import { store, subscribe }        from '../../../core/State.js';
import { invoke }                  from '../../../core/Ipc.js';
import { notify }                  from '../../../core/Notify.js';
import { Logger }                  from '../../../core/Logger.js';
import { BRIDGE_VIA_STITCH }       from '../../../core/AppCommands.js';

const TEMPLATE = document.createElement('template');
TEMPLATE.innerHTML = `
<style>
  :host {
    display: flex;
    flex-direction: column;
    gap: 0;
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

  .checkbox-label {
    flex-direction: row;
    align-items: center;
    gap: var(--km-space-2);
    font-size: var(--km-font-size-sm);
    color: var(--km-text-secondary);
    cursor: pointer;
  }
  .checkbox-label input { width: auto; }

  label {
    display: flex;
    flex-direction: column;
    gap: 4px;
    font-size: var(--km-font-size-xs);
    color: var(--km-text-secondary);
  }

  input, select {
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
  input:focus, select:focus { border-color: var(--km-accent); }

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
  }
  .btn-preview:hover:not(:disabled) { background: var(--km-bg-surface); }

  .btn-apply {
    background: var(--km-accent);
    color: #fff;
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

  .no-bridge {
    padding: var(--km-space-3);
    font-size: var(--km-font-size-xs);
    color: var(--km-text-muted);
    text-align: center;
    opacity: 0.7;
  }
</style>

<section>
  <h4>Net &amp; Layers</h4>
  <div class="field-row full">
    <label>Net
      <select id="net-sel"><option value="">— select net —</option></select>
    </label>
  </div>
  <div class="field-row">
    <label>From layer
      <select id="layer-from-sel"><option value="F.Cu">F.Cu</option></select>
    </label>
    <label>To layer
      <select id="layer-to-sel"><option value="B.Cu">B.Cu</option></select>
    </label>
  </div>
</section>

<section>
  <h4>Via Parameters</h4>
  <div class="field-row">
    <label>Via size (mm)
      <input id="via-size" type="number" value="0.8" min="0.2" max="5" step="0.05"/>
    </label>
    <label>Drill (mm)
      <input id="drill" type="number" value="0.4" min="0.1" max="4" step="0.05"/>
    </label>
  </div>
  <div class="field-row">
    <label>Pitch (mm)
      <input id="pitch" type="number" value="2.5" min="0.5" max="50" step="0.1"/>
    </label>
    <label>Zone (optional)
      <input id="zone-name" type="text" placeholder="e.g. GND_FILL"/>
    </label>
  </div>
  <div class="field-row">
    <label>Clearance (mm)
      <input id="clearance" type="number" value="0" min="0" max="5" step="0.05"/>
    </label>
    <label class="checkbox-label">
      <input id="randomize" type="checkbox"/>
      Randomize placement
    </label>
  </div>
</section>

<div class="btn-row">
  <button class="btn btn-preview" id="btn-preview">Preview</button>
  <button class="btn btn-apply"   id="btn-apply" disabled>Apply</button>
</div>
<div class="status-bar" id="status-bar"></div>

<div class="no-bridge" id="no-bridge" style="display:none">
  Connect the KiCad Bridge to use board tools.
</div>
`;

export class KmViaStitchPanel extends HTMLElement {
  constructor() {
    super();
    this.attachShadow({ mode: 'open' });
    this.shadowRoot.appendChild(TEMPLATE.content.cloneNode(true));

    this._netSel       = this.shadowRoot.getElementById('net-sel');
    this._layerFrom    = this.shadowRoot.getElementById('layer-from-sel');
    this._layerTo      = this.shadowRoot.getElementById('layer-to-sel');
    this._viaSize      = this.shadowRoot.getElementById('via-size');
    this._drill        = this.shadowRoot.getElementById('drill');
    this._pitch        = this.shadowRoot.getElementById('pitch');
    this._zoneName     = this.shadowRoot.getElementById('zone-name');
    this._clearance    = this.shadowRoot.getElementById('clearance');
    this._randomize    = this.shadowRoot.getElementById('randomize');
    this._btnPreview   = this.shadowRoot.getElementById('btn-preview');
    this._btnApply     = this.shadowRoot.getElementById('btn-apply');
    this._statusBar    = this.shadowRoot.getElementById('status-bar');
    this._noBridge     = this.shadowRoot.getElementById('no-bridge');

    this._previewPoints = [];
    this._busy = false;
    this._onOpResultBound = this._onOpResult.bind(this);
  }

  connectedCallback() {
    this._btnPreview.addEventListener('click', () => this._runPreview());
    this._btnApply.addEventListener('click',   () => this._runApply());

    // BridgeClient re-dispatches Tauri op_result events as a DOM CustomEvent
    // on `document` (see BridgeClient._onOpResult) — not `window`/BRIDGE_OP_RESULT,
    // which is the Tauri-side event name from Rust.
    document.addEventListener('km-bridge-op-result', this._onOpResultBound);

    // Populate nets + layers from board state
    this._unsubs = [
      subscribe('bridgeConnected', () => this._refresh()),
      subscribe('boardComponents', () => this._refresh()),
    ];
    this._refresh();
  }

  disconnectedCallback() {
    document.removeEventListener('km-bridge-op-result', this._onOpResultBound);
    this._unsubs?.forEach(fn => fn?.());
  }

  // ── Board state sync ──────────────────────────────────────────────────────

  _refresh() {
    const connected = store.bridgeConnected;
    this._noBridge.style.display = connected ? 'none' : '';
    this._btnPreview.disabled = !connected;

    if (!connected) return;

    const nets = (store.boardNets ?? []).filter(n => n && n !== '').sort();
    this._netSel.innerHTML = '<option value="">— select net —</option>' +
      nets.map(n => `<option value="${n}">${n}</option>`).join('');

    // Auto-select GND
    const gnd = nets.find(n => n === 'GND' || n === '/GND');
    if (gnd) this._netSel.value = gnd;

    const layers = store.boardLayers ?? ['F.Cu', 'B.Cu'];
    const copperLayers = layers.filter(l => /Cu/.test(l));
    const makeOpts = (defaultVal) =>
      (copperLayers.length ? copperLayers : ['F.Cu', 'B.Cu'])
        .map(l => `<option value="${l}"${l === defaultVal ? ' selected' : ''}>${l}</option>`)
        .join('');

    this._layerFrom.innerHTML = makeOpts('F.Cu');
    this._layerTo.innerHTML   = makeOpts('B.Cu');
  }

  // ── Preview ───────────────────────────────────────────────────────────────

  async _runPreview() {
    if (this._busy) return;
    const params = this._collectParams();
    if (!params) return;

    this._setBusy(true);
    this._setStatus('Calculating preview…', '');
    this._broadcastPreview('clear', null);
    this._btnApply.disabled = true;

    Logger.debug('ViaStitch', 'invoke preview', params);
    try {
      await invoke(BRIDGE_VIA_STITCH, { ...params, dry_run: true });
      // Result arrives asynchronously via the bridge's km-bridge-op-result event
    } catch (err) {
      Logger.error('ViaStitch', err, 'preview invoke failed');
      this._setStatus(`Error: ${err}`, 'err');
      this._setBusy(false);
    }
  }

  // ── Apply ─────────────────────────────────────────────────────────────────

  async _runApply() {
    if (this._busy || this._previewPoints.length === 0) return;
    const params = this._collectParams();
    if (!params) return;

    this._setBusy(true);
    this._setStatus('Placing vias…', '');

    Logger.debug('ViaStitch', 'invoke apply', params);
    try {
      await invoke(BRIDGE_VIA_STITCH, { ...params, dry_run: false });
      // Result arrives via the bridge's km-bridge-op-result event
    } catch (err) {
      Logger.error('ViaStitch', err, 'apply invoke failed');
      this._setStatus(`Error: ${err}`, 'err');
      this._setBusy(false);
    }
  }

  // ── Op result handler ─────────────────────────────────────────────────────

  _onOpResult(e) {
    const { op, success, message, placed, skipped, preview } = e.detail ?? {};
    if (op !== 'via_stitch') return;

    Logger.debug('ViaStitch', 'op_result received', e.detail);
    this._setBusy(false);

    if (!success) {
      this._setStatus(message || 'Operation failed', 'err');
      this._btnApply.disabled = true;
      return;
    }

    if (preview && preview.length > 0) {
      // This was a dry-run preview
      this._previewPoints = preview;
      this._broadcastPreview('via_points', preview);
      this._btnApply.disabled = false;
      this._setStatus(
        `Preview: ${preview.length} via${preview.length !== 1 ? 's' : ''} (${skipped ?? 0} skipped)`,
        'ok'
      );
    } else {
      // This was the live apply
      this._previewPoints = [];
      this._broadcastPreview('clear', null);
      this._btnApply.disabled = true;
      this._setStatus(
        `Placed ${placed ?? 0} via${(placed ?? 0) !== 1 ? 's' : ''} (${skipped ?? 0} skipped)`,
        'ok'
      );
      notify({ type: 'success', title: 'Via Stitch', message: message });
    }
  }

  // ── Helpers ───────────────────────────────────────────────────────────────

  _collectParams() {
    const net = this._netSel.value;
    if (!net) {
      notify({ type: 'warning', title: 'Via Stitch', message: 'Select a net first.' });
      return null;
    }

    const viaSize = parseFloat(this._viaSize.value);
    const drill   = parseFloat(this._drill.value);
    const pitch   = parseFloat(this._pitch.value);

    if (isNaN(viaSize) || viaSize <= 0) {
      notify({ type: 'warning', title: 'Via Stitch', message: 'Invalid via size.' });
      return null;
    }
    if (isNaN(drill) || drill <= 0 || drill >= viaSize) {
      notify({ type: 'warning', title: 'Via Stitch', message: 'Drill must be > 0 and < via size.' });
      return null;
    }
    if (isNaN(pitch) || pitch <= 0) {
      notify({ type: 'warning', title: 'Via Stitch', message: 'Invalid pitch.' });
      return null;
    }

    const clearance = parseFloat(this._clearance.value);

    return {
      net,
      via_size_mm:  viaSize,
      drill_mm:     drill,
      pitch_mm:     pitch,
      layer_from:   this._layerFrom.value,
      layer_to:     this._layerTo.value,
      zone_name:    this._zoneName.value.trim() || null,
      clearance_mm: isNaN(clearance) || clearance < 0 ? 0 : clearance,
      randomize:    this._randomize.checked,
    };
  }

  /**
   * Broadcast preview geometry to any listening live-overlay (e.g. PcbLayout's
   * LiveOverlay drawn on the actual KiCanvas board view). Composed + bubbling
   * so it crosses shadow-DOM boundaries; harmless no-op if nothing listens
   * (e.g. when this panel is hosted standalone without PcbLayout present).
   */
  _broadcastPreview(kind, payload) {
    this.dispatchEvent(new CustomEvent('km-board-preview', {
      bubbles: true,
      composed: true,
      detail: { source: 'via-stitch', kind, payload },
    }));
  }

  _setBusy(busy) {
    this._busy = busy;
    this._btnPreview.disabled = busy || !store.bridgeConnected;
    if (busy) this._btnApply.disabled = true;
  }

  _setStatus(msg, cls) {
    this._statusBar.textContent = msg;
    this._statusBar.className   = `status-bar${cls ? ' ' + cls : ''}`;
  }
}

customElements.define('km-via-stitch-panel', KmViaStitchPanel);
