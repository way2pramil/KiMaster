/**
 * @element km-wgt-board-info
 * @summary Live board statistics — components, nets, layers, size, DRs, DNP.
 */

import { store, subscribe }            from '../../../../core/State.js';
import { notify }                      from '../../../../core/Notify.js';
import { WIDGET_BASE_CSS, navTo, esc } from './WidgetShell.js';

const T = document.createElement('template');
T.innerHTML = /* html */`
<style>
${WIDGET_BASE_CSS}

/* ── Live dot ─────────────────────────────────────────────────── */
.status-dot {
  width: 7px; height: 7px; border-radius: 50%;
  background: var(--km-alpha-15); flex-shrink: 0;
  transition: background 0.3s, box-shadow 0.3s;
}
.status-dot.live {
  background: var(--km-live);
  box-shadow: 0 0 7px var(--km-live);
  animation: breathe 3s ease-in-out infinite;
}
@keyframes breathe {
  0%,100% { box-shadow: 0 0 4px var(--km-live); }
  50%      { box-shadow: 0 0 12px var(--km-live); }
}

/* ── Primary metrics ─────────────────────────────────────────── */
.metrics {
  display: flex; gap: 0;
  padding: 10px 16px 6px;
  flex-shrink: 0;
}
.metric {
  flex: 1; display: flex; flex-direction: column; gap: 2px;
  position: relative;
}
.metric + .metric::before {
  content: ''; position: absolute; left: 0; top: 4px; bottom: 4px;
  width: 1px; background: var(--km-alpha-06);
}
.metric + .metric { padding-left: 14px; }

.metric-val {
  font-size: 32px; font-weight: 700; letter-spacing: -0.04em;
  line-height: 1; font-variant-numeric: tabular-nums;
}
.metric-val.comp   { color: var(--km-text-primary); }
.metric-val.nets   { color: var(--km-live); }
.metric-val.layers { color: var(--km-accent-hover); }
.metric-lbl {
  font-size: 10px; color: var(--km-alpha-30);
  font-weight: 500; letter-spacing: 0.02em;
}

/* ── Board name + size ──────────────────────────────────────── */
.board-row {
  padding: 4px 16px 6px;
  display: flex; align-items: center; gap: 8px; flex-wrap: wrap;
  flex-shrink: 0;
}
.board-name {
  font-size: 11px; font-family: var(--km-font-mono);
  color: var(--km-text-muted);
  background: var(--km-alpha-04);
  border: 1px solid var(--km-border);
  padding: 3px 8px; border-radius: 5px;
  overflow: hidden; text-overflow: ellipsis; white-space: nowrap;
  max-width: 100%;
}
.board-size {
  font-size: 11px; font-family: var(--km-font-mono);
  color: var(--km-text-secondary);
  background: rgba(37,99,235,0.07);
  border: 1px solid rgba(37,99,235,0.18);
  padding: 3px 8px; border-radius: 5px;
  white-space: nowrap; flex-shrink: 0;
}

/* ── Spec grid — design rules + quick counts ─────────────────── */
.spec-grid {
  display: grid; grid-template-columns: 1fr 1fr;
  gap: 5px; padding: 0 16px 6px;
  flex-shrink: 0;
}
.spec-cell {
  display: flex; flex-direction: column; gap: 1px;
  background: var(--km-alpha-02);
  border: 1px solid var(--km-alpha-055);
  border-radius: 8px; padding: 6px 8px;
}
.spec-val {
  font-size: 13px; font-weight: 600;
  font-variant-numeric: tabular-nums;
  font-family: var(--km-font-mono);
  color: var(--km-text-secondary);
  line-height: 1;
}
.spec-val.warn  { color: var(--km-warning, #f59e0b); }
.spec-val.ok    { color: var(--km-trace); }
.spec-val.muted { color: var(--km-text-muted); }
.spec-lbl {
  font-size: 9px; color: var(--km-alpha-25);
  letter-spacing: 0.02em; margin-top: 1px;
}

/* ── Component type breakdown ────────────────────────────────── */
.breakdown {
  padding: 0 16px 6px;
  display: flex; gap: 5px; flex-wrap: wrap; flex-shrink: 0;
}
.bk-chip {
  display: inline-flex; align-items: center; gap: 4px;
  font-size: 10px; padding: 2px 7px; border-radius: 5px;
  font-variant-numeric: tabular-nums;
  color: var(--km-text-muted);
  background: var(--km-alpha-04);
  border: 1px solid var(--km-border);
}
.bk-chip b { color: var(--km-text-primary); font-weight: 600; }

/* ── Copper layer pills ──────────────────────────────────────── */
.layers-row {
  padding: 0 16px 6px;
  display: flex; gap: 5px; flex-wrap: wrap; flex-shrink: 0;
}
.layer-pill {
  font-size: 9.5px; font-family: var(--km-font-mono);
  padding: 2px 7px; border-radius: 4px;
  white-space: nowrap;
}
.layer-pill.front  { color: #f87171; background: rgba(248,113,113,0.1);  border: 1px solid rgba(248,113,113,0.2); }
.layer-pill.inner  { color: #fb923c; background: rgba(251,146,60,0.08);  border: 1px solid rgba(251,146,60,0.18); }
.layer-pill.back   { color: #60a5fa; background: rgba(96,165,250,0.08);  border: 1px solid rgba(96,165,250,0.18); }
.layer-pill.other  { color: var(--km-text-muted); background: var(--km-alpha-04); border: 1px solid var(--km-border); }

/* ── Status chips ────────────────────────────────────────────── */
.chips-row {
  padding: 0 16px 6px;
  display: flex; gap: 5px; flex-wrap: wrap; flex-shrink: 0;
}
.chip {
  display: inline-flex; align-items: center; gap: 4px;
  font-size: 10px; padding: 2px 7px; border-radius: 5px;
  font-variant-numeric: tabular-nums;
}
.chip.ok    { color: var(--km-trace);  background: rgba(16,185,129,0.08); border: 1px solid rgba(16,185,129,0.18); }
.chip.err   { color: var(--km-danger); background: rgba(239,68,68,0.08);  border: 1px solid rgba(239,68,68,0.18); }
.chip.warn  { color: var(--km-warning, #f59e0b); background: rgba(245,158,11,0.08); border: 1px solid rgba(245,158,11,0.2); }
.chip.muted { color: var(--km-text-muted); background: var(--km-alpha-04); border: 1px solid var(--km-border); }

/* ── Section label ───────────────────────────────────────────── */
.section-lbl {
  font-size: 9px; color: var(--km-text-muted);
  letter-spacing: 0.05em; text-transform: uppercase;
  padding: 4px 16px 3px; flex-shrink: 0;
}

.flex-1 { flex: 1; }
</style>

<div class="wgt-hdr">
  <km-icon class="wgt-icon" name="cpu" size="sm"></km-icon>
  <span class="wgt-label">Board info</span>
  <div class="status-dot" id="sdot"></div>
</div>

<div id="content"></div>
<div class="flex-1"></div>
<div class="wgt-footer" id="footer"></div>
`;

export class WidgetBoardInfo extends HTMLElement {
  constructor() {
    super();
    this.attachShadow({ mode: 'open' });
    this.shadowRoot.appendChild(T.content.cloneNode(true));
    this._unsubs = [];
  }

  connectedCallback() {
    this._render();
    this._unsubs.push(
      subscribe('bridgeConnected',  () => this._render()),
      subscribe('boardComponents',  () => this._render()),
      subscribe('boardNets',        () => this._render()),
      subscribe('boardLayers',      () => this._render()),
      subscribe('boardState',       () => this._render()),
      subscribe('bridgeBoardName',  () => this._render()),
      subscribe('drcErrors',        () => this._render()),
      subscribe('drcStatus',        () => this._render()),
      subscribe('schematicState',   () => this._render()),
    );
  }

  disconnectedCallback() { this._unsubs.forEach(u => u()); this._unsubs = []; }

  _render() {
    const sdot    = this.shadowRoot.getElementById('sdot');
    const content = this.shadowRoot.getElementById('content');
    const footer  = this.shadowRoot.getElementById('footer');
    const on      = store.bridgeConnected;

    sdot.classList.toggle('live', on);

    if (!on) {
      content.innerHTML = `
        <div class="empty" style="padding:28px 20px;gap:12px">
          <km-icon name="plug" size="xl"></km-icon>
          <span class="empty-label" style="color:var(--km-text-secondary)">
            Connect to KiCad<br>to see board stats
          </span>
          <button class="btn-primary" id="btn-connect">
            <km-icon name="plug" size="sm"></km-icon> Connect
          </button>
        </div>`;
      content.querySelector('#btn-connect')?.addEventListener('click', () =>
        import('../../../../modules/kicad-bridge/BridgeClient.js')
          .then(m => m.showConnectGate())
          .catch(err => notify({ type: 'error', title: 'Connection failed', message: String(err?.message ?? err) })));
      footer.innerHTML = '';
      return;
    }

    const comps      = store.boardComponents ?? [];
    const compCount  = comps.length;
    const netCount   = store.boardNets?.length ?? 0;
    const layerCount = store.boardLayers?.length ?? 0;
    const board      = store.bridgeBoardName?.split(/[\\/]/).pop() || 'Unknown board';
    const drcErr     = store.drcErrors?.length ?? 0;
    const bs         = store.boardState;
    const sch        = store.schematicState;

    // Component breakdown
    const dnpCount    = comps.filter(c => c.dnp).length;
    const lockedCount = comps.filter(c => c.locked).length;
    const backCount   = comps.filter(c => c.on_back).length;

    // Board dimensions
    const size = bs?.board_size;
    const sizeStr = size
      ? `${_fmt(size.width_mm)} × ${_fmt(size.height_mm)} mm`
      : null;

    // Design rules
    const dr = bs?.design_rules;
    const minClr   = dr?.min_clearance_mm    ?? null;
    const minTrack = dr?.min_track_width_mm  ?? null;
    const minDrill = dr?.min_via_drill_mm    ?? null;

    // Schematic extras
    const noConn     = sch?.no_connect_count ?? null;
    const sheetCount = sch?.sheet_count      ?? null;

    // Component type breakdown from ref prefix
    const breakdown = _countByType(comps);
    const bkHtml = breakdown.map(({ label, count }) =>
      `<span class="bk-chip"><b>${count}</b> ${label}</span>`).join('');

    // Layer pills with colour coding
    const layers = store.boardLayers ?? [];
    const layerHtml = layers.map(l => {
      const cls = /^F\./i.test(l) ? 'front' : /^B\./i.test(l) ? 'back' : /^In\d/i.test(l) ? 'inner' : 'other';
      return `<span class="layer-pill ${cls}">${esc(l)}</span>`;
    }).join('');

    content.innerHTML = `
      <div class="metrics">
        <div class="metric">
          <span class="metric-val comp">${compCount}</span>
          <span class="metric-lbl">components</span>
        </div>
        <div class="metric">
          <span class="metric-val nets">${netCount}</span>
          <span class="metric-lbl">nets</span>
        </div>
        <div class="metric">
          <span class="metric-val layers">${layerCount}</span>
          <span class="metric-lbl">layers</span>
        </div>
      </div>

      <div class="board-row">
        <span class="board-name" title="${esc(store.bridgeBoardName || '')}">${esc(board)}</span>
        ${sizeStr ? `<span class="board-size">${esc(sizeStr)}</span>` : ''}
      </div>

      <div class="spec-grid">
        <div class="spec-cell">
          <span class="spec-val ${minClr !== null && minClr < 0.1 ? 'warn' : ''}">${minClr !== null ? minClr + ' mm' : '—'}</span>
          <span class="spec-lbl">Min clearance</span>
        </div>
        <div class="spec-cell">
          <span class="spec-val ${minTrack !== null && minTrack < 0.1 ? 'warn' : ''}">${minTrack !== null ? minTrack + ' mm' : '—'}</span>
          <span class="spec-lbl">Min track width</span>
        </div>
        <div class="spec-cell">
          <span class="spec-val ${minDrill !== null && minDrill < 0.2 ? 'warn' : ''}">${minDrill !== null ? minDrill + ' mm' : '—'}</span>
          <span class="spec-lbl">Min via drill</span>
        </div>
        <div class="spec-cell">
          <span class="spec-val ${noConn !== null && noConn > 0 ? 'warn' : 'muted'}">${noConn !== null ? noConn : '—'}${sheetCount !== null && sheetCount > 1 ? ` / ${sheetCount} sheets` : ''}</span>
          <span class="spec-lbl">No connects</span>
        </div>
      </div>

      ${bkHtml ? `<div class="section-lbl">by type</div><div class="breakdown">${bkHtml}</div>` : ''}
      ${layerHtml ? `<div class="section-lbl">copper layers</div><div class="layers-row">${layerHtml}</div>` : ''}

      <div class="chips-row">
        ${drcErr === 0
          ? `<span class="chip ok"><km-icon name="check" size="sm"></km-icon>${store.drcStatus === 'done' ? 'DRC clean' : 'DRC not run'}</span>`
          : `<span class="chip err"><km-icon name="warning" size="sm"></km-icon>${drcErr} DRC error${drcErr !== 1 ? 's' : ''}</span>`}
        ${dnpCount > 0    ? `<span class="chip warn">${dnpCount} DNP</span>` : ''}
        ${lockedCount > 0 ? `<span class="chip muted">${lockedCount} locked</span>` : ''}
        ${backCount > 0   ? `<span class="chip muted">${backCount} back</span>` : ''}
        ${bs?.board_name  ? `<span class="chip muted">Live sync</span>` : ''}
      </div>`;

    footer.innerHTML = `<button class="btn-link accent" id="btn-bridge">View bridge <km-icon name="arrow-right" size="sm"></km-icon></button>`;
    footer.querySelector('#btn-bridge')?.addEventListener('click', () => navTo(this, '/bridge'));
  }
}

function _fmt(n) {
  return n !== null && n !== undefined ? parseFloat(n.toFixed(1)).toString() : '?';
}

const _REF_TYPES = [
  { prefix: /^U/i,  label: 'ICs' },
  { prefix: /^C/i,  label: 'Caps' },
  { prefix: /^R/i,  label: 'Resistors' },
  { prefix: /^L/i,  label: 'Inductors' },
  { prefix: /^[JP]/i, label: 'Connectors' },
  { prefix: /^Q/i,  label: 'Transistors' },
  { prefix: /^D/i,  label: 'Diodes' },
  { prefix: /^F/i,  label: 'Fuses' },
  { prefix: /^Y|^X/i, label: 'Crystals' },
];

function _countByType(comps) {
  const counts = {};
  let other = 0;
  for (const c of comps) {
    const match = _REF_TYPES.find(t => t.prefix.test(c.ref));
    if (match) counts[match.label] = (counts[match.label] ?? 0) + 1;
    else other++;
  }
  const result = Object.entries(counts).map(([label, count]) => ({ label, count }));
  if (other > 0) result.push({ label: 'other', count: other });
  return result;
}

customElements.define('km-wgt-board-info', WidgetBoardInfo);
