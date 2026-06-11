/**
 * @element km-stackup-panel
 * @summary PCB Stackup Manager
 *
 * Tab 1 — Stackup Visual Editor
 *   Cross-section viewer, layer property editor, preset picker,
 *   vault save/load.
 *
 * Tab 2 — Impedance Calculator
 *   Real-time microstrip / stripline / CPW / differential-pair Z0.
 *   Click a copper layer in Tab 1 to auto-populate geometry.
 *
 * Tab 3 — Trace Sizing (IPC-2221)
 *   Forward:  Given current (A) → minimum trace width (mm)
 *   Reverse:  Given trace width (mm) → maximum safe current (A)
 *   Reference table for the active stackup at common current values.
 *
 * ─────────────────────────────────────────────────────────────────
 * UPCOMING — Option B: Component Current Budgets (PDN Analyzer)
 *   User assigns current draw per component (U1=25mA, U2=100mA).
 *   System walks the bridge netlist tree from power source to each
 *   sink and computes the current flowing through every track segment.
 *   Trunk trace = sum of all downstream sinks.  Branch = single sink.
 *   This is the correct engineering approach for per-track validation
 *   and matches how Altium's PDN Analyzer works.
 *   Requires: bridge topology walk, component-level current DB.
 *
 * UPCOMING — Option C: Track Width Histogram
 *   Pulls all track segments from the live KiCad bridge, groups by
 *   width bucket, and for each bucket shows: count of tracks, max
 *   safe current (IPC-2221), layer distribution.  Zero user input —
 *   engineer scans the histogram to spot undersized tracks visually.
 *   Requires: bridge command returning all track segments with widths.
 * ─────────────────────────────────────────────────────────────────
 */

import { store, subscribe }        from '../../../core/State.js';
import { invoke }                  from '../../../core/Ipc.js';
import { Logger }                  from '../../../core/Logger.js';
import { notify }                  from '../../../core/Notify.js';
import {
  VAULT_LIST_STACKUPS, VAULT_SAVE_STACKUP, VAULT_LOAD_STACKUP,
  // Upcoming Option B: BRIDGE_GET_BOARD_STATE for netlist topology walk
  // Upcoming Option C: need new cmd_get_all_tracks bridge command
} from '../../../core/AppCommands.js';
import { requestBoardStackup } from '../../../modules/kicad-bridge/BridgeClient.js';
import {
  PRESETS, LAYER_TYPES,
  clonePreset, calcTotalThickness,
  getCopperLayerNames, defaultImpedanceType,
  findMicrostripH, findStriplineB,
  calcZ0, calcWidthForZ0, calcDiffPairZ0, calcCoplanarWaveguideZ0,
  calcMaxCurrent, calcRequiredWidth,
  resolveLayerCopperOz,
} from '../../../modules/stackup/StackupService.js';

// ── Template ──────────────────────────────────────────────────────────────────

const TEMPLATE = document.createElement('template');
TEMPLATE.innerHTML = `
<style>
  :host {
    display: block;
    font-family: var(--km-font);
    height: 100%;
    overflow: hidden;
  }
  .panel {
    display: flex;
    flex-direction: column;
    height: 100%;
    padding: var(--km-space-4) var(--km-space-6);
    gap: var(--km-space-3);
    overflow: hidden;
  }

  /* ── Header ── */
  .header {
    display: flex;
    align-items: center;
    gap: var(--km-space-3);
    flex-shrink: 0;
  }
  .header-title {
    font-size: var(--km-font-size-lg);
    font-weight: var(--km-font-weight-semibold);
    color: var(--km-text-primary);
    flex: 1;
  }
  .preset-select {
    background: var(--km-bg-surface);
    border: 1px solid var(--km-border);
    color: var(--km-text-primary);
    font-family: var(--km-font);
    font-size: var(--km-font-size-xs);
    padding: var(--km-space-1) var(--km-space-2);
    border-radius: var(--km-radius-sm);
    cursor: pointer;
    min-width: 220px;
  }
  .preset-select:focus { outline: 1px solid var(--km-accent); }

  /* ── Tabs ── */
  .tabs {
    display: flex;
    gap: var(--km-space-1);
    flex-shrink: 0;
    border-bottom: 1px solid var(--km-border);
    padding-bottom: var(--km-space-2);
  }
  .tab {
    padding: var(--km-space-1-5) var(--km-space-3);
    border-radius: var(--km-radius-sm);
    font-size: var(--km-font-size-xs);
    font-weight: var(--km-font-weight-medium);
    color: var(--km-text-secondary);
    cursor: pointer;
    transition: background var(--km-duration-fast), color var(--km-duration-fast);
    user-select: none;
  }
  .tab:hover { background: var(--km-bg-surface); color: var(--km-text-primary); }
  .tab.active { background: var(--km-accent-muted); color: var(--km-accent); }

  /* ── Tab content ── */
  .tab-content { flex: 1; overflow: hidden; display: none; }
  .tab-content.active { display: flex; flex-direction: column; overflow: hidden; }

  /* ══ TAB 1: STACKUP ════════════════════════════════════════════════════════ */
  .stackup-body {
    display: flex;
    gap: var(--km-space-6);
    flex: 1;
    overflow: hidden;
  }
  .cross-section {
    display: flex;
    flex-direction: column;
    gap: 1px;
    width: 320px;
    flex-shrink: 0;
    overflow-y: auto;
    scrollbar-width: thin;
    padding-right: var(--km-space-2);
  }
  .layer-row {
    display: flex;
    align-items: center;
    gap: var(--km-space-2);
    border-radius: var(--km-radius-xs);
    padding: 2px var(--km-space-2);
    cursor: pointer;
    transition: background var(--km-duration-fast);
    border: 1px solid transparent;
  }
  .layer-row:hover { background: var(--km-bg-elevated); }
  .layer-row.selected { background: var(--km-accent-muted); border-color: var(--km-accent); }
  .layer-bar {
    width: 48px;
    flex-shrink: 0;
    border-radius: 2px;
    min-height: 4px;
  }
  .layer-bar.copper     { background: #c8861a; }
  .layer-bar.dielectric { background: #1a4d2e; border: 1px solid #2d7a4a; }
  .layer-bar.mask       { background: #2a2a3a; }
  .layer-bar.paste      { background: #3a3a2a; }
  .layer-bar.silk       { background: #1e1e2e; }
  .layer-info { flex: 1; min-width: 0; }
  .layer-name {
    font-size: 11px;
    font-weight: var(--km-font-weight-medium);
    color: var(--km-text-primary);
    white-space: nowrap;
    overflow: hidden;
    text-overflow: ellipsis;
  }
  .layer-meta { font-size: 10px; color: var(--km-text-muted); white-space: nowrap; }
  .layer-thickness {
    font-size: 10px;
    color: var(--km-text-secondary);
    font-variant-numeric: tabular-nums;
    flex-shrink: 0;
  }
  .total-thickness {
    display: flex;
    align-items: center;
    justify-content: space-between;
    padding: var(--km-space-1-5) var(--km-space-2);
    margin-top: var(--km-space-1);
    border-top: 1px solid var(--km-border);
    font-size: var(--km-font-size-xs);
    color: var(--km-text-secondary);
    flex-shrink: 0;
  }
  .total-thickness strong { color: var(--km-accent); }
  .stackup-editor {
    flex: 1;
    display: flex;
    flex-direction: column;
    gap: var(--km-space-3);
    overflow-y: auto;
    padding-right: var(--km-space-1);
  }
  .editor-section-title {
    font-size: var(--km-font-size-xs);
    font-weight: var(--km-font-weight-semibold);
    color: var(--km-text-secondary);
    text-transform: uppercase;
    letter-spacing: 0.05em;
    margin-bottom: var(--km-space-1);
  }
  .field-grid { display: grid; grid-template-columns: 1fr 1fr; gap: var(--km-space-2); }
  .field { display: flex; flex-direction: column; gap: 4px; }
  .field label { font-size: 10px; color: var(--km-text-muted); font-weight: var(--km-font-weight-medium); }
  .field input, .field select {
    background: var(--km-bg-surface);
    border: 1px solid var(--km-border);
    color: var(--km-text-primary);
    font-family: var(--km-font);
    font-size: var(--km-font-size-xs);
    padding: 4px 8px;
    border-radius: var(--km-radius-xs);
    width: 100%;
  }
  .field input:focus, .field select:focus { outline: 1px solid var(--km-accent); }
  .placeholder-msg {
    color: var(--km-text-muted);
    font-size: var(--km-font-size-xs);
    padding: var(--km-space-4);
    text-align: center;
  }
  .vault-actions {
    display: flex;
    gap: var(--km-space-2);
    flex-shrink: 0;
    margin-top: auto;
    padding-top: var(--km-space-3);
    border-top: 1px solid var(--km-border);
  }

  /* ══ TAB 2: IMPEDANCE ══════════════════════════════════════════════════════ */
  .imp-body { display: flex; gap: var(--km-space-6); flex: 1; overflow: hidden; }
  .imp-inputs {
    display: flex;
    flex-direction: column;
    gap: var(--km-space-3);
    width: 260px;
    flex-shrink: 0;
    overflow-y: auto;
  }
  .imp-results { flex: 1; display: flex; flex-direction: column; gap: var(--km-space-4); overflow-y: auto; }
  .seg-control {
    display: flex;
    gap: 2px;
    background: var(--km-bg-surface);
    padding: 2px;
    border-radius: var(--km-radius-sm);
    border: 1px solid var(--km-border);
  }
  .seg-btn {
    flex: 1;
    padding: 4px 8px;
    border-radius: var(--km-radius-xs);
    font-size: var(--km-font-size-xs);
    font-weight: var(--km-font-weight-medium);
    color: var(--km-text-secondary);
    cursor: pointer;
    text-align: center;
    transition: background var(--km-duration-fast), color var(--km-duration-fast);
    user-select: none;
  }
  .seg-btn.active { background: var(--km-accent-muted); color: var(--km-accent); }
  .toggle-row {
    display: flex;
    align-items: center;
    gap: var(--km-space-2);
    font-size: var(--km-font-size-xs);
    color: var(--km-text-secondary);
    cursor: pointer;
  }
  .toggle-row input[type=checkbox] { accent-color: var(--km-accent); cursor: pointer; }
  .z0-display {
    display: flex;
    align-items: center;
    gap: var(--km-space-4);
    padding: var(--km-space-4);
    background: var(--km-bg-surface);
    border: 1px solid var(--km-border);
    border-radius: var(--km-radius-md);
  }
  .z0-ring {
    width: 80px; height: 80px;
    border-radius: 50%;
    border: 4px solid var(--km-border);
    display: flex; align-items: center; justify-content: center;
    flex-shrink: 0;
    transition: border-color var(--km-duration-base);
  }
  .z0-ring.green  { border-color: var(--km-live); }
  .z0-ring.yellow { border-color: var(--km-warning); }
  .z0-ring.red    { border-color: var(--km-danger); }
  .z0-value { font-size: 24px; font-weight: var(--km-font-weight-semibold); color: var(--km-text-primary); font-variant-numeric: tabular-nums; }
  .z0-unit  { font-size: 12px; color: var(--km-text-muted); }
  .z0-meta  { display: flex; flex-direction: column; gap: 4px; }
  .z0-label { font-size: var(--km-font-size-xs); color: var(--km-text-muted); }
  .z0-hint  { font-size: var(--km-font-size-xs); color: var(--km-accent); font-weight: var(--km-font-weight-medium); }
  .ref-table { width: 100%; border-collapse: collapse; font-size: var(--km-font-size-xs); }
  .ref-table th {
    text-align: left; padding: 4px 8px;
    color: var(--km-text-muted); font-weight: var(--km-font-weight-medium);
    border-bottom: 1px solid var(--km-border);
  }
  .ref-table td {
    padding: 5px 8px; color: var(--km-text-secondary);
    border-bottom: 1px solid var(--km-border);
    font-variant-numeric: tabular-nums;
  }
  .ref-table tr:last-child td { border-bottom: none; }
  .geo-row {
    display: flex; gap: var(--km-space-3);
    font-size: var(--km-font-size-xs); color: var(--km-text-muted);
    padding: var(--km-space-2) var(--km-space-3);
    background: var(--km-bg-surface);
    border-radius: var(--km-radius-xs);
    border: 1px solid var(--km-border);
  }
  .geo-item strong { color: var(--km-text-secondary); }

  /* ══ TAB 3: TRACE SIZING ═══════════════════════════════════════════════════ */
  .sizing-body {
    display: flex;
    gap: var(--km-space-6);
    flex: 1;
    overflow: hidden;
  }

  /* Left column — calculator */
  .sizing-calc {
    display: flex;
    flex-direction: column;
    gap: var(--km-space-4);
    width: 300px;
    flex-shrink: 0;
    overflow-y: auto;
  }

  /* Mode toggle */
  .mode-toggle {
    display: flex;
    gap: 2px;
    background: var(--km-bg-surface);
    padding: 2px;
    border-radius: var(--km-radius-sm);
    border: 1px solid var(--km-border);
  }
  .mode-btn {
    flex: 1;
    padding: 6px 8px;
    border-radius: var(--km-radius-xs);
    font-size: var(--km-font-size-xs);
    font-weight: var(--km-font-weight-medium);
    color: var(--km-text-secondary);
    cursor: pointer;
    text-align: center;
    transition: background var(--km-duration-fast), color var(--km-duration-fast);
    user-select: none;
    line-height: 1.3;
  }
  .mode-btn .mode-sub { font-size: 9px; opacity: 0.7; display: block; margin-top: 1px; }
  .mode-btn.active { background: var(--km-accent-muted); color: var(--km-accent); }
  .mode-btn.active .mode-sub { opacity: 1; }

  /* Input card */
  .calc-card {
    background: var(--km-bg-surface);
    border: 1px solid var(--km-border);
    border-radius: var(--km-radius-md);
    padding: var(--km-space-4);
    display: flex;
    flex-direction: column;
    gap: var(--km-space-3);
  }
  .calc-card .field label { color: var(--km-text-secondary); font-size: var(--km-font-size-xs); }
  .calc-card input, .calc-card select {
    background: var(--km-bg-elevated);
    border: 1px solid var(--km-border);
    color: var(--km-text-primary);
    font-family: var(--km-font);
    font-size: var(--km-font-size-xs);
    padding: 6px 10px;
    border-radius: var(--km-radius-xs);
    width: 100%;
  }
  .calc-card input:focus, .calc-card select:focus { outline: 1px solid var(--km-accent); }

  /* Result display */
  .result-display {
    background: var(--km-bg-surface);
    border: 1px solid var(--km-border);
    border-radius: var(--km-radius-md);
    padding: var(--km-space-4);
    display: flex;
    flex-direction: column;
    gap: var(--km-space-2);
  }
  .result-label {
    font-size: 10px;
    font-weight: var(--km-font-weight-semibold);
    color: var(--km-text-muted);
    text-transform: uppercase;
    letter-spacing: 0.06em;
  }
  .result-value {
    font-size: 36px;
    font-weight: var(--km-font-weight-semibold);
    color: var(--km-text-primary);
    font-variant-numeric: tabular-nums;
    line-height: 1;
  }
  .result-unit {
    font-size: 14px;
    color: var(--km-text-muted);
    font-weight: normal;
  }
  .result-sublabel {
    font-size: var(--km-font-size-xs);
    color: var(--km-text-muted);
    margin-top: var(--km-space-1);
  }
  .result-bar-wrap {
    height: 4px;
    border-radius: 2px;
    background: var(--km-bg-elevated);
    overflow: hidden;
    margin-top: var(--km-space-1);
  }
  .result-bar {
    height: 100%;
    border-radius: 2px;
    background: var(--km-accent);
    transition: width var(--km-duration-base), background var(--km-duration-base);
  }

  /* Right column — reference table */
  .sizing-ref {
    flex: 1;
    display: flex;
    flex-direction: column;
    gap: var(--km-space-3);
    overflow-y: auto;
    min-width: 0;
  }
  .ref-card {
    background: var(--km-bg-surface);
    border: 1px solid var(--km-border);
    border-radius: var(--km-radius-md);
    overflow: hidden;
  }
  .ref-card-header {
    display: flex;
    align-items: center;
    justify-content: space-between;
    padding: var(--km-space-2) var(--km-space-3);
    border-bottom: 1px solid var(--km-border);
    background: var(--km-bg-elevated);
  }
  .ref-card-title {
    font-size: var(--km-font-size-xs);
    font-weight: var(--km-font-weight-semibold);
    color: var(--km-text-primary);
  }
  .ref-card-sub { font-size: 10px; color: var(--km-text-muted); }
  .sizing-table {
    width: 100%;
    border-collapse: collapse;
    font-size: var(--km-font-size-xs);
  }
  .sizing-table th {
    text-align: left;
    padding: 5px 10px;
    color: var(--km-text-muted);
    font-weight: var(--km-font-weight-medium);
    font-size: 10px;
    border-bottom: 1px solid var(--km-border);
    white-space: nowrap;
  }
  .sizing-table td {
    padding: 5px 10px;
    color: var(--km-text-secondary);
    border-bottom: 1px solid var(--km-border);
    font-variant-numeric: tabular-nums;
    white-space: nowrap;
  }
  .sizing-table tbody tr:last-child td { border-bottom: none; }
  .sizing-table tbody tr:hover td { background: var(--km-bg-elevated); color: var(--km-text-primary); }
  .sizing-table td.highlight { color: var(--km-accent); font-weight: var(--km-font-weight-medium); }
  .tier-chip {
    display: inline-block;
    padding: 1px 6px;
    border-radius: var(--km-radius-full);
    font-size: 9px;
    font-weight: var(--km-font-weight-semibold);
  }
  .tier-chip.sig   { background: rgba(100,180,255,0.12); color: #6ab4ff; }
  .tier-chip.pwr   { background: rgba(255,160, 50,0.12); color: #ffa032; }
  .tier-chip.heavy { background: rgba(239, 68, 68,0.12); color: var(--km-danger); }

  /* Upcoming stubs */
  .upcoming-section {
    flex-shrink: 0;
    border: 1px dashed var(--km-border);
    border-radius: var(--km-radius-md);
    padding: var(--km-space-3) var(--km-space-4);
    display: flex;
    flex-direction: column;
    gap: var(--km-space-1-5);
  }
  .upcoming-title {
    font-size: var(--km-font-size-xs);
    font-weight: var(--km-font-weight-semibold);
    color: var(--km-text-muted);
    display: flex;
    align-items: center;
    gap: var(--km-space-2);
  }
  .upcoming-badge {
    font-size: 9px;
    padding: 1px 6px;
    border-radius: var(--km-radius-full);
    background: var(--km-bg-elevated);
    color: var(--km-text-muted);
    border: 1px solid var(--km-border);
    font-weight: var(--km-font-weight-medium);
  }
  .upcoming-desc {
    font-size: var(--km-font-size-xs);
    color: var(--km-text-muted);
    line-height: 1.5;
  }

  /* ── Shared buttons ── */
  .btn {
    display: inline-flex;
    align-items: center;
    gap: var(--km-space-1-5);
    padding: var(--km-space-1-5) var(--km-space-3);
    border-radius: var(--km-radius-sm);
    font-size: var(--km-font-size-xs);
    font-weight: var(--km-font-weight-medium);
    cursor: pointer;
    transition: background var(--km-duration-fast), color var(--km-duration-fast);
    border: 1px solid var(--km-border);
    background: var(--km-bg-surface);
    color: var(--km-text-secondary);
    user-select: none;
    white-space: nowrap;
  }
  .btn:hover { background: var(--km-bg-elevated); color: var(--km-text-primary); }
  .btn.primary { background: var(--km-accent-muted); color: var(--km-accent); border-color: var(--km-accent); }
  .btn.primary:hover { background: var(--km-accent); color: #000; }
  .btn:disabled { opacity: 0.4; cursor: not-allowed; }
  .section-title {
    font-size: var(--km-font-size-xs);
    font-weight: var(--km-font-weight-semibold);
    color: var(--km-text-secondary);
    margin-bottom: var(--km-space-1);
  }
</style>

<div class="panel">
  <!-- Header -->
  <div class="header">
    <span class="header-title">Stackup Manager</span>
    <button class="btn primary" id="btn-extract-kicad" title="Read real stackup from the open KiCad board via bridge">
      ↓ Extract from KiCad
    </button>
    <select class="preset-select" id="preset-select">
      <option value="">— Select Preset —</option>
    </select>
  </div>

  <!-- Tabs -->
  <div class="tabs">
    <div class="tab active" data-tab="stackup">Stackup</div>
    <div class="tab" data-tab="impedance">Impedance Calc</div>
    <div class="tab" data-tab="sizing">Trace Sizing</div>
  </div>

  <!-- ── Tab 1: Stackup ── -->
  <div class="tab-content active" id="tab-stackup">
    <div class="stackup-body">
      <div>
        <div class="editor-section-title">Cross-Section</div>
        <div class="cross-section" id="cross-section"></div>
        <div class="total-thickness">
          <span>Total thickness</span>
          <strong id="total-mm">—</strong>
        </div>
      </div>
      <div class="stackup-editor" id="layer-editor">
        <div class="placeholder-msg" id="editor-placeholder">Click a layer to edit its properties</div>
        <div id="editor-fields" style="display:none">
          <div class="editor-section-title" id="editor-layer-title">Layer Properties</div>
          <div class="field-grid">
            <div class="field"><label>Name</label><input id="ef-name" type="text"></div>
            <div class="field"><label>Material</label><input id="ef-material" type="text"></div>
            <div class="field"><label>Thickness (mm)</label><input id="ef-thickness" type="number" step="0.001" min="0"></div>
            <div class="field" id="ef-dk-field"><label>Dielectric Constant (Dk)</label><input id="ef-dk" type="number" step="0.01" min="1"></div>
            <div class="field" id="ef-oz-field">
              <label>Copper Weight (oz)</label>
              <select id="ef-oz">
                <option value="0.5">0.5 oz (17.5 µm)</option>
                <option value="1">1 oz (35 µm)</option>
                <option value="2">2 oz (70 µm)</option>
                <option value="3">3 oz (105 µm)</option>
              </select>
            </div>
          </div>
        </div>
        <div class="vault-actions">
          <button class="btn primary" id="btn-save-vault">Save to Vault</button>
          <button class="btn" id="btn-load-vault">Load from Vault</button>
          <button class="btn" id="btn-apply-kicad" disabled title="Coming soon — will push stackup to open KiCad board">Apply to KiCad</button>
        </div>
      </div>
    </div>
  </div>

  <!-- ── Tab 2: Impedance ── -->
  <div class="tab-content" id="tab-impedance">
    <div class="imp-body">
      <div class="imp-inputs">
        <div>
          <div class="editor-section-title">Trace Type</div>
          <div class="seg-control" id="trace-type-ctrl">
            <div class="seg-btn active" data-type="microstrip">Microstrip</div>
            <div class="seg-btn" data-type="stripline">Stripline</div>
            <div class="seg-btn" data-type="cpw">CPW</div>
          </div>
        </div>
        <div class="field">
          <label>Signal Layer</label>
          <select id="imp-layer-select" class="preset-select" style="min-width:0;width:100%"></select>
        </div>
        <div class="field">
          <label>Trace Width (mm)</label>
          <input id="imp-width" type="number" value="0.2" step="0.01" min="0.01"
            style="background:var(--km-bg-surface);border:1px solid var(--km-border);color:var(--km-text-primary);font-family:var(--km-font);font-size:var(--km-font-size-xs);padding:6px 8px;border-radius:var(--km-radius-xs);">
        </div>
        <div class="field">
          <label>Target Impedance (Ω)</label>
          <input id="imp-target" type="number" value="50" step="1" min="1"
            style="background:var(--km-bg-surface);border:1px solid var(--km-border);color:var(--km-text-primary);font-family:var(--km-font);font-size:var(--km-font-size-xs);padding:6px 8px;border-radius:var(--km-radius-xs);">
        </div>
        <div class="field" id="cpw-field" style="display:none">
          <label>Ground Clearance / Gap (mm)</label>
          <input id="imp-gap" type="number" value="0.2" step="0.01" min="0.01"
            style="background:var(--km-bg-surface);border:1px solid var(--km-border);color:var(--km-text-primary);font-family:var(--km-font);font-size:var(--km-font-size-xs);padding:6px 8px;border-radius:var(--km-radius-xs);">
        </div>
        <label class="toggle-row" id="diff-toggle-wrap">
          <input type="checkbox" id="diff-toggle">
          <span>Differential Pair</span>
        </label>
        <div class="field" id="diff-spacing-field" style="display:none">
          <label>Edge-to-Edge Spacing (mm)</label>
          <input id="imp-spacing" type="number" value="0.2" step="0.01" min="0.01"
            style="background:var(--km-bg-surface);border:1px solid var(--km-border);color:var(--km-text-primary);font-family:var(--km-font);font-size:var(--km-font-size-xs);padding:6px 8px;border-radius:var(--km-radius-xs);">
        </div>
      </div>
      <div class="imp-results">
        <div class="z0-display">
          <div class="z0-ring" id="z0-ring">
            <div>
              <div class="z0-value" id="z0-value">—</div>
              <div class="z0-unit">Ω</div>
            </div>
          </div>
          <div class="z0-meta">
            <div class="z0-label" id="z0-type-label">Single-ended impedance</div>
            <div class="z0-hint" id="z0-width-hint"></div>
            <div class="z0-label" id="z0-geo-note" style="margin-top:4px;font-size:10px;"></div>
          </div>
        </div>
        <div class="geo-row" id="geo-row"><span>Select a layer to see geometry</span></div>
        <div>
          <div class="section-title">Reference — Width for Standard Impedances</div>
          <table class="ref-table" id="ref-table">
            <thead><tr><th>Target (Ω)</th><th>Required Width (mm)</th><th>Effective Er</th></tr></thead>
            <tbody id="ref-table-body"></tbody>
          </table>
        </div>
      </div>
    </div>
  </div>

  <!-- ── Tab 3: Trace Sizing ── -->
  <div class="tab-content" id="tab-sizing">
    <div class="sizing-body">

      <!-- Left: calculator -->
      <div class="sizing-calc">

        <!-- Mode selector -->
        <div>
          <div class="editor-section-title">Calculation Mode</div>
          <div class="mode-toggle" id="sizing-mode-toggle">
            <div class="mode-btn active" data-mode="forward">
              Current → Width
              <span class="mode-sub">What width do I need?</span>
            </div>
            <div class="mode-btn" data-mode="reverse">
              Width → Current
              <span class="mode-sub">What can this trace carry?</span>
            </div>
          </div>
        </div>

        <!-- Inputs -->
        <div class="calc-card">
          <!-- Forward mode input -->
          <div id="fwd-input" class="field">
            <label>Target Current (A)</label>
            <input id="sz-current" type="number" value="1" step="0.1" min="0.001" placeholder="e.g. 0.025 for 25mA">
          </div>
          <!-- Reverse mode input -->
          <div id="rev-input" class="field" style="display:none">
            <label>Trace Width (mm)</label>
            <input id="sz-width" type="number" value="0.2" step="0.01" min="0.01">
          </div>

          <!-- Shared settings -->
          <div class="field">
            <label>Copper Layer</label>
            <select id="sz-layer">
              <option value="">— select layer —</option>
            </select>
          </div>
          <div class="field">
            <label>Copper Weight (oz)</label>
            <select id="sz-oz">
              <option value="auto">Auto (from stackup)</option>
              <option value="0.5">0.5 oz</option>
              <option value="1">1 oz</option>
              <option value="2">2 oz</option>
            </select>
          </div>
          <div class="field">
            <label>Temperature Rise (°C)</label>
            <input id="sz-dt" type="number" value="10" step="1" min="1" max="100">
          </div>
        </div>

        <!-- Result -->
        <div class="result-display" id="sz-result-card">
          <div class="result-label" id="sz-result-label">Minimum Width</div>
          <div>
            <span class="result-value" id="sz-result-value">—</span>
            <span class="result-unit" id="sz-result-unit">mm</span>
          </div>
          <div class="result-bar-wrap"><div class="result-bar" id="sz-result-bar" style="width:0%"></div></div>
          <div class="result-sublabel" id="sz-result-sub"></div>
        </div>

      </div>

      <!-- Right: reference table + upcoming stubs -->
      <div class="sizing-ref">
        <div>
          <div class="section-title">Quick Reference — IPC-2221B</div>
          <div class="ref-card">
            <div class="ref-card-header">
              <span class="ref-card-title" id="ref-table-title">Width required per current</span>
              <span class="ref-card-sub" id="ref-table-sub"></span>
            </div>
            <table class="sizing-table" id="sizing-ref-table">
              <thead>
                <tr>
                  <th>Current</th>
                  <th>Use-case</th>
                  <th>Ext. trace (mm)</th>
                  <th>Int. trace (mm)</th>
                  <th>Max I — 0.2mm ext.</th>
                </tr>
              </thead>
              <tbody id="sizing-ref-body"></tbody>
            </table>
          </div>
        </div>

        <!-- ── UPCOMING: Option B — Component Current Budgets ── -->
        <div class="upcoming-section">
          <div class="upcoming-title">
            Option B — Component Current Budgets
            <span class="upcoming-badge">Upcoming</span>
          </div>
          <div class="upcoming-desc">
            Assign current draw per component (U1 = 25 mA, U2 = 100 mA).
            KiMaster walks the bridge netlist tree from each power source to every
            sink, computing the exact current flowing through each track segment —
            trunk = sum of downstream sinks, branch = individual sink draw.
            Enables per-segment pass/fail without the false positives of net-level
            assignment.
          </div>
        </div>

        <!-- ── UPCOMING: Option C — Track Width Histogram ── -->
        <div class="upcoming-section">
          <div class="upcoming-title">
            Option C — Track Width Histogram
            <span class="upcoming-badge">Upcoming</span>
          </div>
          <div class="upcoming-desc">
            Pulls all track segments from the live KiCad bridge, groups them by
            width, and shows count, layer distribution, and max safe current
            (IPC-2221) for each bucket.  Zero user input — scan the histogram
            visually to spot undersized tracks across the whole board at once.
          </div>
        </div>

      </div>
    </div>
  </div>

</div>
`;

// ── Component ─────────────────────────────────────────────────────────────────

export class KmStackupPanel extends HTMLElement {
  constructor() {
    super();
    this.attachShadow({ mode: 'open' });
    this.shadowRoot.appendChild(TEMPLATE.content.cloneNode(true));

    this._config      = null;
    this._selectedIdx = -1;
    this._traceType   = 'microstrip';
    this._diffMode    = false;
    this._impLayer    = null;
    this._sizingMode  = 'forward'; // 'forward' | 'reverse'
    this._unsubs      = [];
  }

  connectedCallback() {
    this._buildPresetOptions();
    this._bindTabSwitching();
    this._bindImpedanceControls();
    this._bindSizingControls();
    this._bindVaultButtons();
    this._bindLayerEditor();
    this._bindExtractButton();

    const saved = store.stackupConfig;
    this._setConfig(saved || clonePreset(
      PRESETS.find(p => p.id === 'jlcpcb-4l-jlc7628') || PRESETS[0]
    ), false);

    // React when live stackup data arrives from bridge
    this._unsubs.push(subscribe('bridgeStackup', (data) => this._onBridgeStackup(data)));
    // If data already arrived before this panel was mounted
    if (store.bridgeStackup && !store.bridgeStackup.loading && store.bridgeStackup.layers?.length) {
      this._onBridgeStackup(store.bridgeStackup);
    }
  }

  disconnectedCallback() {
    this._unsubs.forEach(fn => fn());
    this._unsubs = [];
  }

  // ── Extract from KiCad ──────────────────────────────────────────────────────

  _bindExtractButton() {
    const btn = this.shadowRoot.getElementById('btn-extract-kicad');
    btn.addEventListener('click', async () => {
      if (!store.bridgeConnected) {
        notify({ type: 'warning', title: 'Not Connected', message: 'Connect to KiCad bridge first.' });
        return;
      }
      // Warn if old plugin version is detected (plugin_version < 0.1.1)
      const pv = store.bridgePluginVersion;
      if (pv && pv === '0.1.0') {
        notify({ type: 'warning', title: 'Old Plugin Version', message: 'Plugin v0.1.0 detected — reinstall the bridge plugin in KiMaster to get stackup extraction (v0.1.1+).' });
        return;
      }
      btn.disabled = true;
      btn.textContent = '↓ Extracting…';
      try {
        await requestBoardStackup();
        // Result arrives via store.bridgeStackup subscription above
      } catch (err) {
        Logger.warn('Stackup', 'extract from KiCad failed', err);
        notify({ type: 'error', title: 'Extract Failed', message: String(err) });
      } finally {
        btn.disabled = false;
        btn.textContent = '↓ Extract from KiCad';
      }
    });
  }

  /**
   * Called when `store.bridgeStackup` is updated with live data from the bridge.
   * Converts the raw pcbnew layer list into a StackupConfig and loads it.
   * @param {{ board_name, layers, source, error?, loading? }} data
   */
  _onBridgeStackup(data) {
    if (!data || data.loading) return;

    if (!data.layers?.length) {
      notify({
        type:    'error',
        title:   'Stackup Extract Failed',
        message: data.error || 'No layer data returned. Open a .kicad_pcb in KiCad first.',
      });
      return;
    }

    // Build a StackupConfig from the bridge data
    const boardFile  = (data.board_name || '').replace(/\\/g, '/').split('/').pop() || 'Board';
    const boardName  = boardFile.replace(/\.kicad_pcb$/i, '');
    const config = {
      id:                 'live-board',
      name:               `${boardName} (from KiCad)`,
      description:        `Live stackup extracted from ${boardFile} via pcbnew API`,
      manufacturer:       'Custom',
      layer_count:        data.layers.filter(l => l.layer_type === 'copper').length,
      total_thickness_mm: data.layers.reduce((s, l) => s + (l.thickness_mm || 0), 0),
      layers:             data.layers,
    };

    this._setConfig(config, true);
    const isSynthesized = data.source === 'synthesized';
    notify({
      type:    isSynthesized ? 'warning' : 'success',
      title:   isSynthesized ? 'Stackup Estimated' : 'Stackup Extracted',
      message: isSynthesized
        ? `${config.layer_count}-layer board — no explicit stackup found, FR4 defaults assumed. Define it in KiCad → Board Setup → Board Stackup.`
        : `${config.layer_count}-layer board · ${config.total_thickness_mm.toFixed(3)}mm · source: ${data.source}`,
    });
  }

  // ── Preset / config ─────────────────────────────────────────────────────────

  _buildPresetOptions() {
    const sel = this.shadowRoot.getElementById('preset-select');
    for (const p of PRESETS) {
      const opt = document.createElement('option');
      opt.value = p.id;
      opt.textContent = p.name;
      sel.appendChild(opt);
    }
    sel.addEventListener('change', () => {
      const preset = PRESETS.find(p => p.id === sel.value);
      if (preset) this._setConfig(clonePreset(preset), true);
    });
  }

  _setConfig(config, resetSelection = true) {
    this._config = config;
    store.stackupConfig = config;
    const sel = this.shadowRoot.getElementById('preset-select');
    sel.value = PRESETS.find(p => p.id === config.id) ? config.id : '';
    if (resetSelection) this._selectedIdx = -1;
    this._renderCrossSection();
    this._renderEditorFields();
    this._populateImpLayerOptions();
    this._populateSizingLayerOptions();
    this._recalcImpedance();
    this._recalcSizing();
  }

  // ── Tab 1: Cross-section ─────────────────────────────────────────────────────

  _renderCrossSection() {
    const container = this.shadowRoot.getElementById('cross-section');
    container.innerHTML = '';
    if (!this._config) return;

    const layers = this._config.layers;
    const maxThick = Math.max(...layers.map(l => l.thickness_mm));

    layers.forEach((layer, i) => {
      const row = document.createElement('div');
      row.className = 'layer-row' + (i === this._selectedIdx ? ' selected' : '');
      const barH = Math.max(4, Math.round((layer.thickness_mm / maxThick) * 32));
      const meta = layer.layer_type === 'copper'
        ? `${layer.copper_oz}oz · ${(layer.thickness_mm * 1000).toFixed(1)}µm`
        : layer.layer_type === 'dielectric'
          ? `Dk=${layer.dk} · ${layer.material}`
          : layer.material || layer.layer_type;

      row.innerHTML = `
        <div class="layer-bar ${layer.layer_type}" style="height:${barH}px"></div>
        <div class="layer-info">
          <div class="layer-name">${layer.name}</div>
          <div class="layer-meta">${meta}</div>
        </div>
        <div class="layer-thickness">${layer.thickness_mm.toFixed(4)}mm</div>
      `;
      row.addEventListener('click', () => this._selectLayer(i));
      container.appendChild(row);
    });

    this.shadowRoot.getElementById('total-mm').textContent =
      `${calcTotalThickness(layers).toFixed(4)} mm`;
  }

  _selectLayer(idx) {
    this._selectedIdx = idx;
    this._renderCrossSection();
    this._renderEditorFields();

    const layer = this._config?.layers[idx];
    if (layer?.layer_type === 'copper') {
      this._switchTab('impedance');
      const sel = this.shadowRoot.getElementById('imp-layer-select');
      sel.value = layer.name;
      this._impLayer = layer.name;
      this._traceType = defaultImpedanceType(layer.name);
      this._updateTraceTypeUI();
      this._recalcImpedance();
    }
  }

  // ── Layer editor ─────────────────────────────────────────────────────────────

  _renderEditorFields() {
    const placeholder = this.shadowRoot.getElementById('editor-placeholder');
    const fields      = this.shadowRoot.getElementById('editor-fields');
    if (this._selectedIdx < 0 || !this._config) {
      placeholder.style.display = '';
      fields.style.display = 'none';
      return;
    }
    placeholder.style.display = 'none';
    fields.style.display = '';
    const layer = this._config.layers[this._selectedIdx];
    this.shadowRoot.getElementById('editor-layer-title').textContent = `Layer: ${layer.name}`;
    this.shadowRoot.getElementById('ef-name').value      = layer.name;
    this.shadowRoot.getElementById('ef-material').value  = layer.material || '';
    this.shadowRoot.getElementById('ef-thickness').value = layer.thickness_mm;
    this.shadowRoot.getElementById('ef-dk').value        = layer.dk || '';
    this.shadowRoot.getElementById('ef-oz').value        = layer.copper_oz || 1;
    this.shadowRoot.getElementById('ef-dk-field').style.display  = layer.layer_type === 'dielectric' ? '' : 'none';
    this.shadowRoot.getElementById('ef-oz-field').style.display  = layer.layer_type === 'copper'     ? '' : 'none';
  }

  _bindLayerEditor() {
    const apply = () => {
      if (this._selectedIdx < 0 || !this._config) return;
      const layer = this._config.layers[this._selectedIdx];
      layer.name         = this.shadowRoot.getElementById('ef-name').value.trim()        || layer.name;
      layer.material     = this.shadowRoot.getElementById('ef-material').value;
      layer.thickness_mm = parseFloat(this.shadowRoot.getElementById('ef-thickness').value) || layer.thickness_mm;
      if (layer.layer_type === 'dielectric') {
        layer.dk = parseFloat(this.shadowRoot.getElementById('ef-dk').value) || layer.dk;
      }
      if (layer.layer_type === 'copper') {
        layer.copper_oz    = parseFloat(this.shadowRoot.getElementById('ef-oz').value) || 1;
        layer.thickness_mm = layer.copper_oz * 0.035;
        this.shadowRoot.getElementById('ef-thickness').value = layer.thickness_mm;
      }
      this._renderCrossSection();
      this._recalcImpedance();
      this._recalcSizing();
    };
    for (const id of ['ef-name','ef-material','ef-thickness','ef-dk']) {
      this.shadowRoot.getElementById(id)?.addEventListener('input', apply);
    }
    this.shadowRoot.getElementById('ef-oz')?.addEventListener('change', apply);
  }

  // ── Vault ────────────────────────────────────────────────────────────────────

  _bindVaultButtons() {
    this.shadowRoot.getElementById('btn-save-vault').addEventListener('click', () => this._saveToVault());
    this.shadowRoot.getElementById('btn-load-vault').addEventListener('click', () => this._loadFromVault());
  }

  async _saveToVault() {
    if (!this._config) return;
    try {
      await invoke(VAULT_SAVE_STACKUP, { config: this._config });
      Logger.info('Stackup', `Saved "${this._config.name}" to vault`);
      notify({ type: 'success', title: 'Stackup Saved', message: `"${this._config.name}" added to vault.` });
    } catch (err) {
      Logger.warn('Stackup', 'vault save failed', err);
      notify({ type: 'error', title: 'Vault Save Failed', message: String(err?.message ?? err) });
    }
  }

  async _loadFromVault() {
    try {
      const entries = await invoke(VAULT_LIST_STACKUPS);
      if (!entries?.length) return;
      const names = entries.map((e, i) => `${i + 1}. ${e.name}`).join('\n');
      const idx   = parseInt(prompt(`Select stackup (enter number):\n${names}`)) - 1;
      if (isNaN(idx) || idx < 0 || idx >= entries.length) return;
      const config = await invoke(VAULT_LOAD_STACKUP, { id: entries[idx].id });
      this._setConfig(config, true);
      notify({ type: 'success', title: 'Stackup Loaded', message: `"${entries[idx].name}" applied.` });
    } catch (err) {
      Logger.warn('Stackup', 'vault load failed', err);
      notify({ type: 'error', title: 'Vault Load Failed', message: String(err?.message ?? err) });
    }
  }

  // ── Tab switching ────────────────────────────────────────────────────────────

  _bindTabSwitching() {
    this.shadowRoot.querySelectorAll('.tab').forEach(tab => {
      tab.addEventListener('click', () => this._switchTab(tab.dataset.tab));
    });
  }

  _switchTab(id) {
    this.shadowRoot.querySelectorAll('.tab').forEach(t =>
      t.classList.toggle('active', t.dataset.tab === id));
    this.shadowRoot.querySelectorAll('.tab-content').forEach(c =>
      c.classList.toggle('active', c.id === `tab-${id}`));
  }

  // ── Tab 2: Impedance ─────────────────────────────────────────────────────────

  _populateImpLayerOptions() {
    const sel  = this.shadowRoot.getElementById('imp-layer-select');
    const prev = sel.value;
    sel.innerHTML = '';
    if (!this._config) return;
    for (const name of getCopperLayerNames(this._config.layers)) {
      const opt = document.createElement('option');
      opt.value = name; opt.textContent = name;
      sel.appendChild(opt);
    }
    if (prev && [...sel.options].some(o => o.value === prev)) sel.value = prev;
    this._impLayer = sel.value || null;
  }

  _bindImpedanceControls() {
    this.shadowRoot.querySelectorAll('#trace-type-ctrl .seg-btn').forEach(btn => {
      btn.addEventListener('click', () => {
        this._traceType = btn.dataset.type;
        this._updateTraceTypeUI();
        this._recalcImpedance();
      });
    });
    this.shadowRoot.getElementById('imp-layer-select').addEventListener('change', (e) => {
      this._impLayer = e.target.value;
      this._recalcImpedance();
    });
    for (const id of ['imp-width','imp-target','imp-gap','imp-spacing']) {
      this.shadowRoot.getElementById(id)?.addEventListener('input', () => this._recalcImpedance());
    }
    this.shadowRoot.getElementById('diff-toggle').addEventListener('change', (e) => {
      this._diffMode = e.target.checked;
      this.shadowRoot.getElementById('diff-spacing-field').style.display = this._diffMode ? '' : 'none';
      this._recalcImpedance();
    });
  }

  _updateTraceTypeUI() {
    this.shadowRoot.querySelectorAll('#trace-type-ctrl .seg-btn').forEach(btn =>
      btn.classList.toggle('active', btn.dataset.type === this._traceType));
    this.shadowRoot.getElementById('cpw-field').style.display =
      this._traceType === 'cpw' ? '' : 'none';
    this.shadowRoot.getElementById('diff-toggle-wrap').style.display =
      this._traceType === 'cpw' ? 'none' : '';
  }

  _resolveGeo() {
    if (!this._config || !this._impLayer) return null;
    const layers = this._config.layers;
    if (this._traceType === 'microstrip' || this._traceType === 'cpw') {
      return findMicrostripH(layers, this._impLayer);
    }
    const res = findStriplineB(layers, this._impLayer);
    return res ? { ...res, h_mm: res.b_mm / 2 } : null;
  }

  _recalcImpedance() {
    const w      = parseFloat(this.shadowRoot.getElementById('imp-width').value);
    const target = parseFloat(this.shadowRoot.getElementById('imp-target').value) || 50;
    const spacing= parseFloat(this.shadowRoot.getElementById('imp-spacing').value) || 0.2;
    const gap    = parseFloat(this.shadowRoot.getElementById('imp-gap').value) || 0.2;
    const geo    = this._resolveGeo();

    const geoRow = this.shadowRoot.getElementById('geo-row');
    if (geo) {
      const hLabel = this._traceType === 'stripline' ? `B=${geo.b_mm?.toFixed(3)}mm` : `H=${geo.h_mm?.toFixed(3)}mm`;
      geoRow.innerHTML = `<span><strong>${hLabel}</strong></span><span>Er=<strong>${geo.er?.toFixed(2)}</strong></span><span>T=<strong>${geo.t_mm?.toFixed(4)}mm</strong></span>`;
    } else {
      geoRow.innerHTML = `<span style="color:var(--km-text-muted)">No geometry — select a layer</span>`;
    }

    if (!geo || !w || w <= 0) { this._setZ0Display(null, target); this._renderRefTable(geo, target); return; }

    let z0;
    if (this._traceType === 'cpw') {
      z0 = calcCoplanarWaveguideZ0(w, geo.h_mm, gap, geo.er);
    } else {
      const gp = this._traceType === 'stripline'
        ? { b_mm: geo.b_mm, t_mm: geo.t_mm, er: geo.er }
        : { h_mm: geo.h_mm, t_mm: geo.t_mm, er: geo.er };
      z0 = calcZ0(this._traceType, w, gp);
    }
    if (this._diffMode && this._traceType !== 'cpw') {
      z0 = calcDiffPairZ0(z0, spacing, this._traceType === 'stripline' ? geo.b_mm / 2 : geo.h_mm);
    }
    this._setZ0Display(z0, target);

    const geoForSolve = this._traceType === 'stripline'
      ? { b_mm: geo.b_mm, t_mm: geo.t_mm, er: geo.er }
      : { h_mm: geo.h_mm, t_mm: geo.t_mm, er: geo.er, g_mm: gap };
    const reqW = calcWidthForZ0(this._traceType, target, geoForSolve);
    this.shadowRoot.getElementById('z0-width-hint').textContent =
      reqW ? `Width for ${target}Ω: ${reqW.toFixed(3)} mm` : '';

    this._renderRefTable(geo, target);
  }

  _setZ0Display(z0, target) {
    const ring = this.shadowRoot.getElementById('z0-ring');
    const val  = this.shadowRoot.getElementById('z0-value');
    const lbl  = this.shadowRoot.getElementById('z0-type-label');
    const note = this.shadowRoot.getElementById('z0-geo-note');
    if (!z0 || !isFinite(z0)) { val.textContent = '—'; ring.className = 'z0-ring'; note.textContent = ''; return; }
    val.textContent = z0.toFixed(1);
    lbl.textContent = this._diffMode
      ? 'Differential impedance (Zdiff)'
      : `${this._traceType === 'cpw' ? 'CPW' : this._traceType === 'stripline' ? 'Stripline' : 'Microstrip'} impedance`;
    const pct = Math.abs(z0 - target) / target;
    ring.className = 'z0-ring ' + (pct < 0.1 ? 'green' : pct < 0.25 ? 'yellow' : 'red');
    const layer = this._config?.layers.find(l => l.name === this._impLayer);
    if (layer) note.textContent = `Layer: ${layer.name} · ${layer.material || ''} · ${layer.copper_oz || 1}oz`;
  }

  _renderRefTable(geo, currentTarget) {
    const tbody = this.shadowRoot.getElementById('ref-table-body');
    tbody.innerHTML = '';
    if (!geo) return;
    const geoParam = this._traceType === 'stripline'
      ? { b_mm: geo.b_mm, t_mm: geo.t_mm, er: geo.er }
      : { h_mm: geo.h_mm, t_mm: geo.t_mm, er: geo.er, g_mm: 0.2 };
    for (const t of [25, 50, 75, 100]) {
      const w = calcWidthForZ0(this._traceType, t, geoParam);
      const tr = document.createElement('tr');
      tr.innerHTML = `<td>${t}Ω${t === currentTarget ? ' ★' : ''}</td><td>${w ? w.toFixed(3) : '—'}</td><td>${geo.er?.toFixed(2) || '—'}</td>`;
      tbody.appendChild(tr);
    }
  }

  // ── Tab 3: Trace Sizing ───────────────────────────────────────────────────────

  _populateSizingLayerOptions() {
    const sel  = this.shadowRoot.getElementById('sz-layer');
    const prev = sel.value;
    sel.innerHTML = '<option value="">— select layer —</option>';
    if (!this._config) return;
    for (const name of getCopperLayerNames(this._config.layers)) {
      const opt = document.createElement('option');
      opt.value = name; opt.textContent = name;
      sel.appendChild(opt);
    }
    // Default to F.Cu
    if (!prev || !([...sel.options].some(o => o.value === prev))) {
      const fcu = [...sel.options].find(o => o.value === 'F.Cu');
      if (fcu) sel.value = 'F.Cu';
    } else {
      sel.value = prev;
    }
  }

  _bindSizingControls() {
    // Mode toggle
    this.shadowRoot.querySelectorAll('.mode-btn').forEach(btn => {
      btn.addEventListener('click', () => {
        this._sizingMode = btn.dataset.mode;
        this.shadowRoot.querySelectorAll('.mode-btn').forEach(b =>
          b.classList.toggle('active', b.dataset.mode === this._sizingMode));
        this.shadowRoot.getElementById('fwd-input').style.display =
          this._sizingMode === 'forward' ? '' : 'none';
        this.shadowRoot.getElementById('rev-input').style.display =
          this._sizingMode === 'reverse' ? '' : 'none';
        this._recalcSizing();
      });
    });

    // Live recalc on any input change
    for (const id of ['sz-current','sz-width','sz-layer','sz-oz','sz-dt']) {
      this.shadowRoot.getElementById(id)?.addEventListener('input',  () => this._recalcSizing());
      this.shadowRoot.getElementById(id)?.addEventListener('change', () => this._recalcSizing());
    }
  }

  _getSizingParams() {
    const layerName = this.shadowRoot.getElementById('sz-layer')?.value || '';
    const ozMode    = this.shadowRoot.getElementById('sz-oz')?.value || 'auto';
    const dT        = parseFloat(this.shadowRoot.getElementById('sz-dt')?.value)  || 10;

    // Resolve copper oz — auto reads from stackup, otherwise use manual selection
    let oz = 1;
    if (ozMode === 'auto') {
      oz = this._config ? resolveLayerCopperOz(layerName, this._config.layers) : 1;
    } else {
      oz = parseFloat(ozMode) || 1;
    }

    // Resolve location — external = F.Cu or B.Cu, everything else = internal
    const location = (layerName === 'F.Cu' || layerName === 'B.Cu') ? 'external' : 'internal';

    return { layerName, oz, dT, location };
  }

  _recalcSizing() {
    const { layerName, oz, dT, location } = this._getSizingParams();
    const resultVal  = this.shadowRoot.getElementById('sz-result-value');
    const resultLbl  = this.shadowRoot.getElementById('sz-result-label');
    const resultUnit = this.shadowRoot.getElementById('sz-result-unit');
    const resultSub  = this.shadowRoot.getElementById('sz-result-sub');
    const resultBar  = this.shadowRoot.getElementById('sz-result-bar');

    if (this._sizingMode === 'forward') {
      const current = parseFloat(this.shadowRoot.getElementById('sz-current')?.value);
      resultLbl.textContent = 'Minimum Trace Width';
      resultUnit.textContent = 'mm';

      if (!current || current <= 0) {
        resultVal.textContent = '—';
        resultBar.style.width = '0%';
        resultSub.textContent = '';
      } else {
        const w = calcRequiredWidth(current, oz, dT, location);
        resultVal.textContent = w.toFixed(4);
        resultSub.textContent =
          `${current}A · ${oz}oz ${location} · ΔT=${dT}°C — ` +
          `${(w * 1000 / 25.4).toFixed(1)} mil`;
        // Bar: scale 0–5mm → 0–100%
        resultBar.style.width = Math.min(100, (w / 5) * 100).toFixed(1) + '%';
        resultBar.style.background = w < 0.1 ? 'var(--km-live)' : w < 2 ? 'var(--km-accent)' : 'var(--km-warning)';
      }
    } else {
      // Reverse: width → max current
      const w = parseFloat(this.shadowRoot.getElementById('sz-width')?.value);
      resultLbl.textContent = 'Maximum Safe Current';
      resultUnit.textContent = 'A';

      if (!w || w <= 0) {
        resultVal.textContent = '—';
        resultBar.style.width = '0%';
        resultSub.textContent = '';
      } else {
        const iMax = calcMaxCurrent(w, oz, dT, location);
        resultVal.textContent = iMax.toFixed(3);
        resultSub.textContent =
          `${w}mm trace · ${oz}oz ${location} · ΔT=${dT}°C — ` +
          `${(w / 0.0254).toFixed(0)} mil wide`;
        // Bar: scale 0–10A → 0–100%
        resultBar.style.width = Math.min(100, (iMax / 10) * 100).toFixed(1) + '%';
        resultBar.style.background = iMax >= 1 ? 'var(--km-live)' : iMax >= 0.3 ? 'var(--km-accent)' : 'var(--km-warning)';
      }
    }

    this._renderSizingRefTable(oz, dT, location, layerName);
  }

  _renderSizingRefTable(oz, dT, location, layerName) {
    const tbody = this.shadowRoot.getElementById('sizing-ref-body');
    const sub   = this.shadowRoot.getElementById('ref-table-sub');
    tbody.innerHTML = '';

    // Show oz and layer context in subtitle
    sub.textContent = layerName
      ? `${layerName} · ${oz}oz · ΔT=${dT}°C`
      : `${oz}oz · ΔT=${dT}°C`;

    // Rows: common current values covering signal traces to heavy power
    const rows = [
      { current: 0.025, label: '25 mA',  tier: 'sig',   note: 'CAN IC, LDO enable, LED' },
      { current: 0.1,   label: '100 mA', tier: 'sig',   note: 'MCU core, small LDO' },
      { current: 0.25,  label: '250 mA', tier: 'sig',   note: 'USB VBUS, LDO output' },
      { current: 0.5,   label: '500 mA', tier: 'pwr',   note: 'USB 2.0 limit, small motor' },
      { current: 1.0,   label: '1 A',    tier: 'pwr',   note: 'Buck output, sensor rail' },
      { current: 2.0,   label: '2 A',    tier: 'pwr',   note: 'LED driver, stepper coil' },
      { current: 3.0,   label: '3 A',    tier: 'pwr',   note: 'Main 3.3 V / 5 V rail' },
      { current: 5.0,   label: '5 A',    tier: 'heavy', note: 'Motor driver, high-power buck' },
      { current: 10.0,  label: '10 A',   tier: 'heavy', note: 'Battery charge path, FET drain' },
    ];

    // Current user input for highlighting
    const userCurrent = this._sizingMode === 'forward'
      ? parseFloat(this.shadowRoot.getElementById('sz-current')?.value)
      : null;

    for (const row of rows) {
      // Always compute for external and internal so the table shows both
      const wExt = calcRequiredWidth(row.current, oz, dT, 'external');
      const wInt = calcRequiredWidth(row.current, oz, dT, 'internal');
      // Max current for a 0.2mm external trace at this oz/dT
      const iMax02 = calcMaxCurrent(0.2, oz, dT, 'external');

      const isHighlighted = userCurrent && Math.abs(row.current - userCurrent) < row.current * 0.05;
      const tr = document.createElement('tr');
      tr.innerHTML = `
        <td class="${isHighlighted ? 'highlight' : ''}">${row.label}</td>
        <td><span class="tier-chip ${row.tier}">${row.note}</span></td>
        <td class="${isHighlighted ? 'highlight' : ''}">${wExt.toFixed(3)}</td>
        <td>${wInt.toFixed(3)}</td>
        <td style="color:var(--km-text-muted);font-size:10px">${iMax02.toFixed(3)} A</td>
      `;
      tbody.appendChild(tr);
    }
  }
}

customElements.define('km-stackup-panel', KmStackupPanel);
