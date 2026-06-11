/**
 * @element km-bom-table
 * @summary Full-featured BOM panel — grouping, checkboxes, netlist, split canvas, export.
 *
 * Reads: store.boardComponents, store.boardNets, store.bridgeConnected
 */

import { store, subscribe }                  from '../../../core/State.js';
import { Logger }                            from '../../../core/Logger.js';
import { highlightComponent, highlightNet }  from '../../../modules/kicad-bridge/BridgeClient.js';

// ── Persistence ───────────────────────────────────────────────────────────────

const LS_SETTINGS = 'km-bom-settings';

function _loadSettings() {
  try { return JSON.parse(localStorage.getItem(LS_SETTINGS) || '{}'); } catch { return {}; }
}
function _saveSettings(o) {
  try { localStorage.setItem(LS_SETTINGS, JSON.stringify(o)); } catch {}
}
function _loadCbxRefs(name) {
  try {
    const v = localStorage.getItem(`km-bom-cbx-${name}`);
    return v ? new Set(v.split(',').filter(Boolean)) : new Set();
  } catch { return new Set(); }
}
function _saveCbxRefs(name, refs) {
  try { localStorage.setItem(`km-bom-cbx-${name}`, [...refs].join(',')); } catch {}
}

// ── Placement Canvas ──────────────────────────────────────────────────────────

class PlacementCanvas {
  constructor(canvas, side) {
    this.canvas     = canvas;
    this.ctx        = canvas.getContext('2d');
    this.side       = side;
    this._comps     = [];
    this._hi        = new Set();
    this._marked    = new Set();
    this._tf        = { s: 1, ox: 0, oy: 0 };
    this._bbox      = null;
    this._drag      = null;
    this._wasDrag   = false;
    this.onClickRef = null;
    this._bind();
  }

  update(comps, hi, marked) {
    const refitNeeded = comps !== this._comps;
    this._comps  = comps;
    this._hi     = hi;
    this._marked = marked;
    if (refitNeeded) this._fit();
    this.draw();
  }

  resize(w, h) {
    if (!w || !h) return;
    this.canvas.width  = w;
    this.canvas.height = h;
    this._resetView();
    this.draw();
  }

  _fit() {
    if (!this._comps.length) return;
    let x0 = Infinity, y0 = Infinity, x1 = -Infinity, y1 = -Infinity;
    for (const c of this._comps) {
      x0 = Math.min(x0, c.position.x); y0 = Math.min(y0, c.position.y);
      x1 = Math.max(x1, c.position.x); y1 = Math.max(y1, c.position.y);
    }
    this._bbox = { x0, y0, x1, y1 };
    this._resetView();
  }

  _resetView() {
    if (!this._bbox || !this.canvas.width) return;
    const { x0, y0, x1, y1 } = this._bbox;
    const bw = x1 - x0 || 20, bh = y1 - y0 || 20;
    const pad = 0.12;
    const s = Math.min(this.canvas.width / (bw * (1 + 2 * pad)), this.canvas.height / (bh * (1 + 2 * pad)));
    const cx = (x0 + x1) / 2, cy = (y0 + y1) / 2;
    this._tf = { s, ox: this.canvas.width / 2 - cx * s, oy: this.canvas.height / 2 - cy * s };
  }

  _sc(x, y) {
    const { s, ox, oy } = this._tf;
    const sx = x * s + ox;
    return { x: this.side === 'B' ? this.canvas.width - sx : sx, y: y * s + oy };
  }

  _bd(sx, sy) {
    const { s, ox, oy } = this._tf;
    const rx = this.side === 'B' ? this.canvas.width - sx : sx;
    return { x: (rx - ox) / s, y: (sy - oy) / s };
  }

  draw() {
    const ctx = this.ctx;
    const { width: w, height: h } = this.canvas;
    ctx.clearRect(0, 0, w, h);
    ctx.fillStyle = '#080c14';
    ctx.fillRect(0, 0, w, h);

    if (!this._comps.length) {
      ctx.fillStyle = '#2d3748';
      ctx.font = '12px system-ui';
      ctx.textAlign = 'center';
      ctx.textBaseline = 'middle';
      ctx.fillText('No components', w / 2, h / 2);
      return;
    }

    const { s } = this._tf;
    const r = Math.max(3, Math.min(14, s * 1.1));

    for (const c of this._comps) {
      const { x, y } = this._sc(c.position.x, c.position.y);
      const hi  = this._hi.has(c.ref);
      const mk  = this._marked.has(c.ref);
      const dnp = c.dnp;

      ctx.lineWidth = hi ? 2.5 : 1;

      if (hi) {
        ctx.fillStyle   = '#f59e0b';
        ctx.strokeStyle = '#fcd34d';
      } else if (mk) {
        ctx.fillStyle   = '#059669';
        ctx.strokeStyle = '#10b981';
      } else if (dnp) {
        ctx.fillStyle   = 'transparent';
        ctx.strokeStyle = '#ef444450';
      } else {
        ctx.fillStyle   = this.side === 'F' ? '#1d4ed840' : '#0e749050';
        ctx.strokeStyle = this.side === 'F' ? '#3b82f6bb' : '#06b6d4bb';
      }

      ctx.beginPath();
      ctx.arc(x, y, r, 0, Math.PI * 2);
      if (dnp && !hi && !mk) ctx.stroke();
      else { ctx.fill(); ctx.stroke(); }

      if (hi && s > 2) {
        ctx.fillStyle    = '#f1f5f9';
        ctx.font         = `${Math.max(9, r * 1.2)}px monospace`;
        ctx.textAlign    = 'center';
        ctx.textBaseline = 'bottom';
        ctx.fillText(c.ref, x, y - r - 3);
        ctx.textBaseline = 'alphabetic';
      }
    }
  }

  _bind() {
    this.canvas.addEventListener('wheel', e => {
      e.preventDefault();
      const rect = this.canvas.getBoundingClientRect();
      const mx = e.clientX - rect.left, my = e.clientY - rect.top;
      const d  = e.deltaY > 0 ? 0.84 : 1.19;
      const ns = Math.max(0.1, Math.min(300, this._tf.s * d));
      this._tf = { s: ns, ox: mx - (mx - this._tf.ox) * (ns / this._tf.s), oy: my - (my - this._tf.oy) * (ns / this._tf.s) };
      this.draw();
    }, { passive: false });

    this.canvas.addEventListener('mousedown', e => {
      this._drag = { x: e.clientX, y: e.clientY, ox: this._tf.ox, oy: this._tf.oy };
      this._wasDrag = false;
    });
    this.canvas.addEventListener('mousemove', e => {
      if (!this._drag) return;
      const dx = e.clientX - this._drag.x, dy = e.clientY - this._drag.y;
      if (Math.abs(dx) > 3 || Math.abs(dy) > 3) this._wasDrag = true;
      this._tf.ox = this._drag.ox + dx;
      this._tf.oy = this._drag.oy + dy;
      this.draw();
    });
    this.canvas.addEventListener('mouseup', e => {
      if (!this._wasDrag && this.onClickRef) {
        const rect = this.canvas.getBoundingClientRect();
        const bp   = this._bd(e.clientX - rect.left, e.clientY - rect.top);
        const thr  = Math.max(4, 9 / this._tf.s);
        let best = null, bd = thr;
        for (const c of this._comps) {
          const d = Math.hypot(c.position.x - bp.x, c.position.y - bp.y);
          if (d < bd) { bd = d; best = c.ref; }
        }
        if (best) this.onClickRef(best);
      }
      this._drag = null;
    });
    this.canvas.addEventListener('mouseleave', () => { this._drag = null; });
    this.canvas.addEventListener('dblclick', () => { this._resetView(); this.draw(); });
  }
}

// ── Helpers ───────────────────────────────────────────────────────────────────

function esc(s) {
  const d = document.createElement('div');
  d.textContent = String(s ?? '');
  return d.innerHTML;
}

function _isSmd(fp) {
  const l = fp.toLowerCase();
  return l.includes('smd') || l.includes('_smd')
      || /c_0[0-9]{3}|r_0[0-9]{3}|qfp|bga|sot|dfn|qfn|soic|ssop|tssop|msop|son/i.test(l);
}

function _naturalSort(a, b) {
  return a.localeCompare(b, undefined, { numeric: true, sensitivity: 'base' });
}

function _sideBadge(sides) {
  if (sides.has('front') && sides.has('back')) return '<span class="badge badge-both">Both</span>';
  if (sides.has('back'))  return '<span class="badge badge-back">Back</span>';
  return '<span class="badge badge-front">Front</span>';
}

function _uniqueFields(components) {
  const s = new Set();
  for (const c of components) if (c.fields) for (const k of Object.keys(c.fields)) s.add(k);
  return [...s];
}

function _hlText(text, query) {
  if (!query) return esc(text);
  const escaped = esc(text);
  const q = query.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  return escaped.replace(new RegExp(q, 'gi'), m => `<mark class="hl">${m}</mark>`);
}

// ── Template ──────────────────────────────────────────────────────────────────

const TEMPLATE = document.createElement('template');
TEMPLATE.innerHTML = `
<style>
  :host { display: block; height: 100%; font-family: var(--km-font); }

  /* ── Root layouts ── */
  .bom-root { display: flex; height: 100%; overflow: hidden; position: relative; }
  .bom-root.layout-bom-only { flex-direction: column; }
  .bom-root.layout-lr       { flex-direction: row; }
  .bom-root.layout-tb       { flex-direction: column; }

  /* ── BOM pane ── */
  .bom-pane {
    display: flex; flex-direction: column;
    flex: 1; min-width: 0; min-height: 0; overflow: hidden;
  }
  .layout-lr .bom-pane { flex: 0 0 50%; }
  .layout-tb .bom-pane { flex: 0 0 50%; }

  /* ── Toolbar ── */
  .toolbar {
    display: flex; align-items: center; gap: 6px;
    padding: 8px 12px;
    border-bottom: 1px solid var(--km-border);
    flex-shrink: 0;
    background: var(--km-bg-primary);
    flex-wrap: wrap;
    min-height: 48px;
  }

  /* Omni-search */
  .omni-wrap {
    display: flex; align-items: center;
    flex: 1; min-width: 160px; max-width: 320px;
    background: var(--km-bg-surface);
    border: 1px solid var(--km-border);
    border-radius: var(--km-radius);
    padding: 0 8px 0 4px;
    gap: 4px;
    transition: border-color var(--km-duration-fast) var(--km-ease);
  }
  .omni-wrap:focus-within { border-color: var(--km-accent); }

  .omni-mode-pill {
    flex-shrink: 0;
    padding: 2px 6px;
    border-radius: var(--km-radius-sm);
    border: none;
    background: var(--km-bg-elevated);
    color: var(--km-text-muted);
    font-size: 10px;
    font-family: var(--km-font);
    cursor: pointer;
    white-space: nowrap;
    transition: all var(--km-duration-fast) var(--km-ease);
    letter-spacing: 0.02em;
  }
  .omni-mode-pill:hover { color: var(--km-text-primary); }
  .omni-mode-pill.ref-mode { background: var(--km-accent-muted); color: var(--km-accent); }

  .omni-icon { color: var(--km-text-muted); display: flex; align-items: center; flex-shrink: 0; }

  .omni {
    flex: 1; border: none; background: transparent;
    color: var(--km-text-primary); font-family: var(--km-font);
    font-size: var(--km-font-size-sm); outline: none;
    padding: 6px 0;
    min-width: 0;
  }
  .omni::placeholder { color: var(--km-text-muted); }

  .omni-clear {
    flex-shrink: 0; border: none; background: none;
    color: var(--km-text-muted); cursor: pointer;
    font-size: 14px; line-height: 1; padding: 0 2px;
    transition: color var(--km-duration-fast) var(--km-ease);
  }
  .omni-clear:hover { color: var(--km-text-primary); }

  /* Layer segmented control */
  .layer-seg {
    display: flex; flex-shrink: 0;
    background: var(--km-bg-surface);
    border: 1px solid var(--km-border);
    border-radius: var(--km-radius);
    padding: 2px;
    gap: 2px;
  }
  .lseg-btn {
    padding: 4px 10px;
    border: none; border-radius: calc(var(--km-radius) - 2px);
    background: none; color: var(--km-text-muted);
    font-size: var(--km-font-size-xs); font-family: var(--km-font);
    cursor: pointer; white-space: nowrap;
    transition: all var(--km-duration-fast) var(--km-ease);
  }
  .lseg-btn:hover { color: var(--km-text-primary); }
  .lseg-btn.active { background: var(--km-bg-elevated); color: var(--km-text-primary); box-shadow: 0 1px 3px rgba(0,0,0,0.3); }

  /* Type filter dropdown */
  .type-wrap { position: relative; flex-shrink: 0; }
  .type-btn {
    display: inline-flex; align-items: center; gap: 4px;
    padding: 5px 10px;
    border: 1px solid var(--km-border); border-radius: var(--km-radius);
    background: var(--km-bg-surface); color: var(--km-text-muted);
    font-size: var(--km-font-size-xs); font-family: var(--km-font);
    cursor: pointer; white-space: nowrap;
    transition: all var(--km-duration-fast) var(--km-ease);
  }
  .type-btn:hover { color: var(--km-text-primary); border-color: var(--km-border); }
  .type-btn.has-filter { color: var(--km-accent); border-color: var(--km-accent); background: var(--km-accent-muted); }
  .type-btn svg { transition: transform var(--km-duration-fast) var(--km-ease); }
  .type-btn.open svg { transform: rotate(180deg); }

  .type-menu {
    position: absolute; top: calc(100% + 4px); left: 0; z-index: 100;
    background: var(--km-bg-elevated);
    border: 1px solid var(--km-border);
    border-radius: var(--km-radius);
    padding: 4px;
    display: flex; flex-direction: column; gap: 2px;
    box-shadow: 0 8px 24px rgba(0,0,0,0.4);
    min-width: 100px;
    animation: menuIn var(--km-duration-fast) var(--km-ease);
  }
  @keyframes menuIn { from { opacity:0; transform:translateY(-4px); } to { opacity:1; transform:translateY(0); } }
  .type-menu-item {
    display: flex; align-items: center; gap: 8px;
    padding: 6px 10px; border-radius: var(--km-radius-sm);
    border: none; background: none; cursor: pointer;
    color: var(--km-text-secondary); font-size: var(--km-font-size-xs); font-family: var(--km-font);
    text-align: left; white-space: nowrap;
    transition: all var(--km-duration-fast) var(--km-ease);
  }
  .type-menu-item:hover { background: var(--km-bg-surface); color: var(--km-text-primary); }
  .type-menu-item.active { color: var(--km-accent); }
  .type-menu-item .check { width: 12px; opacity: 0; }
  .type-menu-item.active .check { opacity: 1; }

  /* Stats strip */
  .toolbar-sep { flex: 1; }
  .stat-strip {
    display: flex; align-items: center; gap: 4px;
    font-size: var(--km-font-size-xs);
    color: var(--km-text-muted);
    white-space: nowrap;
    flex-shrink: 0;
    font-variant-numeric: tabular-nums;
  }
  .stat-num {
    font-weight: var(--km-font-weight-semibold);
    color: var(--km-text-secondary);
    font-variant-numeric: tabular-nums;
  }
  .stat-sep { opacity: 0.4; margin: 0 2px; }
  .stat-side { color: var(--km-text-muted); opacity: 0.7; margin-left: 4px; }

  /* Export dropdown */
  .export-wrap { position: relative; flex-shrink: 0; }
  .export-btn {
    display: inline-flex; align-items: center; gap: 4px;
    padding: 5px 10px;
    border: 1px solid var(--km-border); border-radius: var(--km-radius);
    background: var(--km-bg-surface); color: var(--km-text-secondary);
    font-size: var(--km-font-size-xs); font-family: var(--km-font);
    font-weight: var(--km-font-weight-medium);
    cursor: pointer; white-space: nowrap;
    transition: all var(--km-duration-fast) var(--km-ease);
  }
  .export-btn:hover { color: var(--km-text-primary); border-color: var(--km-accent); }
  .export-btn svg { transition: transform var(--km-duration-fast) var(--km-ease); }
  .export-btn.open svg { transform: rotate(180deg); }

  .export-menu {
    position: absolute; top: calc(100% + 4px); right: 0; z-index: 100;
    background: var(--km-bg-elevated);
    border: 1px solid var(--km-border);
    border-radius: var(--km-radius);
    padding: 4px;
    display: flex; flex-direction: column; gap: 2px;
    box-shadow: 0 8px 24px rgba(0,0,0,0.4);
    min-width: 150px;
    animation: menuIn var(--km-duration-fast) var(--km-ease);
  }
  .export-menu-item {
    display: flex; align-items: center; gap: 8px;
    padding: 7px 12px; border-radius: var(--km-radius-sm);
    border: none; background: none; cursor: pointer;
    color: var(--km-text-secondary); font-size: var(--km-font-size-xs); font-family: var(--km-font);
    text-align: left; white-space: nowrap;
    transition: all var(--km-duration-fast) var(--km-ease);
  }
  .export-menu-item:hover { background: var(--km-bg-surface); color: var(--km-text-primary); }
  .export-badge {
    margin-left: auto;
    padding: 1px 5px; border-radius: var(--km-radius-xs);
    background: var(--km-bg-surface);
    color: var(--km-text-muted); font-size: 10px;
    font-family: var(--km-font-mono);
  }

  /* Settings (gear) button */
  .settings-btn {
    display: inline-flex; align-items: center; justify-content: center;
    width: 32px; height: 32px;
    border: 1px solid var(--km-border); border-radius: var(--km-radius);
    background: var(--km-bg-surface); color: var(--km-text-muted);
    cursor: pointer; flex-shrink: 0;
    transition: all var(--km-duration-fast) var(--km-ease);
  }
  .settings-btn:hover { color: var(--km-text-primary); border-color: var(--km-accent); }
  .settings-btn.active { color: var(--km-accent); border-color: var(--km-accent); background: var(--km-accent-muted); }

  /* ── Progress bars ── */
  .progress-section {
    display: flex; align-items: center; gap: 12px;
    padding: 6px 16px;
    border-bottom: 1px solid var(--km-border);
    background: var(--km-bg-secondary);
    flex-shrink: 0; flex-wrap: wrap;
  }
  .pitem { display: flex; align-items: center; gap: 8px; }
  .plabel { font-size: var(--km-font-size-xs); color: var(--km-text-muted); white-space: nowrap; }
  .pbar-track { width: 120px; height: 4px; background: var(--km-bg-surface); border-radius: 2px; overflow: hidden; }
  .pbar-fill { height: 100%; background: var(--km-accent); border-radius: 2px; transition: width 0.35s var(--km-ease); }
  .pcount { font-size: var(--km-font-size-xs); color: var(--km-text-muted); font-variant-numeric: tabular-nums; white-space: nowrap; }

  /* ── Table ── */
  .table-wrap { flex: 1; overflow: auto; min-height: 0; outline: none; }
  .table-wrap::-webkit-scrollbar { width: 5px; height: 5px; }
  .table-wrap::-webkit-scrollbar-track { background: transparent; }
  .table-wrap::-webkit-scrollbar-thumb { background: var(--km-scrollbar-thumb); border-radius: 3px; }

  table { width: 100%; border-collapse: collapse; font-size: 13px; }
  thead { position: sticky; top: 0; z-index: 1; background: var(--km-bg-secondary); }

  th {
    padding: 8px 12px; text-align: left;
    font-size: 11px; font-weight: var(--km-font-weight-medium);
    color: var(--km-text-muted); border-bottom: 1px solid var(--km-border);
    white-space: nowrap; cursor: pointer; user-select: none;
    letter-spacing: 0.03em;
  }
  th:hover { color: var(--km-text-secondary); }
  th.sorted { color: var(--km-accent); }
  th.num { text-align: right; }
  th.cbx-th { text-align: center; width: 40px; min-width: 40px; font-size: 10px; }

  td {
    padding: 9px 12px;
    border-bottom: 1px solid rgba(255,255,255,0.04);
    color: var(--km-text-secondary); vertical-align: middle;
  }
  tr:last-child td { border-bottom: none; }

  tr:hover td { background: rgba(255,255,255,0.025); }
  tr.selected td {
    background: rgba(37,99,235,0.12) !important;
  }
  tr.row-marked td { background: rgba(5,150,105,0.06); }
  tr.row-marked.selected td { background: rgba(5,150,105,0.16) !important; }

  td.qty { text-align: right; font-weight: 600; color: var(--km-text-primary); font-variant-numeric: tabular-nums; width: 40px; }
  td.refs { font-family: var(--km-font-mono); font-size: 12px; color: var(--km-text-primary); }
  td.val  { font-weight: 500; color: var(--km-text-primary); white-space: nowrap; }
  td.fp   { font-family: var(--km-font-mono); font-size: 11px; color: var(--km-text-muted); max-width: 180px; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
  td.side { text-align: center; white-space: nowrap; }
  td.field { font-size: 11px; color: var(--km-text-muted); max-width: 140px; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
  td.cbx-td { text-align: center; padding: 6px; }
  td.net-name { font-family: var(--km-font-mono); font-size: 12px; color: var(--km-text-primary); cursor: pointer; }

  /* Refs with overflow badge */
  .refs-wrap { display: flex; align-items: center; gap: 5px; }
  .refs-text { font-family: var(--km-font-mono); font-size: 12px; color: var(--km-text-primary); }
  .refs-more {
    display: inline-flex; align-items: center; justify-content: center;
    padding: 1px 5px; border-radius: 10px;
    background: var(--km-bg-elevated); border: 1px solid var(--km-border);
    font-size: 10px; color: var(--km-text-muted); white-space: nowrap;
    cursor: default; flex-shrink: 0;
    position: relative;
    transition: all var(--km-duration-fast) var(--km-ease);
  }
  .refs-more:hover { color: var(--km-text-primary); border-color: var(--km-accent); }

  /* Status ring checkbox */
  .status-ring {
    appearance: none; -webkit-appearance: none;
    width: 18px; height: 18px; border-radius: 50%;
    border: 2px solid var(--km-border);
    background: transparent; cursor: pointer;
    transition: all 0.15s var(--km-ease);
    vertical-align: middle;
    position: relative;
    flex-shrink: 0;
  }
  .status-ring:hover { border-color: var(--km-accent); }
  .status-ring:checked { background: var(--km-accent); border-color: var(--km-accent); }
  .status-ring:checked::after {
    content: ''; position: absolute;
    top: 3px; left: 3px; width: 8px; height: 8px;
    border-radius: 50%; background: white;
  }
  .status-ring:indeterminate { border-color: var(--km-accent); background: var(--km-accent-muted); }

  /* Named checkbox rings (color-coded for multiple checkboxes) */
  .status-ring[data-cbx-idx="1"] { accent-color: #10b981; }
  .status-ring[data-cbx-idx="1"]:checked { background: #10b981; border-color: #10b981; }
  .status-ring[data-cbx-idx="2"] { }
  .status-ring[data-cbx-idx="2"]:checked { background: #f59e0b; border-color: #f59e0b; }

  /* Badges */
  .badge { display: inline-flex; align-items: center; padding: 1px 5px; border-radius: 3px; font-size: 10px; font-weight: 500; }
  .badge-back  { background: rgba(6,182,212,0.12); color: #06b6d4; }
  .badge-front { background: rgba(37,99,235,0.12); color: #3b82f6; }
  .badge-both  { background: rgba(16,185,129,0.12); color: #10b981; }
  .badge-dnp   { background: rgba(239,68,68,0.12); color: #ef4444; margin-left: 4px; }

  mark.hl { background: rgba(245,158,11,0.2); color: inherit; border-radius: 2px; padding: 0 1px; }

  /* ── Keyboard hint ── */
  .kbd-bar {
    display: flex; align-items: center; gap: 14px;
    padding: 5px 14px;
    border-top: 1px solid var(--km-border);
    background: var(--km-bg-secondary);
    flex-shrink: 0;
    font-size: 11px; color: var(--km-text-muted); flex-wrap: wrap;
  }
  .kbd-item { display: inline-flex; align-items: center; gap: 4px; }
  kbd {
    font-family: var(--km-font-mono); font-size: 10px;
    padding: 1px 5px; border: 1px solid var(--km-border);
    border-radius: 3px; background: var(--km-bg-surface);
    color: var(--km-text-secondary);
  }

  /* ── Resize handle ── */
  .resize-handle { flex-shrink: 0; background: var(--km-border); transition: background var(--km-duration-fast) var(--km-ease); }
  .resize-handle:hover, .resize-handle.dragging { background: var(--km-accent); }
  .layout-lr .resize-handle { width: 4px; cursor: col-resize; }
  .layout-tb .resize-handle { height: 4px; cursor: row-resize; }

  /* ── Canvas pane ── */
  .canvas-pane { display: flex; flex-direction: column; flex: 1; min-width: 0; min-height: 0; background: var(--km-bg-elevated); overflow: hidden; }
  .canvas-toolbar {
    display: flex; align-items: center; gap: 8px;
    padding: 6px 12px;
    border-bottom: 1px solid var(--km-border);
    flex-shrink: 0; background: var(--km-bg-secondary);
  }
  .canvas-hint { font-size: 11px; color: var(--km-text-muted); margin-left: auto; opacity: 0.6; }
  .canvas-area { flex: 1; display: flex; min-height: 0; overflow: hidden; }
  .canvas-area.cl-F  .canvas-back-wrap  { display: none; }
  .canvas-area.cl-B  .canvas-front-wrap { display: none; }
  .canvas-front-wrap, .canvas-back-wrap { flex: 1; position: relative; min-width: 0; min-height: 0; overflow: hidden; }
  .canvas-side-label { position: absolute; top: 7px; left: 10px; font-size: 11px; color: var(--km-text-muted); z-index: 1; pointer-events: none; opacity: 0.6; }
  canvas { display: block; width: 100%; height: 100%; }

  /* ── Settings drawer ── */
  .drawer-backdrop {
    position: absolute; inset: 0; z-index: 200;
    background: rgba(0,0,0,0.45);
    backdrop-filter: blur(2px);
    opacity: 0; pointer-events: none;
    transition: opacity 0.22s var(--km-ease);
  }
  .drawer-backdrop.visible { opacity: 1; pointer-events: auto; }

  .drawer-panel {
    position: absolute; top: 0; right: 0; bottom: 0; z-index: 201;
    width: 320px; max-width: 90%;
    background: var(--km-bg-elevated);
    border-left: 1px solid var(--km-border);
    display: flex; flex-direction: column;
    transform: translateX(100%);
    transition: transform 0.22s var(--km-ease);
    box-shadow: -8px 0 32px rgba(0,0,0,0.4);
  }
  .drawer-panel.visible { transform: translateX(0); }

  .drawer-header {
    display: flex; align-items: center; justify-content: space-between;
    padding: 14px 16px 12px;
    border-bottom: 1px solid var(--km-border);
    flex-shrink: 0;
  }
  .drawer-title { font-size: var(--km-font-size-sm); font-weight: var(--km-font-weight-semibold); color: var(--km-text-primary); }
  .drawer-close {
    width: 28px; height: 28px; border-radius: var(--km-radius-sm);
    border: none; background: none; color: var(--km-text-muted);
    cursor: pointer; display: flex; align-items: center; justify-content: center;
    font-size: 16px; transition: all var(--km-duration-fast) var(--km-ease);
  }
  .drawer-close:hover { background: var(--km-bg-surface); color: var(--km-text-primary); }

  .drawer-body { flex: 1; overflow-y: auto; padding: 16px; display: flex; flex-direction: column; gap: 20px; }
  .drawer-body::-webkit-scrollbar { width: 4px; }
  .drawer-body::-webkit-scrollbar-thumb { background: var(--km-scrollbar-thumb); border-radius: 2px; }

  .drawer-section { display: flex; flex-direction: column; gap: 8px; }
  .drawer-section-title { font-size: 11px; font-weight: 500; color: var(--km-text-muted); text-transform: uppercase; letter-spacing: 0.06em; margin-bottom: 2px; }

  /* Toggle switch */
  .drawer-row { display: flex; align-items: center; justify-content: space-between; gap: 12px; }
  .drawer-row-label { font-size: var(--km-font-size-sm); color: var(--km-text-secondary); }

  .toggle-switch {
    position: relative; display: inline-block;
    width: 36px; height: 20px; flex-shrink: 0;
  }
  .toggle-switch input { opacity: 0; width: 0; height: 0; }
  .toggle-track {
    position: absolute; inset: 0;
    background: var(--km-bg-surface); border: 1px solid var(--km-border);
    border-radius: 10px; cursor: pointer;
    transition: all 0.18s var(--km-ease);
  }
  .toggle-track::after {
    content: ''; position: absolute;
    top: 2px; left: 2px; width: 14px; height: 14px;
    background: var(--km-text-muted); border-radius: 50%;
    transition: all 0.18s var(--km-ease);
  }
  .toggle-switch input:checked + .toggle-track { background: var(--km-accent); border-color: var(--km-accent); }
  .toggle-switch input:checked + .toggle-track::after { transform: translateX(16px); background: white; }

  /* Segmented (for mode/layout in drawer) */
  .drawer-seg { display: flex; gap: 2px; background: var(--km-bg-surface); border: 1px solid var(--km-border); border-radius: var(--km-radius); padding: 2px; }
  .drawer-seg-btn {
    flex: 1; padding: 5px 6px; border: none; border-radius: calc(var(--km-radius) - 2px);
    background: none; color: var(--km-text-muted); font-size: 11px; font-family: var(--km-font);
    cursor: pointer; text-align: center; white-space: nowrap;
    transition: all var(--km-duration-fast) var(--km-ease);
  }
  .drawer-seg-btn:hover { color: var(--km-text-primary); }
  .drawer-seg-btn.active { background: var(--km-bg-elevated); color: var(--km-text-primary); box-shadow: 0 1px 3px rgba(0,0,0,0.3); }

  /* Checkbox input in drawer */
  .cbx-input {
    width: 100%; padding: 7px 10px; border: 1px solid var(--km-border);
    border-radius: var(--km-radius-sm); background: var(--km-bg-surface);
    color: var(--km-text-primary); font-family: var(--km-font);
    font-size: var(--km-font-size-sm); outline: none; box-sizing: border-box;
    transition: border-color var(--km-duration-fast) var(--km-ease);
  }
  .cbx-input:focus { border-color: var(--km-accent); }
  .cbx-input-hint { font-size: 11px; color: var(--km-text-muted); margin-top: 2px; }

  .mark-select {
    width: 100%; padding: 7px 10px; border: 1px solid var(--km-border);
    border-radius: var(--km-radius-sm); background: var(--km-bg-surface);
    color: var(--km-text-secondary); font-family: var(--km-font);
    font-size: var(--km-font-size-sm); outline: none; cursor: pointer;
    transition: border-color var(--km-duration-fast) var(--km-ease);
  }
  .mark-select:focus { border-color: var(--km-accent); }

  /* ── Empty state ── */
  .empty {
    display: flex; flex-direction: column; align-items: center; justify-content: center;
    gap: 10px; padding: 48px 24px; color: var(--km-text-muted); text-align: center;
    flex: 1;
  }
  .empty-icon { opacity: 0.25; }
  .empty-text { font-size: var(--km-font-size-sm); color: var(--km-text-secondary); }
  .empty-hint { font-size: var(--km-font-size-xs); max-width: 280px; line-height: 1.5; }
</style>

<div class="bom-root layout-bom-only" id="root">

  <!-- ── Settings drawer ── -->
  <div class="drawer-backdrop" id="drawer-backdrop"></div>
  <div class="drawer-panel" id="drawer-panel">
    <div class="drawer-header">
      <span class="drawer-title">View Settings</span>
      <button class="drawer-close" id="drawer-close" aria-label="Close settings">×</button>
    </div>
    <div class="drawer-body">

      <div class="drawer-section">
        <div class="drawer-section-title">BOM mode</div>
        <div class="drawer-seg" id="mode-btns">
          <button class="drawer-seg-btn active" data-mode="grouped">Grouped</button>
          <button class="drawer-seg-btn" data-mode="ungrouped">Ungrouped</button>
          <button class="drawer-seg-btn" data-mode="netlist">Netlist</button>
        </div>
      </div>

      <div class="drawer-section">
        <div class="drawer-section-title">Layout</div>
        <div class="drawer-seg" id="layout-btns">
          <button class="drawer-seg-btn active" data-layout="bom-only">BOM Only</button>
          <button class="drawer-seg-btn" data-layout="lr">Left-Right</button>
          <button class="drawer-seg-btn" data-layout="tb">Top-Bottom</button>
        </div>
      </div>

      <div class="drawer-section">
        <div class="drawer-section-title">Assembly checkboxes</div>
        <input class="cbx-input" id="cbx-input" type="text" placeholder="Placed, Sourced, Inspected…" autocomplete="off"/>
        <div class="cbx-input-hint">Comma-separated names. Shown as rings per row.</div>
      </div>

      <div class="drawer-section" id="mark-section">
        <div class="drawer-section-title">Mark board when checked</div>
        <select class="mark-select" id="mark-select"><option value="">None</option></select>
      </div>

      <div class="drawer-section" id="col-section">
        <div class="drawer-section-title">Visible columns</div>
        <div id="col-toggles" style="display:flex;flex-direction:column;gap:8px;"></div>
      </div>

    </div>
  </div>

  <!-- ── BOM pane ── -->
  <div class="bom-pane" id="bom-pane">

    <!-- Toolbar -->
    <div class="toolbar">

      <!-- Omni-search -->
      <div class="omni-wrap">
        <button class="omni-mode-pill" id="omni-mode" title="Click to toggle: search all fields / jump to exact ref">search</button>
        <span class="omni-icon">
          <svg width="12" height="12" viewBox="0 0 12 12" fill="none">
            <circle cx="5" cy="5" r="3.5" stroke="currentColor" stroke-width="1.3"/>
            <path d="M8 8l2.5 2.5" stroke="currentColor" stroke-width="1.3" stroke-linecap="round"/>
          </svg>
        </span>
        <input class="omni" id="omni" type="text" placeholder="Search parts, values, refs…" autocomplete="off" spellcheck="false"/>
        <button class="omni-clear" id="omni-clear" aria-label="Clear search">×</button>
      </div>

      <!-- Layer segmented control -->
      <div class="layer-seg">
        <button class="lseg-btn active" data-lfilter="all">All</button>
        <button class="lseg-btn" data-lfilter="front">Front</button>
        <button class="lseg-btn" data-lfilter="back">Back</button>
      </div>

      <!-- Type filter dropdown -->
      <div class="type-wrap">
        <button class="type-btn" id="type-btn">
          <span id="type-btn-label">Type</span>
          <svg width="10" height="10" viewBox="0 0 10 10" fill="none">
            <path d="M2 3.5l3 3 3-3" stroke="currentColor" stroke-width="1.3" stroke-linecap="round" stroke-linejoin="round"/>
          </svg>
        </button>
        <div class="type-menu" id="type-menu" hidden>
          <button class="type-menu-item" data-tfilter="all">
            <svg class="check" width="12" height="12" viewBox="0 0 12 12" fill="none"><path d="M2 6l3 3 5-5" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"/></svg>
            All types
          </button>
          <button class="type-menu-item" data-tfilter="smd">
            <svg class="check" width="12" height="12" viewBox="0 0 12 12" fill="none"><path d="M2 6l3 3 5-5" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"/></svg>
            SMD only
          </button>
          <button class="type-menu-item" data-tfilter="tht">
            <svg class="check" width="12" height="12" viewBox="0 0 12 12" fill="none"><path d="M2 6l3 3 5-5" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"/></svg>
            THT only
          </button>
          <button class="type-menu-item" data-tfilter="dnp">
            <svg class="check" width="12" height="12" viewBox="0 0 12 12" fill="none"><path d="M2 6l3 3 5-5" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"/></svg>
            DNP only
          </button>
        </div>
      </div>

      <div class="toolbar-sep"></div>

      <!-- Stats strip -->
      <div class="stat-strip" id="stat-strip">
        <span class="stat-num" id="stat-total">0</span>
        <span>parts</span>
        <span class="stat-sep">·</span>
        <span class="stat-num" id="stat-groups">0</span>
        <span>groups</span>
        <span class="stat-sep">·</span>
        <span class="stat-num" id="stat-unique">0</span>
        <span>unique</span>
        <span class="stat-side" id="stat-side"></span>
      </div>

      <!-- Export dropdown -->
      <div class="export-wrap">
        <button class="export-btn" id="export-btn">
          <svg width="11" height="11" viewBox="0 0 12 12" fill="none">
            <path d="M6 1v7M3 5l3 3 3-3" stroke="currentColor" stroke-width="1.3" stroke-linecap="round" stroke-linejoin="round"/>
            <path d="M1 10h10" stroke="currentColor" stroke-width="1.3" stroke-linecap="round"/>
          </svg>
          Export
          <svg width="10" height="10" viewBox="0 0 10 10" fill="none">
            <path d="M2 3.5l3 3 3-3" stroke="currentColor" stroke-width="1.3" stroke-linecap="round" stroke-linejoin="round"/>
          </svg>
        </button>
        <div class="export-menu" id="export-menu" hidden>
          <button class="export-menu-item" data-fmt="csv">
            Copy as CSV <span class="export-badge">.csv</span>
          </button>
          <button class="export-menu-item" data-fmt="tsv">
            Copy as TSV <span class="export-badge">.tsv</span>
          </button>
          <button class="export-menu-item" data-fmt="json">
            Copy as JSON <span class="export-badge">.json</span>
          </button>
        </div>
      </div>

      <!-- Settings gear -->
      <button class="settings-btn" id="btn-settings" aria-label="View settings" title="View settings">
        <svg width="14" height="14" viewBox="0 0 14 14" fill="none">
          <circle cx="7" cy="7" r="2.2" stroke="currentColor" stroke-width="1.3"/>
          <path d="M7 1.5v1.2M7 11.3v1.2M1.5 7h1.2M11.3 7h1.2M3.1 3.1l.85.85M10.05 10.05l.85.85M3.1 10.9l.85-.85M10.05 3.95l.85-.85" stroke="currentColor" stroke-width="1.2" stroke-linecap="round"/>
        </svg>
      </button>
    </div>

    <!-- Progress bars (auto-shows when checkboxes configured) -->
    <div class="progress-section" id="progress-section" hidden></div>

    <!-- Table -->
    <div class="table-wrap" id="table-wrap" tabindex="0"></div>

    <!-- Keyboard hint (auto-shows when checkboxes configured) -->
    <div class="kbd-bar" id="kbd-hint" hidden>
      <span class="kbd-item"><kbd>↑</kbd><kbd>↓</kbd> Navigate</span>
      <span class="kbd-item"><kbd>n</kbd> Mark as placed</span>
      <span class="kbd-item"><kbd>1–9</kbd> Toggle checkbox</span>
    </div>
  </div>

  <!-- Resize handle -->
  <div class="resize-handle" id="resize-handle" hidden></div>

  <!-- Canvas pane -->
  <div class="canvas-pane" id="canvas-pane" hidden>
    <div class="canvas-toolbar">
      <div class="layer-seg" id="canvas-layout-btns" style="background:var(--km-bg-surface)">
        <button class="lseg-btn" data-cl="F">Front</button>
        <button class="lseg-btn active" data-cl="FB">Both</button>
        <button class="lseg-btn" data-cl="B">Back</button>
      </div>
      <span class="canvas-hint">Scroll: zoom · Drag: pan · Double-click: reset</span>
    </div>
    <div class="canvas-area cl-FB" id="canvas-area">
      <div class="canvas-front-wrap">
        <span class="canvas-side-label">Front</span>
        <canvas id="canvas-front"></canvas>
      </div>
      <div class="canvas-back-wrap">
        <span class="canvas-side-label">Back (mirrored)</span>
        <canvas id="canvas-back"></canvas>
      </div>
    </div>
  </div>

</div>
`;

// ── Component ─────────────────────────────────────────────────────────────────

export class BomTable extends HTMLElement {
  constructor() {
    super();
    this.attachShadow({ mode: 'open' });
    this.shadowRoot.appendChild(TEMPLATE.content.cloneNode(true));

    // Omni-search replaces separate _query + _reflookup
    this._omniValue      = '';
    this._omniMode       = 'search'; // 'search' | 'ref'

    this._layerFilter    = 'all';    // all | front | back
    this._typeFilter     = 'all';    // all | smd | tht | dnp

    this._sortKey        = 'refs';
    this._sortAsc        = true;
    this._selectedIdx    = -1;
    this._mode           = 'grouped';
    this._layout         = 'bom-only';
    this._canvasLayout   = 'FB';
    this._checkboxNames  = [];
    this._markWhenChecked = '';
    this._hiddenColumns  = new Set();
    this._cbxRefs        = {};
    this._drawerOpen     = false;
    this._exportMenuOpen = false;
    this._typeMenuOpen   = false;
    this._sortedRows     = [];
    this._dynFields      = [];
    this._canvasFront    = null;
    this._canvasBack     = null;
    this._resizeDrag     = null;
    this._unsubs         = [];

    this._applyPersistedSettings(_loadSettings());
  }

  _applyPersistedSettings(s) {
    if (['grouped','ungrouped','netlist'].includes(s.mode))          this._mode = s.mode;
    if (['bom-only','lr','tb'].includes(s.layout))                   this._layout = s.layout;
    if (['F','FB','B'].includes(s.canvasLayout))                     this._canvasLayout = s.canvasLayout;
    if (['all','front','back'].includes(s.layerFilter))              this._layerFilter = s.layerFilter;
    if (['all','smd','tht','dnp'].includes(s.typeFilter))            this._typeFilter = s.typeFilter;
    if (s.sortKey)                                                   this._sortKey = s.sortKey;
    if (s.sortAsc !== undefined)                                     this._sortAsc = !!s.sortAsc;
    if (Array.isArray(s.checkboxNames))                              this._checkboxNames = s.checkboxNames;
    if (typeof s.markWhenChecked === 'string')                       this._markWhenChecked = s.markWhenChecked;
    if (Array.isArray(s.hiddenColumns))                              this._hiddenColumns = new Set(s.hiddenColumns);
    this._reloadAllCbxRefs();
  }

  _persist() {
    _saveSettings({
      mode: this._mode, layout: this._layout, canvasLayout: this._canvasLayout,
      layerFilter: this._layerFilter, typeFilter: this._typeFilter,
      sortKey: this._sortKey, sortAsc: this._sortAsc,
      checkboxNames: this._checkboxNames, markWhenChecked: this._markWhenChecked,
      hiddenColumns: [...this._hiddenColumns],
    });
  }

  _reloadAllCbxRefs() {
    this._cbxRefs = {};
    for (const n of this._checkboxNames) this._cbxRefs[n] = _loadCbxRefs(n);
  }

  connectedCallback() {
    const sr = this.shadowRoot;

    // Omni-search
    const omniEl   = sr.getElementById('omni');
    const clearBtn = sr.getElementById('omni-clear');
    const modeBtn  = sr.getElementById('omni-mode');

    omniEl.addEventListener('input', e => {
      this._omniValue = e.target.value;
      clearBtn.hidden = !this._omniValue;
      this._render();
    });
    clearBtn.addEventListener('click', () => {
      omniEl.value = '';
      this._omniValue = '';
      clearBtn.hidden = true;
      omniEl.focus();
      this._render();
    });
    modeBtn.addEventListener('click', () => {
      this._omniMode = this._omniMode === 'search' ? 'ref' : 'search';
      modeBtn.textContent  = this._omniMode;
      modeBtn.classList.toggle('ref-mode', this._omniMode === 'ref');
      omniEl.placeholder   = this._omniMode === 'ref' ? 'Jump to exact ref… (e.g. C11)' : 'Search parts, values, refs…';
      omniEl.focus();
      this._render();
    });

    // Layer segmented control
    sr.querySelectorAll('.lseg-btn[data-lfilter]').forEach(btn => {
      btn.classList.toggle('active', btn.dataset.lfilter === this._layerFilter);
      btn.addEventListener('click', () => {
        this._layerFilter = btn.dataset.lfilter;
        sr.querySelectorAll('.lseg-btn[data-lfilter]').forEach(b => b.classList.toggle('active', b === btn));
        this._persist();
        this._render();
      });
    });

    // Type filter dropdown
    const typeBtn  = sr.getElementById('type-btn');
    const typeMenu = sr.getElementById('type-menu');
    typeBtn.addEventListener('click', e => {
      e.stopPropagation();
      this._typeMenuOpen = !this._typeMenuOpen;
      typeMenu.hidden  = !this._typeMenuOpen;
      typeBtn.classList.toggle('open', this._typeMenuOpen);
    });
    sr.querySelectorAll('.type-menu-item').forEach(item => {
      item.addEventListener('click', () => {
        this._typeFilter = item.dataset.tfilter;
        this._updateTypeBtn();
        typeMenu.hidden  = true;
        typeBtn.classList.remove('open');
        this._typeMenuOpen = false;
        this._persist();
        this._render();
      });
    });
    this._updateTypeBtn();

    // Export dropdown
    const exportBtn  = sr.getElementById('export-btn');
    const exportMenu = sr.getElementById('export-menu');
    exportBtn.addEventListener('click', e => {
      e.stopPropagation();
      this._exportMenuOpen = !this._exportMenuOpen;
      exportMenu.hidden = !this._exportMenuOpen;
      exportBtn.classList.toggle('open', this._exportMenuOpen);
    });
    sr.querySelectorAll('.export-menu-item').forEach(item => {
      item.addEventListener('click', () => {
        this._export(item.dataset.fmt);
        exportMenu.hidden = true;
        exportBtn.classList.remove('open');
        this._exportMenuOpen = false;
      });
    });

    // Close dropdowns on outside click
    this._onDocClick = () => {
      if (this._exportMenuOpen) { exportMenu.hidden = true; exportBtn.classList.remove('open'); this._exportMenuOpen = false; }
      if (this._typeMenuOpen)   { typeMenu.hidden   = true; typeBtn.classList.remove('open');   this._typeMenuOpen   = false; }
    };
    document.addEventListener('click', this._onDocClick);

    // Settings drawer
    sr.getElementById('btn-settings').addEventListener('click', () => this._openDrawer());
    sr.getElementById('drawer-close').addEventListener('click', () => this._closeDrawer());
    sr.getElementById('drawer-backdrop').addEventListener('click', () => this._closeDrawer());

    // Mode buttons (in drawer)
    sr.querySelectorAll('#mode-btns .drawer-seg-btn').forEach(btn => {
      btn.classList.toggle('active', btn.dataset.mode === this._mode);
      btn.addEventListener('click', () => {
        this._mode = btn.dataset.mode;
        sr.querySelectorAll('#mode-btns .drawer-seg-btn').forEach(b => b.classList.toggle('active', b === btn));
        this._persist();
        this._render();
      });
    });

    // Layout buttons (in drawer)
    sr.querySelectorAll('#layout-btns .drawer-seg-btn').forEach(btn => {
      btn.classList.toggle('active', btn.dataset.layout === this._layout);
      btn.addEventListener('click', () => this._setLayout(btn.dataset.layout));
    });

    // Canvas layout buttons
    sr.querySelectorAll('#canvas-layout-btns .lseg-btn').forEach(btn => {
      btn.classList.toggle('active', btn.dataset.cl === this._canvasLayout);
      btn.addEventListener('click', () => {
        this._canvasLayout = btn.dataset.cl;
        sr.querySelectorAll('#canvas-layout-btns .lseg-btn').forEach(b => b.classList.toggle('active', b === btn));
        sr.getElementById('canvas-area').className = `canvas-area cl-${this._canvasLayout}`;
        this._persist();
        this._refreshCanvases();
      });
    });

    // Checkbox names input (in drawer)
    const cbxInput = sr.getElementById('cbx-input');
    cbxInput.value = this._checkboxNames.join(', ');
    cbxInput.addEventListener('change', () => {
      this._checkboxNames = cbxInput.value.split(',').map(s => s.trim()).filter(Boolean);
      this._reloadAllCbxRefs();
      this._persist();
      this._updateMarkSelect();
      this._updateColToggles();
      this._render();
    });

    this._updateMarkSelect();
    sr.getElementById('mark-select').addEventListener('change', e => {
      this._markWhenChecked = e.target.value;
      this._persist();
      this._refreshCanvases();
    });

    this._updateColToggles();

    // Resize handle
    const handle = sr.getElementById('resize-handle');
    handle.addEventListener('mousedown', e => {
      e.preventDefault();
      this._resizeDrag = true;
      handle.classList.add('dragging');
    });
    this._onMouseMove = e => {
      if (!this._resizeDrag) return;
      const hostRect = this.getBoundingClientRect();
      const bomPane  = sr.getElementById('bom-pane');
      if (this._layout === 'lr') {
        const w = Math.max(180, Math.min(this.clientWidth - 180, e.clientX - hostRect.left));
        bomPane.style.flex = `0 0 ${w}px`;
      } else {
        const h = Math.max(100, Math.min(this.clientHeight - 100, e.clientY - hostRect.top));
        bomPane.style.flex = `0 0 ${h}px`;
      }
      this._refreshCanvases();
    };
    this._onMouseUp = () => {
      if (this._resizeDrag) { this._resizeDrag = false; handle.classList.remove('dragging'); }
    };
    document.addEventListener('mousemove', this._onMouseMove);
    document.addEventListener('mouseup',   this._onMouseUp);

    // Keyboard nav
    sr.getElementById('table-wrap').addEventListener('keydown', e => this._handleKey(e));

    // Canvas init
    this._canvasFront = new PlacementCanvas(sr.getElementById('canvas-front'), 'F');
    this._canvasBack  = new PlacementCanvas(sr.getElementById('canvas-back'),  'B');
    this._canvasFront.onClickRef = ref => this._onCanvasClick(ref);
    this._canvasBack.onClickRef  = ref => this._onCanvasClick(ref);

    if (typeof ResizeObserver !== 'undefined') {
      this._ro = new ResizeObserver(() => this._refreshCanvases());
      this._ro.observe(sr.getElementById('canvas-pane'));
    }

    this._unsubs.push(
      subscribe('boardComponents', () => this._render()),
      subscribe('boardNets',       () => this._render()),
      subscribe('bridgeConnected', () => this._render()),
    );

    this._applyLayout();
    this._render();
  }

  disconnectedCallback() {
    for (const u of this._unsubs) u();
    this._unsubs = [];
    if (this._ro) this._ro.disconnect();
    document.removeEventListener('mousemove', this._onMouseMove);
    document.removeEventListener('mouseup',   this._onMouseUp);
    document.removeEventListener('click',     this._onDocClick);
  }

  // ── Drawer ────────────────────────────────────────────────────────────────────

  _openDrawer() {
    const sr = this.shadowRoot;
    this._drawerOpen = true;
    sr.getElementById('drawer-backdrop').classList.add('visible');
    sr.getElementById('drawer-panel').classList.add('visible');
    sr.getElementById('btn-settings').classList.add('active');
  }

  _closeDrawer() {
    const sr = this.shadowRoot;
    this._drawerOpen = false;
    sr.getElementById('drawer-backdrop').classList.remove('visible');
    sr.getElementById('drawer-panel').classList.remove('visible');
    sr.getElementById('btn-settings').classList.remove('active');
  }

  // ── Type button label ─────────────────────────────────────────────────────────

  _updateTypeBtn() {
    const sr  = this.shadowRoot;
    const btn = sr.getElementById('type-btn');
    const lbl = sr.getElementById('type-btn-label');
    const labelMap = { all: 'Type', smd: 'SMD', tht: 'THT', dnp: 'DNP' };
    lbl.textContent = labelMap[this._typeFilter] ?? 'Type';
    btn.classList.toggle('has-filter', this._typeFilter !== 'all');

    sr.querySelectorAll('.type-menu-item').forEach(item => {
      item.classList.toggle('active', item.dataset.tfilter === this._typeFilter);
    });
  }

  // ── Layout ────────────────────────────────────────────────────────────────────

  _setLayout(layout) {
    this._layout = layout;
    const sr = this.shadowRoot;
    sr.querySelectorAll('#layout-btns .drawer-seg-btn').forEach(b => b.classList.toggle('active', b.dataset.layout === layout));
    sr.getElementById('bom-pane').style.flex = '';
    this._persist();
    this._applyLayout();
    this._render();
  }

  _applyLayout() {
    const sr = this.shadowRoot;
    sr.getElementById('root').className = `bom-root layout-${this._layout}`;
    const canvasPane = sr.getElementById('canvas-pane');
    const handle     = sr.getElementById('resize-handle');

    if (this._layout === 'bom-only') {
      canvasPane.hidden = true;
      handle.hidden     = true;
    } else {
      canvasPane.hidden = false;
      handle.hidden     = false;
      setTimeout(() => this._refreshCanvases(), 80);
    }
  }

  // ── Canvas ────────────────────────────────────────────────────────────────────

  _refreshCanvases() {
    if (this._layout === 'bom-only') return;
    const sr = this.shadowRoot;
    const frontWrap = sr.querySelector('.canvas-front-wrap');
    const backWrap  = sr.querySelector('.canvas-back-wrap');
    const allComps  = store.boardComponents ?? [];
    const hiRefs    = this._getHighlightedRefs();
    const mkRefs    = this._markWhenChecked ? (this._cbxRefs[this._markWhenChecked] ?? new Set()) : new Set();

    if (this._canvasFront && frontWrap) {
      const w = frontWrap.clientWidth, h = frontWrap.clientHeight;
      if (w > 0 && h > 0) this._canvasFront.resize(w, h);
      this._canvasFront.update(allComps.filter(c => !c.on_back), hiRefs, mkRefs);
    }
    if (this._canvasBack && backWrap) {
      const w = backWrap.clientWidth, h = backWrap.clientHeight;
      if (w > 0 && h > 0) this._canvasBack.resize(w, h);
      this._canvasBack.update(allComps.filter(c => c.on_back), hiRefs, mkRefs);
    }
  }

  _getHighlightedRefs() {
    const row = this._sortedRows[this._selectedIdx];
    if (!row || this._mode === 'netlist') return new Set();
    return new Set(row.refs ?? [row.ref]);
  }

  _onCanvasClick(ref) {
    for (let i = 0; i < this._sortedRows.length; i++) {
      const r = this._sortedRows[i];
      if ((r.refs ?? [r.ref]).includes(ref)) { this._selectRow(i); break; }
    }
  }

  // ── BOM building ──────────────────────────────────────────────────────────────

  _buildGrouped(components) {
    const groups = new Map();
    for (const c of components) {
      const val = c.value || '?', fp = c.footprint || '?';
      const key = `${val}||${fp}`;
      if (!groups.has(key)) {
        const pkg = fp.includes(':') ? fp.split(':').pop() : fp;
        groups.set(key, { value: val, footprint: fp, package: pkg, refs: [], qty: 0, sides: new Set(), hasDnp: false, isSmd: _isSmd(fp), fields: {} });
      }
      const g = groups.get(key);
      g.refs.push(c.ref); g.qty++;
      g.sides.add(c.on_back ? 'back' : 'front');
      if (c.dnp) g.hasDnp = true;
      if (c.fields) for (const [k, v] of Object.entries(c.fields)) {
        if (!g.fields[k]) g.fields[k] = new Set();
        g.fields[k].add(String(v));
      }
    }
    for (const g of groups.values()) {
      g.refs.sort(_naturalSort);
      for (const k of Object.keys(g.fields)) g.fields[k] = [...g.fields[k]].join(', ');
    }
    return [...groups.values()];
  }

  _buildUngrouped(components) {
    return components.map(c => ({
      ref: c.ref, value: c.value || '?', footprint: c.footprint || '?',
      package: (c.footprint || '').includes(':') ? c.footprint.split(':').pop() : (c.footprint || '?'),
      qty: 1, refs: [c.ref], sides: new Set([c.on_back ? 'back' : 'front']),
      hasDnp: !!c.dnp, dnp: !!c.dnp, isSmd: _isSmd(c.footprint || ''), fields: c.fields || {},
    }));
  }

  _applyFilters(rows) {
    const q = this._omniValue.toLowerCase();
    return rows.filter(r => {
      // Text search (omni mode: search)
      if (q && this._omniMode === 'search') {
        const refs = r.refs ?? [r.ref];
        const fieldVals = Object.values(r.fields ?? {}).join(' ');
        const hay = `${r.value} ${r.footprint} ${refs.join(' ')} ${fieldVals}`.toLowerCase();
        if (!hay.includes(q)) return false;
      }
      // Layer filter
      switch (this._layerFilter) {
        case 'front': if (!(r.sides.has('front') && !r.sides.has('back'))) return false; break;
        case 'back':  if (!(r.sides.has('back')  && !r.sides.has('front'))) return false; break;
      }
      // Type filter
      switch (this._typeFilter) {
        case 'smd': if (!r.isSmd) return false; break;
        case 'tht': if (r.isSmd)  return false; break;
        case 'dnp': if (!(r.hasDnp || r.dnp)) return false; break;
      }
      return true;
    });
  }

  _applySort(rows) {
    const k = this._sortKey, d = this._sortAsc ? 1 : -1;
    return [...rows].sort((a, b) => {
      if (k === 'qty') return (a.qty - b.qty) * d;
      let av, bv;
      if      (k === 'value')   { av = a.value.toLowerCase();   bv = b.value.toLowerCase(); }
      else if (k === 'package') { av = a.package.toLowerCase(); bv = b.package.toLowerCase(); }
      else { av = (a.refs?.[0] ?? a.ref ?? '').toLowerCase(); bv = (b.refs?.[0] ?? b.ref ?? '').toLowerCase(); }
      return av < bv ? -d : av > bv ? d : 0;
    });
  }

  // ── Render ────────────────────────────────────────────────────────────────────

  _render() {
    const sr    = this.shadowRoot;
    const wrap  = sr.getElementById('table-wrap');
    const comps = store.boardComponents ?? [];
    const nets  = store.boardNets ?? [];

    const nf = _uniqueFields(comps);
    if (nf.join(',') !== this._dynFields.join(',')) {
      this._dynFields = nf;
      this._updateColToggles();
    }

    const nFront = comps.filter(c => !c.on_back).length;
    const nBack  = comps.filter(c =>  c.on_back).length;
    sr.getElementById('stat-side').textContent = comps.length ? `(${nFront}F · ${nBack}B)` : '';

    if (!store.bridgeConnected) {
      this._zeroStats();
      wrap.innerHTML = `<div class="empty">
        <km-icon name="bom" size="xl" class="empty-icon"></km-icon>
        <span class="empty-text">Connect to KiCad to view the BOM</span>
        <span class="empty-hint">Start KiCad with the bridge plugin active, then connect from the sidebar.</span>
      </div>`;
      return;
    }

    if (this._mode === 'netlist') { this._renderNetlist(nets); return; }

    if (!comps.length) {
      this._zeroStats();
      wrap.innerHTML = `<div class="empty">
        <km-icon name="bom" size="xl" class="empty-icon"></km-icon>
        <span class="empty-text">No components on this board</span>
      </div>`;
      return;
    }

    const allRows  = this._mode === 'ungrouped' ? this._buildUngrouped(comps) : this._buildGrouped(comps);
    const filtered = this._applyFilters(allRows);
    const sorted   = this._applySort(filtered);
    this._sortedRows = sorted;

    // Ref-jump: auto-select
    if (this._omniMode === 'ref' && this._omniValue) {
      const q   = this._omniValue.toLowerCase().trim();
      const idx = sorted.findIndex(r => (r.refs ?? [r.ref]).some(ref => ref.toLowerCase() === q));
      if (idx >= 0) this._selectedIdx = idx;
    }

    const totalParts = sorted.reduce((s, r) => s + r.qty, 0);
    const uniqueVals = new Set(sorted.map(r => r.value)).size;
    sr.getElementById('stat-groups').textContent = String(sorted.length);
    sr.getElementById('stat-total').textContent  = String(totalParts);
    sr.getElementById('stat-unique').textContent = String(uniqueVals);

    const showQty = this._mode !== 'ungrouped' && !this._hiddenColumns.has('qty');
    const sc = {
      qty:       showQty,
      refs:      !this._hiddenColumns.has('refs'),
      value:     !this._hiddenColumns.has('value'),
      package:   !this._hiddenColumns.has('package'),
      footprint: !this._hiddenColumns.has('footprint'),
      side:      !this._hiddenColumns.has('side'),
    };
    const fieldCols = this._dynFields.filter(f => !this._hiddenColumns.has(f));

    // Header
    let hdr = this._checkboxNames.map((n, i) =>
      `<th class="cbx-th" data-cbx="${esc(n)}" title="Toggle all: ${esc(n)}" style="cursor:pointer">${esc(n)}</th>`
    ).join('');
    if (sc.qty)       hdr += this._th('qty',     'Qty', true, true);
    if (sc.refs)      hdr += this._th('refs',    this._mode === 'ungrouped' ? 'Ref' : 'References');
    if (sc.value)     hdr += this._th('value',   'Value');
    if (sc.package)   hdr += this._th('package', 'Package');
    if (sc.footprint) hdr += '<th>Footprint</th>';
    if (sc.side)      hdr += '<th>Side</th>';
    fieldCols.forEach(f => { hdr += `<th title="${esc(f)}">${esc(f)}</th>`; });

    const tbody = sorted.map((row, i) => this._buildRow(row, i, sc, fieldCols)).join('');
    wrap.innerHTML = `<table><thead><tr>${hdr}</tr></thead><tbody>${tbody}</tbody></table>`;

    // Fix indeterminate states
    wrap.querySelectorAll('input[data-indet]').forEach(inp => { inp.indeterminate = true; });

    // Restore selection
    if (this._selectedIdx >= 0) {
      const selTr = wrap.querySelector(`tr[data-idx="${this._selectedIdx}"]`);
      if (selTr) selTr.classList.add('selected');
    }

    // Sort header handlers
    wrap.querySelectorAll('th[data-sort]').forEach(th => {
      th.addEventListener('click', () => {
        if (this._sortKey === th.dataset.sort) this._sortAsc = !this._sortAsc;
        else { this._sortKey = th.dataset.sort; this._sortAsc = true; }
        this._persist();
        this._render();
      });
    });

    // Checkbox "toggle all" header
    wrap.querySelectorAll('th[data-cbx]').forEach(th => {
      th.addEventListener('click', () => {
        const name    = th.dataset.cbx;
        const allRefs = sorted.flatMap(r => r.refs ?? [r.ref]);
        const stored  = this._cbxRefs[name] ?? new Set();
        const allOn   = allRefs.every(r => stored.has(r));
        if (allOn) allRefs.forEach(r => stored.delete(r));
        else       allRefs.forEach(r => stored.add(r));
        this._cbxRefs[name] = stored;
        _saveCbxRefs(name, stored);
        this._render();
      });
    });

    // Row click
    wrap.querySelectorAll('tr[data-idx]').forEach(tr => {
      tr.addEventListener('click', e => {
        if (e.target.tagName === 'INPUT') return;
        this._selectRow(parseInt(tr.dataset.idx, 10));
      });
    });

    // Checkbox change
    wrap.querySelectorAll('input[data-cbx-name]').forEach(inp => {
      inp.addEventListener('change', () => {
        const name   = inp.dataset.cbxName;
        const refs   = inp.dataset.refs.split(',');
        const stored = this._cbxRefs[name] ?? new Set();
        if (inp.checked) refs.forEach(r => stored.add(r));
        else             refs.forEach(r => stored.delete(r));
        inp.indeterminate = false;
        this._cbxRefs[name] = stored;
        _saveCbxRefs(name, stored);
        this._updateProgress();
        this._refreshCanvases();
        const tr = inp.closest('tr');
        if (tr) tr.classList.toggle('row-marked', this._isRowMarked(refs));
      });
    });

    sr.getElementById('kbd-hint').hidden = !this._checkboxNames.length;
    this._updateProgress();
    this._refreshCanvases();
  }

  _renderNetlist(nets) {
    const sr   = this.shadowRoot;
    const wrap = sr.getElementById('table-wrap');
    const q    = this._omniMode === 'search' ? this._omniValue.toLowerCase() : '';

    const filtered = nets.filter(n => !q || n.toLowerCase().includes(q));
    const sorted   = [...filtered].sort(_naturalSort);
    this._sortedRows = sorted.map(n => ({ netname: n }));

    sr.getElementById('stat-groups').textContent = String(sorted.length);
    sr.getElementById('stat-total').textContent  = String(sorted.length);
    sr.getElementById('stat-unique').textContent = '—';

    if (!sorted.length) {
      wrap.innerHTML = `<div class="empty"><span class="empty-text">No nets${q ? ' matching filter' : ''}.</span></div>`;
      return;
    }

    const rows = sorted.map((net, i) => {
      const sel = this._selectedIdx === i ? 'selected' : '';
      const hl  = _hlText(net, q);
      return `<tr data-idx="${i}" class="${sel}" style="cursor:pointer"><td class="net-name">${hl}</td></tr>`;
    }).join('');

    wrap.innerHTML = `<table>
      <thead><tr><th>Net Name</th></tr></thead>
      <tbody>${rows}</tbody>
    </table>`;

    wrap.querySelectorAll('tr[data-idx]').forEach(tr => {
      tr.addEventListener('click', () => {
        const net = sorted[parseInt(tr.dataset.idx, 10)];
        this._selectedIdx = parseInt(tr.dataset.idx, 10);
        wrap.querySelectorAll('tr[data-idx]').forEach(r => r.classList.toggle('selected', r === tr));
        highlightNet(net).catch(e => Logger.warn('BomTable', 'highlightNet failed', e));
      });
    });

    sr.getElementById('kbd-hint').hidden = true;
    this._updateProgress();
  }

  _buildRow(row, idx, sc, fieldCols) {
    const refs    = row.refs ?? [row.ref];
    const sel     = this._selectedIdx === idx ? 'selected' : '';
    const marked  = this._isRowMarked(refs) ? 'row-marked' : '';
    const shortFp = row.footprint.includes(':') ? row.footprint.split(':').pop() : row.footprint;
    const q       = this._omniMode === 'search' ? this._omniValue.toLowerCase() : '';

    let cells = '';

    // Checkbox rings
    for (let ci = 0; ci < this._checkboxNames.length; ci++) {
      const name    = this._checkboxNames[ci];
      const state   = this._cbxGetState(name, refs);
      const checked = state === 'checked' ? 'checked' : '';
      const indet   = state === 'indeterminate' ? 'data-indet' : '';
      cells += `<td class="cbx-td"><input type="checkbox" class="status-ring" data-cbx-idx="${ci + 1}" data-cbx-name="${esc(name)}" data-refs="${esc(refs.join(','))}" ${checked} ${indet} title="${esc(name)}"/></td>`;
    }

    if (sc.qty) cells += `<td class="qty">${row.qty}</td>`;

    if (sc.refs) {
      const MAX = 4;
      const shown  = refs.slice(0, MAX);
      const extra  = refs.length - MAX;
      const shownHl = shown.map(r => _hlText(r, q)).join(', ');
      const extraBadge = extra > 0
        ? `<span class="refs-more" title="${esc(refs.slice(MAX).join(', '))}">+${extra}</span>`
        : '';
      cells += `<td class="refs" title="${esc(refs.join(', '))}"><div class="refs-wrap">${shownHl}${extraBadge}</div></td>`;
    }

    if (sc.value) {
      const dnpBadge = (row.hasDnp || row.dnp) ? '<span class="badge badge-dnp">DNP</span>' : '';
      cells += `<td class="val">${_hlText(row.value, q)}${dnpBadge}</td>`;
    }
    if (sc.package)   cells += `<td class="fp" title="${esc(row.footprint)}">${esc(row.package)}</td>`;
    if (sc.footprint) cells += `<td class="fp" title="${esc(row.footprint)}">${esc(shortFp)}</td>`;
    if (sc.side)      cells += `<td class="side">${_sideBadge(row.sides)}</td>`;
    for (const f of fieldCols) {
      const v = row.fields?.[f] ?? '';
      cells += `<td class="field" title="${esc(String(v))}">${_hlText(String(v), q)}</td>`;
    }

    return `<tr data-idx="${idx}" class="${sel} ${marked}">${cells}</tr>`;
  }

  _th(key, label, sortable = true, isNum = false) {
    const active = this._sortKey === key;
    const arrow  = active ? (this._sortAsc ? ' ↑' : ' ↓') : '';
    const cls    = [active ? 'sorted' : '', isNum ? 'num' : ''].filter(Boolean).join(' ');
    if (!sortable) return `<th class="${cls}">${label}</th>`;
    return `<th data-sort="${key}" class="${cls}">${label}${arrow}</th>`;
  }

  _cbxGetState(name, refs) {
    const stored = this._cbxRefs[name] ?? new Set();
    const n = refs.filter(r => stored.has(r)).length;
    if (n === 0)           return 'unchecked';
    if (n === refs.length) return 'checked';
    return 'indeterminate';
  }

  _isRowMarked(refs) {
    if (!this._markWhenChecked) return false;
    const stored = this._cbxRefs[this._markWhenChecked] ?? new Set();
    return refs.length > 0 && refs.every(r => stored.has(r));
  }

  _selectRow(idx) {
    const sr   = this.shadowRoot;
    const wrap = sr.getElementById('table-wrap');
    this._selectedIdx = idx;
    wrap.querySelectorAll('tr[data-idx]').forEach(r =>
      r.classList.toggle('selected', r.dataset.idx === String(idx))
    );
    const row = this._sortedRows[idx];
    if (row && this._mode !== 'netlist') {
      for (const ref of (row.refs ?? [row.ref])) {
        highlightComponent(ref).catch(e => Logger.warn('BomTable', 'highlight failed', e));
      }
    }
    this._refreshCanvases();
  }

  // ── Progress bars ─────────────────────────────────────────────────────────────

  _updateProgress() {
    const sr      = this.shadowRoot;
    const section = sr.getElementById('progress-section');
    if (!this._checkboxNames.length) { section.hidden = true; return; }
    section.hidden = false;
    const total   = (store.boardComponents ?? []).length;
    section.innerHTML = this._checkboxNames.map(name => {
      const count = (this._cbxRefs[name] ?? new Set()).size;
      const pct   = total ? Math.round(count * 100 / total) : 0;
      return `<div class="pitem">
        <span class="plabel">${esc(name)}</span>
        <div class="pbar-track"><div class="pbar-fill" style="width:${pct}%"></div></div>
        <span class="pcount">${count}/${total} (${pct}%)</span>
      </div>`;
    }).join('');
  }

  // ── Settings helpers ──────────────────────────────────────────────────────────

  _updateMarkSelect() {
    const sel = this.shadowRoot.getElementById('mark-select');
    if (!sel) return;
    sel.innerHTML = '<option value="">None</option>'
      + this._checkboxNames.map(n => `<option value="${esc(n)}">${esc(n)}</option>`).join('');
    sel.value = this._markWhenChecked;
  }

  _updateColToggles() {
    const container = this.shadowRoot.getElementById('col-toggles');
    if (!container) return;
    const staticCols = ['qty', 'refs', 'value', 'package', 'footprint', 'side'];
    const allCols    = [...staticCols, ...this._dynFields];
    container.innerHTML = allCols.map(col => {
      const checked = !this._hiddenColumns.has(col);
      return `<div class="drawer-row">
        <span class="drawer-row-label">${esc(col.charAt(0).toUpperCase() + col.slice(1))}</span>
        <label class="toggle-switch">
          <input type="checkbox" data-col="${esc(col)}" ${checked ? 'checked' : ''}/>
          <span class="toggle-track"></span>
        </label>
      </div>`;
    }).join('');
    container.querySelectorAll('input').forEach(inp => {
      inp.addEventListener('change', () => {
        if (inp.checked) this._hiddenColumns.delete(inp.dataset.col);
        else             this._hiddenColumns.add(inp.dataset.col);
        this._persist();
        this._render();
      });
    });
  }

  _zeroStats() {
    const sr = this.shadowRoot;
    ['stat-groups','stat-total','stat-unique'].forEach(id => { sr.getElementById(id).textContent = '0'; });
    sr.getElementById('stat-side').textContent = '';
  }

  // ── Keyboard navigation ───────────────────────────────────────────────────────

  _handleKey(e) {
    const rows = this._sortedRows;
    if (!rows.length) return;

    if (e.key === 'ArrowDown') {
      e.preventDefault();
      const next = Math.min(this._selectedIdx + 1, rows.length - 1);
      this._selectRow(next);
      this._scrollToRow(next);
    } else if (e.key === 'ArrowUp') {
      e.preventDefault();
      const prev = Math.max(this._selectedIdx - 1, 0);
      this._selectRow(prev);
      this._scrollToRow(prev);
    } else if (e.key === 'n' && this._checkboxNames.length && this._mode !== 'netlist') {
      e.preventDefault();
      const row = rows[this._selectedIdx];
      if (!row) return;
      const refs   = row.refs ?? [row.ref];
      const name   = this._checkboxNames[0];
      const stored = this._cbxRefs[name] ?? new Set();
      const allOn  = refs.every(r => stored.has(r));
      if (allOn) refs.forEach(r => stored.delete(r));
      else       refs.forEach(r => stored.add(r));
      this._cbxRefs[name] = stored;
      _saveCbxRefs(name, stored);
      this._render();
      const next = Math.min(this._selectedIdx + 1, rows.length - 1);
      setTimeout(() => { this._selectRow(next); this._scrollToRow(next); }, 0);
    } else if (e.key >= '1' && e.key <= '9' && this._mode !== 'netlist') {
      const n = parseInt(e.key, 10) - 1;
      if (n >= this._checkboxNames.length) return;
      const row = rows[this._selectedIdx];
      if (!row) return;
      const refs   = row.refs ?? [row.ref];
      const name   = this._checkboxNames[n];
      const stored = this._cbxRefs[name] ?? new Set();
      const allOn  = refs.every(r => stored.has(r));
      if (allOn) refs.forEach(r => stored.delete(r));
      else       refs.forEach(r => stored.add(r));
      this._cbxRefs[name] = stored;
      _saveCbxRefs(name, stored);
      this._render();
    }
  }

  _scrollToRow(idx) {
    const tr = this.shadowRoot.getElementById('table-wrap').querySelector(`tr[data-idx="${idx}"]`);
    if (tr) tr.scrollIntoView({ block: 'nearest', behavior: 'smooth' });
  }

  // ── Export ────────────────────────────────────────────────────────────────────

  _export(fmt) {
    const comps = store.boardComponents ?? [];
    if (!comps.length) return;
    const allRows = this._mode === 'ungrouped' ? this._buildUngrouped(comps) : this._buildGrouped(comps);
    const sorted  = this._applySort(this._applyFilters(allRows));
    const fields  = this._dynFields;

    let text;
    if (fmt === 'json') {
      text = JSON.stringify(sorted.map(r => {
        const o = { qty: r.qty, refs: (r.refs ?? [r.ref]).join(', '), value: r.value, package: r.package, footprint: r.footprint, side: [...r.sides].join('+') };
        fields.forEach(f => { o[f] = r.fields?.[f] ?? ''; });
        return o;
      }), null, 2);
    } else {
      const sep = fmt === 'tsv' ? '\t' : ',';
      const q   = fmt === 'tsv' ? s => String(s) : s => `"${String(s).replace(/"/g, '""')}"`;
      const hdr = ['Qty','References','Value','Package','Footprint','Side',...fields].map(q).join(sep);
      const lines = sorted.map(r => {
        const base = [r.qty, (r.refs ?? [r.ref]).join(', '), r.value, r.package, r.footprint, [...r.sides].join('+')].map(q);
        return [...base, ...fields.map(f => q(r.fields?.[f] ?? ''))].join(sep);
      });
      text = [hdr, ...lines].join('\n');
    }

    const btn = this.shadowRoot.getElementById('export-btn');
    navigator.clipboard.writeText(text).then(() => {
      const orig = btn.innerHTML;
      btn.textContent = 'Copied!';
      setTimeout(() => { btn.innerHTML = orig; }, 1400);
    }).catch(e => Logger.warn('BomTable', 'clipboard failed', e));
  }
}

customElements.define('km-bom-table', BomTable);
