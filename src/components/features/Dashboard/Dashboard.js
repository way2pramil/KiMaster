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
import { GridGeometry }                from './layout/GridEngine.js';
import { attachResize }                from './layout/ResizeController.js';
import { attachDrag }                  from './layout/DragController.js';

// ── Widget imports (register all custom elements) ─────────────────────────────
import './widgets/WidgetProjectFiles.js';
import './widgets/WidgetRecentProjects.js';
import './widgets/WidgetBoardInfo.js';
import './widgets/WidgetNetlistGraph.js';
import './widgets/WidgetNotes.js';
import './widgets/WidgetBoardRender.js';
import './widgets/WidgetShortcuts.js';
import { SDK_HELLO_TAG } from './widgets/WidgetSdkHello.js';

// ── Widget registry ───────────────────────────────────────────────────────────

const WIDGETS = {
  'project-files':   { label:'Project files',   icon:'folder-tree', tag:'km-wgt-project-files',    defaultW: 3, defaultH: 2 },
  'recent-projects': { label:'Recent projects', icon:'clock',       tag:'km-wgt-recent-projects',  defaultW: 3, defaultH: 2 },
  'board-info':      { label:'Board info',      icon:'cpu',         tag:'km-wgt-board-info',       defaultW: 3, defaultH: 2 },
  'netlist-graph':   { label:'Netlist graph',   icon:'graph',       tag:'km-wgt-netlist-graph',    defaultW: 3, defaultH: 2 },
  'shortcuts':       { label:'Shortcuts',       icon:'grid',        tag:'km-wgt-shortcuts',        defaultW: 6, defaultH: 1 },
  'notes':           { label:'Notes',           icon:'notes',       tag:'km-wgt-notes',            defaultW: 3, defaultH: 1 },
  'board-render':    { label:'3D render',       icon:'render',      tag:'km-wgt-board-render',     defaultW: 3, defaultH: 2 },
  'sdk-hello':       { label:'SDK Hello',       icon:'box',         tag: SDK_HELLO_TAG,            defaultW: 3, defaultH: 1 },
};

const DEFAULT_LAYOUT = [
  { id: 'project-files', w: 3, h: 1 },
  { id: 'netlist-graph', w: 9, h: 1 },
  { id: 'board-info',    w: 6, h: 1 },
  { id: 'shortcuts',     w: 3, h: 1 },
  { id: 'notes',         w: 3, h: 1 },
  { id: 'sdk-hello',     w: 3, h: 1 },
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

  /* ── Hero bar — 64px tall, 4 zones ───────────────────────────── */
  .hero {
    display: grid;
    grid-template-columns: minmax(180px, auto) minmax(0, 1fr) minmax(0, 1fr) auto;
    align-items: center;
    gap: 16px;
    height: 64px; flex-shrink: 0;
    padding: 0 20px;
    background: var(--km-alpha-018);
    border-bottom: 1px solid var(--km-alpha-05);
    position: relative;
    overflow: hidden;
  }

  /* Pulse progress bar pinned to the bottom of the hero (4px) */
  .hero-pulse {
    position: absolute; left: 0; right: 0; bottom: 0; height: 2px;
    background: var(--km-alpha-05);
    overflow: hidden;
  }
  .hero-pulse::after {
    content: ''; position: absolute; inset: 0;
    background: linear-gradient(90deg, transparent 0%, var(--km-live) 50%, transparent 100%);
    transform-origin: left;
    transform: scaleX(0.2);
    opacity: 0.55;
  }
  .hero-pulse.idle::after {
    background: linear-gradient(90deg, transparent 0%, var(--km-alpha-30) 50%, transparent 100%);
    animation: pulse-idle 2.5s ease-in-out infinite;
  }
  .hero-pulse.live::after {
    animation: pulse-live 1.25s ease-in-out infinite;
  }
  .hero-pulse.sync::after {
    animation: pulse-sync 0.625s ease-in-out infinite;
  }
  @keyframes pulse-idle  { 0%,100%{transform:scaleX(0.15);opacity:0.3} 50%{transform:scaleX(0.6);opacity:0.55} }
  @keyframes pulse-live  { 0%,100%{transform:scaleX(0.25);opacity:0.45} 50%{transform:scaleX(0.85);opacity:0.85} }
  @keyframes pulse-sync  { 0%,100%{transform:scaleX(0.4); opacity:0.7}  50%{transform:scaleX(1);   opacity:1} }

  /* Zone A — Identity */
  .hero-id {
    display: flex; align-items: center; gap: 12px; min-width: 0;
  }
  .hero-glyph {
    width: 32px; height: 32px; border-radius: 9px; flex-shrink: 0;
    background: linear-gradient(135deg, var(--km-accent) 0%, var(--km-live) 100%);
    display: flex; align-items: center; justify-content: center;
    font-size: 17px; font-weight: 700; color: #fff;
    box-shadow: var(--km-accent-glow);
    letter-spacing: -0.05em;
  }
  .hero-id-text { display: flex; flex-direction: column; gap: 1px; min-width: 0; }
  .hero-name {
    font-size: 13px; font-weight: 600; letter-spacing: -0.02em;
    color: var(--km-alpha-85);
    white-space: nowrap; overflow: hidden; text-overflow: ellipsis;
  }
  .hero-meta {
    font-size: 10px; color: var(--km-alpha-30);
    font-family: var(--km-font-mono);
    white-space: nowrap; overflow: hidden; text-overflow: ellipsis;
  }

  /* Zone B — Live status */
  .hero-live {
    display: flex; align-items: center; gap: 8px; min-width: 0;
    padding: 0 12px; height: 36px;
    background: var(--km-alpha-04);
    border: 1px solid var(--km-alpha-06);
    border-radius: 9px;
    cursor: pointer;
    transition: background 0.15s, border-color 0.15s;
    overflow: hidden;
  }
  .hero-live:hover { background: var(--km-alpha-06); border-color: var(--km-alpha-10); }
  .live-dot {
    width: 8px; height: 8px; border-radius: 50%; flex-shrink: 0;
    background: var(--km-alpha-15);
    transition: background 0.3s, box-shadow 0.3s;
  }
  .live-dot.on  { background: var(--km-live); box-shadow: 0 0 8px var(--km-live); }
  .live-dot.sync { background: var(--km-warning); box-shadow: 0 0 8px var(--km-warning); animation: live-blink 0.6s ease-in-out infinite; }
  @keyframes live-blink { 0%,100%{opacity:1} 50%{opacity:0.4} }
  .live-text {
    flex: 1; min-width: 0; overflow: hidden; text-overflow: ellipsis; white-space: nowrap;
    font-size: 11px;
  }
  .live-text .lbl { color: var(--km-alpha-55); font-weight: 500; }
  .live-text .val { color: var(--km-alpha-85); font-family: var(--km-font-mono); }

  /* Zone C — Project breadcrumb */
  .hero-proj {
    display: flex; align-items: center; gap: 8px; min-width: 0;
    padding: 0 12px; height: 36px;
    background: var(--km-alpha-04);
    border: 1px solid var(--km-alpha-06);
    border-radius: 9px;
    overflow: hidden;
  }
  .proj-icon { color: var(--km-alpha-30); flex-shrink: 0; display: flex; }
  .proj-text { flex: 1; min-width: 0; overflow: hidden; }
  .proj-name {
    font-size: 12px; font-weight: 500; color: var(--km-alpha-85);
    white-space: nowrap; overflow: hidden; text-overflow: ellipsis;
  }
  .proj-sub {
    font-size: 10px; color: var(--km-alpha-25); font-family: var(--km-font-mono);
    white-space: nowrap; overflow: hidden; text-overflow: ellipsis;
    margin-top: 1px;
  }

  /* Zone D — Actions */
  .hero-acts {
    display: flex; align-items: center; gap: 4px; flex-shrink: 0;
  }
  .icon-btn {
    background: none; border: none; padding: 7px; border-radius: 8px;
    color: var(--km-alpha-40); cursor: pointer;
    display: inline-flex; align-items: center;
    transition: color 0.15s, background 0.15s;
  }
  .icon-btn:hover { color: var(--km-alpha-85); background: var(--km-alpha-06); }
  .icon-btn.active { color: var(--km-accent-hover); background: var(--km-accent-muted); }

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
    grid-template-columns: repeat(12, 1fr);
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

  /* ── Floating action button (FAB) — permanent + to add widgets ── */
  .fab {
    position: fixed;
    right: 28px; bottom: 28px;
    width: 52px; height: 52px; border-radius: 50%;
    background: var(--km-accent);
    color: #fff; border: none;
    box-shadow:
      0 8px 24px rgba(37,99,235,0.45),
      0 0 0 4px rgba(37,99,235,0.12);
    display: flex; align-items: center; justify-content: center;
    cursor: pointer;
    z-index: 150;
    transition: transform 0.18s var(--km-ease-spring), background 0.15s, box-shadow 0.2s;
  }
  .fab:hover {
    background: var(--km-accent-hover);
    transform: translateY(-2px) scale(1.05);
    box-shadow:
      0 12px 32px rgba(37,99,235,0.55),
      0 0 0 6px rgba(37,99,235,0.15);
  }
  .fab:active { transform: scale(0.96); }
  .fab[hidden] { display: none; }

  /* ── Anchored popover (replaces the centred modal) ─────────── */
  .popover-backdrop {
    position: fixed; inset: 0; z-index: 200;
    background: transparent;
    pointer-events: none;
  }
  .popover-backdrop.visible { pointer-events: auto; }
  .popover {
    position: fixed;
    right: 28px; bottom: 96px;
    width: 360px; max-height: 480px;
    background: var(--km-glass-bg);
    border: 1px solid var(--km-alpha-10);
    border-top-color: var(--km-alpha-18);
    border-radius: 16px;
    box-shadow:
      0 24px 60px var(--km-shadow-card-strong),
      0 0 0 0.5px var(--km-shadow-card-strong);
    overflow: hidden;
    display: flex; flex-direction: column;
    transform: translateY(8px) scale(0.96);
    opacity: 0; pointer-events: none;
    transform-origin: bottom right;
    transition: transform 0.18s var(--km-ease-spring), opacity 0.15s;
  }
  .popover-backdrop.visible .popover {
    transform: translateY(0) scale(1);
    opacity: 1; pointer-events: auto;
  }
  .popover-hdr {
    display: flex; align-items: center; gap: 10px;
    padding: 12px 14px;
    border-bottom: 1px solid var(--km-alpha-06);
    flex-shrink: 0;
  }
  .popover-search-wrap {
    flex: 1; display: flex; align-items: center; gap: 8px;
    background: var(--km-alpha-04);
    border: 1px solid var(--km-alpha-06);
    border-radius: 8px;
    padding: 0 10px; height: 32px;
  }
  .popover-search-wrap:focus-within {
    border-color: var(--km-accent-border);
    background: var(--km-alpha-06);
  }
  .popover-search {
    flex: 1; background: none; border: none; outline: none;
    color: var(--km-alpha-85); font: inherit; font-size: 12px;
    font-family: var(--km-font);
  }
  .popover-search::placeholder { color: var(--km-alpha-30); }
  .popover-grid {
    flex: 1; overflow-y: auto; padding: 10px;
    display: grid; grid-template-columns: repeat(3, 1fr); gap: 6px;
  }
  .popover-item {
    display: flex; flex-direction: column; align-items: center; gap: 6px;
    padding: 14px 8px; border-radius: 10px; cursor: pointer;
    border: 1px solid transparent;
    background: none;
    transition: all 0.12s;
    font: inherit; color: inherit;
  }
  .popover-item:hover {
    background: var(--km-accent-muted);
    border-color: var(--km-accent-border);
  }
  .popover-item km-icon { color: var(--km-alpha-55); }
  .popover-item:hover km-icon { color: var(--km-accent-hover); }
  .popover-item-label {
    font-size: 10px; color: var(--km-alpha-45);
    text-align: center; line-height: 1.3;
  }
  .popover-item:hover .popover-item-label { color: var(--km-alpha-85); }
  .popover-item.added { opacity: 0.35; cursor: default; }
  .popover-item.added:hover { background: none; border-color: transparent; }
  .popover-item.added km-icon,
  .popover-item.added .popover-item-label { color: var(--km-alpha-25); }
  .popover-empty {
    grid-column: 1 / -1;
    padding: 28px 14px; text-align: center;
    font-size: 11px; color: var(--km-alpha-25);
  }
  .popover-empty b { color: var(--km-alpha-55); font-weight: 500; }

  /* ── Right-click context menu ──────────────────────────────── */
  .ctx-menu {
    position: fixed; z-index: 300;
    min-width: 180px;
    background: var(--km-glass-bg);
    border: 1px solid var(--km-alpha-10);
    border-top-color: var(--km-alpha-18);
    border-radius: 10px;
    box-shadow: 0 12px 32px var(--km-shadow-card-strong);
    padding: 4px;
    display: none;
  }
  .ctx-menu.visible { display: block; }
  .ctx-item {
    display: flex; align-items: center; gap: 8px;
    width: 100%; padding: 6px 10px;
    background: none; border: none;
    color: var(--km-alpha-70);
    font: inherit; font-size: 12px; text-align: left;
    border-radius: 6px;
    cursor: pointer;
    transition: background 0.1s, color 0.1s;
  }
  .ctx-item:hover { background: var(--km-accent-muted); color: var(--km-alpha-85); }
  .ctx-item.danger { color: var(--km-danger); }
  .ctx-item.danger:hover { background: rgba(239,68,68,0.12); }
  .ctx-sep { height: 1px; background: var(--km-alpha-06); margin: 4px 6px; }
  .ctx-kbd { margin-left: auto; font-size: 10px; color: var(--km-alpha-25); font-family: var(--km-font-mono); }
</style>

<!-- Hero bar — 64px, 4 zones -->
<div class="hero" id="hero">
  <!-- Zone A — Identity -->
  <div class="hero-id" id="hero-id">
    <div class="hero-glyph">K</div>
    <div class="hero-id-text">
      <div class="hero-name">KiMaster</div>
      <div class="hero-meta" id="hero-meta">v0.1.0</div>
    </div>
  </div>

  <!-- Zone B — Live status -->
  <button class="hero-live" id="hero-live" type="button" title="Open Bridge monitor">
    <div class="live-dot" id="live-dot"></div>
    <div class="live-text">
      <span class="lbl"  id="live-lbl">Not connected</span>
      <span class="val"  id="live-val"></span>
    </div>
  </button>

  <!-- Zone C — Project breadcrumb -->
  <div class="hero-proj" id="hero-proj" title="Open project folder">
    <div class="proj-icon"><km-icon name="folder" size="sm"></km-icon></div>
    <div class="proj-text">
      <div class="proj-name" id="proj-name">No project open</div>
      <div class="proj-sub"  id="proj-sub">Open a .kicad_pro to start</div>
    </div>
  </div>

  <!-- Zone D — Actions -->
  <div class="hero-acts">
    <button class="icon-btn" id="btn-palette" title="Command palette (Ctrl+K)">
      <km-icon name="search" size="sm"></km-icon>
    </button>
    <button class="icon-btn" id="btn-edit" title="Edit layout">
      <km-icon name="settings" size="sm"></km-icon>
    </button>
    <button class="icon-btn" id="btn-bridge" title="Open bridge">
      <km-icon name="plug" size="sm"></km-icon>
    </button>
  </div>

  <!-- Pulse progress bar (pinned to bottom of hero) -->
  <div class="hero-pulse idle" id="hero-pulse"></div>
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

<!-- Permanent FAB — opens the widget popover -->
<button class="fab" id="fab-add" type="button" title="Add widget" aria-label="Add widget">
  <km-icon name="plus" size="md"></km-icon>
</button>

<!-- Anchored popover (replaces the centred modal) -->
<div class="popover-backdrop" id="popover-backdrop">
  <div class="popover" id="popover" role="dialog" aria-label="Add widget">
    <div class="popover-hdr">
      <div class="popover-search-wrap">
        <km-icon name="search" size="sm"></km-icon>
        <input
          class="popover-search"
          id="popover-search"
          type="text"
          placeholder="Search widgets…"
          autocomplete="off"
          spellcheck="false">
      </div>
    </div>
    <div class="popover-grid" id="popover-grid"></div>
  </div>
</div>

<!-- Right-click context menu (single instance, positioned dynamically) -->
<div class="ctx-menu" id="ctx-menu" role="menu"></div>
`;

// ── Component ─────────────────────────────────────────────────────────────────

export class KmDashboard extends HTMLElement {
  constructor() {
    super();
    this.attachShadow({ mode: 'open' });
    this.shadowRoot.appendChild(T.content.cloneNode(true));
    this._unsubs       = [];
    this._editMode     = false;
    this._dragId       = null;
    this._interactions = new Map(); // cellId → [dispose fns] for resize/drag

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
    this._renderLive();
    this._renderGrid();
    this._wireControls();

    this._unsubs.push(
      subscribe('bridgeConnected',    () => this._renderLive()),
      subscribe('bridgeBoardName',    () => this._renderLive()),
      subscribe('bridgePort',         () => this._renderLive()),
      subscribe('bridgeSyncing',      () => this._renderLive()),
      subscribe('bridgeKicadVersion', () => this._renderHero()),
      subscribe('project',            () => this._renderHero()),
    );
  }

  disconnectedCallback() {
    this._unsubs.forEach(u => u());
    this._unsubs = [];
    if (this._onDocKey) {
      document.removeEventListener('keydown', this._onDocKey);
      this._onDocKey = null;
    }
    this._closeContextMenu();
  }

  // ── Layout persistence (delegates to LayoutStore) ─────────────

  /**
   * Per-render cache of the layout. The grid is 12-col (v3 native); entries
   * carry `w`/`h` for size, plus a derived `colSpan` mirror (1-4) for legacy
   * resize math. Rebuilt at the top of `_renderGrid()` from the LayoutStore.
   * Never mutated directly; layout changes go through the store helpers and
   * then call `_renderGrid`.
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
    // Meta line under the app name: "v0.x · KiCad 9.0" (or "kicad-cli missing")
    const meta = this.shadowRoot.getElementById('hero-meta');
    if (meta) {
      const segs = [`v${store.appVersion || '0.1.0'}`];
      if (store.bridgeKicadVersion) segs.push(`KiCad ${store.bridgeKicadVersion}`);
      else if (store.kicadCliPath)   segs.push('kicad-cli ✓');
      else                            segs.push('kicad-cli ✗');
      meta.textContent = segs.join(' · ');
    }

    // Project breadcrumb (Zone C)
    const projName = this.shadowRoot.getElementById('proj-name');
    const projSub  = this.shadowRoot.getElementById('proj-sub');
    if (projName && projSub) {
      if (store.project?.name) {
        projName.textContent = store.project.name;
        const full = store.project.path || '';
        const dir  = full.includes('\\') || full.includes('/')
          ? full.split(/[\\/]/).slice(0, -1).pop() || ''
          : '';
        const saved = store.project.savedAt
          ? ' · saved ' + _relTime(store.project.savedAt)
          : store.project.mtimeMs
            ? ' · saved ' + _relTime(store.project.mtimeMs)
            : '';
        projSub.textContent  = (dir ? dir + ' · ' : '') + 'kicad_pro' + saved;
      } else {
        projName.textContent = 'No project open';
        projSub.textContent  = 'Open a .kicad_pro to start';
      }
    }
  }

  // ── Live status pill (Zone B) ─────────────────────────────────

  _renderLive() {
    const on   = !!store.bridgeConnected;
    const sync = !!store.bridgeSyncing;
    const dot  = this.shadowRoot.getElementById('live-dot');
    const lbl  = this.shadowRoot.getElementById('live-lbl');
    const val  = this.shadowRoot.getElementById('live-val');
    const pulse = this.shadowRoot.getElementById('hero-pulse');
    const btn  = this.shadowRoot.getElementById('btn-bridge');

    if (dot) {
      dot.classList.toggle('on',   on && !sync);
      dot.classList.toggle('sync', sync);
    }
    if (lbl) lbl.textContent = sync ? 'Syncing…' : on ? 'Connected · KiCad' : 'Not connected';
    if (val) {
      if (on) {
        const board = store.bridgeBoardName
          ? store.bridgeBoardName.split(/[\\/]/).pop()
          : '';
        const port  = store.bridgePort ? `:${store.bridgePort}` : '';
        val.textContent = board ? `${board} ${port}`.trim() : `localhost${port}`;
      } else {
        val.textContent = '';
      }
    }
    if (pulse) {
      pulse.classList.toggle('idle', !on);
      pulse.classList.toggle('live',  on && !sync);
      pulse.classList.toggle('sync',  sync);
    }
    if (btn) {
      btn.title = on ? 'Disconnect bridge' : 'Open bridge';
    }
  }

  // ── Grid ──────────────────────────────────────────────────────

  _disposeInteractions() {
    for (const fns of this._interactions.values()) {
      for (const dispose of fns) try { dispose(); } catch {}
    }
    this._interactions.clear();
  }

  _renderGrid() {
    const grid = this.shadowRoot.getElementById('grid');
    this._disposeInteractions();
    grid.innerHTML = '';

    // Build a fresh geometry bound to the live grid element. Used by both
    // the resize and drag controllers.
    this._geometry = new GridGeometry(grid);

    this._layout = this._readLayout();

    this._layout.forEach((entry, idx) => {
      const def  = WIDGETS[entry.id];
      if (!def) return;
      // Native 12-col grid (v3): use `w` directly. `colSpan` was the v2
      // 1-4 mapping and is no longer needed — kept on entries for back-compat
      // with resize-drag code that mutates `entry.colSpan`/`rowSpan` in place.
      const cols = entry.w || def.defaultW;
      const rows = entry.h || def.defaultH;

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
      // Wired through ResizeController; the controller owns the pointer
      // gesture and the floating size badge, the dashboard owns the
      // commit-back to the LayoutStore.
      const disposers = [];

      const rE = document.createElement('div');
      rE.className = 'resize-e';
      rE.title = 'Drag to resize width';
      rE.innerHTML = `<div class="resize-e-bar"></div>`;
      overlay.appendChild(rE);
      disposers.push(attachResize(rE, {
        dir: 'e', geometry: this._geometry, cellEl: cell, entry,
        onDelta: ({ cols, rows }) => this._applyResize(entry, cell, cols, rows),
        onCommit: () => this._saveLayout(),
      }));

      const rS = document.createElement('div');
      rS.className = 'resize-s';
      rS.title = 'Drag to resize height';
      rS.innerHTML = `<div class="resize-s-bar"></div>`;
      overlay.appendChild(rS);
      disposers.push(attachResize(rS, {
        dir: 's', geometry: this._geometry, cellEl: cell, entry,
        onDelta: ({ cols, rows }) => this._applyResize(entry, cell, cols, rows),
        onCommit: () => this._saveLayout(),
      }));

      const rSE = document.createElement('div');
      rSE.className = 'resize-se';
      rSE.title = 'Drag to resize';
      rSE.innerHTML = `<div class="resize-se-dot"></div>`;
      overlay.appendChild(rSE);
      disposers.push(attachResize(rSE, {
        dir: 'se', geometry: this._geometry, cellEl: cell, entry,
        onDelta: ({ cols, rows }) => this._applyResize(entry, cell, cols, rows),
        onCommit: () => this._saveLayout(),
      }));

      this._interactions.set(entry.id, disposers);

      cell.appendChild(overlay);

      // ── Move via mousedown (no HTML5 DnD — unreliable in Shadow DOM) ──
      // Mousedown anywhere on overlay except resize handles and remove button
      // ── Move via DragController ───────────────────────────────────
      // Wired through DragController; the controller owns the ghost, the
      // drag-over highlight, and the hit-test. The dashboard decides
      // what to do with the drop (reorder the layout).
      const existing = this._interactions.get(entry.id) ?? [];
      existing.push(attachDrag(cell, {
        id: entry.id,
        geometry: this._geometry,
        sourceEl: cell,
        shouldStart: () => this._editMode,
        getCells: () => [...this.shadowRoot.querySelectorAll('.wgt-cell')],
        onDrop: ({ targetId }) => this._commitDrop(entry.id, targetId),
      }));
      this._interactions.set(entry.id, existing);

      // Right-click context menu (always available, not just in edit mode)
      cell.addEventListener('contextmenu', e => this._openContextMenu(e, entry));

      grid.appendChild(cell);
    });

    // Add cell (shown in edit mode) — reuses the same popover the FAB opens
    const addCell = document.createElement('div');
    addCell.className = 'add-cell';
    addCell.textContent = '＋';
    addCell.title = 'Add widget';
    addCell.addEventListener('click', () => this._openPopover());
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

  // ── Resize / move callbacks (called by ResizeController / DragController) ─

  /**
   * Apply a snapped grid size to the in-memory entry + the live cell style.
   * Mirrored to `colSpan`/`rowSpan` for any legacy code that still inspects
   * those fields.
   * @param {{w:number,h:number}} entry
   * @param {HTMLElement} cell
   * @param {number} cols
   * @param {number} rows
   */
  _applyResize(entry, cell, cols, rows) {
    entry.w = cols;
    entry.h = rows;
    entry.colSpan = Math.max(1, Math.min(4, Math.round(cols / 3)));
    entry.rowSpan = rows;
    cell.style.gridColumn = `span ${cols}`;
    cell.style.gridRow    = `span ${rows}`;
  }

  /**
   * Commit a drag-reorder: swap the source and target in the layout, then
   * re-render. No-op if either side is missing.
   * @param {string} sourceId
   * @param {string|null} targetId
   */
  _commitDrop(sourceId, targetId) {
    if (!targetId || targetId === sourceId) return;
    const cur = getLayout();
    const fi = cur.findIndex(x => x.id === sourceId);
    const ti = cur.findIndex(x => x.id === targetId);
    if (fi === -1 || ti === -1) return;
    const [item] = cur.splice(fi, 1);
    cur.splice(ti, 0, item);
    setLayout(cur);
    this._renderGrid();
  }

  // ── Widget popover (anchored to FAB / +cell) ─────────────────

  _togglePopover() {
    const bd = this.shadowRoot.getElementById('popover-backdrop');
    if (bd.classList.contains('visible')) this._closePopover();
    else this._openPopover();
  }

  _openPopover() {
    this.shadowRoot.getElementById('popover-backdrop').classList.add('visible');
    this.shadowRoot.getElementById('popover-search').value = '';
    this._renderPopoverItems('');
    // Focus the search box after the open transition
    setTimeout(() => this.shadowRoot.getElementById('popover-search')?.focus(), 50);
  }

  _closePopover() {
    this.shadowRoot.getElementById('popover-backdrop')?.classList.remove('visible');
  }

  _renderPopoverItems(query = '') {
    const grid   = this.shadowRoot.getElementById('popover-grid');
    const active = new Set(getLayout().map(e => e.id));
    const q      = query.trim().toLowerCase();
    const all    = Object.entries(WIDGETS);
    const matches = q
      ? all.filter(([id, def]) => def.label.toLowerCase().includes(q) || id.includes(q))
      : all;

    if (!matches.length) {
      grid.innerHTML = `<div class="popover-empty">No widgets match "<b>${_e(query)}</b>"</div>`;
      return;
    }
    const allAdded = matches.every(([id]) => active.has(id));
    if (allAdded && !q) {
      grid.innerHTML = `<div class="popover-empty">All <b>${matches.length}</b> widgets are already on your dashboard. Remove one first, or reset the layout from the command palette.</div>`;
      return;
    }
    grid.innerHTML = matches.map(([id, def]) => {
      const added = active.has(id);
      return `
        <button class="popover-item ${added ? 'added' : ''}" data-wid="${id}" ${added ? 'disabled' : ''} type="button">
          <km-icon name="${def.icon}" size="md"></km-icon>
          <span class="popover-item-label">${_e(def.label)}</span>
        </button>`;
    }).join('');
    grid.querySelectorAll('.popover-item:not(.added)').forEach(btn =>
      btn.addEventListener('click', () => this._addWidgetFromPopover(btn.dataset.wid)));
  }

  _addWidgetFromPopover(id) {
    const def  = WIDGETS[id];
    if (!def) return;
    const cur  = getLayout();
    cur.push({ id, w: def.defaultW, h: def.defaultH });
    setLayout(cur);
    this._renderGrid();
    // Re-render the popover items so the now-added widget shows as disabled
    this._renderPopoverItems(this.shadowRoot.getElementById('popover-search')?.value || '');
  }

  // ── Right-click context menu on widgets ──────────────────────

  _openContextMenu(e, entry) {
    e.preventDefault();
    e.stopPropagation();
    const menu = this.shadowRoot.getElementById('ctx-menu');
    const def  = WIDGETS[entry.id];
    if (!def || !menu) return;

    menu.innerHTML = `
      <button class="ctx-item" data-act="grow-w">
        <km-icon name="plus" size="sm"></km-icon> Grow width <span class="ctx-kbd">→</span>
      </button>
      <button class="ctx-item" data-act="shrink-w">
        <km-icon name="x" size="sm"></km-icon> Shrink width <span class="ctx-kbd">←</span>
      </button>
      <button class="ctx-item" data-act="grow-h">
        <km-icon name="plus" size="sm"></km-icon> Grow height <span class="ctx-kbd">↓</span>
      </button>
      <button class="ctx-item" data-act="shrink-h">
        <km-icon name="x" size="sm"></km-icon> Shrink height <span class="ctx-kbd">↑</span>
      </button>
      <div class="ctx-sep"></div>
      <button class="ctx-item" data-act="reset">
        <km-icon name="refresh" size="sm"></km-icon> Reset to default size
      </button>
      <div class="ctx-sep"></div>
      <button class="ctx-item danger" data-act="remove">
        <km-icon name="x" size="sm"></km-icon> Remove widget
      </button>
    `;
    // Position with edge clamping
    const PAD = 8;
    menu.style.left = '0px';
    menu.style.top  = '0px';
    menu.classList.add('visible');
    const r = menu.getBoundingClientRect();
    const vw = window.innerWidth, vh = window.innerHeight;
    let x = e.clientX, y = e.clientY;
    if (x + r.width  > vw - PAD) x = vw - r.width  - PAD;
    if (y + r.height > vh - PAD) y = vh - r.height - PAD;
    menu.style.left = x + 'px';
    menu.style.top  = y + 'px';

    const onPick = (ev) => {
      const btn = ev.target.closest('.ctx-item');
      if (!btn) return;
      this._closeContextMenu();
      this._applyContextAction(btn.dataset.act, entry);
    };
    menu.addEventListener('click', onPick, { once: true });

    // Dismiss on outside click or Escape
    setTimeout(() => {
      this._ctxDismiss = (ev) => {
        if (!menu.contains(ev.target)) this._closeContextMenu();
      };
      document.addEventListener('mousedown', this._ctxDismiss);
      this._ctxKey = (ev) => { if (ev.key === 'Escape') this._closeContextMenu(); };
      document.addEventListener('keydown', this._ctxKey);
    }, 0);
  }

  _closeContextMenu() {
    this.shadowRoot.getElementById('ctx-menu')?.classList.remove('visible');
    if (this._ctxDismiss) { document.removeEventListener('mousedown', this._ctxDismiss); this._ctxDismiss = null; }
    if (this._ctxKey)     { document.removeEventListener('keydown',  this._ctxKey);     this._ctxKey     = null; }
  }

  _applyContextAction(act, entry) {
    const cur = getLayout();
    const i   = cur.findIndex(x => x.id === entry.id);
    if (i === -1) return;
    const e = cur[i];
    const wMax = 12, hMax = 8;
    const inc = (step) => {
      if (act === 'grow-w')    e.w = Math.min(wMax, e.w + 1);
      if (act === 'shrink-w')  e.w = Math.max(1,  e.w - 1);
      if (act === 'grow-h')    e.h = Math.min(hMax, e.h + 1);
      if (act === 'shrink-h')  e.h = Math.max(1,  e.h - 1);
    };
    if (act === 'reset') {
      const def = WIDGETS[entry.id];
      e.w = def.defaultW; e.h = def.defaultH;
    } else if (act === 'remove') {
      cur.splice(i, 1);
    } else {
      inc(act);
    }
    setLayout(cur);
    this._renderGrid();
    notify({
      type: 'success',
      title: act === 'remove' ? 'Widget removed' : act === 'reset' ? 'Size reset' : 'Widget resized',
      message: WIDGETS[entry.id].label,
    });
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
    this.shadowRoot.getElementById('btn-palette')
      ?.addEventListener('click', () => import('../../../core/Router.js').then(m => {
        // Open the omni-bar by clicking it if it exists, else navigate home
        const pal = document.querySelector('km-command-palette');
        if (pal && typeof pal.open === 'function') pal.open();
        else m.Router.navigate('/');
      }));
    this.shadowRoot.getElementById('hero-live')
      ?.addEventListener('click', () => import('../../../core/Router.js').then(m => m.Router.navigate('/bridge')));
    this.shadowRoot.getElementById('hero-proj')
      ?.addEventListener('click', () => {
        if (store.project?.path) {
          import('../../../core/Ipc.js').then(({ invoke }) => invoke('open_path', { path: store.project.path }));
        } else {
          import('../../../modules/project/ProjectService.js').then(m => m.pickAndOpenProject());
        }
      });
    this.shadowRoot.getElementById('btn-bridge')
      ?.addEventListener('click', () => {
        if (store.bridgeConnected) {
          import('../../../modules/kicad-bridge/BridgeClient.js').then(m => m.disconnectBridge());
        } else {
          import('../../../modules/kicad-bridge/BridgeClient.js').then(m => m.showConnectGate());
        }
      });

    // FAB — always visible, opens anchored popover
    this.shadowRoot.getElementById('fab-add')
      ?.addEventListener('click', () => this._togglePopover());
    this.shadowRoot.getElementById('popover-search')
      ?.addEventListener('input', e => this._renderPopoverItems(e.target.value));
    this.shadowRoot.getElementById('popover-backdrop')
      ?.addEventListener('click', e => {
        if (e.target === this.shadowRoot.getElementById('popover-backdrop'))
          this._closePopover();
      });
    document.addEventListener('keydown', this._onDocKey = e => {
      if (e.key === 'Escape' && this.shadowRoot.getElementById('popover-backdrop')?.classList.contains('visible')) {
        this._closePopover();
      }
    });
  }
}

function _e(s) {
  const d = document.createElement('div');
  d.textContent = String(s ?? '');
  return d.innerHTML;
}

/** Human-friendly "x ago" relative timestamp. Pure local math, no i18n. */
function _relTime(t) {
  const ms = Date.now() - Number(t);
  if (!Number.isFinite(ms) || ms < 0)        return 'just now';
  if (ms < 60_000)                          return 'just now';
  if (ms < 3_600_000)                       return `${Math.floor(ms / 60_000)}m ago`;
  if (ms < 86_400_000)                      return `${Math.floor(ms / 3_600_000)}h ago`;
  if (ms < 7 * 86_400_000)                  return `${Math.floor(ms / 86_400_000)}d ago`;
  return new Date(Number(t)).toLocaleDateString();
}

customElements.define('km-dashboard', KmDashboard);
