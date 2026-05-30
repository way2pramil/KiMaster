/**
 * @element km-drc-panel
 * @summary DRC/ERC results panel with violation list, severity filters, and run controls.
 *
 * @attr {'drc'|'erc'} mode - which check to run (default: 'drc')
 *
 * @fires km-run-drc - when DRC run is requested
 * @fires km-run-erc - when ERC run is requested
 * @fires km-violation-click - when a violation row is clicked, detail: { violation }
 */

import { store, subscribe } from '../../../core/State.js';
import { Logger } from '../../../core/Logger.js';
import { runDrc, runErc } from '../../../modules/drc/DrcService.js';
import { FAB_PRESETS, evaluatePreset, readinessScore } from '../../../modules/fab/FabRules.js';

const TEMPLATE = document.createElement('template');
TEMPLATE.innerHTML = `
<style>
  :host {
    display: block;
    font-family: var(--km-font);
    height: 100%;
  }

  .panel {
    display: flex;
    flex-direction: column;
    height: 100%;
    padding: var(--km-space-4) var(--km-space-6);
    gap: var(--km-space-4);
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

  /* ── Stats bar ── */
  .stats {
    display: flex;
    gap: var(--km-space-3);
    flex-shrink: 0;
  }
  .stat-chip {
    display: flex;
    align-items: center;
    gap: var(--km-space-1);
    padding: var(--km-space-1) var(--km-space-3);
    border-radius: var(--km-radius-full);
    font-size: var(--km-font-size-xs);
    font-weight: var(--km-font-weight-medium);
    background: var(--km-bg-surface);
    color: var(--km-text-secondary);
  }
  .stat-chip.errors   { background: rgba(239, 68, 68, 0.15); color: var(--km-danger); }
  .stat-chip.warnings { background: rgba(245, 158, 11, 0.15); color: var(--km-warning); }
  .stat-chip.total    { background: var(--km-accent-muted); color: var(--km-accent); }

  /* ── Tabs (DRC / ERC) ── */
  .tabs {
    display: flex;
    gap: var(--km-space-1);
    flex-shrink: 0;
    border-bottom: 1px solid var(--km-border);
    padding-bottom: var(--km-space-2);
  }
  .tab {
    padding: var(--km-space-1) var(--km-space-3);
    border-radius: var(--km-radius-sm);
    font-size: var(--km-font-size-sm);
    color: var(--km-text-muted);
    cursor: pointer;
    transition: all var(--km-duration-fast) var(--km-ease);
    border: none;
    background: none;
    font-family: var(--km-font);
    font-weight: var(--km-font-weight-medium);
  }
  .tab:hover { color: var(--km-text-secondary); background: var(--km-bg-surface); }
  .tab.active { color: var(--km-accent); background: var(--km-accent-muted); }

  /* ── Filters ── */
  .filters {
    display: flex;
    gap: var(--km-space-2);
    align-items: center;
    flex-shrink: 0;
  }
  .filter-btn {
    padding: 2px var(--km-space-2);
    border-radius: var(--km-radius-xs);
    font-size: var(--km-font-size-xs);
    color: var(--km-text-muted);
    cursor: pointer;
    border: 1px solid transparent;
    background: none;
    font-family: var(--km-font);
    transition: all var(--km-duration-fast) var(--km-ease);
  }
  .filter-btn:hover { color: var(--km-text-secondary); }
  .filter-btn.active { color: var(--km-text-primary); border-color: var(--km-border-strong); background: var(--km-bg-surface); }
  .filter-label {
    font-size: var(--km-font-size-xs);
    color: var(--km-text-muted);
    margin-right: var(--km-space-1);
  }

  /* ── Violation list ── */
  .violations-wrap {
    flex: 1;
    overflow-y: auto;
    min-height: 0;
  }
  .violations-wrap::-webkit-scrollbar { width: 6px; }
  .violations-wrap::-webkit-scrollbar-track { background: transparent; }
  .violations-wrap::-webkit-scrollbar-thumb { background: var(--km-scrollbar-thumb); border-radius: 3px; }

  .violation-row {
    display: flex;
    align-items: flex-start;
    gap: var(--km-space-3);
    padding: var(--km-space-3);
    border-radius: var(--km-radius-sm);
    cursor: pointer;
    transition: background var(--km-duration-fast) var(--km-ease);
    border-bottom: 1px solid var(--km-border);
  }
  .violation-row:hover { background: var(--km-bg-surface); }
  .violation-row:last-child { border-bottom: none; }

  .sev-icon { flex-shrink: 0; margin-top: 2px; }
  .sev-error   { color: var(--km-danger); }
  .sev-warning { color: var(--km-warning); }

  .v-body { flex: 1; min-width: 0; }
  .v-desc {
    font-size: var(--km-font-size-sm);
    color: var(--km-text-primary);
    line-height: var(--km-line-height-base);
    word-break: break-word;
  }
  .v-meta {
    display: flex;
    gap: var(--km-space-3);
    margin-top: 2px;
    font-size: var(--km-font-size-xs);
    color: var(--km-text-muted);
    font-family: var(--km-font-mono);
  }

  /* ── Empty / running states ── */
  .state-msg {
    display: flex;
    flex-direction: column;
    align-items: center;
    justify-content: center;
    gap: var(--km-space-3);
    padding: var(--km-space-8) 0;
    color: var(--km-text-muted);
    text-align: center;
  }
  .state-msg .msg-text {
    font-size: var(--km-font-size-sm);
  }

  /* ── Manufacturing readiness ── */
  .mfg-wrap {
    flex: 1;
    overflow-y: auto;
    padding: var(--km-space-4);
    display: flex;
    flex-direction: column;
    gap: var(--km-space-4);
    min-height: 0;
  }
  .mfg-wrap::-webkit-scrollbar { width: 4px; }
  .mfg-wrap::-webkit-scrollbar-track { background: transparent; }
  .mfg-wrap::-webkit-scrollbar-thumb { background: var(--km-scrollbar-thumb); border-radius: 2px; }

  .mfg-preset-row {
    display: flex;
    align-items: center;
    gap: var(--km-space-2);
    flex-shrink: 0;
  }
  .mfg-preset-label {
    font-size: var(--km-font-size-xs);
    color: var(--km-text-muted);
    flex-shrink: 0;
  }
  .mfg-score-bar {
    display: flex;
    align-items: center;
    gap: var(--km-space-3);
    padding: var(--km-space-3);
    background: var(--km-bg-surface);
    border: 1px solid var(--km-border);
    border-radius: var(--km-radius-md);
    box-shadow: var(--km-bezel);
  }
  .mfg-score-ring {
    width: 48px;
    height: 48px;
    flex-shrink: 0;
  }
  .mfg-score-info { flex: 1; }
  .mfg-score-num {
    font-size: var(--km-font-size-xl);
    font-weight: var(--km-font-weight-semibold);
    color: var(--km-text-primary);
    font-variant-numeric: tabular-nums;
  }
  .mfg-score-sub { font-size: var(--km-font-size-xs); color: var(--km-text-muted); }
  .mfg-check-list { display: flex; flex-direction: column; gap: 4px; }
  .mfg-check {
    display: flex;
    align-items: flex-start;
    gap: var(--km-space-2);
    padding: var(--km-space-2) var(--km-space-3);
    border-radius: var(--km-radius-sm);
    font-size: var(--km-font-size-sm);
  }
  .mfg-check.pass    { background: rgba(16,185,129,0.06); }
  .mfg-check.fail    { background: rgba(239,68,68,0.06); }
  .mfg-check.unknown { background: var(--km-bg-surface); opacity: 0.7; }
  .mfg-check-icon { flex-shrink: 0; margin-top: 1px; }
  .mfg-check-body { flex: 1; min-width: 0; }
  .mfg-check-label { color: var(--km-text-primary); line-height: 1.3; }
  .mfg-check-detail { font-size: var(--km-font-size-xs); color: var(--km-text-muted); margin-top: 1px; font-variant-numeric: tabular-nums; font-family: var(--km-font-mono); }

  /* ── Utility ── */
  .hidden            { display: none !important; }
  .state-icon        { opacity: 0.3; }
  .state-icon--accent  { color: var(--km-accent); }
  .state-icon--danger  { color: var(--km-danger); }
  .state-icon--success { color: var(--km-success); }

  /* ── Staggered row entrance ── */
  .row-enter {
    opacity: 0;
    transform: translateY(6px);
    transition: opacity 150ms var(--km-ease), transform 150ms var(--km-ease);
  }

  /* ── Project-locked file input ── */
  .file-path[data-project-locked] {
    border-color: var(--km-accent);
    color: var(--km-text-primary);
    background: var(--km-accent-muted);
  }

  /* ── File picker row ── */
  .file-input-row {
    display: flex;
    gap: var(--km-space-2);
    align-items: center;
    flex-shrink: 0;
  }
  .file-path {
    flex: 1;
    padding: var(--km-space-2) var(--km-space-3);
    border-radius: var(--km-radius-sm);
    border: 1px solid var(--km-border);
    background: var(--km-bg-primary);
    color: var(--km-text-secondary);
    font-family: var(--km-font-mono);
    font-size: var(--km-font-size-xs);
    outline: none;
    transition: border-color var(--km-duration-fast) var(--km-ease);
  }
  .file-path:focus { border-color: var(--km-accent); }
  .file-path::placeholder { color: var(--km-text-muted); }
</style>

<div class="panel">
  <div class="header">
    <span class="header-title">Design Rule Checks</span>
  </div>

  <div class="tabs">
    <button class="tab active" data-tab="drc">
      <km-icon name="drc" size="sm"></km-icon> DRC
    </button>
    <button class="tab" data-tab="erc">
      <km-icon name="erc" size="sm"></km-icon> ERC
    </button>
    <button class="tab" data-tab="mfg">
      <km-icon name="gerber" size="sm"></km-icon> Mfg
    </button>
  </div>

  <div class="file-input-row">
    <input class="file-path" id="file-input" type="text" placeholder="Path to .kicad_pcb file..." />
    <km-button variant="primary" size="sm" id="btn-run">Run DRC</km-button>
  </div>

  <div class="stats hidden" id="stats-bar">
    <span class="stat-chip total" id="stat-total">0 total</span>
    <span class="stat-chip errors" id="stat-errors">0 errors</span>
    <span class="stat-chip warnings" id="stat-warnings">0 warnings</span>
  </div>

  <div class="filters hidden" id="filters">
    <span class="filter-label">Show:</span>
    <button class="filter-btn active" data-filter="all">All</button>
    <button class="filter-btn" data-filter="error">Errors</button>
    <button class="filter-btn" data-filter="warning">Warnings</button>
  </div>

  <div class="violations-wrap" id="violations-list">
    <div class="state-msg" id="empty-state">
      <km-icon name="drc" size="xl" class="state-icon"></km-icon>
      <span class="msg-text">Run a check to see violations here.</span>
    </div>
  </div>
</div>
`;

export class DrcPanel extends HTMLElement {
  constructor() {
    super();
    this.attachShadow({ mode: 'open' });
    this.shadowRoot.appendChild(TEMPLATE.content.cloneNode(true));

    this._mode       = 'drc';
    this._filter     = 'all';
    this._fabPreset  = 'jlcpcb_2layer';
    this._unsubs     = [];
  }

  connectedCallback() {
    // Tab switching
    for (const tab of this.shadowRoot.querySelectorAll('.tab')) {
      tab.addEventListener('click', () => this._switchTab(tab.dataset.tab));
    }

    // Filter buttons
    for (const btn of this.shadowRoot.querySelectorAll('.filter-btn')) {
      btn.addEventListener('click', () => this._setFilter(btn.dataset.filter));
    }

    // Run button
    this.shadowRoot.getElementById('btn-run').addEventListener('km-click', () => this._runCheck());

    // Pre-fill file path from active project
    this._syncFileInput();

    // Subscribe to state changes
    this._unsubs.push(
      subscribe('drcStatus',    () => this._onStatusChange()),
      subscribe('drcErrors',    () => { this._renderViolations(); if (this._mode === 'mfg') this._renderMfg(); }),
      subscribe('ercStatus',    () => this._onStatusChange()),
      subscribe('ercErrors',    () => this._renderViolations()),
      subscribe('project',      () => this._syncFileInput()),
      subscribe('boardState',   () => { if (this._mode === 'mfg') this._renderMfg(); }),
    );

    // Panel entrance handled by CSS (no JS opacity manipulation per architecture rules)
  }

  disconnectedCallback() {
    for (const unsub of this._unsubs) unsub();
    this._unsubs = [];
  }

  _syncFileInput() {
    const input  = this.shadowRoot.getElementById('file-input');
    const proj   = store.project;
    // Rust serialises struct fields as snake_case: pcb_file, schematic_file
    if (this._mode === 'drc' && proj?.pcb_file) {
      input.value = proj.pcb_file;
      input.setAttribute('data-project-locked', '');
      input.title = 'Auto-filled from active project — edit to override';
    } else if (this._mode === 'erc' && proj?.schematic_file) {
      input.value = proj.schematic_file;
      input.setAttribute('data-project-locked', '');
      input.title = 'Auto-filled from active project — edit to override';
    } else {
      input.removeAttribute('data-project-locked');
      input.title = '';
    }
  }

  _switchTab(tab) {
    this._mode = tab;
    for (const t of this.shadowRoot.querySelectorAll('.tab')) {
      t.classList.toggle('active', t.dataset.tab === tab);
    }

    const isMfg = tab === 'mfg';
    const fileRow = this.shadowRoot.querySelector('.file-input-row');
    const statsBar = this.shadowRoot.getElementById('stats-bar');
    const filters  = this.shadowRoot.getElementById('filters');
    const violList = this.shadowRoot.getElementById('violations-list');

    if (isMfg) {
      fileRow?.classList.add('hidden');
      statsBar.classList.add('hidden');
      filters.classList.add('hidden');
      violList.classList.add('hidden');
      this._renderMfg();
    } else {
      fileRow?.classList.remove('hidden');
      violList.classList.remove('hidden');

      const btn = this.shadowRoot.getElementById('btn-run');
      btn.textContent = tab === 'drc' ? 'Run DRC' : 'Run ERC';
      const input = this.shadowRoot.getElementById('file-input');
      input.placeholder = tab === 'drc' ? 'Path to .kicad_pcb file...' : 'Path to .kicad_sch file...';
      input.value = '';
      this._syncFileInput();
      this._renderViolations();
    }
  }

  _setFilter(filter) {
    this._filter = filter;
    for (const btn of this.shadowRoot.querySelectorAll('.filter-btn')) {
      btn.classList.toggle('active', btn.dataset.filter === filter);
    }
    this._renderViolations();
  }

  async _runCheck() {
    const filePath = this.shadowRoot.getElementById('file-input').value.trim();
    if (!filePath) return;

    const btn = this.shadowRoot.getElementById('btn-run');
    btn.setAttribute('loading', '');

    try {
      if (this._mode === 'drc') {
        await runDrc(filePath);
      } else {
        await runErc(filePath);
      }
    } catch (err) {
      Logger.error('DrcPanel', err, `${this._mode.toUpperCase()} run failed`);
    } finally {
      btn.removeAttribute('loading');
    }
  }

  _onStatusChange() {
    this._renderViolations();
  }

  // ── Manufacturing Readiness ───────────────────────────────────────────────────

  _renderMfg() {
    const container = this.shadowRoot.getElementById('violations-list');
    container.classList.remove('hidden');

    const preset  = FAB_PRESETS[this._fabPreset];
    const results = evaluatePreset(preset, store.boardState, store.drcErrors ?? []);
    const { score, passed, failed, unknown } = readinessScore(results);

    const scoreColor = failed > 0 ? 'var(--km-danger)' : score === 100 ? 'var(--km-trace)' : 'var(--km-warning)';
    const scoreLabel = failed > 0 ? 'Not ready' : score === 100 ? 'Ready to order!' : 'Almost ready';

    const presetOptions = Object.values(FAB_PRESETS).map(p =>
      `<option value="${p.id}"${p.id === this._fabPreset ? ' selected' : ''}>${p.name}</option>`
    ).join('');

    container.innerHTML = `
      <div class="mfg-wrap">
        <div class="mfg-preset-row">
          <span class="mfg-preset-label">Target fab:</span>
          <select class="km-select" id="mfg-preset-select">${presetOptions}</select>
        </div>
        <div class="mfg-score-bar">
          <svg class="mfg-score-ring" viewBox="0 0 48 48">
            <circle cx="24" cy="24" r="20" fill="none" stroke="var(--km-border)" stroke-width="4"/>
            <circle cx="24" cy="24" r="20" fill="none" stroke="${scoreColor}" stroke-width="4"
              stroke-dasharray="${(score * 1.257).toFixed(1)} 125.7"
              stroke-dashoffset="31.4" stroke-linecap="round"/>
            <text x="24" y="29" text-anchor="middle" fill="${scoreColor}"
              font-size="12" font-weight="600" font-family="var(--km-font-mono)">${score}</text>
          </svg>
          <div class="mfg-score-info">
            <div class="mfg-score-num">${scoreLabel}</div>
            <div class="mfg-score-sub">${passed} passed · ${failed} failed · ${unknown} need bridge</div>
          </div>
        </div>
        <div class="mfg-check-list">
          ${results.map(r => {
            const icon = r.status === 'pass'
              ? `<km-icon name="check"   size="sm" class="state-icon--success"></km-icon>`
              : r.status === 'fail'
              ? `<km-icon name="error"   size="sm" class="state-icon--danger"></km-icon>`
              : `<km-icon name="info"    size="sm"></km-icon>`;
            return `<div class="mfg-check ${r.status}">
              <span class="mfg-check-icon">${icon}</span>
              <div class="mfg-check-body">
                <div class="mfg-check-label">${this._escapeHtml(r.label)}</div>
                <div class="mfg-check-detail">${this._escapeHtml(r.detail)}</div>
              </div>
            </div>`;
          }).join('')}
        </div>
      </div>
    `;

    container.querySelector('#mfg-preset-select')?.addEventListener('change', (e) => {
      this._fabPreset = e.target.value;
      this._renderMfg();
    });
  }

  // ── ─────────────────────────────────────────────────────────────────────────

  _getViolations() {
    const list = this._mode === 'drc' ? store.drcErrors : store.ercErrors;
    if (this._filter === 'all') return list;
    return list.filter(v => v.severity === this._filter);
  }

  _getStatus() {
    return this._mode === 'drc' ? store.drcStatus : store.ercStatus;
  }

  _renderViolations() {
    const container = this.shadowRoot.getElementById('violations-list');
    const statsBar = this.shadowRoot.getElementById('stats-bar');
    const filters = this.shadowRoot.getElementById('filters');
    const status = this._getStatus();
    const allViolations = this._mode === 'drc' ? store.drcErrors : store.ercErrors;

    // Running state
    if (status === 'running') {
      statsBar.classList.add('hidden');
      filters.classList.add('hidden');
      container.innerHTML = `
        <div class="state-msg">
          <km-icon name="loader" size="xl" animate="spin" class="state-icon--accent"></km-icon>
          <span class="msg-text">Running ${this._mode.toUpperCase()}...</span>
        </div>
      `;
      return;
    }

    // Idle state
    if (status === 'idle') {
      statsBar.classList.add('hidden');
      filters.classList.add('hidden');
      container.innerHTML = `
        <div class="state-msg">
          <km-icon name="${this._mode}" size="xl" class="state-icon"></km-icon>
          <span class="msg-text">Run a check to see violations here.</span>
        </div>
      `;
      return;
    }

    // Error state
    if (status === 'error') {
      statsBar.classList.add('hidden');
      filters.classList.add('hidden');
      container.innerHTML = `
        <div class="state-msg">
          <km-icon name="warning" size="xl" class="state-icon--danger"></km-icon>
          <span class="msg-text">${this._mode.toUpperCase()} failed. Check the file path and try again.</span>
        </div>
      `;
      return;
    }

    // Done — show stats
    const errors = allViolations.filter(v => v.severity === 'error').length;
    const warnings = allViolations.filter(v => v.severity === 'warning').length;
    const total = allViolations.length;

    this.shadowRoot.getElementById('stat-total').textContent = `${total} total`;
    this.shadowRoot.getElementById('stat-errors').textContent = `${errors} error${errors !== 1 ? 's' : ''}`;
    this.shadowRoot.getElementById('stat-warnings').textContent = `${warnings} warning${warnings !== 1 ? 's' : ''}`;
    statsBar.classList.remove('hidden');
    filters.classList.toggle('hidden', total === 0);

    const filtered = this._getViolations();

    if (filtered.length === 0) {
      container.innerHTML = total === 0
        ? `<div class="state-msg">
             <km-icon name="success" size="xl" class="state-icon--success"></km-icon>
             <span class="msg-text">No violations found!</span>
           </div>`
        : `<div class="state-msg">
             <span class="msg-text">No violations match the current filter.</span>
           </div>`;
      return;
    }

    container.innerHTML = filtered.map((v, i) => `
      <div class="violation-row" data-idx="${i}">
        <km-icon class="sev-icon sev-${v.severity}" name="${v.severity === 'error' ? 'warning' : 'warning'}" size="sm"></km-icon>
        <div class="v-body">
          <div class="v-desc">${this._escapeHtml(v.description)}</div>
          <div class="v-meta">
            <span>${v.violation_type || ''}</span>
            ${v.items?.[0]?.pos ? `<span class="km-tabular">(${v.items[0].pos.x.toFixed(2)}, ${v.items[0].pos.y.toFixed(2)}) mm</span>` : ''}
          </div>
        </div>
      </div>
    `).join('');

    // Staggered row entrance — CSS class-driven, no inline styles
    const rows = container.querySelectorAll('.violation-row');
    rows.forEach((row, i) => {
      row.classList.add('row-enter');
      setTimeout(() => row.classList.remove('row-enter'), 30 + i * 30);

      row.addEventListener('click', () => {
        this.dispatchEvent(new CustomEvent('km-violation-click', {
          bubbles: true,
          composed: true,
          detail: { violation: filtered[i] },
        }));
      });
    });
  }

  _escapeHtml(str) {
    const d = document.createElement('div');
    d.textContent = str;
    return d.innerHTML;
  }
}

customElements.define('km-drc-panel', DrcPanel);
