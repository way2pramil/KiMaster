/**
 * @element km-dashboard
 * @summary Full-screen dashboard — 4-zone layout
 *
 *  TOP:     Hero (logo + PCB animation + bridge bar merged)
 *  MID-L:   Project tree  (modern tree-style with CSS connecting lines)
 *  MID-R:   Recent projects
 *  BOTTOM:  Shortcuts bar (draggable equal-size tiles — tools + vault)
 *
 * @fires km-nav — { route }
 */

import { Logger }              from '../../../core/Logger.js';
import { invoke }              from '../../../core/Ipc.js';
import { store, subscribe }    from '../../../core/State.js';
import { KM_NAV }              from '../../../core/AppEvents.js';
import {
  GET_RECENT_PROJECTS,
  UCE_GET_VAULT,
  VAULT_LIST_STACKUPS,
  VAULT_LIST_TEMPLATES,
  VAULT_LIST_BLOCKS,
} from '../../../core/AppCommands.js';

/* ── Shortcut pool ─────────────────────────────────────────────────────────── */

const ALL_SC = [
  { id:'drc',       type:'tool',  icon:'drc',       label:'Design checks', route:'/drc' },
  { id:'export',    type:'tool',  icon:'gerber',     label:'Export',         route:'/export' },
  { id:'search',    type:'tool',  icon:'search',     label:'Parts catalog',  route:'/vault' },
  { id:'notes',     type:'tool',  icon:'notes',      label:'Notes',          route:'/notes' },
  { id:'render',    type:'tool',  icon:'render',     label:'3D Render',      route:'/render' },
  { id:'history',   type:'tool',  icon:'history',    label:'History',        route:'/history' },
  { id:'bom',       type:'tool',  icon:'bom',        label:'BOM',            route:'/bom' },
  { id:'bridge',    type:'tool',  icon:'plug',       label:'KiCad bridge',   route:'/bridge' },
  { id:'schematic', type:'tool',  icon:'schematic',  label:'Schematic',      route:'/schematic' },
  { id:'v-comp',    type:'vault', icon:'component',  label:'Components',     route:'/vault', vk:'components' },
  { id:'v-stk',     type:'vault', icon:'layers',     label:'Stackups',       route:'/vault', vk:'stackups' },
  { id:'v-tpl',     type:'vault', icon:'file',       label:'Templates',      route:'/vault', vk:'templates' },
  { id:'v-blk',     type:'vault', icon:'box',        label:'Blocks',         route:'/vault', vk:'blocks' },
];
const DEFAULT_IDS = ['drc','export','search','notes','render','v-comp','v-blk'];
const LS_KEY = 'km-dashboard-shortcuts';

/* ── Template ──────────────────────────────────────────────────────────────── */

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

  /* ─── Scroll wrapper ─── */
  .dash-scroll {
    flex: 1;
    overflow-y: auto;
    overflow-x: hidden;
  }

  /* ─── Main grid ─── */
  .dash {
    display: grid;
    grid-template-columns: 1fr 1fr;
    grid-template-rows: auto 1fr;
    gap: var(--km-space-4);
    padding: var(--km-space-5) var(--km-space-6) var(--km-space-4);
    min-height: calc(100% - 110px); /* leave room for shortcuts strip */
  }

  /* ─── Hero — single inline row ─── */
  .zone-hero {
    grid-column: 1/-1;
    display: flex;
    align-items: center;
    gap: var(--km-space-5);
    padding: var(--km-space-4) var(--km-space-6);
    background: var(--km-bg-surface);
    border: 1px solid var(--km-border);
    border-radius: var(--km-radius-xl);
    transition: border-color 0.3s var(--km-ease), box-shadow 0.3s var(--km-ease);
    animation: dash-in 0.35s var(--km-ease) both;
    min-height: 72px;
  }
  .zone-hero.live {
    border-color: var(--km-live-border);
    box-shadow: 0 0 14px rgba(6,182,212,0.08);
  }

  /* PCB animation */
  .hero-anim {
    width: 150px;
    height: 64px;
    flex-shrink: 0;
  }
  .hero-anim svg { width:100%; height:100%; }
  .trace-path { fill:none; stroke-width:2; stroke-linecap:round; stroke-linejoin:round; }
  .trace-path.t1 { stroke:var(--km-accent); stroke-dasharray:40 200; animation:comet 3s linear infinite; }
  .trace-path.t2 { stroke:var(--km-live);   stroke-dasharray:30 200; animation:comet 3.5s linear infinite 0.6s; }
  .trace-path.t3 { stroke:var(--km-trace);  stroke-dasharray:25 200; animation:comet 4s linear infinite 1.2s; }
  .trace-glow    { fill:none; stroke-width:6; stroke-linecap:round; opacity:0.2; filter:blur(3px); }
  .trace-glow.t1 { stroke:var(--km-accent); stroke-dasharray:40 200; animation:comet 3s linear infinite; }
  .trace-glow.t2 { stroke:var(--km-live);   stroke-dasharray:30 200; animation:comet 3.5s linear infinite 0.6s; }
  .trace-glow.t3 { stroke:var(--km-trace);  stroke-dasharray:25 200; animation:comet 4s linear infinite 1.2s; }
  .via-pad { fill:var(--km-bg-elevated); stroke:var(--km-accent); stroke-width:1.5; }
  .via-dot { fill:var(--km-accent); }
  @keyframes comet {
    0%   { stroke-dashoffset:240; }
    100% { stroke-dashoffset:0; }
  }

  /* Title + version block */
  .hero-brand {
    display: flex;
    flex-direction: column;
    gap: 2px;
    flex-shrink: 0;
  }
  .hero-title {
    font-size: var(--km-font-size-xl);
    font-weight: var(--km-font-weight-bold);
    letter-spacing: -0.03em;
    background: linear-gradient(135deg, var(--km-accent-hover) 0%, var(--km-live) 100%);
    -webkit-background-clip: text;
    -webkit-text-fill-color: transparent;
    background-clip: text;
    line-height: 1;
  }
  .hero-version {
    font-size: 10px;
    color: var(--km-text-muted);
    font-family: var(--km-font-mono);
  }

  /* Sys info — vertical column, aligns with 2-line hero-brand */
  .hero-sys {
    display: flex;
    flex-direction: column;
    justify-content: center;
    gap: var(--km-space-1-5);
    flex-shrink: 0;
  }
  .hero-sys span {
    display: inline-flex;
    align-items: center;
    gap: var(--km-space-1);
    font-size: var(--km-font-size-xs);
    color: var(--km-text-muted);
    white-space: nowrap;
  }

  /* Divider between brand and bridge */
  .hero-divider {
    width: 1px;
    height: 32px;
    background: var(--km-border);
    flex-shrink: 0;
  }

  /* Bridge section — inline, takes remaining width */
  .hero-bridge {
    display: flex;
    align-items: center;
    gap: var(--km-space-3);
    flex: 1;
    min-width: 0;
  }
  .bridge-dot {
    width: 8px; height: 8px; border-radius: 50%; flex-shrink: 0;
    background: var(--km-text-muted);
    transition: background 0.3s, box-shadow 0.3s;
  }
  .bridge-dot.on {
    background: var(--km-live);
    box-shadow: 0 0 8px var(--km-live);
    animation: dot-breathe 3s ease-in-out infinite;
  }
  @keyframes dot-breathe {
    0%,100% { box-shadow: 0 0 5px var(--km-live); }
    50%     { box-shadow: 0 0 14px var(--km-live); }
  }
  .bridge-status {
    font-size: var(--km-font-size-sm);
    font-weight: var(--km-font-weight-medium);
    flex-shrink: 0;
  }
  .bridge-url {
    flex: 1;
    font-size: var(--km-font-size-xs);
    color: var(--km-text-muted);
    font-family: var(--km-font-mono);
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
    min-width: 0;
  }
  .bridge-actions { display:flex; gap:var(--km-space-2); flex-shrink:0; }

  /* ─── Shared card ─── */
  .card {
    background: var(--km-bg-surface);
    border: 1px solid var(--km-border);
    border-radius: var(--km-radius-xl);
    overflow: hidden;
    display: flex;
    flex-direction: column;
  }
  .card-hdr {
    display: flex;
    align-items: center;
    gap: var(--km-space-2);
    padding: var(--km-space-3) var(--km-space-4);
    border-bottom: 1px solid var(--km-border);
    background: var(--km-bg-elevated);
    flex-shrink: 0;
  }
  .card-hdr-title {
    font-size: var(--km-font-size-sm);
    font-weight: var(--km-font-weight-semibold);
    color: var(--km-text-secondary);
    flex: 1;
  }
  .card-hdr km-icon { color: var(--km-accent-hover); }
  .card-body { flex:1; overflow-y:auto; padding: var(--km-space-2) 0; }

  /* ─── Zone: Project tree ─── */
  .zone-tree {
    grid-column: 1;
    animation: dash-in 0.35s var(--km-ease) both 0.1s;
  }

  .tree-empty {
    padding: var(--km-space-6);
    text-align: center;
    color: var(--km-text-muted);
    font-size: var(--km-font-size-sm);
    display: flex;
    flex-direction: column;
    align-items: center;
    gap: var(--km-space-3);
  }

  /* ── Root workspace header ── */
  .tree-root-item {
    display: flex;
    align-items: center;
    gap: var(--km-space-2);
    padding: var(--km-space-2-5) var(--km-space-4);
    cursor: pointer;
    font-size: var(--km-font-size-md);
    font-weight: var(--km-font-weight-semibold);
    color: var(--km-text-primary);
    border-left: 3px solid var(--km-accent);
    background: linear-gradient(90deg, rgba(37,99,235,0.10) 0%, transparent 100%);
    transition: background 0.15s var(--km-ease);
    letter-spacing: -0.01em;
  }
  .tree-root-item:hover {
    background: linear-gradient(90deg, rgba(37,99,235,0.16) 0%, transparent 100%);
  }
  .tree-root-dot {
    width: 9px; height: 9px; border-radius: 50%;
    background: var(--km-accent);
    box-shadow: 0 0 8px rgba(37,99,235,0.6);
    flex-shrink: 0;
    animation: dot-breathe 3s ease-in-out infinite;
  }

  /* ── Level 1 children ── */
  .tree-level {
    position: relative;
    padding-left: 22px;
    margin-left: 14px;
  }
  .tree-level::before {
    content: '';
    position: absolute;
    left: 0;
    top: 6px;
    bottom: 12px;
    width: 1px;
    background: rgba(37,99,235,0.2);
  }

  /* ── Tree item ── */
  .tree-item {
    display: flex;
    align-items: center;
    gap: var(--km-space-2);
    padding: 5px var(--km-space-3) 5px 0;
    cursor: pointer;
    font-size: var(--km-font-size-sm);
    color: var(--km-text-secondary);
    border-radius: var(--km-radius-md);
    position: relative;
    transition: background 0.12s var(--km-ease), color 0.12s var(--km-ease);
    margin-bottom: 1px;
  }
  .tree-item:hover {
    background: rgba(255,255,255,0.04);
    color: var(--km-text-primary);
  }
  /* Horizontal L-shaped stub */
  .tree-item::before {
    content: '';
    position: absolute;
    left: -22px;
    top: 50%;
    width: 16px;
    height: 1px;
    background: rgba(37,99,235,0.2);
  }

  /* ── Colored node dot per file type ── */
  .tree-node-dot {
    width: 6px; height: 6px;
    border-radius: 50%;
    flex-shrink: 0;
    border: 1.5px solid;
    transition: transform 0.15s var(--km-ease-spring), box-shadow 0.15s;
  }
  .tree-item:hover .tree-node-dot { transform: scale(1.4); }

  /* File type colors */
  .tree-item[data-type="pro"]     .tree-node-dot { border-color: var(--km-accent);   background: rgba(37,99,235,0.25); }
  .tree-item[data-type="pcb"]     .tree-node-dot { border-color: var(--km-accent);   background: rgba(37,99,235,0.15); }
  .tree-item[data-type="sch"]     .tree-node-dot { border-color: var(--km-trace);    background: rgba(16,185,129,0.15); }
  .tree-item[data-type="folder"]  .tree-node-dot { border-color: rgba(255,255,255,0.25); background: var(--km-bg-elevated); }
  .tree-item[data-type="km"]      .tree-node-dot { border-color: var(--km-live);     background: rgba(6,182,212,0.15); }
  .tree-item[data-type="lib"]     .tree-node-dot { border-color: var(--km-live);     background: rgba(6,182,212,0.10); }
  .tree-item[data-type="notes"]   .tree-node-dot { border-color: var(--km-warning);  background: rgba(245,158,11,0.12); }
  .tree-item[data-type="tasks"]   .tree-node-dot { border-color: var(--km-warning);  background: rgba(245,158,11,0.08); }

  /* Icon coloring per file type */
  .tree-item[data-type="pro"]    km-icon { color: var(--km-accent); }
  .tree-item[data-type="pcb"]    km-icon { color: var(--km-accent-hover); }
  .tree-item[data-type="sch"]    km-icon { color: var(--km-trace); }
  .tree-item[data-type="km"]     km-icon { color: var(--km-live); }
  .tree-item[data-type="lib"]    km-icon { color: var(--km-live); }
  .tree-item[data-type="notes"]  km-icon { color: var(--km-warning); }
  .tree-item[data-type="tasks"]  km-icon { color: var(--km-warning); }
  .tree-item km-icon { flex-shrink: 0; transition: color 0.12s; }

  .tree-item-name {
    flex: 1;
    min-width: 0;
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
    font-size: var(--km-font-size-sm);
  }

  /* File extension pill */
  .tree-ext {
    font-family: var(--km-font-mono);
    font-size: 9px;
    color: var(--km-text-muted);
    padding: 0 5px;
    border-radius: 3px;
    background: var(--km-bg-elevated);
    border: 1px solid var(--km-border);
    flex-shrink: 0;
    opacity: 0.8;
  }

  /* ── Level 2 (inside .kimaster) ── */
  .tree-level-2 {
    position: relative;
    padding-left: 20px;
    margin-left: 12px;
  }
  .tree-level-2::before {
    content: '';
    position: absolute;
    left: 0;
    top: 6px;
    bottom: 12px;
    width: 1px;
    background: rgba(6,182,212,0.15);
  }
  .tree-level-2 .tree-item { font-size: var(--km-font-size-xs); }
  .tree-level-2 .tree-item::before { left: -20px; background: rgba(6,182,212,0.15); }

  /* ─── Zone: Recent projects ─── */
  .zone-recent {
    grid-column: 2;
    animation: dash-in 0.35s var(--km-ease) both 0.15s;
  }

  .recent-item {
    display: flex;
    align-items: center;
    gap: var(--km-space-3);
    padding: var(--km-space-2-5) var(--km-space-4);
    cursor: pointer;
    transition: background 0.1s var(--km-ease);
  }
  .recent-item:hover { background: var(--km-bg-elevated); }
  .recent-dot {
    width: 6px; height: 6px; border-radius: 50%;
    background: var(--km-text-muted);
    flex-shrink: 0;
    transition: background 0.2s;
  }
  .recent-dot.active {
    background: var(--km-live);
    box-shadow: 0 0 5px var(--km-live);
  }
  .recent-name {
    font-size: var(--km-font-size-sm);
    font-weight: var(--km-font-weight-medium);
    min-width: 80px;
    flex-shrink: 0;
  }
  .recent-path {
    flex: 1;
    font-size: var(--km-font-size-xs);
    color: var(--km-text-muted);
    font-family: var(--km-font-mono);
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
    min-width: 0;
  }
  .recent-btns { display:flex; gap:4px; flex-shrink:0; }
  .icon-btn {
    background: none; border: none;
    padding: 4px; border-radius: var(--km-radius-sm);
    color: var(--km-text-muted); cursor: pointer;
    display: inline-flex; align-items: center;
    transition: color 0.1s, background 0.1s;
  }
  .icon-btn:hover { color: var(--km-text-primary); background: rgba(255,255,255,0.06); }
  .icon-btn.danger:hover { color: var(--km-danger); }

  .recent-empty {
    padding: var(--km-space-5);
    text-align: center;
    color: var(--km-text-muted);
    font-size: var(--km-font-size-sm);
  }

  /* ─── Shortcuts strip (pinned to bottom) ─── */
  .zone-shortcuts {
    flex-shrink: 0;
    padding: var(--km-space-3) var(--km-space-6) var(--km-space-4);
    background: var(--km-bg-primary);
    border-top: 1px solid var(--km-border);
    position: relative;
  }
  .shortcuts-scroll {
    display: flex;
    gap: var(--km-space-3);
    align-items: center;
    overflow-x: auto;
    padding-bottom: 2px; /* room for scrollbar */
    scrollbar-width: none;
  }
  .shortcuts-scroll::-webkit-scrollbar { display: none; }

  /* Individual tile */
  .sc-tile {
    flex-shrink: 0;
    width: 88px;
    height: 76px;
    display: flex;
    flex-direction: column;
    align-items: center;
    justify-content: center;
    gap: var(--km-space-2);
    background: var(--km-bg-surface);
    border: 1px solid var(--km-border);
    border-radius: var(--km-radius-xl);
    cursor: pointer;
    position: relative;
    transition: transform 0.18s var(--km-ease-spring),
                border-color 0.15s var(--km-ease),
                background 0.15s var(--km-ease),
                box-shadow 0.18s var(--km-ease);
    user-select: none;
  }
  .sc-tile:hover {
    border-color: var(--km-accent-border);
    background: var(--km-bg-elevated);
    transform: translateY(-2px);
    box-shadow: var(--km-shadow-sm);
  }
  .sc-tile:active { transform: translateY(0); }
  .sc-tile.dragging {
    opacity: 0.5;
    transform: scale(0.95);
  }
  .sc-tile.drag-over {
    border-color: var(--km-accent);
    background: var(--km-accent-muted);
  }
  .sc-tile km-icon { color: var(--km-text-muted); transition: color 0.15s; }
  .sc-tile:hover km-icon { color: var(--km-accent-hover); }
  .sc-tile-label {
    font-size: 10px;
    color: var(--km-text-muted);
    text-align: center;
    line-height: 1.2;
    max-width: 72px;
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
    transition: color 0.15s;
  }
  .sc-tile:hover .sc-tile-label { color: var(--km-text-secondary); }

  /* Badge on vault tiles */
  .sc-badge {
    position: absolute;
    top: 6px; right: 8px;
    font-size: 10px;
    font-family: var(--km-font-mono);
    font-weight: var(--km-font-weight-bold);
    color: var(--km-accent-hover);
    font-variant-numeric: tabular-nums;
  }

  /* Remove button (shown on hover) */
  .sc-remove {
    position: absolute;
    top: 4px; left: 4px;
    width: 16px; height: 16px;
    border-radius: 50%;
    background: rgba(239,68,68,0.15);
    border: none;
    color: var(--km-danger);
    font-size: 10px;
    display: none;
    align-items: center;
    justify-content: center;
    cursor: pointer;
    line-height: 1;
    padding: 0;
    transition: background 0.1s;
  }
  .sc-tile:hover .sc-remove { display: flex; }
  .sc-remove:hover { background: rgba(239,68,68,0.35); }

  /* Add tile */
  .sc-add {
    flex-shrink: 0;
    width: 44px;
    height: 76px;
    display: flex;
    align-items: center;
    justify-content: center;
    border: 1px dashed rgba(255,255,255,0.12);
    border-radius: var(--km-radius-xl);
    cursor: pointer;
    color: var(--km-text-muted);
    font-size: 18px;
    transition: all 0.15s var(--km-ease);
    position: relative;
  }
  .sc-add:hover {
    border-color: var(--km-accent-border);
    color: var(--km-accent-hover);
    background: var(--km-accent-muted);
  }

  /* Picker overlay */
  .sc-picker {
    position: absolute;
    bottom: calc(100% + var(--km-space-2));
    right: var(--km-space-6);
    width: 320px;
    background: var(--km-bg-surface);
    border: 1px solid var(--km-border-strong);
    border-radius: var(--km-radius-xl);
    box-shadow: var(--km-shadow-lg);
    backdrop-filter: blur(12px);
    z-index: 50;
    overflow: hidden;
    animation: dash-in 0.2s var(--km-ease-spring) both;
  }
  .sc-picker.hidden { display: none; }
  .sc-picker-hdr {
    padding: var(--km-space-3) var(--km-space-4);
    border-bottom: 1px solid var(--km-border);
    font-size: var(--km-font-size-sm);
    font-weight: var(--km-font-weight-semibold);
    color: var(--km-text-secondary);
    background: var(--km-bg-elevated);
  }
  .sc-picker-grid {
    display: grid;
    grid-template-columns: repeat(4, 1fr);
    gap: var(--km-space-2);
    padding: var(--km-space-3);
  }
  .sc-pick-item {
    display: flex;
    flex-direction: column;
    align-items: center;
    gap: var(--km-space-1);
    padding: var(--km-space-2) var(--km-space-1);
    border-radius: var(--km-radius-md);
    cursor: pointer;
    transition: background 0.1s;
  }
  .sc-pick-item:hover { background: var(--km-bg-elevated); }
  .sc-pick-item km-icon { color: var(--km-text-muted); }
  .sc-pick-item span {
    font-size: 10px;
    color: var(--km-text-muted);
    text-align: center;
    line-height: 1.2;
  }

  /* ─── Animations ─── */
  @keyframes dash-in {
    from { opacity:0; transform:translateY(8px); }
    to   { opacity:1; transform:translateY(0); }
  }

  /* ─── Shared buttons ─── */
  .btn {
    background: none;
    border: 1px solid var(--km-border);
    color: var(--km-text-secondary);
    padding: var(--km-space-1-5) var(--km-space-3);
    border-radius: var(--km-radius-sm);
    font-size: var(--km-font-size-xs);
    font-family: var(--km-font);
    cursor: pointer;
    display: inline-flex;
    align-items: center;
    gap: var(--km-space-1);
    transition: all 0.1s var(--km-ease);
  }
  .btn:hover { color: var(--km-text-primary); border-color: var(--km-accent); }
  .btn.primary { background: var(--km-accent); border-color: var(--km-accent); color:#fff; }
  .btn.primary:hover { background: var(--km-accent-hover); }
  .btn.danger:hover { border-color: var(--km-danger); color: var(--km-danger); }
</style>

<div class="dash-scroll">
  <div class="dash">

    <!-- Hero: [brand col] [pcb anim] [sys col] │ [bridge fills right] -->
    <div class="zone-hero" id="zone-hero">
      <!-- 1. Brand column — leftmost -->
      <div class="hero-brand">
        <div class="hero-title">KiMaster</div>
        <div class="hero-version" id="hero-ver">v0.1.0</div>
      </div>
      <!-- 2. PCB animation — centrepiece between brand and sys -->
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
      <!-- 3. System info column — stacks vertically aligned with brand -->
      <div class="hero-sys" id="hero-sys"></div>
      <!-- 4. Vertical divider -->
      <div class="hero-divider"></div>
      <!-- 5. Bridge status + URL + buttons — fills all remaining right space -->
      <div class="hero-bridge" id="hero-bridge">
        <div class="bridge-dot" id="bridge-dot"></div>
        <span class="bridge-status" id="bridge-status">Not connected</span>
        <span class="bridge-url" id="bridge-url"></span>
        <div class="bridge-actions" id="bridge-actions"></div>
      </div>
    </div>

    <!-- Project tree (left) -->
    <div class="zone-tree card" id="zone-tree">
      <div class="card-hdr">
        <km-icon name="folder-tree" size="sm"></km-icon>
        <span class="card-hdr-title">Project files</span>
      </div>
      <div class="card-body" id="tree-body"></div>
    </div>

    <!-- Recent projects (right) -->
    <div class="zone-recent card" id="zone-recent">
      <div class="card-hdr">
        <km-icon name="clock" size="sm"></km-icon>
        <span class="card-hdr-title">Recent projects</span>
      </div>
      <div class="card-body" id="recent-body"></div>
    </div>

  </div>
</div>

<!-- Shortcuts bar (pinned bottom) -->
<div class="zone-shortcuts" id="zone-shortcuts">
  <div class="shortcuts-scroll" id="sc-scroll"></div>
  <!-- Picker overlay -->
  <div class="sc-picker hidden" id="sc-picker">
    <div class="sc-picker-hdr">Add shortcut</div>
    <div class="sc-picker-grid" id="sc-picker-grid"></div>
  </div>
</div>
`;

/* ── Component ─────────────────────────────────────────────────────────────── */

export class KmDashboard extends HTMLElement {
  constructor() {
    super();
    this.attachShadow({ mode: 'open' });
    this.shadowRoot.appendChild(T.content.cloneNode(true));
    this._unsubs   = [];
    this._vault    = { components: 0, stackups: 0, templates: 0, blocks: 0 };
    this._dragIdx  = null;
    this._shortcuts = this._loadShortcuts();
  }

  connectedCallback() {
    this._renderHero();
    this._renderBridge();
    this._renderTree();
    this._renderShortcuts();
    this._loadRecent();
    this._loadVaultCounts();

    // Click-outside to close picker
    this.shadowRoot.addEventListener('click', (e) => {
      if (!e.target.closest('#sc-picker') && !e.target.closest('.sc-add')) {
        this._closePicker();
      }
    });

    this._unsubs.push(
      subscribe('bridgeConnected',    () => { this._renderBridge(); this._renderTree(); }),
      subscribe('boardComponents',    () => this._renderTree()),
      subscribe('bridgeKicadVersion', () => this._renderHero()),
      subscribe('bridgeBoardName',    () => this._renderTree()),
      subscribe('project',            () => { this._renderTree(); this._renderHero(); }),
    );
  }

  disconnectedCallback() {
    this._unsubs.forEach(u => u());
    this._unsubs = [];
  }

  // ── Hero ──────────────────────────────────────────────────────────────────

  _renderHero() {
    const ver = this.shadowRoot.getElementById('hero-ver');
    const sys = this.shadowRoot.getElementById('hero-sys');
    ver.textContent = `v${store.appVersion || '0.1.0'}`;

    const parts = [];
    if (store.bridgeKicadVersion)
      parts.push(`<span><km-icon name="cpu" size="sm"></km-icon> KiCad ${_e(store.bridgeKicadVersion)}</span>`);
    if (store.kicadCliPath)
      parts.push(`<span><km-icon name="check" size="sm" style="color:var(--km-trace)"></km-icon> kicad-cli found</span>`);
    else
      parts.push(`<span><km-icon name="warning" size="sm" style="color:var(--km-warning)"></km-icon> kicad-cli not found</span>`);
    sys.innerHTML = parts.join('');
  }

  // ── Bridge ────────────────────────────────────────────────────────────────

  _renderBridge() {
    const on  = store.bridgeConnected;
    const hero = this.shadowRoot.getElementById('zone-hero');
    const dot  = this.shadowRoot.getElementById('bridge-dot');
    const stat = this.shadowRoot.getElementById('bridge-status');
    const url  = this.shadowRoot.getElementById('bridge-url');
    const acts = this.shadowRoot.getElementById('bridge-actions');

    hero.classList.toggle('live', on);
    dot.classList.toggle('on', on);

    // Human-friendly status messages
    if (on) {
      stat.textContent = 'Connected to KiCad';
      url.textContent  = `Live sync${store.bridgeBoardName ? ` · ${store.bridgeBoardName}` : ''}`;
    } else {
      stat.textContent = 'Not connected';
      url.textContent  = 'Click "Connect" to start';
    }

    if (on) {
      acts.innerHTML = `
        <button class="btn" id="btn-refresh"><km-icon name="refresh" size="sm"></km-icon></button>
        <button class="btn danger" id="btn-disconnect">Disconnect</button>`;
      acts.querySelector('#btn-refresh')?.addEventListener('click', () =>
        import('../../../modules/kicad-bridge/BridgeClient.js').then(m => m.requestBoardState()));
      acts.querySelector('#btn-disconnect')?.addEventListener('click', () =>
        import('../../../modules/kicad-bridge/BridgeClient.js').then(m => m.disconnectBridge()));
    } else {
      acts.innerHTML = `<button class="btn primary" id="btn-connect">Connect</button>`;
      acts.querySelector('#btn-connect')?.addEventListener('click', () =>
        import('../../../modules/kicad-bridge/BridgeClient.js').then(m => m.showConnectGate(40001)));
    }
  }

  // ── Project tree ──────────────────────────────────────────────────────────

  _renderTree() {
    const body = this.shadowRoot.getElementById('tree-body');
    const proj = store.project;
    const boardName = store.bridgeBoardName;

    if (!proj && !boardName) {
      body.innerHTML = `
        <div class="tree-empty">
          <km-icon name="folder-open" size="xl" style="color:var(--km-text-muted);opacity:0.3"></km-icon>
          <div>No project open</div>
          <button class="btn primary" id="btn-open-tree">Open project</button>
        </div>`;
      body.querySelector('#btn-open-tree')?.addEventListener('click', () =>
        import('../../../modules/project/ProjectService.js').then(m => m.pickAndOpenProject()));
      return;
    }

    const name = proj?.name
      || boardName?.replace(/\\/g, '/').split('/').pop()?.replace(/\.kicad_pcb$/, '')
      || 'Project';
    const pcb  = proj?.pcb_file?.split(/[\\/]/).pop()
      || boardName?.split(/[\\/]/).pop() || null;
    const sch  = proj?.schematic_file?.split(/[\\/]/).pop()
      || (pcb ? pcb.replace(/\.kicad_pcb$/, '.kicad_sch') : null);
    const pro  = pcb ? pcb.replace(/\.kicad_pcb$/, '.kicad_pro') : null;

    body.innerHTML = `
      <div class="tree-root-item">
        <div class="tree-root-dot"></div>
        <km-icon name="folder-open" size="sm"></km-icon>
        <span>${_e(name)}</span>
      </div>
      <div class="tree-level">
        ${pro  ? _ti('file',      pro,  'pro')    : ''}
        ${pcb  ? _ti('pcb',       pcb,  'pcb')    : ''}
        ${sch  ? _ti('schematic', sch,  'sch')    : ''}
        ${_ti('folder',  '.kimaster/', 'km')}
        <div class="tree-level-2">
          ${_ti('vault',  'library/',   'lib')}
          ${_ti('notes',  'notes.md',   'notes')}
          ${_ti('task',   'tasks.json', 'tasks')}
        </div>
      </div>`;
  }

  // ── Vault counts ──────────────────────────────────────────────────────────

  async _loadVaultCounts() {
    try {
      const [c, s, t, b] = await Promise.all([
        invoke(UCE_GET_VAULT).catch(() => []),
        invoke(VAULT_LIST_STACKUPS).catch(() => []),
        invoke(VAULT_LIST_TEMPLATES).catch(() => []),
        invoke(VAULT_LIST_BLOCKS).catch(() => []),
      ]);
      if (!this.isConnected) return;
      this._vault = {
        components: c?.length ?? 0,
        stackups:   s?.length ?? 0,
        templates:  t?.length ?? 0,
        blocks:     b?.length ?? 0,
      };
      this._renderShortcuts();
    } catch (e) {
      Logger.warn('Dashboard', 'vault counts', e);
    }
  }

  // ── Recent projects ───────────────────────────────────────────────────────

  async _loadRecent() {
    const body = this.shadowRoot.getElementById('recent-body');
    try {
      const projects = await invoke(GET_RECENT_PROJECTS);
      // Guard: bail if component was removed from DOM while awaiting
      if (!this.isConnected) return;
      if (!projects?.length) {
        body.innerHTML = `<div class="recent-empty">No recent projects</div>`;
        return;
      }
      const currentName = store.project?.name || '';
      body.innerHTML = projects.map(p => {
        const name = p.name
          || p.path?.split(/[\\/]/).pop()?.replace(/\.kicad_pro$/, '')
          || '?';
        const active = name === currentName;
        return `
          <div class="recent-item" data-path="${_e(p.path || '')}">
            <div class="recent-dot${active ? ' active' : ''}"></div>
            <span class="recent-name">${_e(name)}</span>
            <span class="recent-path">${_e(p.path || '')}</span>
            <div class="recent-btns">
              <button class="icon-btn" title="Open folder" data-folder="${_e(p.path || '')}">
                <km-icon name="folder-open" size="sm"></km-icon>
              </button>
              <button class="icon-btn danger" title="Remove" data-remove="${_e(p.path || '')}">
                <km-icon name="trash" size="sm"></km-icon>
              </button>
            </div>
          </div>`;
      }).join('');

      for (const item of body.querySelectorAll('.recent-item')) {
        item.addEventListener('click', (e) => {
          if (e.target.closest('.icon-btn')) return;
          const path = item.dataset.path;
          if (path) {
            import('../../../modules/project/ProjectService.js')
              .then(m => m.openProject?.(path)
                ?? import('../../../core/Ipc.js').then(({ invoke: inv }) =>
                    inv('cmd_open_project', { pro_path: path })));
          }
        });
      }
    } catch (e) {
      Logger.warn('Dashboard', 'recent', e);
      body.innerHTML = `<div class="recent-empty">Could not load recent projects</div>`;
    }
  }

  // ── Shortcuts ─────────────────────────────────────────────────────────────

  _loadShortcuts() {
    try {
      const saved = localStorage.getItem(LS_KEY);
      if (saved) {
        const ids = JSON.parse(saved);
        const valid = ids.filter(id => ALL_SC.some(s => s.id === id));
        if (valid.length) return valid;
      }
    } catch (_) {}
    return [...DEFAULT_IDS];
  }

  _saveShortcuts() {
    localStorage.setItem(LS_KEY, JSON.stringify(this._shortcuts));
  }

  _renderShortcuts() {
    const scroll = this.shadowRoot.getElementById('sc-scroll');
    if (!scroll) return;

    const tiles = this._shortcuts.map((id, idx) => {
      const sc = ALL_SC.find(s => s.id === id);
      if (!sc) return '';
      const badge = sc.vk ? `<span class="sc-badge">${this._vault[sc.vk] ?? 0}</span>` : '';
      return `
        <div class="sc-tile" data-idx="${idx}" data-route="${sc.route}"
             draggable="true">
          <button class="sc-remove" data-remove="${idx}" title="Remove">×</button>
          ${badge}
          <km-icon name="${sc.icon}" size="md"></km-icon>
          <span class="sc-tile-label">${sc.label}</span>
        </div>`;
    });

    tiles.push(`<div class="sc-add" id="sc-add-btn" title="Add shortcut">＋</div>`);
    scroll.innerHTML = tiles.join('');

    // Wire navigation
    for (const tile of scroll.querySelectorAll('.sc-tile')) {
      tile.addEventListener('click', (e) => {
        if (e.target.closest('.sc-remove')) return;
        this._nav(tile.dataset.route);
      });
      // Remove button
      tile.querySelector('.sc-remove')?.addEventListener('click', (e) => {
        e.stopPropagation();
        const idx = parseInt(tile.dataset.idx);
        this._shortcuts.splice(idx, 1);
        this._saveShortcuts();
        this._renderShortcuts();
      });
      // Drag-to-reorder
      tile.addEventListener('dragstart', (e) => {
        this._dragIdx = parseInt(tile.dataset.idx);
        tile.classList.add('dragging');
        e.dataTransfer.effectAllowed = 'move';
      });
      tile.addEventListener('dragend', () => {
        tile.classList.remove('dragging');
        for (const t of scroll.querySelectorAll('.sc-tile'))
          t.classList.remove('drag-over');
        this._dragIdx = null;
      });
      tile.addEventListener('dragover', (e) => {
        e.preventDefault();
        if (this._dragIdx === null) return;
        const overIdx = parseInt(tile.dataset.idx);
        if (overIdx !== this._dragIdx) {
          for (const t of scroll.querySelectorAll('.sc-tile'))
            t.classList.toggle('drag-over', t.dataset.idx === String(overIdx));
        }
      });
      tile.addEventListener('drop', (e) => {
        e.preventDefault();
        if (this._dragIdx === null) return;
        const toIdx = parseInt(tile.dataset.idx);
        if (toIdx !== this._dragIdx) {
          const item = this._shortcuts.splice(this._dragIdx, 1)[0];
          this._shortcuts.splice(toIdx, 0, item);
          this._saveShortcuts();
          this._renderShortcuts();
        }
      });
    }

    // Add button
    scroll.querySelector('#sc-add-btn')?.addEventListener('click', (e) => {
      e.stopPropagation();
      this._togglePicker();
    });
  }

  _togglePicker() {
    const picker = this.shadowRoot.getElementById('sc-picker');
    if (!picker) return;
    const isHidden = picker.classList.contains('hidden');
    if (isHidden) {
      this._buildPicker();
      picker.classList.remove('hidden');
    } else {
      picker.classList.add('hidden');
    }
  }

  _closePicker() {
    this.shadowRoot.getElementById('sc-picker')?.classList.add('hidden');
  }

  _buildPicker() {
    const grid = this.shadowRoot.getElementById('sc-picker-grid');
    if (!grid) return;
    const available = ALL_SC.filter(s => !this._shortcuts.includes(s.id));
    if (available.length === 0) {
      grid.innerHTML = `<p style="grid-column:1/-1;text-align:center;color:var(--km-text-muted);font-size:12px;padding:8px">All shortcuts added</p>`;
      return;
    }
    grid.innerHTML = available.map(sc => `
      <div class="sc-pick-item" data-add="${sc.id}">
        <km-icon name="${sc.icon}" size="md"></km-icon>
        <span>${sc.label}</span>
      </div>`).join('');

    for (const item of grid.querySelectorAll('.sc-pick-item')) {
      item.addEventListener('click', () => {
        this._shortcuts.push(item.dataset.add);
        this._saveShortcuts();
        this._renderShortcuts();
        this._closePicker();
      });
    }
  }

  // ── Nav ───────────────────────────────────────────────────────────────────

  _nav(route) {
    this.dispatchEvent(new CustomEvent(KM_NAV, {
      bubbles: true, composed: true,
      detail: { route },
    }));
  }
}

/* ── Helpers ───────────────────────────────────────────────────────────────── */

function _e(s) {
  const d = document.createElement('div');
  d.textContent = String(s ?? '');
  return d.innerHTML;
}

/**
 * Tree item with colored node dot + icon + label + optional extension pill.
 * @param {string} icon  — km-icon name
 * @param {string} label — display label
 * @param {string} type  — data-type for CSS color scheme
 */
function _ti(icon, label, type = 'folder') {
  // Extract extension for the pill (e.g. ".kicad_pcb", ".md", ".json")
  const extMatch = label.match(/(\.[a-z0-9_]+)$/i);
  const ext = extMatch ? extMatch[1] : '';
  const baseName = ext ? label.slice(0, -ext.length) : label;
  const extPill = ext ? `<span class="tree-ext">${_e(ext)}</span>` : '';

  return `
    <div class="tree-item" data-type="${type}">
      <div class="tree-node-dot"></div>
      <km-icon name="${icon}" size="sm"></km-icon>
      <span class="tree-item-name">${_e(baseName)}</span>
      ${extPill}
    </div>`;
}

customElements.define('km-dashboard', KmDashboard);
