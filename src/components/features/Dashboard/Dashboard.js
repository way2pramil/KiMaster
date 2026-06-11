/**
 * @element km-dashboard
 * @summary Bento widget dashboard — premium Apple-style customisable grid.
 *
 *  Hero bar (always): brand · PCB animation · bridge status
 *  Bento grid:        user-arrangeable widgets, persisted in localStorage
 *  Edit mode:         drag to reorder, remove, add widgets, resize cols
 *
 * @fires km-nav — { route }
 */

import { Logger }           from '../../../core/Logger.js';
import { notify }           from '../../../core/Notify.js';
import { store, subscribe } from '../../../core/State.js';
import { KM_NAV }           from '../../../core/AppEvents.js';
import {
  initLayoutStore,
  getLayout,
  setLayout,
  moveWidget as moveWidgetInStore,
  resizeWidget as resizeWidgetInStore,
  hideWidget as hideWidgetInStore,
  showWidget as showWidgetInStore,
  resetLayout as resetLayoutInStore,
  toLegacyColSpan,
  toLegacyRowSpan,
} from './layout/LayoutStore.js';

// ── Widget imports (register all custom elements) ─────────────────────────────
import './widgets/WidgetProjectFiles.js';
import './widgets/WidgetRecentProjects.js';
import './widgets/WidgetBoardInfo.js';
import './widgets/WidgetNetlistGraph.js';
import './widgets/WidgetNotes.js';
import './widgets/WidgetBoardRender.js';
import './widgets/WidgetShortcuts.js';

// ── Widget registry ───────────────────────────────────────────────────────────

const WIDGETS = {
  'project-files':   { label:'Project files',   icon:'folder-tree', tag:'km-wgt-project-files',    defaultW: 3, defaultH: 2 },
  'recent-projects': { label:'Recent projects', icon:'clock',       tag:'km-wgt-recent-projects',  defaultW: 3, defaultH: 2 },
  'board-info':      { label:'Board info',      icon:'cpu',         tag:'km-wgt-board-info',       defaultW: 3, defaultH: 2 },
  'netlist-graph':   { label:'Netlist graph',   icon:'graph',       tag:'km-wgt-netlist-graph',    defaultW: 3, defaultH: 2 },
  'shortcuts':       { label:'Shortcuts',       icon:'grid',        tag:'km-wgt-shortcuts',        defaultW: 6, defaultH: 1 },
  'notes':           { label:'Notes',           icon:'notes',       tag:'km-wgt-notes',            defaultW: 3, defaultH: 1 },
  'board-render':    { label:'3D render',       icon:'render',      tag:'km-wgt-board-render',     defaultW: 3, defaultH: 2 },
};

const DEFAULT_LAYOUT = [
  { id: 'project-files', w: 3, h: 1 },
  { id: 'netlist-graph', w: 9, h: 1 },
  { id: 'board-info',    w: 6, h: 1 },
  { id: 'shortcuts',     w: 3, h: 1 },
  { id: 'notes',         w: 3, h: 1 },
];

// ── Template ──────────────────────────────────────────────────────────────────

const T = document.createElement('template');
T.innerHTML = /* html */`
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

  /* ── Scroll wrapper ───────────────────────────────────────────── */
  .dash-scroll {
    flex: 1; overflow-y: auto; overflow-x: hidden;
  }
  .dash-scroll::-webkit-scrollbar { width: 4px; }
  .dash-scroll::-webkit-scrollbar-thumb { background: var(--km-alpha-08); border-radius: 2px; }

  /* ── Hero bar ─────────────────────────────────────────────────── */
  .hero {
    display: flex; align-items: center; gap: 16px;
    padding: 12px 20px;
    background: var(--km-alpha-02);
    border-bottom: 1px solid var(--km-alpha-05);
    flex-shrink: 0;
    position: relative;
  }

  .hero-anim { width: 140px; height: 56px; flex-shrink: 0; }
  .hero-anim svg { width:100%; height:100%; }
  .trace-path { fill:none; stroke-width:2; stroke-linecap:round; stroke-linejoin:round; }
  .trace-path.t1 { stroke:var(--km-accent);  stroke-dasharray:40 200; animation:comet 3s linear infinite; }
  .trace-path.t2 { stroke:var(--km-live);    stroke-dasharray:30 200; animation:comet 3.5s linear infinite 0.6s; }
  .trace-path.t3 { stroke:var(--km-trace);   stroke-dasharray:25 200; animation:comet 4s linear infinite 1.2s; }
  .trace-glow    { fill:none; stroke-width:6; stroke-linecap:round; opacity:0.18; filter:blur(3px); }
  .trace-glow.t1 { stroke:var(--km-accent);  stroke-dasharray:40 200; animation:comet 3s linear infinite; }
  .trace-glow.t2 { stroke:var(--km-live);    stroke-dasharray:30 200; animation:comet 3.5s linear infinite 0.6s; }
  .trace-glow.t3 { stroke:var(--km-trace);   stroke-dasharray:25 200; animation:comet 4s linear infinite 1.2s; }
  .via-pad { fill:var(--km-bg-elevated); stroke:var(--km-accent); stroke-width:1.5; }
  .via-dot { fill:var(--km-accent); }
  @keyframes comet { 0%{stroke-dashoffset:240} 100%{stroke-dashoffset:0} }

  .hero-brand { display:flex; flex-direction:column; gap:2px; flex-shrink:0; }
  .hero-title {
    font-size: 18px; font-weight: 700; letter-spacing: -0.04em; line-height: 1;
    background: linear-gradient(135deg, var(--km-accent-hover) 0%, var(--km-live) 100%);
    -webkit-background-clip: text; -webkit-text-fill-color: transparent; background-clip: text;
  }
  .hero-version { font-size: 10px; color: var(--km-alpha-20); font-family: var(--km-font-mono); }

  .hero-sys {
    display: flex; flex-direction: column; justify-content: center; gap: 4px; flex-shrink: 0;
  }
  .hero-sys span {
    display: inline-flex; align-items: center; gap: 5px;
    font-size: 11px; color: var(--km-alpha-30); white-space: nowrap;
  }

  .hero-divider { width:1px; height:28px; background:var(--km-alpha-07); flex-shrink:0; }

  .hero-bridge {
    display: flex; align-items: center; gap: 10px; flex: 1; min-width: 0;
  }
  .bridge-dot {
    width: 7px; height: 7px; border-radius: 50%; flex-shrink: 0;
    background: var(--km-alpha-15); transition: background 0.3s, box-shadow 0.3s;
  }
  .bridge-dot.on {
    background: var(--km-live); box-shadow: 0 0 7px var(--km-live);
    animation: bdot 3s ease-in-out infinite;
  }
  @keyframes bdot { 0%,100%{box-shadow:0 0 4px var(--km-live)} 50%{box-shadow:0 0 12px var(--km-live)} }
  .bridge-status { font-size: 12px; font-weight: 500; flex-shrink: 0; }
  .bridge-sub {
    flex: 1; font-size: 10px; color: var(--km-alpha-25);
    font-family: var(--km-font-mono);
    overflow:hidden; text-overflow:ellipsis; white-space:nowrap; min-width:0;
  }
  .bridge-acts { display:flex; gap:8px; flex-shrink:0; }

  /* Hero right actions */
  .hero-right {
    display: flex; align-items: center; gap: 8px; flex-shrink: 0; margin-left: auto;
  }
  .icon-btn {
    background: none; border: none; padding: 6px; border-radius: 8px;
    color: var(--km-alpha-30); cursor: pointer;
    display: inline-flex; align-items: center;
    transition: color 0.15s, background 0.15s;
  }
  .icon-btn:hover { color: var(--km-alpha-70); background: var(--km-alpha-06); }
  .icon-btn.active { color: var(--km-accent-hover); background: rgba(37,99,235,0.12); }

  .btn {
    background: none; border: 1px solid var(--km-alpha-10);
    color: var(--km-alpha-50); padding: 5px 10px; border-radius: 7px;
    font-size: 11px; font-family: var(--km-font);
    cursor: pointer; display: inline-flex; align-items: center; gap: 5px;
    transition: all 0.15s;
  }
  .btn:hover { color: var(--km-alpha-85); border-color: var(--km-alpha-20); }
  .btn.primary { background:var(--km-accent); border-color:var(--km-accent); color:#fff; }
  .btn.primary:hover { background:var(--km-accent-hover); }
  .btn.danger:hover { border-color:rgba(239,68,68,0.5); color:var(--km-danger); }

  /* ── Edit mode banner ─────────────────────────────────────────── */
  .edit-banner {
    display: none; align-items: center; gap: 10px;
    padding: 8px 20px;
    background: rgba(37,99,235,0.08);
    border-bottom: 1px solid rgba(37,99,235,0.2);
    font-size: 11px; color: var(--km-alpha-45);
    flex-shrink: 0;
  }
  .edit-banner.visible { display: flex; }
  .edit-banner-dot {
    width: 6px; height: 6px; border-radius: 50%;
    background: var(--km-accent-hover); flex-shrink: 0;
    animation: bdot 1.5s ease-in-out infinite;
  }

  /* ── Bento grid ───────────────────────────────────────────────── */
  .grid-wrap { padding: 16px 20px 20px; }
  .grid {
    display: grid;
    grid-template-columns: repeat(4, 1fr);
    grid-auto-rows: minmax(220px, auto);
    gap: 14px;
  }

  /* ── Widget cell (card shell) ─────────────────────────────────── */
  .wgt-cell {
    /* Glassmorphic premium card */
    background: linear-gradient(145deg,
      var(--km-alpha-042) 0%,
      var(--km-alpha-018) 100%
    );
    border: 1px solid var(--km-alpha-075);
    border-top-color: var(--km-alpha-13);
    border-radius: 20px;
    box-shadow:
      0 1px 0 0 var(--km-alpha-055) inset,
      0 0 0 0.5px var(--km-shadow-inset),
      0 8px 32px var(--km-shadow-card),
      0 2px 8px var(--km-shadow-inset);
    overflow: hidden;
    position: relative;
    transition: transform 0.2s var(--km-ease-spring),
                box-shadow 0.2s,
                border-color 0.2s;
    animation: wgt-in 0.3s var(--km-ease) both;
  }
  .wgt-cell:hover {
    box-shadow:
      0 1px 0 0 var(--km-alpha-07) inset,
      0 0 0 0.5px var(--km-shadow-inset),
      0 12px 40px var(--km-shadow-card-strong),
      0 4px 12px var(--km-shadow-inset);
  }
  @keyframes wgt-in {
    from { opacity:0; transform:translateY(10px) scale(0.98); }
    to   { opacity:1; transform:translateY(0) scale(1); }
  }

  /* Stagger animation delays */
  .wgt-cell:nth-child(1) { animation-delay:0s; }
  .wgt-cell:nth-child(2) { animation-delay:0.05s; }
  .wgt-cell:nth-child(3) { animation-delay:0.1s; }
  .wgt-cell:nth-child(4) { animation-delay:0.12s; }
  .wgt-cell:nth-child(5) { animation-delay:0.15s; }
  .wgt-cell:nth-child(6) { animation-delay:0.18s; }
  .wgt-cell:nth-child(7) { animation-delay:0.2s; }

  /* ── Edit mode cell styles ────────────────────────────────────── */
  .wgt-cell.dragging   { opacity: 0.35; transform: scale(0.95); }
  .wgt-cell.drag-over  {
    border-color: var(--km-accent) !important;
    box-shadow: 0 0 0 2px rgba(37,99,235,0.4), 0 12px 40px rgba(37,99,235,0.18) !important;
  }

  /* ── Edit overlay — sits above Shadow DOM content (z-index 50) ── */
  .edit-overlay {
    /* Hidden by default; shown only in edit mode */
    display: none;
    position: absolute; inset: 0; z-index: 50;
    border-radius: 19px; /* 1px inside the card's 20px */
    background: rgba(0, 0, 0, 0.52);
    backdrop-filter: blur(3px);
    border: 2px solid rgba(37, 99, 235, 0.35);
    /* Flex column so handle sits at top, label in middle */
    flex-direction: column;
    align-items: center;
    justify-content: center;
    gap: 6px;
    cursor: grab;
    transition: border-color 0.15s, background 0.15s;
  }
  :host(.edit-mode) .edit-overlay { display: flex; }
  .edit-overlay:hover { border-color: var(--km-accent); background: var(--km-shadow-backdrop); }
  .edit-overlay:active { cursor: grabbing; }

  /* Grip dots (drag handle) */
  .edit-handle {
    display: flex; flex-direction: column; align-items: center; gap: 3px;
    pointer-events: none;
  }
  .grip-row {
    display: flex; gap: 3px;
  }
  .grip-dot {
    width: 4px; height: 4px; border-radius: 50%;
    background: var(--km-alpha-45);
  }

  /* Widget label in overlay */
  .edit-wgt-name {
    font-size: 11px; font-weight: 500; color: var(--km-alpha-45);
    pointer-events: none; letter-spacing: 0.02em;
  }

  /* Remove button — top-right of overlay */
  .cell-rm {
    position: absolute; top: 8px; right: 8px;
    width: 24px; height: 24px; border-radius: 50%;
    background: rgba(239,68,68,0.14); border: 1px solid rgba(239,68,68,0.32);
    color: var(--km-danger); font-size: 14px;
    display: flex; align-items: center; justify-content: center;
    cursor: pointer; padding: 0; line-height: 1;
    transition: background 0.12s, transform 0.1s;
  }
  .cell-rm:hover { background: rgba(239,68,68,0.32); transform: scale(1.1); }

  /* ── Resize handles — Excalidraw-style edge/corner drags ─────── */

  /* Right edge — drag to change column span */
  .resize-e {
    position: absolute; right: -1px; top: 15%; bottom: 15%; width: 12px;
    cursor: ew-resize; z-index: 5;
    display: flex; align-items: center; justify-content: center;
  }
  .resize-e-bar {
    width: 4px; height: 36px; border-radius: 2px;
    background: rgba(37,99,235,0.7);
    box-shadow: 0 0 8px rgba(37,99,235,0.5);
    transition: width 0.1s, background 0.1s;
    pointer-events: none;
  }
  .resize-e:hover .resize-e-bar { width: 5px; background: var(--km-accent-hover); }

  /* Bottom edge — drag to change row span */
  .resize-s {
    position: absolute; bottom: -1px; left: 15%; right: 15%; height: 12px;
    cursor: ns-resize; z-index: 5;
    display: flex; align-items: center; justify-content: center;
  }
  .resize-s-bar {
    height: 4px; width: 36px; border-radius: 2px;
    background: rgba(37,99,235,0.7);
    box-shadow: 0 0 8px rgba(37,99,235,0.5);
    transition: height 0.1s, background 0.1s;
    pointer-events: none;
  }
  .resize-s:hover .resize-s-bar { height: 5px; background: var(--km-accent-hover); }

  /* Corner — drag for both col + row */
  .resize-se {
    position: absolute; right: 0; bottom: 0;
    width: 22px; height: 22px;
    cursor: nwse-resize; z-index: 6;
    display: flex; align-items: flex-end; justify-content: flex-end;
    padding: 4px;
  }
  .resize-se-dot {
    width: 8px; height: 8px; border-radius: 50%;
    background: var(--km-accent);
    box-shadow: 0 0 8px rgba(37,99,235,0.6);
    pointer-events: none;
    transition: transform 0.1s;
  }
  .resize-se:hover .resize-se-dot { transform: scale(1.4); }

  /* Active resize — dim overlay so user sees card shape clearly */
  .edit-overlay.resizing {
    background: var(--km-shadow-card);
    backdrop-filter: blur(1px);
  }

  /* ── Add widget button ────────────────────────────────────────── */
  .add-cell {
    border: 1px dashed var(--km-alpha-08);
    border-radius: 20px;
    display: none; align-items: center; justify-content: center;
    cursor: pointer; color: var(--km-alpha-20); font-size: 28px;
    transition: all 0.15s; grid-column: span 2; min-height: 100px;
  }
  :host(.edit-mode) .add-cell { display: flex; }
  .add-cell:hover {
    border-color: rgba(37,99,235,0.35);
    color: var(--km-accent-hover);
    background: rgba(37,99,235,0.04);
  }

  /* ── Widget picker overlay ────────────────────────────────────── */
  .picker-backdrop {
    position: fixed; inset: 0; z-index: 200;
    background: var(--km-shadow-backdrop); backdrop-filter: blur(8px);
    display: flex; align-items: center; justify-content: center;
    opacity: 0; pointer-events: none; transition: opacity 0.2s;
  }
  .picker-backdrop.visible { opacity: 1; pointer-events: auto; }

  .picker-panel {
    background: var(--km-glass-bg);
    border: 1px solid var(--km-alpha-10);
    border-top-color: var(--km-alpha-18);
    border-radius: 24px;
    box-shadow: 0 40px 80px var(--km-shadow-card-strong), 0 0 0 0.5px var(--km-shadow-card-strong);
    width: 400px; overflow: hidden;
    transform: scale(0.94) translateY(12px);
    transition: transform 0.25s var(--km-ease-spring);
  }
  .picker-backdrop.visible .picker-panel {
    transform: scale(1) translateY(0);
  }
  .picker-hdr {
    display: flex; align-items: center; justify-content: space-between;
    padding: 18px 20px 12px;
    border-bottom: 1px solid var(--km-alpha-06);
  }
  .picker-title {
    font-size: 14px; font-weight: 600; color: var(--km-alpha-85);
  }
  .picker-close {
    background: none; border: none; padding: 4px; border-radius: 6px;
    color: var(--km-alpha-30); cursor: pointer;
    display: flex; align-items: center; transition: color 0.1s;
  }
  .picker-close:hover { color: var(--km-alpha-70); }
  .picker-grid {
    display: grid; grid-template-columns: repeat(3, 1fr);
    gap: 8px; padding: 14px;
  }
  .picker-item {
    display: flex; flex-direction: column; align-items: center; gap: 8px;
    padding: 16px 10px; border-radius: 14px; cursor: pointer;
    border: 1px solid var(--km-alpha-06);
    transition: all 0.15s;
  }
  .picker-item:hover {
    background: rgba(37,99,235,0.08);
    border-color: rgba(37,99,235,0.3);
  }
  .picker-item km-icon { color: var(--km-alpha-45); }
  .picker-item:hover km-icon { color: var(--km-accent-hover); }
  .picker-item-label {
    font-size: 11px; color: var(--km-alpha-40); text-align: center; line-height: 1.3;
  }
  .picker-item:hover .picker-item-label { color: var(--km-alpha-70); }
  .picker-empty {
    padding: 28px; text-align: center;
    font-size: 12px; color: var(--km-alpha-20);
  }
</style>

<!-- Hero bar -->
<div class="hero" id="hero">
  <div class="hero-anim">
    <svg viewBox="0 0 160 72" xmlns="http://www.w3.org/2000/svg">
      <path class="trace-glow t1" d="M8 36 H42 L54 16 H106 L118 36 H152"/>
      <path class="trace-path t1" d="M8 36 H42 L54 16 H106 L118 36 H152"/>
      <path class="trace-glow t2" d="M8 50 H34 L46 62 H80 L92 42 H124 L136 56 H152"/>
      <path class="trace-path t2" d="M8 50 H34 L46 62 H80 L92 42 H124 L136 56 H152"/>
      <path class="trace-glow t3" d="M8 22 H26 L38 10 H66 L78 36 H98 L110 22 H152"/>
      <path class="trace-path t3" d="M8 22 H26 L38 10 H66 L78 36 H98 L110 22 H152"/>
      <circle class="via-pad" cx="42" cy="36" r="4.5"/><circle class="via-dot" cx="42" cy="36" r="1.8"/>
      <circle class="via-pad" cx="106" cy="16" r="3.5"/><circle class="via-dot" cx="106" cy="16" r="1.4"/>
      <circle class="via-pad" cx="80"  cy="36" r="4.5"/><circle class="via-dot" cx="80"  cy="36" r="1.8"/>
      <circle class="via-pad" cx="124" cy="42" r="3.5"/><circle class="via-dot" cx="124" cy="42" r="1.4"/>
    </svg>
  </div>
  <div class="hero-brand">
    <div class="hero-title">KiMaster</div>
    <div class="hero-version" id="hero-ver">v0.1.0</div>
  </div>
  <div class="hero-sys" id="hero-sys"></div>
  <div class="hero-divider"></div>
  <div class="hero-bridge" id="hero-bridge">
    <div class="bridge-dot" id="bdot"></div>
    <span class="bridge-status" id="bstat">Not connected</span>
    <span class="bridge-sub"   id="bsub"></span>
    <div class="bridge-acts"   id="bacts"></div>
  </div>
  <div class="hero-right">
    <button class="icon-btn" id="btn-edit" title="Edit layout">
      <km-icon name="settings" size="sm"></km-icon>
    </button>
  </div>
</div>

<!-- Edit mode banner -->
<div class="edit-banner" id="edit-banner">
  <div class="edit-banner-dot"></div>
  Editing layout — drag to reorder, × to remove, ＋ to add
  <button class="btn" id="btn-done" style="margin-left:auto">Done</button>
  <button class="btn danger" id="btn-reset">Reset</button>
</div>

<!-- Bento grid -->
<div class="dash-scroll">
  <div class="grid-wrap">
    <div class="grid" id="grid"></div>
  </div>
</div>

<!-- Widget picker backdrop -->
<div class="picker-backdrop" id="picker-backdrop">
  <div class="picker-panel" id="picker-panel">
    <div class="picker-hdr">
      <span class="picker-title">Add widget</span>
      <button class="picker-close" id="picker-close">
        <km-icon name="x" size="sm"></km-icon>
      </button>
    </div>
    <div class="picker-grid" id="picker-grid"></div>
  </div>
</div>
`;

// ── Component ─────────────────────────────────────────────────────────────────

export class KmDashboard extends HTMLElement {
  constructor() {
    super();
    this.attachShadow({ mode: 'open' });
    this.shadowRoot.appendChild(T.content.cloneNode(true));
    this._unsubs   = [];
    this._editMode = false;
    this._dragId   = null;

    // One-time init: hand the LayoutStore the list of known widget ids
    // and copy the persisted (or migrated) layout into the global store.
    // Safe to call multiple times — second call is a no-op for layout, but
    // refreshes _knownIds in case widgets were registered later.
    if (!KmDashboard._storeInit) {
      initLayoutStore(Object.keys(WIDGETS));
      // If nothing was loaded from localStorage, seed with default.
      if (!store.dashboardLayout || store.dashboardLayout.length === 0) {
        setLayout(DEFAULT_LAYOUT);
      }
      KmDashboard._storeInit = true;
    }
  }

  connectedCallback() {
    this._renderHero();
    this._renderBridge();
    this._renderGrid();
    this._wireControls();

    this._unsubs.push(
      subscribe('bridgeConnected',    () => this._renderBridge()),
      subscribe('bridgeBoardName',    () => this._renderBridge()),
      subscribe('bridgeKicadVersion', () => this._renderHero()),
      subscribe('project',            () => this._renderHero()),
    );
  }

  disconnectedCallback() {
    this._unsubs.forEach(u => u());
    this._unsubs = [];
  }

  // ── Layout persistence (delegates to LayoutStore) ─────────────

  /**
   * Per-render cache of the layout, augmented with the legacy colSpan /
   * rowSpan fields the current 4-col grid renderer uses. Rebuilt at the
   * top of `_renderGrid()` from the LayoutStore. Never mutated directly;
   * layout changes go through the store helpers and then call `_renderGrid`.
   * @returns {Array<{id:string,w:number,h:number,colSpan:number,rowSpan:number}>}
   */
  _readLayout() {
    return getLayout().map(e => ({
      ...e,
      colSpan: toLegacyColSpan(e.w),
      rowSpan: toLegacyRowSpan(e.h),
    }));
  }

  /** Flush the current in-memory layout to the store (called after drag/resize
   *  handlers that mutate `this._layout` before render). No-op for reads. */
  _saveLayout() {
    // Drag/resize handlers still mutate `this._layout` directly (a transient
    // cache). This method syncs the v3 fields back to the store.
    setLayout(this._layout.map(e => ({ id: e.id, w: e.w, h: e.h })));
  }

  /** Reset to v3 default — exposed on the component for the omni-bar action
   *  and the right-click menu (per plan §4.3). */
  _resetLayout() {
    resetLayoutInStore(DEFAULT_LAYOUT);
    this._renderGrid();
  }

  // ── Hero ──────────────────────────────────────────────────────

  _renderHero() {
    const ver = this.shadowRoot.getElementById('hero-ver');
    const sys = this.shadowRoot.getElementById('hero-sys');
    ver.textContent = `v${store.appVersion || '0.1.0'}`;

    const parts = [];
    if (store.bridgeKicadVersion)
      parts.push(`<span><km-icon name="cpu" size="sm"></km-icon> KiCad ${_e(store.bridgeKicadVersion)}</span>`);
    if (store.kicadCliPath)
      parts.push(`<span><km-icon name="check" size="sm" style="color:var(--km-trace)"></km-icon> kicad-cli</span>`);
    else
      parts.push(`<span><km-icon name="warning" size="sm" style="color:var(--km-warning)"></km-icon> kicad-cli missing</span>`);
    sys.innerHTML = parts.join('');
  }

  // ── Bridge ────────────────────────────────────────────────────

  _renderBridge() {
    const on   = store.bridgeConnected;
    const dot  = this.shadowRoot.getElementById('bdot');
    const stat = this.shadowRoot.getElementById('bstat');
    const sub  = this.shadowRoot.getElementById('bsub');
    const acts = this.shadowRoot.getElementById('bacts');

    dot.classList.toggle('on', on);

    if (on) {
      stat.textContent = 'Connected to KiCad';
      sub.textContent  = store.bridgeBoardName
        ? `Live sync · ${store.bridgeBoardName.split(/[\\/]/).pop()}`
        : 'Live sync';
    } else {
      stat.textContent = 'Not connected';
      sub.textContent  = '';
    }

    if (on) {
      acts.innerHTML = `
        <button class="btn" id="btn-refresh"><km-icon name="refresh" size="sm"></km-icon></button>
        <button class="btn danger" id="btn-dc">Disconnect</button>`;
      acts.querySelector('#btn-refresh')?.addEventListener('click', () =>
        import('../../../modules/kicad-bridge/BridgeClient.js').then(m => m.requestBoardState()));
      acts.querySelector('#btn-dc')?.addEventListener('click', () =>
        import('../../../modules/kicad-bridge/BridgeClient.js').then(m => m.disconnectBridge()));
    } else {
      acts.innerHTML = `<button class="btn primary" id="btn-con">Connect</button>`;
      acts.querySelector('#btn-con')?.addEventListener('click', () =>
        import('../../../modules/kicad-bridge/BridgeClient.js')
          .then(m => m.showConnectGate())
          .catch(err => notify({ type: 'error', title: 'Connection failed', message: String(err?.message ?? err) })));
    }
  }

  // ── Grid ──────────────────────────────────────────────────────

  _renderGrid() {
    const grid = this.shadowRoot.getElementById('grid');
    grid.innerHTML = '';

    this._layout = this._readLayout();

    this._layout.forEach((entry, idx) => {
      const def  = WIDGETS[entry.id];
      if (!def) return;
      const cols = entry.colSpan || toLegacyColSpan(def.defaultW);
      const rows = entry.rowSpan || toLegacyRowSpan(def.defaultH);

      const cell = document.createElement('div');
      cell.className = 'wgt-cell';
      cell.dataset.id  = entry.id;
      cell.dataset.idx = idx;
      cell.style.gridColumn = `span ${cols}`;
      cell.style.gridRow    = `span ${rows}`;

      // ── Widget element (rendered first, under the overlay) ────────
      const wgt = document.createElement(def.tag);
      cell.appendChild(wgt);

      // ── Edit overlay — z-index 50, always above Shadow DOM content ─
      const overlay = document.createElement('div');
      overlay.className = 'edit-overlay';

      // Grip handle (visual, pointer-events: none)
      overlay.innerHTML = `
        <div class="edit-handle">
          <div class="grip-row"><div class="grip-dot"></div><div class="grip-dot"></div><div class="grip-dot"></div></div>
          <div class="grip-row"><div class="grip-dot"></div><div class="grip-dot"></div><div class="grip-dot"></div></div>
        </div>
        <span class="edit-wgt-name">${def.label}</span>`;

      // Remove button
      const rm = document.createElement('button');
      rm.className   = 'cell-rm';
      rm.title       = 'Remove widget';
      rm.textContent = '×';
      rm.addEventListener('click', e => {
        e.stopPropagation();
        const cur = getLayout();
        const curIdx = cur.findIndex(x => x.id === entry.id);
        if (curIdx !== -1) {
          cur.splice(curIdx, 1);
          setLayout(cur);
        }
        this._renderGrid();
      });
      overlay.appendChild(rm);

      // ── Drag-resize handles (right edge, bottom edge, SE corner) ──
      const rE = document.createElement('div');
      rE.className = 'resize-e';
      rE.title = 'Drag to resize width';
      rE.innerHTML = `<div class="resize-e-bar"></div>`;
      rE.addEventListener('mousedown', e => this._startResize(e, cell, entry, 'e'));
      overlay.appendChild(rE);

      const rS = document.createElement('div');
      rS.className = 'resize-s';
      rS.title = 'Drag to resize height';
      rS.innerHTML = `<div class="resize-s-bar"></div>`;
      rS.addEventListener('mousedown', e => this._startResize(e, cell, entry, 's'));
      overlay.appendChild(rS);

      const rSE = document.createElement('div');
      rSE.className = 'resize-se';
      rSE.title = 'Drag to resize';
      rSE.innerHTML = `<div class="resize-se-dot"></div>`;
      rSE.addEventListener('mousedown', e => this._startResize(e, cell, entry, 'se'));
      overlay.appendChild(rSE);

      cell.appendChild(overlay);

      // ── Move via mousedown (no HTML5 DnD — unreliable in Shadow DOM) ──
      // Mousedown anywhere on overlay except resize handles and remove button
      overlay.addEventListener('mousedown', e => {
        if (e.target.closest('.resize-e, .resize-s, .resize-se, .cell-rm')) return;
        if (!this._editMode) return;
        this._startMove(e, cell, entry);
      });

      grid.appendChild(cell);
    });

    // Add cell (shown in edit mode)
    const addCell = document.createElement('div');
    addCell.className = 'add-cell';
    addCell.textContent = '＋';
    addCell.title = 'Add widget';
    addCell.addEventListener('click', () => this._openPicker());
    grid.appendChild(addCell);
  }

  // ── Edit mode ─────────────────────────────────────────────────

  _setEditMode(on) {
    this._editMode = on;
    this.classList.toggle('edit-mode', on);
    this.shadowRoot.getElementById('btn-edit').classList.toggle('active', on);
    this.shadowRoot.getElementById('edit-banner').classList.toggle('visible', on);
    if (!on) {
      this.shadowRoot.querySelectorAll('.wgt-cell').forEach(c =>
        c.classList.remove('drag-over', 'dragging'));
    }
  }

  // ── Resize (edge/corner drag) ─────────────────────────────────

  _startResize(e, cell, entry, dir) {
    e.stopPropagation();
    e.preventDefault();

    const gridEl   = this.shadowRoot.getElementById('grid');
    const overlay  = cell.querySelector('.edit-overlay');
    const GAP      = 14;
    const NUM_COLS = 4;

    const gridRect = gridEl.getBoundingClientRect();
    const colW     = (gridRect.width - (NUM_COLS - 1) * GAP) / NUM_COLS;
    const cellRect = cell.getBoundingClientRect();
    const rowH     = cellRect.height / Math.max(entry.rowSpan || 1, 1);

    const startX   = e.clientX;
    const startY   = e.clientY;
    const startCol = entry.colSpan || 1;
    const startRow = entry.rowSpan || 1;

    // Live size indicator badge
    const badge = document.createElement('div');
    badge.style.cssText = `
      position:fixed; z-index:9999; pointer-events:none;
      background:var(--km-shadow-backdrop); backdrop-filter:blur(8px);
      border:1px solid rgba(37,99,235,0.5); border-radius:6px;
      padding:4px 9px; font-size:11px; font-weight:600;
      color:var(--km-accent-hover); font-family:var(--km-font);
      font-variant-numeric:tabular-nums; white-space:nowrap;
    `;
    badge.textContent = `${startCol} × ${startRow}`;
    document.body.appendChild(badge);

    overlay?.classList.add('resizing');
    document.body.style.cursor     = dir === 'e' ? 'ew-resize' : dir === 's' ? 'ns-resize' : 'nwse-resize';
    document.body.style.userSelect = 'none';

    const onMove = (ev) => {
      const dx = ev.clientX - startX;
      const dy = ev.clientY - startY;

      let newCol = startCol;
      let newRow = startRow;

      if (dir === 'e' || dir === 'se') {
        newCol = Math.round(startCol + dx / (colW + GAP));
        newCol = Math.max(1, Math.min(NUM_COLS, newCol));
      }
      if (dir === 's' || dir === 'se') {
        newRow = Math.round(startRow + dy / (rowH + GAP));
        newRow = Math.max(1, Math.min(4, newRow));
      }

      entry.colSpan = newCol;
      entry.rowSpan = newRow;
      // Map legacy 4-col span back to v3 12-col width/height for persistence.
      entry.w = newCol * 3;
      entry.h = newRow;
      cell.style.gridColumn = `span ${newCol}`;
      cell.style.gridRow    = `span ${newRow}`;

      badge.textContent = `${newCol} × ${newRow}`;
      badge.style.left = (ev.clientX + 14) + 'px';
      badge.style.top  = (ev.clientY - 12) + 'px';
    };

    const onUp = () => {
      document.removeEventListener('mousemove', onMove);
      document.removeEventListener('mouseup',   onUp);
      badge.remove();
      overlay?.classList.remove('resizing');
      document.body.style.cursor     = '';
      document.body.style.userSelect = '';
      this._saveLayout();
    };

    document.addEventListener('mousemove', onMove);
    document.addEventListener('mouseup',   onUp);
  }

  // ── Move (mousedown drag — no HTML5 DnD) ──────────────────────

  _startMove(e, sourceCell, entry) {
    e.preventDefault();
    e.stopPropagation();

    const rect    = sourceCell.getBoundingClientRect();
    const offsetX = e.clientX - rect.left;
    const offsetY = e.clientY - rect.top;

    // Floating ghost card following the cursor
    const ghost = document.createElement('div');
    ghost.style.cssText = `
      position:fixed; pointer-events:none; z-index:9998;
      left:${rect.left}px; top:${rect.top}px;
      width:${rect.width}px; height:${rect.height}px;
      border-radius:18px;
      border:2px dashed rgba(37,99,235,0.65);
      background:rgba(37,99,235,0.07);
      backdrop-filter:blur(6px);
      box-shadow:0 12px 40px rgba(37,99,235,0.22);
      transition:none;
    `;
    document.body.appendChild(ghost);

    sourceCell.style.opacity = '0.3';
    document.body.style.cursor     = 'grabbing';
    document.body.style.userSelect = 'none';

    let targetId = null;

    const onMove = (ev) => {
      ghost.style.left = (ev.clientX - offsetX) + 'px';
      ghost.style.top  = (ev.clientY - offsetY) + 'px';

      // Ghost centre point for hit-testing
      const cx = ev.clientX - offsetX + rect.width  / 2;
      const cy = ev.clientY - offsetY + rect.height / 2;

      // Check bounding rects of all cells (works across Shadow DOM)
      let found = null;
      const cells = [...this.shadowRoot.querySelectorAll('.wgt-cell')];
      for (const c of cells) {
        if (c.dataset.id === entry.id) continue;
        const r = c.getBoundingClientRect();
        if (cx >= r.left && cx <= r.right && cy >= r.top && cy <= r.bottom) {
          found = c; break;
        }
      }

      cells.forEach(c => c.classList.toggle('drag-over', c === found && !!found));
      targetId = found?.dataset.id ?? null;
    };

    const onUp = () => {
      document.removeEventListener('mousemove', onMove);
      document.removeEventListener('mouseup',   onUp);
      ghost.remove();
      sourceCell.style.opacity        = '';
      document.body.style.cursor     = '';
      document.body.style.userSelect = '';
      this.shadowRoot.querySelectorAll('.wgt-cell').forEach(c =>
        c.classList.remove('drag-over', 'dragging'));

      if (targetId && targetId !== entry.id) {
        const cur = getLayout();
        const fi = cur.findIndex(x => x.id === entry.id);
        const ti = cur.findIndex(x => x.id === targetId);
        if (fi !== -1 && ti !== -1) {
          const [item] = cur.splice(fi, 1);
          cur.splice(ti, 0, item);
          setLayout(cur);
          this._renderGrid();
        }
      }
    };

    document.addEventListener('mousemove', onMove);
    document.addEventListener('mouseup',   onUp);
  }

  // ── Widget picker ─────────────────────────────────────────────

  _openPicker() {
    const backdrop = this.shadowRoot.getElementById('picker-backdrop');
    const grid     = this.shadowRoot.getElementById('picker-grid');
    const active   = new Set(getLayout().map(e => e.id));
    const avail    = Object.entries(WIDGETS).filter(([id]) => !active.has(id));

    if (!avail.length) {
      grid.innerHTML = `<div class="picker-empty">All widgets are already on your dashboard.</div>`;
    } else {
      grid.innerHTML = avail.map(([id, def]) => `
        <div class="picker-item" data-wid="${id}">
          <km-icon name="${def.icon}" size="lg"></km-icon>
          <span class="picker-item-label">${def.label}</span>
        </div>`).join('');
      grid.querySelectorAll('.picker-item').forEach(item =>
        item.addEventListener('click', () => {
          const id  = item.dataset.wid;
          const def = WIDGETS[id];
          this._layout.push({ id, w: def.defaultW, h: def.defaultH, colSpan: toLegacyColSpan(def.defaultW), rowSpan: toLegacyRowSpan(def.defaultH) });
          this._saveLayout();
          this._renderGrid();
          this._closePicker();
        }));
    }

    backdrop.classList.add('visible');
  }

  _closePicker() {
    this.shadowRoot.getElementById('picker-backdrop').classList.remove('visible');
  }

  // ── Controls wiring ───────────────────────────────────────────

  _wireControls() {
    this.shadowRoot.getElementById('btn-edit')
      ?.addEventListener('click', () => this._setEditMode(!this._editMode));
    this.shadowRoot.getElementById('btn-done')
      ?.addEventListener('click', () => this._setEditMode(false));
    this.shadowRoot.getElementById('btn-reset')
      ?.addEventListener('click', () => {
        this._layout = DEFAULT_LAYOUT.map(e => ({ ...e, colSpan: toLegacyColSpan(e.w), rowSpan: toLegacyRowSpan(e.h) }));
        this._saveLayout();
        this._renderGrid();
        this._setEditMode(false);
      });
    this.shadowRoot.getElementById('picker-close')
      ?.addEventListener('click', () => this._closePicker());
    this.shadowRoot.getElementById('picker-backdrop')
      ?.addEventListener('click', e => {
        if (e.target === this.shadowRoot.getElementById('picker-backdrop'))
          this._closePicker();
      });
  }
}

function _e(s) {
  const d = document.createElement('div');
  d.textContent = String(s ?? '');
  return d.innerHTML;
}

customElements.define('km-dashboard', KmDashboard);
