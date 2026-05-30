/**
 * @element km-component-browser
 * @summary Interactive component table — search, filter, sort, click-to-highlight.
 *
 * Reads: store.boardComponents, store.bridgeConnected
 * Writes: calls highlightComponent() on row click
 *
 * @fires km-component-select  — detail: { component } when a row is clicked
 * @fires km-component-modify  — detail: { component, op, ...args } for Ghost Layer
 */

import { store, subscribe } from '../../../core/State.js';
import { Logger } from '../../../core/Logger.js';
import { highlightComponent, highlightNet, setLocked, setDnp } from '../../../modules/kicad-bridge/BridgeClient.js';

// ── Template ──────────────────────────────────────────────────────────────────

const TEMPLATE = document.createElement('template');
TEMPLATE.innerHTML = `
<style>
  :host { display: block; height: 100%; font-family: var(--km-font); }

  .browser {
    display: flex;
    flex-direction: column;
    height: 100%;
    overflow: hidden;
  }

  /* ── Toolbar ── */
  .toolbar {
    display: flex;
    align-items: center;
    gap: var(--km-space-2);
    padding: var(--km-space-3) var(--km-space-5);
    border-bottom: 1px solid var(--km-border);
    flex-shrink: 0;
    background: var(--km-bg-primary);
  }
  .search-wrap {
    flex: 1;
    position: relative;
  }
  .search-icon {
    position: absolute;
    left: var(--km-space-2);
    top: 50%;
    transform: translateY(-50%);
    color: var(--km-text-muted);
    pointer-events: none;
    display: flex;
  }
  .search {
    width: 100%;
    padding: var(--km-space-2) var(--km-space-3) var(--km-space-2) 28px;
    border: 1px solid var(--km-border);
    border-radius: var(--km-radius-sm);
    background: var(--km-bg-surface);
    color: var(--km-text-primary);
    font-family: var(--km-font);
    font-size: var(--km-font-size-sm);
    outline: none;
    box-sizing: border-box;
    transition: border-color var(--km-duration-fast) var(--km-ease);
  }
  .search:focus { border-color: var(--km-accent); }
  .search::placeholder { color: var(--km-text-muted); }

  /* filter pills */
  .filter-pills { display: flex; gap: var(--km-space-1); flex-shrink: 0; }
  .fpill {
    padding: 2px var(--km-space-2);
    border-radius: var(--km-radius-full);
    font-size: var(--km-font-size-xs);
    color: var(--km-text-muted);
    border: 1px solid var(--km-border);
    cursor: pointer;
    background: none;
    font-family: var(--km-font);
    transition: all var(--km-duration-fast) var(--km-ease);
    white-space: nowrap;
  }
  .fpill:hover  { color: var(--km-text-primary); }
  .fpill.active { color: var(--km-accent); border-color: var(--km-accent); background: var(--km-accent-muted); }

  /* mode tabs */
  .mode-tabs { display: flex; gap: 0; flex-shrink: 0; border-right: 1px solid var(--km-border); padding-right: var(--km-space-2); }
  .mtab {
    padding: 3px var(--km-space-3);
    border-radius: var(--km-radius-sm);
    font-size: var(--km-font-size-xs);
    font-weight: var(--km-font-weight-medium);
    color: var(--km-text-muted);
    cursor: pointer;
    border: none;
    background: none;
    font-family: var(--km-font);
    transition: all var(--km-duration-fast) var(--km-ease);
  }
  .mtab:hover { color: var(--km-text-secondary); }
  .mtab.active { color: var(--km-accent); background: var(--km-accent-muted); }

  /* net row */
  .net-row {
    display: flex;
    align-items: center;
    gap: var(--km-space-3);
    padding: var(--km-space-2) var(--km-space-4);
    cursor: pointer;
    border-bottom: 1px solid var(--km-border);
    transition: background var(--km-duration-fast) var(--km-ease);
  }
  .net-row:last-child { border-bottom: none; }
  .net-row:hover { background: var(--km-bg-surface); }
  .net-row.selected { background: var(--km-accent-muted); }
  .net-name {
    flex: 1;
    font-family: var(--km-font-mono);
    font-size: var(--km-font-size-sm);
    font-variant-numeric: tabular-nums;
    color: var(--km-text-primary);
    white-space: nowrap;
    overflow: hidden;
    text-overflow: ellipsis;
  }
  .net-count {
    font-size: var(--km-font-size-xs);
    color: var(--km-text-muted);
    font-variant-numeric: tabular-nums;
    flex-shrink: 0;
  }
  .net-highlight-btn {
    opacity: 0;
    flex-shrink: 0;
    display: flex;
    align-items: center;
    justify-content: center;
    width: 20px;
    height: 20px;
    border-radius: var(--km-radius-xs);
    border: none;
    background: none;
    color: var(--km-text-muted);
    cursor: pointer;
    padding: 0;
    transition: all var(--km-duration-fast) var(--km-ease);
  }
  .net-row:hover .net-highlight-btn { opacity: 1; }
  .net-highlight-btn:hover { background: var(--km-bg-elevated); color: var(--km-live); }
  .net-match { color: var(--km-accent); font-weight: var(--km-font-weight-semibold); }

  /* batch selection checkbox */
  .cb-col { width: 28px; text-align: center; padding: var(--km-space-1) 0; }
  input[type="checkbox"] {
    accent-color: var(--km-accent);
    cursor: pointer;
    width: 13px;
    height: 13px;
  }
  tr.batch-selected td { background: var(--km-accent-muted); }

  /* batch action bar — floats at bottom when selections exist */
  .batch-bar {
    display: flex;
    align-items: center;
    gap: var(--km-space-2);
    padding: var(--km-space-2) var(--km-space-4);
    background: var(--km-bg-elevated);
    border-top: 1px solid var(--km-accent);
    flex-shrink: 0;
    flex-wrap: wrap;
  }
  .batch-bar.hidden { display: none; }
  .batch-count {
    font-size: var(--km-font-size-xs);
    color: var(--km-accent);
    font-weight: var(--km-font-weight-medium);
    flex-shrink: 0;
    font-variant-numeric: tabular-nums;
  }
  .batch-sep { flex: 1; }
  .batch-btn {
    padding: 2px var(--km-space-2);
    border-radius: var(--km-radius-sm);
    font-size: var(--km-font-size-xs);
    font-family: var(--km-font);
    border: 1px solid var(--km-border);
    background: var(--km-bg-surface);
    color: var(--km-text-secondary);
    cursor: pointer;
    transition: all var(--km-duration-fast) var(--km-ease);
    white-space: nowrap;
  }
  .batch-btn:hover { color: var(--km-text-primary); border-color: var(--km-accent); }
  .batch-btn:active { transform: scale(0.97); }
  .batch-btn-clear { color: var(--km-text-muted); border-color: transparent; }

  /* count badge */
  .count {
    font-size: var(--km-font-size-xs);
    color: var(--km-text-muted);
    white-space: nowrap;
    font-variant-numeric: tabular-nums;
  }

  /* ── Table ── */
  .table-wrap {
    flex: 1;
    overflow-y: auto;
    min-height: 0;
  }
  .table-wrap::-webkit-scrollbar { width: 6px; }
  .table-wrap::-webkit-scrollbar-track { background: transparent; }
  .table-wrap::-webkit-scrollbar-thumb { background: var(--km-scrollbar-thumb); border-radius: 3px; }

  table {
    width: 100%;
    border-collapse: collapse;
    font-size: var(--km-font-size-sm);
  }
  thead {
    position: sticky;
    top: 0;
    z-index: 1;
    background: var(--km-bg-secondary);
  }
  th {
    padding: var(--km-space-2) var(--km-space-3);
    text-align: left;
    font-size: var(--km-font-size-xs);
    font-weight: var(--km-font-weight-medium);
    color: var(--km-text-muted);
    border-bottom: 1px solid var(--km-border);
    white-space: nowrap;
    cursor: pointer;
    user-select: none;
  }
  th:hover { color: var(--km-text-secondary); }
  th.sorted { color: var(--km-accent); }
  th .sort-arrow { margin-left: 4px; opacity: 0.6; }

  td {
    padding: var(--km-space-2) var(--km-space-3);
    border-bottom: 1px solid var(--km-border);
    color: var(--km-text-secondary);
    vertical-align: middle;
    max-width: 200px;
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
  }
  tr:last-child td { border-bottom: none; }
  tr:hover td { background: var(--km-bg-surface); }
  tr.selected td { background: var(--km-accent-muted); }

  /* column specifics */
  td.ref {
    font-weight: var(--km-font-weight-semibold);
    color: var(--km-text-primary);
    font-variant-numeric: tabular-nums;
  }
  td.value { color: var(--km-text-primary); }
  td.fp {
    font-family: var(--km-font-mono);
    font-size: var(--km-font-size-xs);
    color: var(--km-text-muted);
  }
  td.pos {
    font-family: var(--km-font-mono);
    font-size: var(--km-font-size-xs);
    font-variant-numeric: tabular-nums;
  }
  td.side { text-align: center; }

  /* badges */
  .badge {
    display: inline-flex;
    align-items: center;
    padding: 1px var(--km-space-1);
    border-radius: var(--km-radius-xs);
    font-size: 10px;
    font-weight: var(--km-font-weight-medium);
  }
  .badge-back    { background: rgba(6,182,212,0.15); color: var(--km-live); }
  .badge-front   { background: rgba(37,99,235,0.15);  color: var(--km-accent); }
  .badge-locked  { background: rgba(245,158,11,0.15); color: var(--km-warning); }
  .badge-dnp     { background: rgba(239,68,68,0.15);  color: var(--km-danger); }

  /* actions column */
  .row-actions {
    display: flex;
    gap: var(--km-space-1);
    opacity: 0;
    transition: opacity var(--km-duration-fast) var(--km-ease);
  }
  tr:hover .row-actions { opacity: 1; }
  .act-btn {
    display: flex;
    align-items: center;
    justify-content: center;
    width: 20px;
    height: 20px;
    border-radius: var(--km-radius-xs);
    border: none;
    background: none;
    color: var(--km-text-muted);
    cursor: pointer;
    padding: 0;
    transition: all var(--km-duration-fast) var(--km-ease);
  }
  .act-btn:hover { background: var(--km-bg-elevated); color: var(--km-text-primary); }
  .act-btn:active { transform: scale(0.92); }

  /* ── Empty state ── */
  .empty {
    display: flex;
    flex-direction: column;
    align-items: center;
    justify-content: center;
    gap: var(--km-space-3);
    padding: var(--km-space-8) 0;
    color: var(--km-text-muted);
    text-align: center;
  }
  .empty-icon { opacity: 0.3; }
  .empty-text { font-size: var(--km-font-size-sm); }
</style>

<div class="browser">
  <div class="toolbar">
    <div class="mode-tabs">
      <button class="mtab active" data-mode="components">Components</button>
      <button class="mtab"        data-mode="nets">Nets</button>
    </div>
    <div class="search-wrap">
      <span class="search-icon">
        <svg width="12" height="12" viewBox="0 0 12 12" fill="none">
          <circle cx="5" cy="5" r="3.5" stroke="currentColor" stroke-width="1.4"/>
          <path d="M8 8l2.5 2.5" stroke="currentColor" stroke-width="1.4" stroke-linecap="round"/>
        </svg>
      </span>
      <input class="search" id="search" type="text" placeholder="Search ref, value, footprint…" autocomplete="off"/>
    </div>

    <div class="filter-pills">
      <button class="fpill active" data-filter="all">All</button>
      <button class="fpill" data-filter="front">Front</button>
      <button class="fpill" data-filter="back">Back</button>
      <button class="fpill" data-filter="dnp">DNP</button>
      <button class="fpill" data-filter="locked">Locked</button>
    </div>

    <span class="count" id="count"></span>
  </div>

  <div class="table-wrap" id="table-wrap"></div>

  <!-- Batch action bar — visible when ≥1 component selected -->
  <div class="batch-bar hidden" id="batch-bar">
    <span class="batch-count" id="batch-count">0 selected</span>
    <div class="batch-sep"></div>
    <button class="batch-btn" data-batch="lock">Lock all</button>
    <button class="batch-btn" data-batch="unlock">Unlock all</button>
    <button class="batch-btn" data-batch="dnp-on">Set DNP</button>
    <button class="batch-btn" data-batch="dnp-off">Clear DNP</button>
    <button class="batch-btn" data-batch="align">Align…</button>
    <button class="batch-btn batch-btn-clear" data-batch="deselect">✕ Clear</button>
  </div>
</div>
`;

// ── Component ─────────────────────────────────────────────────────────────────

export class ComponentBrowser extends HTMLElement {
  constructor() {
    super();
    this.attachShadow({ mode: 'open' });
    this.shadowRoot.appendChild(TEMPLATE.content.cloneNode(true));

    this._mode        = 'components'; // 'components' | 'nets'
    this._query       = '';
    this._filter      = 'all';
    this._sortKey     = 'ref';
    this._sortAsc     = true;
    this._selectedRef = null;
    this._selectedNet = null;
    /** @type {Set<string>} refs selected for batch ops */
    this._batchSel    = new Set();
    this._lastClickIdx = -1; // for shift-click range select
    this._unsubs      = [];
  }

  connectedCallback() {
    const sr = this.shadowRoot;

    // Mode tabs
    for (const tab of sr.querySelectorAll('.mtab')) {
      tab.addEventListener('click', () => {
        this._mode = tab.dataset.mode;
        this._query = '';
        sr.getElementById('search').value = '';
        sr.querySelectorAll('.mtab').forEach(t => t.classList.toggle('active', t === tab));
        // Show/hide filter pills (only relevant for components)
        sr.querySelector('.filter-pills').style.display =
          this._mode === 'components' ? 'flex' : 'none';
        this._render();
      });
    }

    // Search
    sr.getElementById('search').addEventListener('input', (e) => {
      this._query = e.target.value.toLowerCase();
      this._render();
    });

    // Filter pills (components mode only)
    for (const pill of sr.querySelectorAll('.fpill')) {
      pill.addEventListener('click', () => {
        this._filter = pill.dataset.filter;
        sr.querySelectorAll('.fpill').forEach(p => p.classList.toggle('active', p === pill));
        this._render();
      });
    }

    // Batch action bar
    for (const btn of sr.querySelectorAll('.batch-btn[data-batch]')) {
      btn.addEventListener('click', () => this._onBatchAction(btn.dataset.batch));
    }

    // Ctrl+A — select all
    sr.addEventListener('keydown', (e) => {
      if ((e.ctrlKey || e.metaKey) && e.key === 'a') {
        e.preventDefault();
        this._selectAll();
      }
    });

    // Reactive store subscriptions — clean up on disconnect (Rule 3)
    this._unsubs.push(
      subscribe('boardComponents', () => this._render()),
      subscribe('boardNets',       () => this._render()),
      subscribe('bridgeConnected', () => this._render()),
    );

    this._render();
  }

  disconnectedCallback() {
    for (const unsub of this._unsubs) unsub();
    this._unsubs = [];
  }

  // ── Rendering ───────────────────────────────────────────────────────────────

  _render() {
    if (this._mode === 'nets') { this._renderNets(); return; }

    const components = store.boardComponents ?? [];
    const filtered   = this._applyFilters(components);
    const sorted     = this._applySort(filtered);

    // Update count
    this.shadowRoot.getElementById('count').textContent =
      `${sorted.length} / ${components.length} components`;

    const wrap = this.shadowRoot.getElementById('table-wrap');

    if (!store.bridgeConnected) {
      wrap.innerHTML = `
        <div class="empty">
          <km-icon name="plug" size="xl" class="empty-icon"></km-icon>
          <span class="empty-text">Connect to KiCad Bridge to browse components.</span>
        </div>`;
      return;
    }

    if (sorted.length === 0) {
      wrap.innerHTML = `
        <div class="empty">
          <km-icon name="component" size="xl" class="empty-icon"></km-icon>
          <span class="empty-text">${this._query ? 'No components match your search.' : 'No components in this board.'}</span>
        </div>`;
      return;
    }

    const allChecked = sorted.length > 0 && sorted.every(c => this._batchSel.has(c.ref));
    wrap.innerHTML = `
      <table>
        <thead>
          <tr>
            <th class="cb-col">
              <input type="checkbox" id="select-all-cb" title="Select all" ${allChecked ? 'checked' : ''}/>
            </th>
            ${this._th('ref',       'Ref')}
            ${this._th('value',     'Value')}
            ${this._th('footprint', 'Footprint')}
            ${this._th('pos',       'Position', false)}
            ${this._th('side',      'Side')}
            <th>Flags</th>
            <th></th>
          </tr>
        </thead>
        <tbody id="tbody">
          ${sorted.map((c, i) => this._row(c, i)).join('')}
        </tbody>
      </table>
    `;

    // Select-all checkbox
    wrap.querySelector('#select-all-cb')?.addEventListener('change', (e) => {
      if (e.target.checked) {
        sorted.forEach(c => this._batchSel.add(c.ref));
      } else {
        this._batchSel.clear();
      }
      this._updateBatchBar();
      wrap.querySelectorAll('tr[data-ref]').forEach(tr => {
        const cb = tr.querySelector('input[type=checkbox]');
        if (cb) cb.checked = this._batchSel.has(tr.dataset.ref);
        tr.classList.toggle('batch-selected', this._batchSel.has(tr.dataset.ref));
      });
    });

    // Sort click on headers
    for (const th of wrap.querySelectorAll('th[data-sort]')) {
      th.addEventListener('click', () => {
        if (this._sortKey === th.dataset.sort) {
          this._sortAsc = !this._sortAsc;
        } else {
          this._sortKey = th.dataset.sort;
          this._sortAsc = true;
        }
        this._render();
      });
    }

    // Row clicks → highlight + select + batch checkbox
    for (const tr of wrap.querySelectorAll('tr[data-ref]')) {
      const ref = tr.dataset.ref;
      const idx = sorted.findIndex(c => c.ref === ref);

      tr.classList.toggle('selected',       ref === this._selectedRef);
      tr.classList.toggle('batch-selected', this._batchSel.has(ref));

      const cb = tr.querySelector('input[type=checkbox]');
      if (cb) cb.checked = this._batchSel.has(ref);

      tr.addEventListener('click', (e) => {
        if (e.target.closest('.act-btn')) return;

        if (e.target.type === 'checkbox') {
          // Checkbox click: toggle this row in batch selection
          if (e.target.checked) {
            this._batchSel.add(ref);
          } else {
            this._batchSel.delete(ref);
          }
          tr.classList.toggle('batch-selected', this._batchSel.has(ref));
          this._updateBatchBar();
          return;
        }

        if (e.shiftKey && this._lastClickIdx >= 0) {
          // Shift+click: range-select between lastClickIdx and current
          const lo = Math.min(this._lastClickIdx, idx);
          const hi = Math.max(this._lastClickIdx, idx);
          for (let i = lo; i <= hi; i++) {
            this._batchSel.add(sorted[i].ref);
          }
          this._updateBatchBar();
          // Refresh batch-selected classes
          wrap.querySelectorAll('tr[data-ref]').forEach(row => {
            const rowCb = row.querySelector('input[type=checkbox]');
            const isSelected = this._batchSel.has(row.dataset.ref);
            row.classList.toggle('batch-selected', isSelected);
            if (rowCb) rowCb.checked = isSelected;
          });
          return;
        }

        this._lastClickIdx = idx;
        this._selectComponent(ref, sorted);
      });
    }

    // Action buttons
    for (const btn of wrap.querySelectorAll('.act-btn')) {
      btn.addEventListener('click', (e) => {
        e.stopPropagation();
        const ref = btn.closest('tr').dataset.ref;
        const op  = btn.dataset.op;
        const comp = sorted.find(c => c.ref === ref);
        if (!comp) return;
        this._handleAction(op, comp);
      });
    }
  }

  _th(key, label, sortable = true) {
    if (!sortable) return `<th>${label}</th>`;
    const active = this._sortKey === key;
    const arrow  = active ? (this._sortAsc ? '↑' : '↓') : '';
    return `<th data-sort="${key}" class="${active ? 'sorted' : ''}">
      ${label}${arrow ? `<span class="sort-arrow">${arrow}</span>` : ''}
    </th>`;
  }

  _row(c, idx = 0) {
    const fp    = c.footprint ? c.footprint.split(':').pop() || c.footprint : '—';
    const xStr  = typeof c.position?.x === 'number' ? c.position.x.toFixed(2) : '?';
    const yStr  = typeof c.position?.y === 'number' ? c.position.y.toFixed(2) : '?';
    const flags = [
      c.on_back ? `<span class="badge badge-back">Back</span>`     : `<span class="badge badge-front">Front</span>`,
      c.locked  ? `<span class="badge badge-locked">Locked</span>` : '',
      c.dnp     ? `<span class="badge badge-dnp">DNP</span>`       : '',
    ].filter(Boolean).join(' ');

    return `
      <tr data-ref="${esc(c.ref)}" data-idx="${idx}">
        <td class="cb-col"><input type="checkbox" ${this._batchSel.has(c.ref) ? 'checked' : ''}/></td>
        <td class="ref">${esc(c.ref)}</td>
        <td class="value">${esc(c.value || '—')}</td>
        <td class="fp" title="${esc(c.footprint)}">${esc(fp)}</td>
        <td class="pos">(${xStr}, ${yStr})</td>
        <td class="side">${c.on_back ? '↙ Back' : '↗ Front'}</td>
        <td>${flags}</td>
        <td>
          <div class="row-actions">
            <button class="act-btn" data-op="highlight" title="Highlight in KiCad">
              <svg width="12" height="12" viewBox="0 0 12 12" fill="none">
                <circle cx="6" cy="6" r="4" stroke="currentColor" stroke-width="1.4"/>
                <circle cx="6" cy="6" r="1.5" fill="currentColor"/>
              </svg>
            </button>
            <button class="act-btn" data-op="toggle-lock" title="${c.locked ? 'Unlock' : 'Lock'}">
              <svg width="12" height="12" viewBox="0 0 12 12" fill="none">
                <rect x="2.5" y="5.5" width="7" height="5" rx="1" stroke="currentColor" stroke-width="1.3"/>
                <path d="M4 5.5V4a2 2 0 014 0v1.5" stroke="currentColor" stroke-width="1.3"/>
              </svg>
            </button>
            <button class="act-btn" data-op="toggle-dnp" title="${c.dnp ? 'Clear DNP' : 'Set DNP'}">
              <svg width="12" height="12" viewBox="0 0 12 12" fill="none">
                <circle cx="6" cy="6" r="4" stroke="currentColor" stroke-width="1.3"/>
                <path d="M4 4l4 4M8 4l-4 4" stroke="currentColor" stroke-width="1.3" stroke-linecap="round"/>
              </svg>
            </button>
            <button class="act-btn" data-op="ghost-move" title="Move (Ghost Layer)">
              <svg width="12" height="12" viewBox="0 0 12 12" fill="none">
                <path d="M6 2v8M2 6h8" stroke="currentColor" stroke-width="1.4" stroke-linecap="round"/>
              </svg>
            </button>
          </div>
        </td>
      </tr>
    `;
  }

  // ── Batch selection helpers ──────────────────────────────────────────────────

  _updateBatchBar() {
    const bar   = this.shadowRoot.getElementById('batch-bar');
    const count = this.shadowRoot.getElementById('batch-count');
    const n = this._batchSel.size;
    bar.classList.toggle('hidden', n === 0);
    count.textContent = `${n} selected`;
  }

  _selectAll() {
    const components = store.boardComponents ?? [];
    const filtered   = this._applyFilters(components);
    filtered.forEach(c => this._batchSel.add(c.ref));
    this._updateBatchBar();
    this._render();
  }

  _onBatchAction(op) {
    if (this._batchSel.size === 0) return;
    const components = store.boardComponents ?? [];
    const selected   = components.filter(c => this._batchSel.has(c.ref));

    if (op === 'deselect') {
      this._batchSel.clear();
      this._updateBatchBar();
      this._render();
      return;
    }

    // All ops except deselect dispatch to main.js for human confirmation
    this.dispatchEvent(new CustomEvent('km-component-batch-modify', {
      bubbles: true, composed: true,
      detail: { op, components: selected },
    }));
  }

  // ── Actions ──────────────────────────────────────────────────────────────────

  _selectComponent(ref, components) {
    this._selectedRef = ref;
    const comp = components.find(c => c.ref === ref);
    if (!comp) return;

    // Update selected row styling
    this.shadowRoot.querySelectorAll('tr[data-ref]').forEach(tr => {
      tr.classList.toggle('selected', tr.dataset.ref === ref);
    });

    // Highlight in KiCad
    highlightComponent(ref).catch(err => Logger.warn('ComponentBrowser', 'highlight failed', err));

    // Emit event for Ghost Layer and other listeners
    this.dispatchEvent(new CustomEvent('km-component-select', {
      bubbles: true, composed: true,
      detail: { component: comp },
    }));
  }

  _handleAction(op, comp) {
    switch (op) {
      case 'highlight':
        highlightComponent(comp.ref).catch(err => Logger.warn('ComponentBrowser', 'highlight failed', err));
        break;

      case 'toggle-lock':
        // Emit modify event — Ghost Layer / main.js shows confirmation dialog
        this.dispatchEvent(new CustomEvent('km-component-modify', {
          bubbles: true, composed: true,
          detail: { component: comp, op: 'set-locked', locked: !comp.locked },
        }));
        break;

      case 'toggle-dnp':
        this.dispatchEvent(new CustomEvent('km-component-modify', {
          bubbles: true, composed: true,
          detail: { component: comp, op: 'set-dnp', dnp: !comp.dnp },
        }));
        break;

      case 'ghost-move':
        this.dispatchEvent(new CustomEvent('km-component-modify', {
          bubbles: true, composed: true,
          detail: { component: comp, op: 'move' },
        }));
        break;

      default:
        Logger.warn('ComponentBrowser', `Unknown action op: ${op}`);
    }
  }

  // ── Net browser ──────────────────────────────────────────────────────────────

  _renderNets() {
    const wrap   = this.shadowRoot.getElementById('table-wrap');
    const nets   = (store.boardNets ?? []).filter(n =>
      !this._query || n.toLowerCase().includes(this._query)
    );
    const components = store.boardComponents ?? [];

    // Build net → component count map
    const netCounts = new Map();
    for (const c of components) {
      // boardNets is a flat string array; we can't map without net data per component
      // Use footprint net fields if available, else just count from net list
    }

    this.shadowRoot.getElementById('count').textContent =
      `${nets.length} / ${(store.boardNets ?? []).length} nets`;

    if (!store.bridgeConnected) {
      wrap.innerHTML = `<div class="empty"><km-icon name="plug" size="xl" class="empty-icon"></km-icon>
        <span class="empty-text">Connect to KiCad Bridge to browse nets.</span></div>`;
      return;
    }

    if (nets.length === 0) {
      wrap.innerHTML = `<div class="empty"><km-icon name="component" size="xl" class="empty-icon"></km-icon>
        <span class="empty-text">${this._query ? 'No nets match.' : 'No nets in this board.'}</span></div>`;
      return;
    }

    wrap.innerHTML = `
      <div>
        ${nets.sort().map(net => `
          <div class="net-row${net === this._selectedNet ? ' selected' : ''}" data-net="${esc(net)}">
            <div class="net-name" title="${esc(net)}">${this._query ? _highlightNet(net, this._query) : esc(net)}</div>
            <span class="net-count">${net === 'GND' || net === 'VCC' ? '★ ' : ''}${net}</span>
            <button class="net-highlight-btn" data-net="${esc(net)}" title="Highlight net in KiCad" type="button">
              <svg width="12" height="12" viewBox="0 0 12 12" fill="none">
                <circle cx="6" cy="6" r="3.5" stroke="currentColor" stroke-width="1.3"/>
                <circle cx="6" cy="6" r="1.3" fill="currentColor"/>
              </svg>
            </button>
          </div>
        `).join('')}
      </div>
    `;

    for (const row of wrap.querySelectorAll('.net-row[data-net]')) {
      row.addEventListener('click', (e) => {
        if (e.target.closest('.net-highlight-btn')) return;
        this._selectedNet = row.dataset.net;
        wrap.querySelectorAll('.net-row').forEach(r =>
          r.classList.toggle('selected', r.dataset.net === this._selectedNet)
        );
        // Notify outer view so it can open the Net Inspector
        this.dispatchEvent(new CustomEvent('km-net-select', {
          bubbles: true, composed: true,
          detail: { net: this._selectedNet },
        }));
      });
    }

    for (const btn of wrap.querySelectorAll('.net-highlight-btn[data-net]')) {
      btn.addEventListener('click', () => {
        highlightNet(btn.dataset.net)
          .catch(err => Logger.warn('ComponentBrowser', 'highlight net failed', err));
      });
    }
  }

  // ── Filtering & Sorting ──────────────────────────────────────────────────────

  _applyFilters(components) {
    return components.filter(c => {
      // Text search
      if (this._query) {
        const haystack = `${c.ref} ${c.value} ${c.footprint}`.toLowerCase();
        if (!haystack.includes(this._query)) return false;
      }
      // Facet filter
      switch (this._filter) {
        case 'front':  return !c.on_back;
        case 'back':   return !!c.on_back;
        case 'dnp':    return !!c.dnp;
        case 'locked': return !!c.locked;
        default:       return true;
      }
    });
  }

  _applySort(components) {
    const key = this._sortKey;
    const dir = this._sortAsc ? 1 : -1;
    return [...components].sort((a, b) => {
      let av, bv;
      if (key === 'pos') {
        av = a.position?.x ?? 0; bv = b.position?.x ?? 0;
      } else {
        av = (a[key] ?? '').toString().toLowerCase();
        bv = (b[key] ?? '').toString().toLowerCase();
      }
      return av < bv ? -dir : av > bv ? dir : 0;
    });
  }
}

// ── Helpers ───────────────────────────────────────────────────────────────────

function esc(s) {
  const d = document.createElement('div');
  d.textContent = String(s ?? '');
  return d.innerHTML;
}

function _highlightNet(text, query) {
  const idx = text.toLowerCase().indexOf(query.toLowerCase());
  if (idx < 0) return esc(text);
  return esc(text.slice(0, idx))
    + `<span class="net-match">${esc(text.slice(idx, idx + query.length))}</span>`
    + esc(text.slice(idx + query.length));
}

customElements.define('km-component-browser', ComponentBrowser);
