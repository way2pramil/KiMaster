/**
 * @element km-component-vault
 * @summary Unified Component Engine (UCE) browser — search LCSC/JLCPCB,
 *          preview parts, add to global component vault.
 *          All processing happens in native Rust (no Python).
 *          The vault is project-independent — works without an open project.
 *
 * Tabs:
 *   1. Search — keyword search against JLCPCB catalogue, results table
 *   2. Bulk   — paste LCSC IDs (one per line), queue-add to vault
 *   3. Vault  — list installed components, remove
 *
 * @fires km-uce-vault-added   — { lcsc_id, name }
 * @fires km-uce-vault-removed — { lcsc_id }
 * @fires km-uce-search-done   — { keyword, total }
 */

import { Logger             } from '../../../core/Logger.js';
import { invoke             } from '../../../core/Ipc.js';
import {
  searchComponents, previewComponent,
  addToVault,
  getVault, removeFromVault,
} from '../../../modules/uce/UceService.js';
import {
  KM_UCE_VAULT_ADDED, KM_UCE_VAULT_REMOVED, KM_UCE_SEARCH_DONE,
} from '../../../core/AppEvents.js';
import { load as loadPpCfg } from '../../../modules/uce/PostProcessConfig.js';
import './VaultPostProcessPanel.js';
import {
  SET_VAULT_DIR,
  VAULT_LIST_STACKUPS, VAULT_SAVE_STACKUP, VAULT_LOAD_STACKUP, VAULT_REMOVE_STACKUP,
  VAULT_LIST_TEMPLATES, VAULT_IMPORT_TEMPLATE, VAULT_INSTANTIATE_TEMPLATE, VAULT_REMOVE_TEMPLATE,
  VAULT_LIST_BLOCKS, VAULT_IMPORT_BLOCK, VAULT_REMOVE_BLOCK,
} from '../../../core/AppCommands.js';

const TEMPLATE = document.createElement('template');
TEMPLATE.innerHTML = `
<style>
  :host {
    display: flex;
    flex-direction: column;
    height: 100%;
    overflow: hidden;
    font-family: var(--km-font);
    color: var(--km-text-primary);
    background: var(--km-bg-primary);
  }

  /* ── Tabs ── */
  .tabs {
    display: flex;
    align-items: center;
    gap: var(--km-space-2);
    padding: 0 var(--km-space-3);
    height: 38px;
    border-bottom: 1px solid var(--km-border);
    background: var(--km-bg-elevated);
    flex-shrink: 0;
  }
  .tab {
    background: none;
    border: none;
    padding: var(--km-space-1) var(--km-space-3);
    border-radius: var(--km-radius-sm);
    color: var(--km-text-secondary);
    font-family: var(--km-font);
    font-size: var(--km-font-size-sm);
    cursor: pointer;
    transition: color var(--km-duration-fast) var(--km-ease),
                background var(--km-duration-fast) var(--km-ease);
  }
  .tab:hover { color: var(--km-text-primary); background: var(--km-bg-surface); }
  .tab.active { color: var(--km-accent); background: var(--km-accent-muted); }
  .tab-sep { flex: 1; }
  .vault-count {
    font-size: var(--km-font-size-xs);
    color: var(--km-text-muted);
    font-variant-numeric: tabular-nums;
  }

  /* ── Search row ── */
  .search-row {
    display: flex;
    gap: var(--km-space-2);
    padding: var(--km-space-3);
    border-bottom: 1px solid var(--km-border);
    flex-shrink: 0;
    background: var(--km-bg-surface);
  }
  .search-row.hidden { display: none; }
  .search-input {
    flex: 1;
    background: var(--km-bg-input);
    border: 1px solid var(--km-border);
    border-radius: var(--km-radius-sm);
    padding: var(--km-space-1) var(--km-space-2);
    color: var(--km-text-primary);
    font-family: var(--km-font);
    font-size: var(--km-font-size-sm);
    outline: none;
    transition: border-color var(--km-duration-fast) var(--km-ease);
  }
  .search-input:focus { border-color: var(--km-accent); }
  .search-input::placeholder { color: var(--km-text-muted); }

  .btn-outline {
    background: none;
    border: 1px solid var(--km-border);
    color: var(--km-text-secondary);
    padding: var(--km-space-1) var(--km-space-3);
    border-radius: var(--km-radius-sm);
    font-size: var(--km-font-size-sm);
    font-family: var(--km-font);
    cursor: pointer;
    transition: color var(--km-duration-fast), border-color var(--km-duration-fast);
  }
  .btn-outline:hover { color: var(--km-text-primary); border-color: var(--km-border-strong); }

  .btn-advanced {
    width: 30px; height: 30px; flex-shrink: 0;
    background: none;
    border: 1px solid var(--km-border);
    border-radius: var(--km-radius-sm);
    color: var(--km-text-muted);
    font-size: 14px; cursor: pointer;
    display: flex; align-items: center; justify-content: center;
    transition: color var(--km-duration-fast), border-color var(--km-duration-fast),
                background var(--km-duration-fast);
  }
  .btn-advanced:hover  { color: var(--km-accent); border-color: var(--km-accent); }
  .btn-advanced.active { color: var(--km-accent); border-color: var(--km-accent);
                         background: var(--km-accent-muted); }

  #search-pane { position: relative; overflow: hidden; display: flex; flex-direction: column; flex: 1; }

  .btn-primary {
    background: var(--km-accent);
    border: none;
    color: #fff;
    padding: var(--km-space-1) var(--km-space-3);
    border-radius: var(--km-radius-sm);
    font-size: var(--km-font-size-sm);
    cursor: pointer;
    transition: background var(--km-duration-fast) var(--km-ease);
  }
  .btn-primary:hover { background: var(--km-accent-hover); }
  .btn-primary:disabled { background: var(--km-bg-elevated); color: var(--km-text-muted); cursor: not-allowed; }

  .btn-ghost {
    background: none;
    border: 1px solid var(--km-border);
    color: var(--km-text-secondary);
    padding: var(--km-space-1) var(--km-space-3);
    border-radius: var(--km-radius-sm);
    font-size: var(--km-font-size-sm);
    cursor: pointer;
    transition: color var(--km-duration-fast) var(--km-ease),
                border-color var(--km-duration-fast) var(--km-ease);
  }
  .btn-ghost:hover { color: var(--km-text-primary); border-color: var(--km-text-muted); }
  .btn-ghost.danger:hover { color: var(--km-red); border-color: var(--km-red); }

  /* ── Body ── */
  .body {
    flex: 1;
    overflow: auto;
    padding: var(--km-space-2);
  }

  /* ── Table ── */
  table {
    width: 100%;
    border-collapse: collapse;
    font-size: var(--km-font-size-sm);
  }
  th {
    text-align: left;
    color: var(--km-text-muted);
    font-weight: var(--km-font-weight-medium);
    padding: var(--km-space-1) var(--km-space-2);
    border-bottom: 1px solid var(--km-border);
    background: var(--km-bg-elevated);
    position: sticky;
    top: 0;
    z-index: 1;
  }
  td {
    padding: var(--km-space-1) var(--km-space-2);
    border-bottom: 1px solid var(--km-border);
    color: var(--km-text-primary);
    vertical-align: top;
  }
  tr:hover td { background: var(--km-bg-surface); }
  .lcsc-cell {
    font-family: var(--km-font-mono);
    color: var(--km-cyan);
    font-variant-numeric: tabular-nums;
  }
  .pkg-cell    { font-family: var(--km-font-mono); color: var(--km-text-secondary); }
  .stock-cell  { font-variant-numeric: tabular-nums; color: var(--km-text-secondary); text-align: right; }
  .price-cell  { font-variant-numeric: tabular-nums; color: var(--km-trace); text-align: right; }
  .desc-cell   { color: var(--km-text-secondary); max-width: 320px; overflow: hidden; text-overflow: ellipsis; }
  .type-badge {
    display: inline-block;
    padding: 0 6px;
    font-size: 10px;
    border-radius: var(--km-radius-xs);
    border: 1px solid var(--km-border);
    color: var(--km-text-secondary);
  }
  .type-badge.basic    { color: var(--km-trace);  border-color: rgba(16,185,129,0.3); background: rgba(16,185,129,0.08); }
  .type-badge.extended { color: var(--km-warning); border-color: rgba(245,158,11,0.3); background: rgba(245,158,11,0.08); }
  .action-cell { text-align: right; white-space: nowrap; }

  .row-btn {
    background: none;
    border: 1px solid var(--km-border);
    color: var(--km-text-secondary);
    padding: 1px 7px;
    margin-left: 4px;
    border-radius: var(--km-radius-xs);
    font-size: var(--km-font-size-xs);
    cursor: pointer;
    transition: color var(--km-duration-fast) var(--km-ease),
                border-color var(--km-duration-fast) var(--km-ease);
    font-family: var(--km-font);
  }
  .row-btn:hover { color: var(--km-accent); border-color: var(--km-accent); }
  .row-btn.added { color: var(--km-trace); border-color: var(--km-trace); cursor: default; background: rgba(74,222,128,0.07); }
  .row-btn.added:hover { color: var(--km-trace); border-color: var(--km-trace); }
  .row-btn.danger:hover { color: var(--km-red); border-color: var(--km-red); }
  .row-btn:disabled { opacity: 0.55; cursor: wait; }

  /* ── Add-to-vault button — prominent primary action ── */
  .add-vault-btn {
    background: var(--km-accent-muted);
    border: 1.5px solid var(--km-accent-border);
    color: var(--km-accent-hover);
    padding: 4px 13px;
    border-radius: var(--km-radius-sm);
    font-size: var(--km-font-size-sm);
    font-weight: 600;
    font-family: var(--km-font);
    cursor: pointer;
    white-space: nowrap;
    min-width: 118px;
    display: inline-flex;
    align-items: center;
    justify-content: center;
    gap: 5px;
    transition: background var(--km-duration-fast), color var(--km-duration-fast),
                border-color var(--km-duration-fast), box-shadow var(--km-duration-fast);
  }
  .add-vault-btn:hover:not(:disabled) {
    background: var(--km-accent);
    color: #fff;
    border-color: var(--km-accent);
    box-shadow: 0 0 10px var(--km-accent-muted);
  }
  .add-vault-btn.busy {
    color: var(--km-text-secondary);
    border-color: var(--km-border);
    background: var(--km-bg-elevated);
    cursor: wait;
  }
  .add-vault-btn.success {
    color: var(--km-trace, #4ade80);
    border-color: rgba(74,222,128,0.35);
    background: rgba(74,222,128,0.08);
    cursor: default;
  }
  .add-vault-btn.warn {
    color: var(--km-warning, #fbbf24);
    border-color: rgba(251,191,36,0.35);
    background: rgba(251,191,36,0.08);
    cursor: default;
  }
  .add-vault-btn.fail {
    color: var(--km-red, #f87171);
    border-color: rgba(248,113,113,0.35);
    background: rgba(248,113,113,0.08);
    cursor: default;
  }
  .add-vault-btn:disabled { cursor: default; }

  /* Spinner inside buttons */
  @keyframes km-spin { to { transform: rotate(360deg); } }
  .km-spinner {
    display: inline-block;
    width: 11px; height: 11px; flex-shrink: 0;
    border: 1.5px solid currentColor;
    border-top-color: transparent;
    border-radius: 50%;
    animation: km-spin 0.65s linear infinite;
  }

  /* ── Empty states ── */
  .empty {
    padding: var(--km-space-6);
    text-align: center;
    color: var(--km-text-muted);
    font-size: var(--km-font-size-sm);
  }

  /* ── Inline bulk queue ── */
  .bulk-queue {
    padding: var(--km-space-3) var(--km-space-3) 0;
    display: flex;
    flex-direction: column;
    gap: var(--km-space-3);
  }
  .bulk-header {
    display: flex;
    align-items: center;
    gap: var(--km-space-2);
  }
  .bulk-header-label {
    flex: 1;
    font-size: var(--km-font-size-sm);
    font-weight: 600;
    color: var(--km-text-primary);
  }
  .bulk-chips {
    display: flex;
    flex-wrap: wrap;
    gap: 6px;
  }
  .bulk-chip {
    display: inline-flex;
    align-items: center;
    gap: 5px;
    padding: 3px 10px;
    border-radius: var(--km-radius-full);
    font-family: var(--km-font-mono);
    font-size: 11px;
    font-variant-numeric: tabular-nums;
    border: 1px solid var(--km-border);
    background: var(--km-bg-elevated);
    color: var(--km-text-secondary);
    transition: background var(--km-duration-fast), color var(--km-duration-fast),
                border-color var(--km-duration-fast);
  }
  .bulk-chip.pending  { }
  .bulk-chip.running  { color: var(--km-text-primary); border-color: var(--km-accent-border); background: var(--km-accent-muted); }
  .bulk-chip.done     { color: var(--km-trace,#4ade80); border-color: rgba(74,222,128,.3); background: rgba(74,222,128,.07); }
  .bulk-chip.warn     { color: var(--km-warning,#fbbf24); border-color: rgba(251,191,36,.3); background: rgba(251,191,36,.07); }
  .bulk-chip.fail     { color: var(--km-red,#f87171); border-color: rgba(248,113,113,.3); background: rgba(248,113,113,.07); }
  .bulk-progress-row  { display: flex; align-items: center; gap: var(--km-space-2); }
  .bulk-bar           { flex: 1; height: 3px; background: var(--km-bg-elevated); border-radius: var(--km-radius-full); overflow: hidden; }
  .bulk-bar__fill     { height: 100%; background: var(--km-accent); width: 0%; transition: width 0.25s var(--km-ease); }
  .bulk-prog-text     { font-size: 10px; font-variant-numeric: tabular-nums; color: var(--km-text-muted); white-space: nowrap; }

  /* ── Status / loader ── */
  .status-line {
    padding: var(--km-space-1) var(--km-space-3);
    font-size: var(--km-font-size-xs);
    color: var(--km-text-muted);
    border-top: 1px solid var(--km-border);
    background: var(--km-bg-elevated);
    font-variant-numeric: tabular-nums;
    flex-shrink: 0;
  }
  .status-line.error { color: var(--km-red); }
  .status-line.ok    { color: var(--km-trace); }
  .status-line.warn  { color: var(--km-warning, #fbbf24); }

  /* ── Vault directory bar ── */
  .vault-dir-bar {
    display: flex;
    align-items: center;
    gap: var(--km-space-2);
    padding: var(--km-space-2) var(--km-space-3);
    border-bottom: 1px solid var(--km-border);
    background: var(--km-bg-surface);
    flex-shrink: 0;
  }
  .vault-dir-bar .dir-label {
    font-size: var(--km-font-size-xs);
    color: var(--km-text-muted);
    white-space: nowrap;
  }
  .vault-dir-bar .dir-path {
    flex: 1;
    font-family: var(--km-font-mono);
    font-size: 11px;
    color: var(--km-text-secondary);
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
    min-width: 0;
  }
  .vault-dir-bar .btn-change {
    background: none;
    border: 1px solid var(--km-border);
    color: var(--km-text-secondary);
    padding: 2px 10px;
    border-radius: var(--km-radius-xs);
    font-size: var(--km-font-size-xs);
    cursor: pointer;
    white-space: nowrap;
    font-family: var(--km-font);
    transition: color var(--km-duration-fast) var(--km-ease),
                border-color var(--km-duration-fast) var(--km-ease);
  }
  .vault-dir-bar .btn-change:hover {
    color: var(--km-accent);
    border-color: var(--km-accent);
  }

  /* ── Pane visibility ── */
  .hidden,
  [id$="-pane"].hidden {
    display: none !important;
  }

  /* ── Sub-vault panes ── */
  #stackups-pane,
  #templates-pane,
  #blocks-pane {
    display: flex;
    flex-direction: column;
    flex: 1;
    overflow: hidden;
  }
</style>

<!-- Tabs -->
<div class="tabs">
  <button class="tab active" data-tab="search">Library</button>
  <button class="tab"        data-tab="stackups">Stackups</button>
  <button class="tab"        data-tab="templates">Templates</button>
  <button class="tab"        data-tab="blocks">Blocks</button>
  <span class="tab-sep"></span>
  <span class="vault-count" id="vault-count"></span>
</div>

<!-- Library tab — search bar + vault list (default) + results + bulk queue -->
<div id="search-pane">
  <!-- Search row -->
  <div class="search-row" id="search-row">
    <input class="search-input" id="search-input"
           placeholder="Search by keyword, LCSC ID, or paste multiple IDs (C49678, C144198 …)"
           type="text" />
    <button class="btn-primary" id="btn-search">Search</button>
    <button class="btn-advanced" id="btn-advanced" title="Post-processing options">⚙</button>
  </div>
  <!-- Post-process panel overlay (hidden by default) -->
  <div id="pp-overlay" style="display:none;position:absolute;top:0;right:0;bottom:0;width:300px;z-index:10;background:var(--km-bg-primary);border-left:1px solid var(--km-border);box-shadow:var(--km-shadow-xl,none);">
    <km-vault-pp-panel id="pp-panel"></km-vault-pp-panel>
  </div>
  <!-- Content area: vault list by default, results when searching -->
  <div class="body" id="search-body"></div>
</div>

<!-- Stackups tab -->
<div id="stackups-pane" class="hidden">
  <div class="body" id="stackups-body">
    <div class="empty" id="stackups-empty">
      <p style="margin-bottom:8px">No stackup configurations saved yet.</p>
      <p style="font-size:11px;color:var(--km-text-muted)">Stackups define PCB layer structures — copper layers, dielectric materials, thickness, and εr values.<br>Save your frequently used stackups here to reuse across projects.</p>
    </div>
  </div>
</div>

<!-- Templates tab -->
<div id="templates-pane" class="hidden">
  <div class="body" id="templates-body">
    <div class="empty" id="templates-empty">
      <p style="margin-bottom:8px">No project templates saved yet.</p>
      <p style="font-size:11px;color:var(--km-text-muted)">Templates are complete KiCad projects with pre-configured DRC rules, netclasses,<br>track widths, clearances, and layer stackups baked in.<br>Import a configured project, then instantiate it for new boards.</p>
      <button class="btn-primary" id="btn-import-template" style="margin-top:12px">Import project as template…</button>
    </div>
  </div>
</div>

<!-- Blocks tab -->
<div id="blocks-pane" class="hidden">
  <div class="body" id="blocks-body">
    <div class="empty" id="blocks-empty">
      <p style="margin-bottom:8px">No reusable design blocks saved yet.</p>
      <p style="font-size:11px;color:var(--km-text-muted)">Blocks are ready-to-reuse schematic + layout pairs — buck converters, USB-C connectors,<br>Ethernet PHY circuits, etc. Import a schematic (.kicad_sch) and optional layout (.kicad_pcb)<br>to save a block for use in future projects.</p>
      <button class="btn-primary" id="btn-import-block" style="margin-top:12px">Import block…</button>
    </div>
  </div>
</div>

<!-- Status line -->
<div class="status-line" id="status-line">Native Rust • EasyEDA → KiCad pipeline ready</div>
`;

export class KmComponentVault extends HTMLElement {
  constructor() {
    super();
    this.attachShadow({ mode: 'open' });
    this.shadowRoot.appendChild(TEMPLATE.content.cloneNode(true));

    this._activeTab  = 'search';
    this._bodyMode   = 'vault';   // 'vault' | 'results' | 'bulk'
    /** @type {import('../../../modules/uce/UceService.js').UceSearchItem[]} */
    this._results    = [];
    /** @type {import('../../../modules/uce/UceService.js').VaultEntry[]} */
    this._vault      = [];
    this._busyAdd    = new Set();
    this._unsubs     = [];

    /** @type {Array} */ this._stackups  = [];
    /** @type {Array} */ this._templates = [];
    /** @type {Array} */ this._blocks    = [];

    // Post-processing config (loaded from localStorage, sent with every add-to-vault)
    this._ppConfig = loadPpCfg();
    this._ppOpen   = false;
  }

  connectedCallback() {
    this._wireTabs();
    this._wireSearch();
    this._wireSubVaultButtons();
    this._wireAdvanced();
    // Load vault and show it as default Library content — no API call needed
    this._loadVault().then(() => this._renderBody());
  }

  disconnectedCallback() {
    for (const u of this._unsubs) u();
    this._unsubs = [];
  }

  // ── Vault ──────────────────────────────────────────────────────────────────

  async _loadVault() {
    this._vault = await getVault();
    this._updateVaultCount();
    return this._vault;
  }

  _updateVaultCount() {
    const el = this.shadowRoot.getElementById('vault-count');
    if (el) {
      el.textContent = this._vault.length
        ? `${this._vault.length} installed`
        : '';
    }
  }

  // ── Vault directory (managed via Settings panel — no controls here) ─────────

  _wireVaultDir() {
    const btn = this.shadowRoot.getElementById('btn-change-vault-dir');
    if (!btn) return;  // element was removed — no-op guard
    btn.addEventListener('click', async () => {
      btn.disabled = true;
      btn.textContent = 'Selecting…';
      try {
        const r = await invoke(SET_VAULT_DIR, {});
        this._setStatus(`Library directory set to: ${r.global_vault}`, 'ok');
        // Reload vault from new location
        await this._loadVault();
        this._renderBody();
      } catch (err) {
        const msg = String(err);
        if (!msg.includes('No folder selected')) {
          Logger.error('ComponentVault', 'setVaultDir failed', err);
          this._setStatus(`Failed to change directory: ${msg}`, 'error');
        }
      } finally {
        btn.disabled = false;
        btn.textContent = 'Change…';
      }
    });
  }

  // ── Advanced / Post-process panel ────────────────────────────────────────

  _wireAdvanced() {
    const btn     = this.shadowRoot.getElementById('btn-advanced');
    const overlay = this.shadowRoot.getElementById('pp-overlay');
    const panel   = this.shadowRoot.getElementById('pp-panel');
    if (!btn || !overlay || !panel) return;

    btn.addEventListener('click', () => {
      this._ppOpen = !this._ppOpen;
      overlay.style.display = this._ppOpen ? 'block' : 'none';
      btn.classList.toggle('active', this._ppOpen);
    });

    // Keep config in sync when user changes settings in the panel
    panel.addEventListener('pp-change', (e) => {
      this._ppConfig = e.detail;
    });

    // Close button inside the panel
    panel.addEventListener('pp-close', () => {
      this._ppOpen = false;
      overlay.style.display = 'none';
      btn.classList.remove('active');
    });
  }

  // ── Tabs ──────────────────────────────────────────────────────────────────

  _wireTabs() {
    const tabs = this.shadowRoot.querySelectorAll('.tab');
    for (const tab of tabs) {
      tab.addEventListener('click', () => {
        this._activeTab = tab.dataset.tab;
        tabs.forEach(t => t.classList.toggle('active', t.dataset.tab === this._activeTab));
        this._showTab(this._activeTab);
      });
    }
  }

  _showTab(tab) {
    const map = {
      search:    'search-pane',
      stackups:  'stackups-pane',
      templates: 'templates-pane',
      blocks:    'blocks-pane',
    };
    for (const [name, id] of Object.entries(map)) {
      const el = this.shadowRoot.getElementById(id);
      if (el) el.classList.toggle('hidden', name !== tab);
    }
    if (tab === 'stackups')  this._loadStackups();
    if (tab === 'templates') this._loadTemplates();
    if (tab === 'blocks')    this._loadBlocks();
  }

  // ── Body rendering dispatcher ─────────────────────────────────────────────

  /** Render the Library body based on current _bodyMode. */
  _renderBody() {
    if (this._bodyMode === 'vault')   this._renderVaultInline();
    if (this._bodyMode === 'results') this._renderResults();
    // 'bulk' is rendered directly by _runBulkQueue
  }

  // ── Smart search / bulk ───────────────────────────────────────────────────

  /** Classify input text: bulk | search */
  _classifyInput(raw) {
    const text = raw.trim();
    // Comma-separated or multi-line → bulk
    const ids = text.split(/[\n,]+/)
      .map(s => s.trim())
      .filter(s => /^C\d+$/i.test(s));
    if (ids.length > 1) return { mode: 'bulk', ids };
    // Single LCSC ID → direct add (skip catalog search)
    if (/^C\d+$/i.test(text)) return { mode: 'direct', id: text.toUpperCase() };
    // Otherwise → keyword search
    return { mode: 'search', keyword: text };
  }

  _wireSearch() {
    const input = this.shadowRoot.getElementById('search-input');
    const btn   = this.shadowRoot.getElementById('btn-search');

    // Update button label dynamically while typing;
    // also restore vault list when input is cleared
    const updateBtn = () => {
      const cls = this._classifyInput(input.value);
      if (cls.mode === 'bulk') {
        btn.textContent = `Add ${cls.ids.length} to Vault`;
      } else if (cls.mode === 'direct') {
        btn.textContent = '+ Add to Vault';
      } else {
        btn.textContent = 'Search';
      }
      // Input cleared → show vault list again
      if (!input.value.trim() && this._bodyMode !== 'vault') {
        this._bodyMode = 'vault';
        this._renderBody();
      }
    };
    input.addEventListener('input', updateBtn);

    const run = async () => {
      const raw = input.value.trim();
      if (!raw) return;
      const cls = this._classifyInput(raw);

      if (cls.mode === 'bulk') {
        this._bodyMode = 'bulk';
        await this._runBulkQueue(cls.ids);
      } else if (cls.mode === 'direct') {
        // Direct LCSC ID — add without searching
        btn.disabled = true;
        btn.textContent = 'Adding…';
        this._setStatus(`Adding ${cls.id}…`, '');
        await this._handleAdd(cls.id, null);
        btn.disabled = false;
        updateBtn();
      } else {
        this._bodyMode = 'results';
        btn.disabled = true;
        btn.textContent = 'Searching…';
        this._setStatus(`Searching for "${cls.keyword}" …`, '');
        try {
          const r = await searchComponents(cls.keyword, 1);
          this._results = r.results || [];
          this._renderResults();
          this._setStatus(
            `Found ${r.total ?? this._results.length} results — components already in vault are marked ✓`,
            'ok'
          );
          this.dispatchEvent(new CustomEvent(KM_UCE_SEARCH_DONE, {
            bubbles: true, composed: true,
            detail: { keyword: cls.keyword, total: r.total ?? this._results.length },
          }));
        } catch (err) {
          Logger.error('ComponentVault', 'Search failed', err);
          this._setStatus(`Search failed: ${err}`, 'error');
        } finally {
          btn.disabled = false;
          updateBtn();
        }
      }
    };

    btn.addEventListener('click', run);
    input.addEventListener('keydown', e => { if (e.key === 'Enter') run(); });
    // Support paste: detect bulk IDs immediately after paste
    input.addEventListener('paste', () => setTimeout(updateBtn, 10));
  }

  /** Run an inline bulk-add queue — shows chip status per LCSC ID in the search body. */
  async _runBulkQueue(ids) {
    const body = this.shadowRoot.getElementById('search-body');
    const btn  = this.shadowRoot.getElementById('btn-search');
    if (!body) return;

    // State: pending | running | done | warn | fail
    const state = Object.fromEntries(ids.map(id => [id, 'pending']));

    const renderChips = () => ids.map(id => {
      const s = state[id];
      const icon = { pending:'○', running:'<span class="km-spinner"></span>', done:'✓', warn:'⚠', fail:'✗' }[s] ?? '○';
      return `<span class="bulk-chip ${s}" data-id="${esc(id)}">${icon} ${esc(id)}</span>`;
    }).join('');

    const done  = () => Object.values(state).filter(s => s === 'done' || s === 'warn').length;
    const total = ids.length;

    const render = () => {
      const pct = Math.round((done() / total) * 100);
      body.innerHTML = `
        <div class="bulk-queue">
          <div class="bulk-header">
            <span class="bulk-header-label">${total} part${total > 1 ? 's' : ''} to add to vault</span>
            <button class="btn-outline" id="btn-bulk-clear" style="font-size:11px;padding:3px 10px;">Clear</button>
          </div>
          <div class="bulk-chips" id="bulk-chips">${renderChips()}</div>
          <div class="bulk-progress-row">
            <div class="bulk-bar"><div class="bulk-bar__fill" id="bulk-fill" style="width:${pct}%"></div></div>
            <span class="bulk-prog-text" id="bulk-prog">${done()} / ${total}</span>
          </div>
        </div>
      `;
      this.shadowRoot.getElementById('btn-bulk-clear')
        ?.addEventListener('click', () => {
          body.innerHTML = `<div class="empty">Search JLCPCB &amp; LCSC catalog above.</div>`;
          const input = this.shadowRoot.getElementById('search-input');
          if (input) { input.value = ''; }
          btn.textContent = 'Search';
        });
    };

    render();
    btn.disabled = true;
    this._setStatus(`Adding ${total} parts…`, '');

    let added = 0, failed = 0;
    for (const id of ids) {
      state[id] = 'running';
      // Update just this chip without full re-render
      const chip = body.querySelector(`.bulk-chip[data-id="${id}"]`);
      if (chip) { chip.className = 'bulk-chip running'; chip.innerHTML = `<span class="km-spinner"></span> ${esc(id)}`; }

      const r = await addToVault(id, this._ppConfig);

      if (r.success) {
        const missing = [];
        if (!r.has_symbol)    missing.push('sym');
        if (!r.has_footprint) missing.push('fp');
        if (!r.has_3d_model)  missing.push('3D');
        if (missing.length) {
          state[id] = 'warn';
          if (chip) { chip.className = 'bulk-chip warn'; chip.innerHTML = `⚠ ${esc(id)}`; chip.title = `Missing: ${missing.join(', ')}`; }
        } else {
          state[id] = 'done';
          if (chip) { chip.className = 'bulk-chip done'; chip.innerHTML = `✓ ${esc(id)}`; }
        }
        added++;
      } else {
        state[id] = 'fail';
        if (chip) { chip.className = 'bulk-chip fail'; chip.innerHTML = `✗ ${esc(id)}`; chip.title = r.message; }
        failed++;
      }

      // Update progress bar
      const fill = body.querySelector('#bulk-fill');
      const prog = body.querySelector('#bulk-prog');
      const pct  = Math.round((done() / total) * 100);
      if (fill) fill.style.width = `${pct}%`;
      if (prog) prog.textContent  = `${done()} / ${total}`;
    }

    this._vault = await getVault();
    this._updateVaultCount();
    btn.disabled = false;
    btn.textContent = 'Search';

    const summary = failed > 0
      ? `⚠ Bulk done — ${added} added, ${failed} failed`
      : `✓ All ${added} parts added to vault`;
    this._setStatus(summary, failed > 0 ? 'warn' : 'ok');

    // After a short pause, clear input and show the updated vault list
    setTimeout(() => {
      const input = this.shadowRoot.getElementById('search-input');
      if (input) input.value = '';
      btn.textContent = 'Search';
      this._bodyMode = 'vault';
      this._renderBody();
    }, 2500);
  }

  _renderResults() {
    const body = this.shadowRoot.getElementById('search-body');
    if (this._results.length === 0) {
      body.innerHTML = `<div class="empty">No results.</div>`;
      return;
    }
    body.innerHTML = `
      <table>
        <thead>
          <tr>
            <th>LCSC</th>
            <th>Name</th>
            <th>Package</th>
            <th>Type</th>
            <th>Description</th>
            <th style="text-align:right">Stock</th>
            <th style="text-align:right">Price</th>
            <th></th>
          </tr>
        </thead>
        <tbody>
          ${this._results.map(r => this._renderResultRow(r)).join('')}
        </tbody>
      </table>
    `;

    // Wire Add buttons
    for (const btn of body.querySelectorAll('button[data-add]')) {
      btn.addEventListener('click', () => this._handleAdd(btn.dataset.add, btn));
    }
  }

  _renderResultRow(r) {
    const isInVault = r.in_vault || this._vault.some(v => v.lcsc_id === r.lcsc);
    const isBusy    = this._busyAdd.has(r.lcsc);
    const stockTxt  = (r.stock ?? 0).toLocaleString();
    const priceTxt  = r.price != null ? `$${r.price.toFixed(3)}` : '—';
    const typeCls   = (r.part_type || '').toLowerCase() === 'basic' ? 'basic' : 'extended';

    let btnHtml;
    if (isInVault) {
      btnHtml = `<button class="add-vault-btn success" disabled>✓ In Vault</button>`;
    } else if (isBusy) {
      btnHtml = `<button class="add-vault-btn busy" disabled><span class="km-spinner"></span> Fetching…</button>`;
    } else {
      btnHtml = `<button class="add-vault-btn" data-add="${esc(r.lcsc)}">+ Add to Vault</button>`;
    }

    return `
      <tr>
        <td class="lcsc-cell">${esc(r.lcsc)}</td>
        <td>${esc(r.name)}</td>
        <td class="pkg-cell">${esc(r.package)}</td>
        <td><span class="type-badge ${typeCls}">${esc(r.part_type || '')}</span></td>
        <td class="desc-cell" title="${esc(r.description)}">${esc(r.description)}</td>
        <td class="stock-cell">${stockTxt}</td>
        <td class="price-cell">${priceTxt}</td>
        <td class="action-cell">${btnHtml}</td>
      </tr>
    `;
  }

  async _handleAdd(lcscId, btn) {
    if (this._busyAdd.has(lcscId)) return;
    this._busyAdd.add(lcscId);

    // ── Multi-stage button animation ─────────────────────────────────────────
    const STAGES = [
      [0,    'Fetching data…'],
      [700,  'Downloading 3D…'],
      [2800, 'Writing vault…'],
    ];
    const spinner = `<span class="km-spinner"></span>`;
    let stageIdx = 0;
    const start  = Date.now();

    const advanceStage = () => {
      if (!btn) return;
      btn.disabled = true;
      btn.className = 'add-vault-btn busy';
      const elapsed = Date.now() - start;
      while (stageIdx < STAGES.length - 1 && elapsed >= STAGES[stageIdx + 1][0]) stageIdx++;
      btn.innerHTML = `${spinner} ${STAGES[stageIdx][1]}`;
    };

    advanceStage();
    const ticker = setInterval(advanceStage, 300);
    this._setStatus(`Adding ${lcscId}…`, '');

    // ── Call backend ──────────────────────────────────────────────────────────
    const r = await addToVault(lcscId, this._ppConfig);
    clearInterval(ticker);
    this._busyAdd.delete(lcscId);

    // ── Final button state ────────────────────────────────────────────────────
    if (r.success) {
      const missing = [];
      if (!r.has_symbol)    missing.push('symbol');
      if (!r.has_footprint) missing.push('footprint');
      if (!r.has_3d_model)  missing.push('3D model');

      const libNotice = r.lib_registered_first_time
        ? '  ·  KiMaster library registered in project — ready to use in KiCad.'
        : '';

      if (missing.length === 0) {
        if (btn) { btn.className = 'add-vault-btn success'; btn.innerHTML = '✓ Added'; btn.disabled = true; }
        this._setStatus(`✓ ${lcscId} added  (${r.timings?.total_ms ?? '?'}ms)${libNotice}`, 'ok');
      } else {
        // Partial success — show warning with what's missing
        const missingStr = missing.join(', ');
        if (btn) {
          btn.className = 'add-vault-btn warn';
          btn.innerHTML = `⚠ Added`;
          btn.disabled  = true;
          btn.title     = `Missing: ${missingStr}`;
        }
        this._setStatus(
          `⚠ ${lcscId} added — missing: ${missingStr}. ${_missingHelp(missing)}${libNotice}`,
          'warn'
        );
      }

      this.dispatchEvent(new CustomEvent(KM_UCE_VAULT_ADDED, {
        bubbles: true, composed: true,
        detail: { lcsc_id: lcscId, name: '' },
      }));
      this._vault = await getVault();
      this._updateVaultCount();
      // Re-render the current view — results or vault list
      this._renderBody();

    } else {
      if (btn) {
        btn.className = 'add-vault-btn fail';
        btn.innerHTML = '✗ Failed';
        btn.disabled  = false;
        btn.title     = r.message;
        // Reset to normal after 4s so user can retry
        setTimeout(() => {
          if (btn) { btn.className = 'add-vault-btn'; btn.innerHTML = '+ Add to Vault'; btn.title = ''; }
        }, 4000);
      }
      this._setStatus(`✗ ${lcscId} — ${r.message}`, 'error');
    }
  }

  // ── Vault inline (Library default view) ──────────────────────────────────

  _renderVaultInline() {
    const body = this.shadowRoot.getElementById('search-body');
    if (!body) return;

    if (this._vault.length === 0) {
      body.innerHTML = `
        <div class="empty">
          No components in vault yet.<br>
          <span style="font-size:11px;color:var(--km-text-muted);margin-top:6px;display:block">
            Search above or paste LCSC IDs to add parts.
          </span>
        </div>`;
      return;
    }

    body.innerHTML = `
      <div style="padding:8px 12px 4px;font-size:10px;font-weight:600;letter-spacing:.06em;text-transform:uppercase;color:var(--km-text-muted);">
        Installed Components (${this._vault.length})
      </div>
      <table>
        <thead>
          <tr>
            <th>LCSC</th><th>Name</th><th>Package</th><th>MPN</th>
            <th style="color:var(--km-text-muted);font-size:10px">Added</th>
            <th></th>
          </tr>
        </thead>
        <tbody>
          ${this._vault.map(v => `
            <tr>
              <td class="lcsc-cell">${esc(v.lcsc_id)}</td>
              <td>${esc(v.name)}</td>
              <td class="pkg-cell">${esc(v.package)}</td>
              <td>${esc(v.mpn)}</td>
              <td style="font-variant-numeric:tabular-nums;color:var(--km-text-muted);font-size:11px">${esc(v.added_at?.split('T')[0] ?? v.added_at ?? '')}</td>
              <td class="action-cell">
                <button class="row-btn danger" data-remove="${esc(v.lcsc_id)}">Remove</button>
              </td>
            </tr>
          `).join('')}
        </tbody>
      </table>
    `;

    for (const btn of body.querySelectorAll('button[data-remove]')) {
      btn.addEventListener('click', () => this._handleRemove(btn.dataset.remove));
    }
  }

  async _handleRemove(lcscId) {
    if (!confirm(`Remove ${lcscId} from vault?`)) return;
    const ok = await removeFromVault(lcscId);
    if (ok) {
      this._setStatus(`✓ Removed ${lcscId} from vault`, 'ok');
      this.dispatchEvent(new CustomEvent(KM_UCE_VAULT_REMOVED, {
        bubbles: true, composed: true,
        detail: { lcsc_id: lcscId },
      }));
      this._vault = await getVault();
      this._updateVaultCount();
      this._renderBody();
    } else {
      this._setStatus(`✗ Failed to remove ${lcscId}`, 'error');
    }
  }

  // ── Sub-vault wiring ───────────────────────────────────────────────────────

  _wireSubVaultButtons() {
    const btnTemplate = this.shadowRoot.getElementById('btn-import-template');
    if (btnTemplate) {
      btnTemplate.addEventListener('click', () => this._handleImportTemplate());
    }
    const btnBlock = this.shadowRoot.getElementById('btn-import-block');
    if (btnBlock) {
      btnBlock.addEventListener('click', () => this._handleImportBlock());
    }
  }

  // ── Stackups ──────────────────────────────────────────────────────────────

  async _loadStackups() {
    try {
      this._stackups = await invoke(VAULT_LIST_STACKUPS);
      this._renderStackups();
    } catch (err) {
      Logger.error('ComponentVault', 'Failed to load stackups', err);
      this._setStatus(`Failed to load stackups: ${err}`, 'error');
    }
  }

  _renderStackups() {
    const body = this.shadowRoot.getElementById('stackups-body');
    if (!body) return;
    if (this._stackups.length === 0) {
      body.innerHTML = `
        <div class="empty">
          <p style="margin-bottom:8px">No stackup configurations saved yet.</p>
          <p style="font-size:11px;color:var(--km-text-muted)">Stackups define PCB layer structures — copper layers, dielectric materials, thickness, and εr values.<br>Save your frequently used stackups here to reuse across projects.</p>
        </div>`;
      return;
    }
    body.innerHTML = `
      <table>
        <thead>
          <tr>
            <th>Name</th><th>Layers</th><th>Thickness</th><th>Description</th><th>Added</th><th></th>
          </tr>
        </thead>
        <tbody>
          ${this._stackups.map(s => `
            <tr>
              <td>${esc(s.name)}</td>
              <td style="text-align:center">${esc(s.layers)}</td>
              <td class="pkg-cell">${s.thickness_mm != null ? s.thickness_mm + ' mm' : '—'}</td>
              <td class="desc-cell" title="${esc(s.description)}">${esc(s.description)}</td>
              <td style="font-variant-numeric:tabular-nums;color:var(--km-text-muted)">${esc(s.added_at)}</td>
              <td class="action-cell">
                <button class="row-btn danger" data-remove-stackup="${esc(s.id)}">Remove</button>
              </td>
            </tr>
          `).join('')}
        </tbody>
      </table>
    `;
    for (const btn of body.querySelectorAll('button[data-remove-stackup]')) {
      btn.addEventListener('click', () => this._handleRemoveStackup(btn.dataset.removeStackup));
    }
  }

  async _handleRemoveStackup(id) {
    if (!confirm(`Remove stackup "${id}"?`)) return;
    try {
      await invoke(VAULT_REMOVE_STACKUP, { id });
      this._setStatus(`✓ Removed stackup "${id}"`, 'ok');
      await this._loadStackups();
    } catch (err) {
      Logger.error('ComponentVault', 'Failed to remove stackup', err);
      this._setStatus(`✗ Failed to remove stackup: ${err}`, 'error');
    }
  }

  // ── Templates ─────────────────────────────────────────────────────────────

  async _loadTemplates() {
    try {
      this._templates = await invoke(VAULT_LIST_TEMPLATES);
      this._renderTemplates();
    } catch (err) {
      Logger.error('ComponentVault', 'Failed to load templates', err);
      this._setStatus(`Failed to load templates: ${err}`, 'error');
    }
  }

  _renderTemplates() {
    const body = this.shadowRoot.getElementById('templates-body');
    if (!body) return;
    if (this._templates.length === 0) {
      body.innerHTML = `
        <div class="empty">
          <p style="margin-bottom:8px">No project templates saved yet.</p>
          <p style="font-size:11px;color:var(--km-text-muted)">Templates are complete KiCad projects with pre-configured DRC rules, netclasses,<br>track widths, clearances, and layer stackups baked in.<br>Import a configured project, then instantiate it for new boards.</p>
          <button class="btn-primary" id="btn-import-template" style="margin-top:12px">Import project as template…</button>
        </div>`;
      // Re-wire the import button inside the empty state
      const btn = body.querySelector('#btn-import-template');
      if (btn) btn.addEventListener('click', () => this._handleImportTemplate());
      return;
    }
    body.innerHTML = `
      <div style="padding:var(--km-space-2);text-align:right;">
        <button class="btn-primary" id="btn-import-template-top">Import project as template…</button>
      </div>
      <table>
        <thead>
          <tr>
            <th>Name</th><th>Layers</th><th>Tags</th><th>Description</th><th>Added</th><th></th>
          </tr>
        </thead>
        <tbody>
          ${this._templates.map(t => `
            <tr>
              <td>${esc(t.name)}</td>
              <td style="text-align:center">${esc(t.layers)}</td>
              <td class="pkg-cell">${esc(t.tags)}</td>
              <td class="desc-cell" title="${esc(t.description)}">${esc(t.description)}</td>
              <td style="font-variant-numeric:tabular-nums;color:var(--km-text-muted)">${esc(t.added_at)}</td>
              <td class="action-cell">
                <button class="row-btn danger" data-remove-template="${esc(t.id)}">Remove</button>
              </td>
            </tr>
          `).join('')}
        </tbody>
      </table>
    `;
    const btnTop = body.querySelector('#btn-import-template-top');
    if (btnTop) btnTop.addEventListener('click', () => this._handleImportTemplate());
    for (const btn of body.querySelectorAll('button[data-remove-template]')) {
      btn.addEventListener('click', () => this._handleRemoveTemplate(btn.dataset.removeTemplate));
    }
  }

  async _handleImportTemplate() {
    this._setStatus('Opening folder picker for template import…', '');
    try {
      const id = await invoke(VAULT_IMPORT_TEMPLATE, {
        source_dir: '', name: '', description: '', tags: '',
      });
      this._setStatus(`✓ Template imported: ${id}`, 'ok');
      await this._loadTemplates();
    } catch (err) {
      const msg = String(err);
      if (!msg.includes('cancelled') && !msg.includes('No folder')) {
        Logger.error('ComponentVault', 'Template import failed', err);
        this._setStatus(`✗ Template import failed: ${msg}`, 'error');
      } else {
        this._setStatus('Template import cancelled.', '');
      }
    }
  }

  async _handleRemoveTemplate(id) {
    if (!confirm(`Remove template "${id}"? This cannot be undone.`)) return;
    try {
      await invoke(VAULT_REMOVE_TEMPLATE, { id });
      this._setStatus(`✓ Removed template "${id}"`, 'ok');
      await this._loadTemplates();
    } catch (err) {
      Logger.error('ComponentVault', 'Failed to remove template', err);
      this._setStatus(`✗ Failed to remove template: ${err}`, 'error');
    }
  }

  // ── Blocks ────────────────────────────────────────────────────────────────

  async _loadBlocks() {
    try {
      this._blocks = await invoke(VAULT_LIST_BLOCKS);
      this._renderBlocks();
    } catch (err) {
      Logger.error('ComponentVault', 'Failed to load blocks', err);
      this._setStatus(`Failed to load blocks: ${err}`, 'error');
    }
  }

  _renderBlocks() {
    const body = this.shadowRoot.getElementById('blocks-body');
    if (!body) return;
    if (this._blocks.length === 0) {
      body.innerHTML = `
        <div class="empty">
          <p style="margin-bottom:8px">No reusable design blocks saved yet.</p>
          <p style="font-size:11px;color:var(--km-text-muted)">Blocks are ready-to-reuse schematic + layout pairs — buck converters, USB-C connectors,<br>Ethernet PHY circuits, etc. Import a schematic (.kicad_sch) and optional layout (.kicad_pcb)<br>to save a block for use in future projects.</p>
          <button class="btn-primary" id="btn-import-block" style="margin-top:12px">Import block…</button>
        </div>`;
      const btn = body.querySelector('#btn-import-block');
      if (btn) btn.addEventListener('click', () => this._handleImportBlock());
      return;
    }
    body.innerHTML = `
      <div style="padding:var(--km-space-2);text-align:right;">
        <button class="btn-primary" id="btn-import-block-top">Import block…</button>
      </div>
      <table>
        <thead>
          <tr>
            <th>Name</th><th>Category</th><th>Layout</th><th>Tags</th><th>Description</th><th>Added</th><th></th>
          </tr>
        </thead>
        <tbody>
          ${this._blocks.map(b => `
            <tr>
              <td>${esc(b.name)}</td>
              <td><span class="type-badge">${esc(b.category)}</span></td>
              <td style="text-align:center">${b.has_layout ? '<span style="color:var(--km-trace)">✓</span>' : '—'}</td>
              <td class="pkg-cell">${esc(b.tags)}</td>
              <td class="desc-cell" title="${esc(b.description)}">${esc(b.description)}</td>
              <td style="font-variant-numeric:tabular-nums;color:var(--km-text-muted)">${esc(b.added_at)}</td>
              <td class="action-cell">
                <button class="row-btn danger" data-remove-block="${esc(b.id)}">Remove</button>
              </td>
            </tr>
          `).join('')}
        </tbody>
      </table>
    `;
    const btnTop = body.querySelector('#btn-import-block-top');
    if (btnTop) btnTop.addEventListener('click', () => this._handleImportBlock());
    for (const btn of body.querySelectorAll('button[data-remove-block]')) {
      btn.addEventListener('click', () => this._handleRemoveBlock(btn.dataset.removeBlock));
    }
  }

  async _handleImportBlock() {
    this._setStatus('Opening file picker for block import…', '');
    try {
      const id = await invoke(VAULT_IMPORT_BLOCK, {
        sch_path: '', name: '', description: '', category: '', tags: '',
      });
      this._setStatus(`✓ Block imported: ${id}`, 'ok');
      await this._loadBlocks();
    } catch (err) {
      const msg = String(err);
      if (!msg.includes('cancelled') && !msg.includes('No file')) {
        Logger.error('ComponentVault', 'Block import failed', err);
        this._setStatus(`✗ Block import failed: ${msg}`, 'error');
      } else {
        this._setStatus('Block import cancelled.', '');
      }
    }
  }

  async _handleRemoveBlock(id) {
    if (!confirm(`Remove block "${id}"? This cannot be undone.`)) return;
    try {
      await invoke(VAULT_REMOVE_BLOCK, { id });
      this._setStatus(`✓ Removed block "${id}"`, 'ok');
      await this._loadBlocks();
    } catch (err) {
      Logger.error('ComponentVault', 'Failed to remove block', err);
      this._setStatus(`✗ Failed to remove block: ${err}`, 'error');
    }
  }

  // ── Status ────────────────────────────────────────────────────────────────

  _setStatus(text, type = '') {
    const el = this.shadowRoot.getElementById('status-line');
    if (!el) return;
    el.textContent = text;
    el.classList.remove('ok', 'error', 'warn');
    if (type) el.classList.add(type);
  }
}

function esc(s) {
  const d = document.createElement('div');
  d.textContent = String(s ?? '');
  return d.innerHTML;
}

/** Human-readable help text for missing vault assets. */
function _missingHelp(missing) {
  if (missing.includes('symbol') && missing.includes('footprint'))
    return 'This part may require EasyEDA Pro login or the LCSC ID is unavailable.';
  if (missing.includes('symbol'))
    return 'Symbol geometry unavailable — footprint and 3D model were saved.';
  if (missing.includes('footprint'))
    return 'Footprint pads unavailable — schematic symbol was saved.';
  if (missing.includes('3D model'))
    return 'No 3D STEP model available for this package — symbol and footprint are complete.';
  return '';
}

customElements.define('km-component-vault', KmComponentVault);
