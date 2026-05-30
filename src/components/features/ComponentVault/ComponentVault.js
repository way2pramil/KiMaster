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
  addToVault, bulkAddToVault,
  getVault, removeFromVault,
} from '../../../modules/uce/UceService.js';
import {
  KM_UCE_VAULT_ADDED, KM_UCE_VAULT_REMOVED, KM_UCE_SEARCH_DONE,
} from '../../../core/AppEvents.js';
import {
  GET_VAULT_DIR, SET_VAULT_DIR,
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
  .row-btn.added { color: var(--km-trace); border-color: var(--km-trace); cursor: default; }
  .row-btn.added:hover { color: var(--km-trace); border-color: var(--km-trace); }
  .row-btn.danger:hover { color: var(--km-red); border-color: var(--km-red); }
  .row-btn:disabled { opacity: 0.4; cursor: wait; }

  /* ── Empty states ── */
  .empty {
    padding: var(--km-space-6);
    text-align: center;
    color: var(--km-text-muted);
    font-size: var(--km-font-size-sm);
  }

  /* ── Bulk tab ── */
  .bulk-pane {
    display: flex;
    flex-direction: column;
    gap: var(--km-space-3);
    padding: var(--km-space-3);
    height: 100%;
    box-sizing: border-box;
  }
  .bulk-pane.hidden { display: none; }
  .bulk-pane textarea {
    flex: 1;
    background: var(--km-bg-input);
    border: 1px solid var(--km-border);
    border-radius: var(--km-radius-sm);
    padding: var(--km-space-3);
    color: var(--km-text-primary);
    font-family: var(--km-font-mono);
    font-size: var(--km-font-size-sm);
    line-height: 1.6;
    outline: none;
    resize: none;
    min-height: 200px;
  }
  .bulk-pane textarea:focus { border-color: var(--km-accent); }
  .bulk-actions {
    display: flex;
    align-items: center;
    gap: var(--km-space-2);
  }
  .bulk-status {
    flex: 1;
    font-size: var(--km-font-size-xs);
    color: var(--km-text-muted);
    font-variant-numeric: tabular-nums;
  }
  .bulk-progress {
    height: 4px;
    background: var(--km-bg-elevated);
    border-radius: var(--km-radius-full);
    overflow: hidden;
    margin-top: var(--km-space-2);
  }
  .bulk-progress__bar {
    height: 100%;
    background: var(--km-accent);
    width: 0%;
    transition: width var(--km-duration-base) var(--km-ease);
  }

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
  <button class="tab active" data-tab="search">Search</button>
  <button class="tab"        data-tab="bulk">Bulk Import</button>
  <button class="tab"        data-tab="vault">Components</button>
  <button class="tab"        data-tab="stackups">Stackups</button>
  <button class="tab"        data-tab="templates">Templates</button>
  <button class="tab"        data-tab="blocks">Blocks</button>
  <span class="tab-sep"></span>
  <span class="vault-count" id="vault-count"></span>
</div>

<!-- Search tab -->
<div id="search-pane">
  <div class="search-row" id="search-row">
    <input class="search-input" id="search-input" placeholder="LCSC ID (C49678), part number, or keyword …" type="text" />
    <button class="btn-primary" id="btn-search">Search</button>
  </div>
  <div class="body" id="search-body">
    <div class="empty" id="search-empty">Search JLCPCB &amp; LCSC catalog above.</div>
  </div>
</div>

<!-- Bulk tab -->
<div id="bulk-pane" class="bulk-pane hidden">
  <textarea id="bulk-input" placeholder="Paste LCSC part numbers, one per line:&#10;C49678&#10;C25804&#10;C2837920" spellcheck="false"></textarea>
  <div class="bulk-actions">
    <button class="btn-primary" id="btn-bulk-run">Add all to vault</button>
    <span class="bulk-status" id="bulk-status"></span>
  </div>
  <div class="bulk-progress"><div class="bulk-progress__bar" id="bulk-bar"></div></div>
</div>

<!-- Vault tab -->
<div id="vault-pane" class="hidden">
  <div class="vault-dir-bar">
    <span class="dir-label">Library:</span>
    <span class="dir-path" id="vault-dir-path" title="">…</span>
    <button class="btn-change" id="btn-change-vault-dir">Change…</button>
  </div>
  <div class="body" id="vault-body">
    <div class="empty" id="vault-empty">Vault is empty. Search components above and add them.</div>
  </div>
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

    this._activeTab = 'search';
    /** @type {import('../../../modules/uce/UceService.js').UceSearchItem[]} */
    this._results   = [];
    /** @type {import('../../../modules/uce/UceService.js').VaultEntry[]} */
    this._vault     = [];
    this._busyAdd   = new Set(); // LCSC IDs currently being added
    this._unsubs    = [];

    /** @type {Array} */ this._stackups  = [];
    /** @type {Array} */ this._templates = [];
    /** @type {Array} */ this._blocks    = [];
  }

  connectedCallback() {
    this._wireTabs();
    this._wireSearch();
    this._wireBulk();
    this._wireVaultDir();
    this._wireSubVaultButtons();
    // Vault is global — load immediately, no project required
    this._loadVault();
    this._loadVaultDir();
  }

  disconnectedCallback() {
    for (const u of this._unsubs) u();
    this._unsubs = [];
  }

  // ── Vault (global — project-independent) ──────────────────────────────────

  async _loadVault() {
    this._vault = await getVault();
    this._renderVault();
    this._updateVaultCount();
  }

  _updateVaultCount() {
    const el = this.shadowRoot.getElementById('vault-count');
    if (el) el.textContent = `${this._vault.length} in vault`;
  }

  // ── Vault directory ────────────────────────────────────────────────────────

  async _loadVaultDir() {
    try {
      const r = await invoke(GET_VAULT_DIR);
      this._setVaultDirDisplay(r.path || '');
    } catch (err) {
      Logger.warn('ComponentVault', 'Could not load vault dir', err);
    }
  }

  _setVaultDirDisplay(path) {
    const el = this.shadowRoot.getElementById('vault-dir-path');
    if (!el) return;
    el.textContent = path || '…';
    el.title = path || '';
  }

  _wireVaultDir() {
    const btn = this.shadowRoot.getElementById('btn-change-vault-dir');
    if (!btn) return;
    btn.addEventListener('click', async () => {
      btn.disabled = true;
      btn.textContent = 'Selecting…';
      try {
        const r = await invoke(SET_VAULT_DIR, {});
        this._setVaultDirDisplay(r.path);
        this._setStatus(`Library directory set to: ${r.path}`, 'ok');
        // Reload vault from new location
        await this._loadVault();
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
      bulk:      'bulk-pane',
      vault:     'vault-pane',
      stackups:  'stackups-pane',
      templates: 'templates-pane',
      blocks:    'blocks-pane',
    };
    for (const [name, id] of Object.entries(map)) {
      const el = this.shadowRoot.getElementById(id);
      if (el) el.classList.toggle('hidden', name !== tab);
    }
    if (tab === 'vault')     this._loadVault();
    if (tab === 'stackups')  this._loadStackups();
    if (tab === 'templates') this._loadTemplates();
    if (tab === 'blocks')    this._loadBlocks();
  }

  // ── Search ────────────────────────────────────────────────────────────────

  _wireSearch() {
    const input = this.shadowRoot.getElementById('search-input');
    const btn   = this.shadowRoot.getElementById('btn-search');
    const run = async () => {
      const q = input.value.trim();
      if (!q) return;
      btn.disabled = true;
      this._setStatus(`Searching for "${q}" …`, '');
      try {
        const r = await searchComponents(q, 1);
        this._results = r.results || [];
        this._renderResults();
        this._setStatus(`Found ${r.total ?? this._results.length} results for "${q}"`, 'ok');
        this.dispatchEvent(new CustomEvent(KM_UCE_SEARCH_DONE, {
          bubbles: true, composed: true,
          detail: { keyword: q, total: r.total ?? this._results.length },
        }));
      } catch (err) {
        Logger.error('ComponentVault', 'Search failed', err);
        this._setStatus(`Search failed: ${err}`, 'error');
      } finally {
        btn.disabled = false;
      }
    };
    btn.addEventListener('click', run);
    input.addEventListener('keydown', e => { if (e.key === 'Enter') run(); });
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
      btnHtml = `<button class="row-btn added" disabled>✓ in vault</button>`;
    } else if (isBusy) {
      btnHtml = `<button class="row-btn" disabled>Adding…</button>`;
    } else {
      btnHtml = `<button class="row-btn" data-add="${esc(r.lcsc)}">+ Add</button>`;
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
    if (btn) { btn.disabled = true; btn.textContent = 'Adding…'; }
    this._setStatus(`Fetching ${lcscId} from EasyEDA → parsing → sanitizing → writing vault…`, '');
    const r = await addToVault(lcscId);
    this._busyAdd.delete(lcscId);
    if (r.success) {
      this._setStatus(`✓ ${lcscId} → ${r.mod_path}`, 'ok');
      this.dispatchEvent(new CustomEvent(KM_UCE_VAULT_ADDED, {
        bubbles: true, composed: true,
        detail: { lcsc_id: lcscId, name: '' },
      }));
      // Refresh vault + result row
      this._vault = await getVault();
      this._updateVaultCount();
      this._renderResults();
    } else {
      this._setStatus(`✗ ${lcscId} — ${r.message}`, 'error');
      if (btn) { btn.disabled = false; btn.textContent = '+ Add'; }
    }
  }

  // ── Bulk import ───────────────────────────────────────────────────────────

  _wireBulk() {
    const btn = this.shadowRoot.getElementById('btn-bulk-run');
    btn.addEventListener('click', async () => {
      const text = this.shadowRoot.getElementById('bulk-input').value;
      const ids  = text
        .split(/\r?\n/)
        .map(s => s.trim())
        .filter(s => s.length > 0 && /^C\d+$/i.test(s));

      if (ids.length === 0) {
        this._setBulkStatus('No valid LCSC IDs found (expected lines like C49678).');
        return;
      }

      btn.disabled = true;
      this._setBulkStatus(`Starting bulk add for ${ids.length} parts…`);
      this._setBulkProgress(0);

      const r = await bulkAddToVault(ids, ({ current, total, lcsc, success }) => {
        this._setBulkStatus(`${current}/${total} — ${success ? '✓' : '✗'} ${lcsc}`);
        this._setBulkProgress((current / total) * 100);
      });

      btn.disabled = false;
      this._setBulkStatus(`Done. Added ${r.added.length}, failed ${r.failed.length}.`);
      this._setBulkProgress(100);
      this._vault = await getVault();
      this._updateVaultCount();
    });
  }

  _setBulkStatus(text) {
    const el = this.shadowRoot.getElementById('bulk-status');
    if (el) el.textContent = text;
  }
  _setBulkProgress(pct) {
    const bar = this.shadowRoot.getElementById('bulk-bar');
    if (bar) bar.style.width = `${Math.max(0, Math.min(100, pct))}%`;
  }

  // ── Vault tab ─────────────────────────────────────────────────────────────

  _renderVault() {
    const body  = this.shadowRoot.getElementById('vault-body');
    const empty = this.shadowRoot.getElementById('vault-empty');
    if (this._vault.length === 0) {
      body.innerHTML = `<div class="empty">Vault is empty. Search components above and add them.</div>`;
      return;
    }
    body.innerHTML = `
      <table>
        <thead>
          <tr>
            <th>LCSC</th><th>Name</th><th>Package</th><th>Manufacturer</th><th>MPN</th><th>Added</th><th></th>
          </tr>
        </thead>
        <tbody>
          ${this._vault.map(v => `
            <tr>
              <td class="lcsc-cell">${esc(v.lcsc_id)}</td>
              <td>${esc(v.name)}</td>
              <td class="pkg-cell">${esc(v.package)}</td>
              <td>${esc(v.manufacturer)}</td>
              <td>${esc(v.mpn)}</td>
              <td style="font-variant-numeric:tabular-nums;color:var(--km-text-muted)">${esc(v.added_at)}</td>
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
    void empty;
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
      this._renderVault();
      this._updateVaultCount();
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
    el.classList.remove('ok', 'error');
    if (type) el.classList.add(type);
  }
}

function esc(s) {
  const d = document.createElement('div');
  d.textContent = String(s ?? '');
  return d.innerHTML;
}

customElements.define('km-component-vault', KmComponentVault);
