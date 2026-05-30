/**
 * @element km-bom-table
 * @summary Bill of Materials — groups components by value + footprint for manufacturing.
 *
 * Unlike ComponentBrowser (per-component, position-oriented, KiCad actions),
 * BomTable answers "how many of each part do I need?" — the manufacturing view.
 *
 * Reads: store.boardComponents, store.bridgeConnected, store.bridgeBoardName
 *
 * @fires km-bom-export  — detail: { rows: BomRow[], format: 'csv' }
 */

import { store, subscribe } from '../../../core/State.js';
import { Logger } from '../../../core/Logger.js';
import { highlightComponent } from '../../../modules/kicad-bridge/BridgeClient.js';

// ── Template ────────────────────────────────────────────────────────────────

const TEMPLATE = document.createElement('template');
TEMPLATE.innerHTML = `
<style>
  :host { display: block; height: 100%; font-family: var(--km-font); }

  .bom {
    display: flex;
    flex-direction: column;
    height: 100%;
    overflow: hidden;
  }

  /* ── Toolbar ── */
  .toolbar {
    display: flex;
    align-items: center;
    gap: var(--km-space-3);
    padding: var(--km-space-3) var(--km-space-5);
    border-bottom: 1px solid var(--km-border);
    flex-shrink: 0;
    background: var(--km-bg-primary);
  }
  .search-wrap {
    flex: 1;
    position: relative;
    max-width: 360px;
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

  /* summary stats */
  .stats {
    display: flex;
    gap: var(--km-space-4);
    align-items: center;
    flex-shrink: 0;
  }
  .stat {
    display: flex;
    align-items: baseline;
    gap: var(--km-space-1);
    font-size: var(--km-font-size-xs);
    color: var(--km-text-muted);
    white-space: nowrap;
    font-variant-numeric: tabular-nums;
  }
  .stat-value {
    font-size: var(--km-font-size-sm);
    font-weight: var(--km-font-weight-semibold);
    color: var(--km-text-primary);
    font-variant-numeric: tabular-nums;
  }

  .toolbar-sep { flex: 1; }

  .export-btn {
    display: inline-flex;
    align-items: center;
    gap: var(--km-space-1);
    padding: var(--km-space-2) var(--km-space-3);
    border-radius: var(--km-radius-sm);
    border: 1px solid var(--km-border);
    background: var(--km-bg-surface);
    color: var(--km-text-secondary);
    font-family: var(--km-font);
    font-size: var(--km-font-size-xs);
    font-weight: var(--km-font-weight-medium);
    cursor: pointer;
    transition: all var(--km-duration-fast) var(--km-ease);
    white-space: nowrap;
  }
  .export-btn:hover { color: var(--km-text-primary); border-color: var(--km-accent); }
  .export-btn:active { transform: scale(0.97); }

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
  th.num { text-align: right; }

  td {
    padding: var(--km-space-2) var(--km-space-3);
    border-bottom: 1px solid var(--km-border);
    color: var(--km-text-secondary);
    vertical-align: middle;
  }
  tr:last-child td { border-bottom: none; }
  tr:hover td { background: var(--km-bg-surface); }
  tr.selected td { background: var(--km-accent-muted); }

  /* column styles */
  td.qty {
    text-align: right;
    font-weight: var(--km-font-weight-semibold);
    color: var(--km-text-primary);
    font-variant-numeric: tabular-nums;
    width: 48px;
  }
  td.refs {
    font-family: var(--km-font-mono);
    font-size: var(--km-font-size-xs);
    color: var(--km-text-primary);
    font-variant-numeric: tabular-nums;
    max-width: 340px;
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
  }
  td.val {
    font-weight: var(--km-font-weight-medium);
    color: var(--km-text-primary);
    white-space: nowrap;
  }
  td.fp {
    font-family: var(--km-font-mono);
    font-size: var(--km-font-size-xs);
    color: var(--km-text-muted);
    max-width: 220px;
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
  }
  td.side { text-align: center; white-space: nowrap; }

  /* badges */
  .badge {
    display: inline-flex;
    align-items: center;
    padding: 1px var(--km-space-1);
    border-radius: var(--km-radius-xs);
    font-size: 10px;
    font-weight: var(--km-font-weight-medium);
  }
  .badge-back  { background: rgba(6,182,212,0.15); color: var(--km-live); }
  .badge-front { background: rgba(37,99,235,0.15); color: var(--km-accent); }
  .badge-both  { background: rgba(16,185,129,0.15); color: var(--km-success); }
  .badge-dnp   { background: rgba(239,68,68,0.15); color: var(--km-danger); margin-left: 4px; }

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
  .empty-hint {
    font-size: var(--km-font-size-xs);
    color: var(--km-text-muted);
    max-width: 320px;
    line-height: var(--km-line-height-base);
  }
</style>

<div class="bom">
  <div class="toolbar">
    <div class="search-wrap">
      <span class="search-icon">
        <svg width="12" height="12" viewBox="0 0 12 12" fill="none">
          <circle cx="5" cy="5" r="3.5" stroke="currentColor" stroke-width="1.4"/>
          <path d="M8 8l2.5 2.5" stroke="currentColor" stroke-width="1.4" stroke-linecap="round"/>
        </svg>
      </span>
      <input class="search" id="search" type="text" placeholder="Search value, footprint, ref..." autocomplete="off"/>
    </div>

    <div class="filter-pills">
      <button class="fpill active" data-filter="all">All</button>
      <button class="fpill" data-filter="front">Front</button>
      <button class="fpill" data-filter="back">Back</button>
      <button class="fpill" data-filter="smd">SMD</button>
      <button class="fpill" data-filter="tht">THT</button>
    </div>

    <div class="toolbar-sep"></div>

    <div class="stats">
      <div class="stat"><span class="stat-value" id="stat-groups">0</span> groups</div>
      <div class="stat"><span class="stat-value" id="stat-total">0</span> parts</div>
      <div class="stat"><span class="stat-value" id="stat-unique">0</span> unique</div>
    </div>

    <button class="export-btn" id="btn-copy" title="Copy BOM to clipboard">
      <svg width="12" height="12" viewBox="0 0 12 12" fill="none">
        <rect x="3.5" y="3.5" width="6" height="7" rx="1" stroke="currentColor" stroke-width="1.2"/>
        <path d="M8.5 3.5V2a1 1 0 00-1-1H3a1 1 0 00-1 1v5.5a1 1 0 001 1h.5" stroke="currentColor" stroke-width="1.2"/>
      </svg>
      Copy CSV
    </button>
  </div>

  <div class="table-wrap" id="table-wrap"></div>
</div>
`;

// ── Component ────────────────────────────────────────────────────────────────

export class BomTable extends HTMLElement {
  constructor() {
    super();
    this.attachShadow({ mode: 'open' });
    this.shadowRoot.appendChild(TEMPLATE.content.cloneNode(true));

    this._query    = '';
    this._filter   = 'all';
    this._sortKey  = 'refs';   // default sort: by first reference
    this._sortAsc  = true;
    this._selectedIdx = -1;
    this._unsubs   = [];
  }

  connectedCallback() {
    const sr = this.shadowRoot;

    // Search
    sr.getElementById('search').addEventListener('input', (e) => {
      this._query = e.target.value.toLowerCase();
      this._render();
    });

    // Filter pills
    for (const pill of sr.querySelectorAll('.fpill')) {
      pill.addEventListener('click', () => {
        this._filter = pill.dataset.filter;
        sr.querySelectorAll('.fpill').forEach(p => p.classList.toggle('active', p === pill));
        this._render();
      });
    }

    // Copy CSV
    sr.getElementById('btn-copy').addEventListener('click', () => this._copyCsv());

    // Store subscriptions
    this._unsubs.push(
      subscribe('boardComponents', () => this._render()),
      subscribe('bridgeConnected', () => this._render()),
    );

    this._render();
  }

  disconnectedCallback() {
    for (const unsub of this._unsubs) unsub();
    this._unsubs = [];
  }

  // ── BOM grouping ───────────────────────────────────────────────────────────

  /**
   * Group components by value + footprint → BOM rows.
   * @param {Array} components
   * @returns {Array<{ value: string, footprint: string, package: string, refs: string[], qty: number, sides: Set<string>, hasDnp: boolean, isSmd: boolean }>}
   */
  _buildBom(components) {
    /** @type {Map<string, object>} */
    const groups = new Map();

    for (const c of components) {
      const val = c.value || '?';
      const fp  = c.footprint || '?';
      const key = `${val}||${fp}`;

      if (!groups.has(key)) {
        const pkg = fp.includes(':') ? fp.split(':').pop() : fp;
        groups.set(key, {
          value: val,
          footprint: fp,
          package: pkg,
          refs: [],
          qty: 0,
          sides: new Set(),
          hasDnp: false,
          isSmd: _isSmd(fp),
        });
      }

      const g = groups.get(key);
      g.refs.push(c.ref);
      g.qty++;
      g.sides.add(c.on_back ? 'back' : 'front');
      if (c.dnp) g.hasDnp = true;
    }

    // Natural-sort refs within each group
    for (const g of groups.values()) {
      g.refs.sort(_naturalSort);
    }

    return Array.from(groups.values());
  }

  // ── Filtering ──────────────────────────────────────────────────────────────

  _applyFilters(bomRows) {
    return bomRows.filter(row => {
      // Text search
      if (this._query) {
        const hay = `${row.value} ${row.footprint} ${row.refs.join(' ')}`.toLowerCase();
        if (!hay.includes(this._query)) return false;
      }
      // Facet
      switch (this._filter) {
        case 'front': return row.sides.has('front') && !row.sides.has('back');
        case 'back':  return row.sides.has('back')  && !row.sides.has('front');
        case 'smd':   return row.isSmd;
        case 'tht':   return !row.isSmd;
        default:      return true;
      }
    });
  }

  _applySort(rows) {
    const key = this._sortKey;
    const dir = this._sortAsc ? 1 : -1;
    return [...rows].sort((a, b) => {
      let av, bv;
      switch (key) {
        case 'qty':
          av = a.qty; bv = b.qty;
          return (av - bv) * dir;
        case 'value':
          av = a.value.toLowerCase(); bv = b.value.toLowerCase();
          break;
        case 'package':
          av = a.package.toLowerCase(); bv = b.package.toLowerCase();
          break;
        case 'refs':
        default:
          av = a.refs[0]?.toLowerCase() ?? ''; bv = b.refs[0]?.toLowerCase() ?? '';
          break;
      }
      return av < bv ? -dir : av > bv ? dir : 0;
    });
  }

  // ── Render ─────────────────────────────────────────────────────────────────

  _render() {
    const sr = this.shadowRoot;
    const wrap = sr.getElementById('table-wrap');
    const components = store.boardComponents ?? [];

    if (!store.bridgeConnected) {
      sr.getElementById('stat-groups').textContent = '0';
      sr.getElementById('stat-total').textContent  = '0';
      sr.getElementById('stat-unique').textContent = '0';
      wrap.innerHTML = `
        <div class="empty">
          <km-icon name="bom" size="xl" class="empty-icon"></km-icon>
          <span class="empty-text">Connect to KiCad bridge to view the BOM.</span>
          <span class="empty-hint">The bill of materials is populated from the live board data via the KiCad bridge. Start KiCad with the bridge plugin active.</span>
        </div>`;
      return;
    }

    if (components.length === 0) {
      sr.getElementById('stat-groups').textContent = '0';
      sr.getElementById('stat-total').textContent  = '0';
      sr.getElementById('stat-unique').textContent = '0';
      wrap.innerHTML = `
        <div class="empty">
          <km-icon name="bom" size="xl" class="empty-icon"></km-icon>
          <span class="empty-text">No components on this board.</span>
        </div>`;
      return;
    }

    const bomAll   = this._buildBom(components);
    const filtered = this._applyFilters(bomAll);
    const sorted   = this._applySort(filtered);

    const totalParts  = sorted.reduce((s, r) => s + r.qty, 0);
    const uniqueVals  = new Set(sorted.map(r => r.value)).size;

    sr.getElementById('stat-groups').textContent = String(sorted.length);
    sr.getElementById('stat-total').textContent  = String(totalParts);
    sr.getElementById('stat-unique').textContent = String(uniqueVals);

    wrap.innerHTML = `
      <table>
        <thead>
          <tr>
            ${this._th('qty',     'Qty',       true, true)}
            ${this._th('refs',    'References')}
            ${this._th('value',   'Value')}
            ${this._th('package', 'Package')}
            <th>Footprint</th>
            <th>Side</th>
          </tr>
        </thead>
        <tbody>
          ${sorted.map((row, i) => this._row(row, i)).join('')}
        </tbody>
      </table>
    `;

    // Sort headers
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

    // Row click → highlight first ref in group
    for (const tr of wrap.querySelectorAll('tr[data-idx]')) {
      tr.addEventListener('click', () => {
        const idx = parseInt(tr.dataset.idx, 10);
        this._selectedIdx = idx;
        wrap.querySelectorAll('tr[data-idx]').forEach(r =>
          r.classList.toggle('selected', r.dataset.idx === String(idx))
        );
        const row = sorted[idx];
        if (row?.refs[0]) {
          highlightComponent(row.refs[0])
            .catch(err => Logger.warn('BomTable', 'highlight failed', err));
        }
      });
    }
  }

  _th(key, label, sortable = true, isNum = false) {
    const active = this._sortKey === key;
    const arrow  = active ? (this._sortAsc ? '↑' : '↓') : '';
    const cls    = [active ? 'sorted' : '', isNum ? 'num' : ''].filter(Boolean).join(' ');
    return `<th data-sort="${key}" class="${cls}">
      ${label}${arrow ? `<span class="sort-arrow">${arrow}</span>` : ''}
    </th>`;
  }

  _row(row, idx) {
    const refsStr  = row.refs.join(', ');
    const shortFp  = row.footprint.includes(':') ? row.footprint.split(':').pop() : row.footprint;
    const sideHtml = _sideBadge(row.sides);
    const dnpHtml  = row.hasDnp ? '<span class="badge badge-dnp">DNP</span>' : '';

    return `
      <tr data-idx="${idx}">
        <td class="qty">${row.qty}</td>
        <td class="refs" title="${esc(refsStr)}">${esc(refsStr)}</td>
        <td class="val">${esc(row.value)}${dnpHtml}</td>
        <td class="fp" title="${esc(row.footprint)}">${esc(shortFp)}</td>
        <td class="fp" title="${esc(row.footprint)}">${esc(row.footprint)}</td>
        <td class="side">${sideHtml}</td>
      </tr>
    `;
  }

  // ── CSV export ─────────────────────────────────────────────────────────────

  _copyCsv() {
    const components = store.boardComponents ?? [];
    if (components.length === 0) return;

    const bom = this._buildBom(components);
    const sorted = this._applySort(this._applyFilters(bom));

    const header = 'Qty,References,Value,Package,Footprint,Side';
    const lines = sorted.map(row => {
      const refs = `"${row.refs.join(', ')}"`;
      const side = row.sides.has('front') && row.sides.has('back') ? 'Both'
                 : row.sides.has('back') ? 'Back' : 'Front';
      return `${row.qty},${refs},"${row.value}","${row.package}","${row.footprint}",${side}`;
    });

    const csv = [header, ...lines].join('\n');

    navigator.clipboard.writeText(csv).then(() => {
      const btn = this.shadowRoot.getElementById('btn-copy');
      const orig = btn.innerHTML;
      btn.textContent = 'Copied!';
      setTimeout(() => { btn.innerHTML = orig; }, 1500);
    }).catch(err => {
      Logger.warn('BomTable', 'clipboard copy failed', err);
    });

    this.dispatchEvent(new CustomEvent('km-bom-export', {
      bubbles: true, composed: true,
      detail: { rows: sorted, format: 'csv' },
    }));
  }
}

// ── Helpers ──────────────────────────────────────────────────────────────────

function esc(s) {
  const d = document.createElement('div');
  d.textContent = String(s ?? '');
  return d.innerHTML;
}

/** Detect SMD vs THT from footprint string heuristics. */
function _isSmd(fp) {
  const lower = fp.toLowerCase();
  return lower.includes('smd') || lower.includes('_smd')
      || /c_0[0-9]{3}|r_0[0-9]{3}|qfp|bga|sot|dfn|qfn|soic|ssop|tssop|msop|son/i.test(lower);
}

/** Natural sort: R1, R2, R10 instead of R1, R10, R2 */
function _naturalSort(a, b) {
  return a.localeCompare(b, undefined, { numeric: true, sensitivity: 'base' });
}

/** Generate side badge HTML from a Set of 'front'/'back'. */
function _sideBadge(sides) {
  if (sides.has('front') && sides.has('back')) {
    return '<span class="badge badge-both">Both</span>';
  }
  if (sides.has('back')) {
    return '<span class="badge badge-back">Back</span>';
  }
  return '<span class="badge badge-front">Front</span>';
}

customElements.define('km-bom-table', BomTable);
