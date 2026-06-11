/**
 * @element km-netlist-graph
 * @summary Obsidian-style force-directed PCB netlist graph.
 *
 * Toolbar: Search · Filter (popover) · Group by · Focus · Net list toggle
 * Filter popover: Node types / Net types / Display — with badge count of active restrictions
 * Right panel: sortable net list with pad count, type, floating warning
 */

import ForceGraph from 'force-graph';
import { store, subscribe } from '../../../core/State.js';
import { invoke } from '../../../core/Ipc.js';
import { Logger } from '../../../core/Logger.js';
import { notify } from '../../../core/Notify.js';
import { GET_NETLIST_GRAPH } from '../../../core/AppCommands.js';

// ── Constants ─────────────────────────────────────────────────────────────────

const NODE_COLORS = {
  ic:          '#06b6d4',
  passive:     '#6b7280',
  connector:   '#3b82f6',
  testpoint:   '#9ca3af',
  power_net:   '#ef4444',
  signal_net:  '#10b981',
};

const NODE_TYPE_LABELS = {
  ic:          'IC / MCU',
  passive:     'Passive (R/C/L)',
  connector:   'Connector',
  testpoint:   'Test point',
  power_net:   'Power net',
  signal_net:  'Signal net',
};

// Default filter state — power nets hidden by default (common on all boards)
const DEFAULT_FILTERS = {
  showIc:          true,
  showPassive:     true,
  showConnector:   true,
  showTestpoint:   true,
  showPowerNet:    false,
  showSignalNet:   true,
  showFloating:    true,
  showCompLabels:  true,
  showNetLabels:   true,
  showPinNums:     false,
};

// ── Template ──────────────────────────────────────────────────────────────────

const TEMPLATE = document.createElement('template');
TEMPLATE.innerHTML = `
<style>
  :host {
    display: flex;
    flex-direction: column;
    height: 100%;
    font-family: var(--km-font);
    color: var(--km-text-primary);
    overflow: hidden;
  }

  /* ── Header ── */
  .header {
    display: flex;
    align-items: center;
    gap: var(--km-space-3);
    padding: var(--km-space-4) var(--km-space-6);
    flex-shrink: 0;
    border-bottom: 1px solid var(--km-border);
  }
  .header-title {
    font-size: var(--km-font-size-lg);
    font-weight: var(--km-font-weight-semibold);
    flex: 1;
  }

  /* ── Toolbar ── */
  .toolbar {
    display: flex;
    align-items: center;
    gap: var(--km-space-2);
    padding: 0 var(--km-space-4);
    height: 38px;
    flex-shrink: 0;
    border-bottom: 1px solid var(--km-border);
    background: var(--km-bg-surface);
  }

  /* Search */
  .search-wrap {
    position: relative;
    width: 200px;
    flex-shrink: 0;
  }
  .search-icon {
    position: absolute;
    left: 7px;
    top: 50%;
    transform: translateY(-50%);
    width: 11px;
    height: 11px;
    color: var(--km-text-muted);
    pointer-events: none;
  }
  .search-input {
    width: 100%;
    box-sizing: border-box;
    padding: 4px 8px 4px 24px;
    border: 1px solid var(--km-border);
    border-radius: var(--km-radius-xs);
    background: var(--km-bg-primary);
    color: var(--km-text-primary);
    font-family: var(--km-font);
    font-size: var(--km-font-size-xs);
    outline: none;
    transition: border-color var(--km-duration-fast);
  }
  .search-input:focus { border-color: var(--km-accent); }
  .search-input::placeholder { color: var(--km-text-muted); }

  /* Toolbar separator */
  .sep {
    width: 1px;
    height: 18px;
    background: var(--km-border);
    flex-shrink: 0;
  }

  /* Toolbar buttons (filter, net list) */
  .tool-btn {
    display: flex;
    align-items: center;
    gap: 5px;
    padding: 4px 10px;
    border: 1px solid var(--km-border);
    border-radius: var(--km-radius-xs);
    background: var(--km-bg-primary);
    color: var(--km-text-secondary);
    font-family: var(--km-font);
    font-size: var(--km-font-size-xs);
    cursor: pointer;
    white-space: nowrap;
    transition: all var(--km-duration-fast);
    position: relative;
  }
  .tool-btn:hover { background: var(--km-bg-elevated); color: var(--km-text-primary); }
  .tool-btn.active {
    background: var(--km-accent-muted);
    border-color: var(--km-accent-border);
    color: var(--km-accent);
  }
  .tool-btn svg { flex-shrink: 0; }

  /* Filter badge */
  .filter-badge {
    display: inline-flex;
    align-items: center;
    justify-content: center;
    min-width: 16px;
    height: 16px;
    padding: 0 4px;
    background: var(--km-accent);
    color: #fff;
    border-radius: 8px;
    font-size: 10px;
    font-weight: 600;
    line-height: 1;
  }
  .filter-badge.hidden { display: none; }

  /* Select dropdowns */
  .tool-select-wrap {
    position: relative;
    display: flex;
    align-items: center;
  }
  .tool-select {
    appearance: none;
    padding: 4px 22px 4px 8px;
    border: 1px solid var(--km-border);
    border-radius: var(--km-radius-xs);
    background: var(--km-bg-primary);
    color: var(--km-text-secondary);
    font-family: var(--km-font);
    font-size: var(--km-font-size-xs);
    cursor: pointer;
    outline: none;
    transition: all var(--km-duration-fast);
  }
  .tool-select:hover { border-color: var(--km-border-strong); color: var(--km-text-primary); }
  .tool-select:focus { border-color: var(--km-accent); }
  .select-arrow {
    position: absolute;
    right: 6px;
    top: 50%;
    transform: translateY(-50%);
    pointer-events: none;
    color: var(--km-text-muted);
    width: 10px;
    height: 10px;
  }

  /* Inline ref input (appears next to select when "connected to" chosen) */
  .ref-input {
    width: 80px;
    padding: 4px 7px;
    border: 1px solid var(--km-accent-border);
    border-radius: var(--km-radius-xs);
    background: var(--km-bg-primary);
    color: var(--km-text-primary);
    font-family: var(--km-font-mono);
    font-size: var(--km-font-size-xs);
    outline: none;
    margin-left: var(--km-space-1);
  }
  .ref-input.hidden { display: none; }

  /* Stats */
  .stats-text {
    margin-left: auto;
    font-size: var(--km-font-size-xs);
    color: var(--km-text-muted);
    font-variant-numeric: tabular-nums;
    white-space: nowrap;
    flex-shrink: 0;
  }

  /* ── Filter popover ── */
  .filter-wrap {
    position: relative;
    flex-shrink: 0;
  }

  .filter-popover {
    position: absolute;
    top: calc(100% + 6px);
    left: 0;
    z-index: 100;
    width: 280px;
    background: var(--km-bg-elevated);
    border: 1px solid var(--km-border);
    border-radius: var(--km-radius-md);
    box-shadow: 0 12px 32px rgba(0,0,0,.5);
    backdrop-filter: blur(8px);
    overflow: hidden;
    opacity: 1;
    transform: translateY(0);
    transition: opacity var(--km-duration-fast), transform var(--km-duration-fast);
  }
  .filter-popover.hidden {
    opacity: 0;
    transform: translateY(-6px);
    pointer-events: none;
  }

  .popover-header {
    display: flex;
    align-items: center;
    padding: var(--km-space-2) var(--km-space-3);
    border-bottom: 1px solid var(--km-border);
    background: var(--km-bg-surface);
    gap: var(--km-space-2);
  }
  .popover-title {
    font-size: var(--km-font-size-xs);
    font-weight: var(--km-font-weight-semibold);
    color: var(--km-text-secondary);
    flex: 1;
    text-transform: uppercase;
    letter-spacing: 0.05em;
  }
  .popover-reset {
    font-size: var(--km-font-size-xs);
    color: var(--km-text-muted);
    background: none;
    border: none;
    cursor: pointer;
    padding: 1px 6px;
    border-radius: var(--km-radius-xs);
    font-family: var(--km-font);
    transition: all var(--km-duration-fast);
  }
  .popover-reset:hover { color: var(--km-accent); background: var(--km-accent-muted); }
  .popover-close {
    background: none;
    border: none;
    color: var(--km-text-muted);
    cursor: pointer;
    line-height: 1;
    padding: 2px 4px;
    font-size: 13px;
    border-radius: var(--km-radius-xs);
  }
  .popover-close:hover { color: var(--km-text-primary); background: var(--km-bg-surface); }

  .popover-section {
    padding: var(--km-space-2-5) var(--km-space-3);
    border-bottom: 1px solid var(--km-border);
  }
  .popover-section:last-child { border-bottom: none; }

  .section-label {
    font-size: 10px;
    font-weight: var(--km-font-weight-semibold);
    color: var(--km-text-muted);
    text-transform: uppercase;
    letter-spacing: 0.06em;
    margin-bottom: var(--km-space-1-5);
  }

  .cb-grid {
    display: grid;
    grid-template-columns: 1fr 1fr;
    gap: var(--km-space-1) var(--km-space-2);
  }
  .cb-grid.single-col { grid-template-columns: 1fr; }

  .cb-item {
    display: flex;
    align-items: center;
    gap: 7px;
    cursor: pointer;
    font-size: var(--km-font-size-xs);
    color: var(--km-text-secondary);
    user-select: none;
    padding: 2px 0;
    transition: color var(--km-duration-fast);
  }
  .cb-item:hover { color: var(--km-text-primary); }

  .cb-dot {
    width: 8px;
    height: 8px;
    border-radius: 50%;
    flex-shrink: 0;
    opacity: 0.9;
  }

  /* Custom checkbox */
  .cb-item input[type="checkbox"] {
    width: 13px;
    height: 13px;
    accent-color: var(--km-accent);
    cursor: pointer;
    flex-shrink: 0;
  }

  /* ── Body: canvas + net list ── */
  .body {
    flex: 1;
    display: flex;
    overflow: hidden;
    min-height: 0;
  }

  .canvas-area {
    flex: 1;
    position: relative;
    overflow: hidden;
    min-width: 0;
  }
  #graph-canvas { width: 100%; height: 100%; }
  #graph-canvas canvas { display: block; }

  /* ── Net list panel ── */
  .net-panel {
    width: 240px;
    flex-shrink: 0;
    display: flex;
    flex-direction: column;
    border-left: 1px solid var(--km-border);
    background: var(--km-bg-surface);
    overflow: hidden;
    transition: width var(--km-duration-base) var(--km-ease);
  }
  .net-panel.collapsed { width: 0; border-left: none; }

  .net-panel-header {
    display: flex;
    align-items: center;
    padding: var(--km-space-2) var(--km-space-3);
    border-bottom: 1px solid var(--km-border);
    flex-shrink: 0;
    gap: var(--km-space-2);
  }
  .net-panel-title {
    font-size: 10px;
    font-weight: var(--km-font-weight-semibold);
    color: var(--km-text-muted);
    text-transform: uppercase;
    letter-spacing: 0.05em;
    flex: 1;
  }
  .net-panel-count {
    font-size: var(--km-font-size-xs);
    color: var(--km-text-muted);
    font-variant-numeric: tabular-nums;
  }

  .net-sort-row {
    display: flex;
    padding: 4px var(--km-space-2);
    gap: 2px;
    border-bottom: 1px solid var(--km-border);
    flex-shrink: 0;
  }
  .sort-btn {
    font-size: 10px;
    color: var(--km-text-muted);
    cursor: pointer;
    padding: 2px 6px;
    border-radius: var(--km-radius-xs);
    border: none;
    background: none;
    font-family: var(--km-font);
    transition: all var(--km-duration-fast);
  }
  .sort-btn:hover { color: var(--km-text-secondary); background: var(--km-bg-elevated); }
  .sort-btn.active { color: var(--km-accent); background: var(--km-accent-muted); }

  .net-list {
    flex: 1;
    overflow-y: auto;
    scrollbar-width: thin;
    scrollbar-color: transparent transparent;
  }
  .net-list:hover { scrollbar-color: var(--km-scrollbar-thumb) transparent; }

  .net-row {
    display: flex;
    align-items: center;
    gap: var(--km-space-2);
    padding: 5px var(--km-space-3);
    cursor: pointer;
    transition: background var(--km-duration-fast);
    border-bottom: 1px solid transparent;
    min-width: 0;
  }
  .net-row:hover { background: var(--km-bg-elevated); }
  .net-row.active { background: var(--km-accent-muted); }
  .net-row.dim { opacity: 0.3; }

  .net-dot { width: 6px; height: 6px; border-radius: 50%; flex-shrink: 0; }
  .net-name {
    font-family: var(--km-font-mono);
    font-size: var(--km-font-size-xs);
    color: var(--km-text-primary);
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
    flex: 1;
    min-width: 0;
  }
  .net-degree { font-size: 10px; color: var(--km-text-muted); font-variant-numeric: tabular-nums; flex-shrink: 0; }
  .net-warn { color: #fbbf24; font-size: 10px; flex-shrink: 0; }

  /* ── Node detail flyout ── */
  .flyout {
    position: absolute;
    top: var(--km-space-3);
    right: var(--km-space-3);
    width: 280px;
    background: var(--km-bg-elevated);
    border: 1px solid var(--km-border);
    border-radius: var(--km-radius-md);
    box-shadow: 0 8px 24px rgba(0,0,0,.45);
    backdrop-filter: blur(8px);
    font-size: var(--km-font-size-xs);
    display: none;
    z-index: 10;
    overflow: hidden;
  }
  .flyout.visible { display: block; }
  .flyout-header {
    display: flex;
    align-items: flex-start;
    gap: var(--km-space-2);
    padding: var(--km-space-2) var(--km-space-3);
    background: var(--km-bg-surface);
    border-bottom: 1px solid var(--km-border);
  }
  .flyout-dot { width: 8px; height: 8px; border-radius: 50%; flex-shrink: 0; margin-top: 3px; }
  .flyout-title-stack {
    flex: 1;
    min-width: 0;
    display: flex;
    flex-direction: column;
    gap: 2px;
  }
  .flyout-label {
    font-weight: var(--km-font-weight-semibold);
    font-family: var(--km-font-mono);
    font-size: var(--km-font-size-sm);
    color: var(--km-text-primary);
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
  }
  .flyout-type {
    font-size: 10px;
    color: var(--km-text-muted);
    white-space: nowrap;
  }
  .flyout-close {
    background: none; border: none;
    color: var(--km-text-muted); cursor: pointer;
    line-height: 1; padding: 2px;
    border-radius: var(--km-radius-xs);
  }
  .flyout-close:hover { color: var(--km-text-primary); background: var(--km-bg-surface); }
  .flyout-body {
    padding: var(--km-space-2) var(--km-space-3);
    max-height: 260px;
    overflow-y: auto;
  }
  .flyout-stat {
    display: flex;
    justify-content: space-between;
    align-items: center;
    padding: 3px 0;
    border-bottom: 1px solid var(--km-border);
  }
  .flyout-stat:last-of-type { border-bottom: none; }
  .flyout-stat-label { color: var(--km-text-muted); }
  .flyout-stat-val { font-family: var(--km-font-mono); color: var(--km-text-secondary); }
  .flyout-section-title {
    font-size: 10px;
    color: var(--km-text-muted);
    text-transform: uppercase;
    letter-spacing: 0.05em;
    margin: var(--km-space-2) 0 var(--km-space-1);
  }
  .flyout-chips { display: flex; flex-wrap: wrap; gap: 3px; }
  .flyout-chip {
    padding: 1px 6px;
    border-radius: var(--km-radius-xs);
    border: 1px solid var(--km-border);
    background: var(--km-bg-primary);
    font-family: var(--km-font-mono);
    color: var(--km-text-secondary);
    font-size: 10px;
  }
  .flyout-chip.warn { border-color: #fbbf2480; color: #fbbf24; }

  /* ── Empty / loading / error ── */
  .state-msg {
    display: flex;
    flex-direction: column;
    align-items: center;
    justify-content: center;
    height: 100%;
    gap: var(--km-space-3);
    color: var(--km-text-muted);
    text-align: center;
    padding: var(--km-space-8) var(--km-space-6);
  }
  .state-msg .msg { font-size: var(--km-font-size-sm); line-height: 1.6; }
  .state-msg.err { color: var(--km-danger); }
  .spinner {
    width: 26px; height: 26px;
    border: 2px solid var(--km-border);
    border-top-color: var(--km-accent);
    border-radius: 50%;
    animation: spin 0.8s linear infinite;
  }
  @keyframes spin { to { transform: rotate(360deg); } }

  /* ── Legend ── */
  .legend {
    position: absolute;
    bottom: var(--km-space-3);
    left: var(--km-space-3);
    background: color-mix(in srgb, var(--km-bg-elevated) 85%, transparent);
    border: 1px solid var(--km-border);
    border-radius: var(--km-radius-sm);
    padding: var(--km-space-2) var(--km-space-2-5);
    font-size: 10px;
    display: flex;
    flex-direction: column;
    gap: 3px;
    pointer-events: none;
    backdrop-filter: blur(6px);
  }
  .legend-row { display: flex; align-items: center; gap: 6px; color: var(--km-text-muted); }
  .legend-dot { width: 7px; height: 7px; border-radius: 50%; flex-shrink: 0; }

  .hidden { display: none !important; }
</style>

<!-- ── Header ── -->
<div class="header">
  <span class="header-title">Net Graph</span>
  <km-button variant="primary" size="sm" id="btn-load">Load Graph</km-button>
</div>

<!-- ── Toolbar ── -->
<div class="toolbar">
  <!-- Search -->
  <div class="search-wrap">
    <svg class="search-icon" viewBox="0 0 12 12" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round">
      <circle cx="5" cy="5" r="3.5"/><line x1="7.9" y1="7.9" x2="11" y2="11"/>
    </svg>
    <input class="search-input" id="search" type="text" placeholder="Search nets or refs…" autocomplete="off"/>
  </div>

  <div class="sep"></div>

  <!-- Filter button + popover -->
  <div class="filter-wrap">
    <button class="tool-btn" id="btn-filter" title="Show filter options">
      <svg width="12" height="12" viewBox="0 0 12 12" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round">
        <line x1="1" y1="3" x2="11" y2="3"/>
        <line x1="2.5" y1="6" x2="9.5" y2="6"/>
        <line x1="4" y1="9" x2="8" y2="9"/>
      </svg>
      Filter
      <span class="filter-badge hidden" id="filter-badge">0</span>
    </button>

    <!-- Popover -->
    <div class="filter-popover hidden" id="filter-popover">
      <div class="popover-header">
        <span class="popover-title">Filters</span>
        <button class="popover-reset" id="btn-reset">Reset all</button>
        <button class="popover-close" id="btn-close-popover">✕</button>
      </div>

      <!-- Node types -->
      <div class="popover-section">
        <div class="section-label">Node types</div>
        <div class="cb-grid">
          <label class="cb-item">
            <input type="checkbox" id="f-ic" checked>
            <span class="cb-dot" style="background:#06b6d4"></span>ICs
          </label>
          <label class="cb-item">
            <input type="checkbox" id="f-passive" checked>
            <span class="cb-dot" style="background:#6b7280"></span>Passives
          </label>
          <label class="cb-item">
            <input type="checkbox" id="f-connector" checked>
            <span class="cb-dot" style="background:#3b82f6"></span>Connectors
          </label>
          <label class="cb-item">
            <input type="checkbox" id="f-testpoint" checked>
            <span class="cb-dot" style="background:#9ca3af"></span>Test points
          </label>
        </div>
      </div>

      <!-- Net types -->
      <div class="popover-section">
        <div class="section-label">Net types</div>
        <div class="cb-grid">
          <label class="cb-item">
            <input type="checkbox" id="f-power">
            <span class="cb-dot" style="background:#ef4444"></span>Power (VCC/GND)
          </label>
          <label class="cb-item">
            <input type="checkbox" id="f-signal" checked>
            <span class="cb-dot" style="background:#10b981"></span>Signal nets
          </label>
          <label class="cb-item">
            <input type="checkbox" id="f-floating" checked>
            <span class="cb-dot" style="background:#fbbf24;box-shadow:0 0 4px #fbbf2480"></span>Floating nets
          </label>
        </div>
      </div>

      <!-- Display options -->
      <div class="popover-section">
        <div class="section-label">Display</div>
        <div class="cb-grid single-col">
          <label class="cb-item">
            <input type="checkbox" id="f-comp-labels" checked>
            Component labels (ref designators)
          </label>
          <label class="cb-item">
            <input type="checkbox" id="f-net-labels" checked>
            Net labels (net names)
          </label>
          <label class="cb-item">
            <input type="checkbox" id="f-pin-nums">
            Pin numbers on edges
          </label>
        </div>
      </div>
    </div>
  </div>

  <!-- Group by -->
  <div class="tool-select-wrap">
    <select class="tool-select" id="sel-groupby" title="Group nodes by category">
      <option value="none">Group by: None</option>
      <option value="type">By component type</option>
      <option value="power">By power net</option>
      <option value="connected">Connected to…</option>
    </select>
    <svg class="select-arrow" viewBox="0 0 10 10" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round"><path d="M2 3.5L5 6.5L8 3.5"/></svg>
    <input class="ref-input hidden" id="groupby-ref" type="text" placeholder="e.g. U1" autocomplete="off"/>
  </div>

  <!-- Focus -->
  <div class="tool-select-wrap">
    <select class="tool-select" id="sel-focus" title="Focus or dim parts of the graph">
      <option value="all">Focus: All</option>
      <option value="floating">Floating nets</option>
      <option value="power">Power only</option>
      <option value="connected">Connected to…</option>
    </select>
    <svg class="select-arrow" viewBox="0 0 10 10" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round"><path d="M2 3.5L5 6.5L8 3.5"/></svg>
    <input class="ref-input hidden" id="focus-ref" type="text" placeholder="ref or net…" autocomplete="off"/>
  </div>

  <div class="sep"></div>

  <!-- Net list toggle -->
  <button class="tool-btn active" id="tog-netlist" title="Toggle net list panel">
    <svg width="12" height="12" viewBox="0 0 12 12" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round">
      <line x1="1" y1="2.5" x2="11" y2="2.5"/>
      <line x1="1" y1="5.5" x2="11" y2="5.5"/>
      <line x1="1" y1="8.5" x2="11" y2="8.5"/>
    </svg>
    Net list
  </button>

  <button class="tool-btn" id="btn-reset-view" title="Reset to default view">
    <svg width="12" height="12" viewBox="0 0 12 12" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round">
      <path d="M10 6A4 4 0 1 1 8.5 2.5"/><polyline points="10 1 10 4 7 4"/>
    </svg>
    Reset
  </button>

  <span class="stats-text" id="stats-text"></span>
</div>

<!-- ── Body ── -->
<div class="body">
  <!-- Graph canvas -->
  <div class="canvas-area">
    <div id="graph-canvas"></div>

    <!-- Node detail flyout -->
    <div class="flyout" id="flyout">
      <div class="flyout-header">
        <div class="flyout-dot" id="flyout-dot"></div>
        <div class="flyout-title-stack">
          <span class="flyout-label" id="flyout-label"></span>
          <span class="flyout-type" id="flyout-type"></span>
        </div>
        <button class="flyout-close" id="flyout-close">✕</button>
      </div>
      <div class="flyout-body" id="flyout-body"></div>
    </div>

    <!-- Legend -->
    <div class="legend" id="legend">
      <div class="legend-row"><div class="legend-dot" style="background:#06b6d4"></div>IC / MCU</div>
      <div class="legend-row"><div class="legend-dot" style="background:#6b7280"></div>Passive</div>
      <div class="legend-row"><div class="legend-dot" style="background:#3b82f6"></div>Connector</div>
      <div class="legend-row"><div class="legend-dot" style="background:#ef4444"></div>Power net</div>
      <div class="legend-row"><div class="legend-dot" style="background:#10b981"></div>Signal net</div>
      <div class="legend-row"><div class="legend-dot" style="background:#fbbf24;box-shadow:0 0 4px #fbbf2480"></div>Floating</div>
    </div>
  </div>

  <!-- Net list panel -->
  <div class="net-panel" id="net-panel">
    <div class="net-panel-header">
      <span class="net-panel-title">Nets</span>
      <span class="net-panel-count" id="net-panel-count"></span>
    </div>
    <div class="net-sort-row">
      <button class="sort-btn active" data-sort="name">A–Z</button>
      <button class="sort-btn" data-sort="degree">Pads ↓</button>
      <button class="sort-btn" data-sort="type">Type</button>
      <button class="sort-btn" data-sort="floating">Floating</button>
    </div>
    <div class="net-list" id="net-list"></div>
  </div>
</div>
`;

// ── Component ─────────────────────────────────────────────────────────────────

export class NetlistGraph extends HTMLElement {
  constructor() {
    super();
    this.attachShadow({ mode: 'open' });
    this.shadowRoot.appendChild(TEMPLATE.content.cloneNode(true));

    this._graph        = null;
    this._hoveredNode  = null;
    this._floatingSet  = new Set();
    this._highlightIds = null;   // Set<id> for search highlight; null = no filter
    this._focusedIds   = null;   // Set<id> for Focus mode; null = show all
    this._activeNetId  = null;   // currently selected net in net list
    this._sortBy       = 'name';
    this._searchQuery  = '';
    this._groupBy      = 'none';
    this._focus        = 'all';
    this._showNetList  = true;
    this._popoverOpen  = false;
    this._unsubs       = [];
    this._resizeObs    = null;

    // Live filter state — mirrors the checkboxes
    this._f = { ...DEFAULT_FILTERS };
  }

  connectedCallback() {
    this._unsubs.push(
      subscribe('netlistGraph',       () => this._onDataChange()),
      subscribe('netlistGraphStatus', () => this._onStatusChange()),
    );

    this._wire();
    this._render();

    // Auto-load when navigated here from the dashboard widget
    // (widget sets status='loading' before navigating if no data exists yet)
    if (store.netlistGraphStatus === 'loading' && !store.netlistGraph) {
      this._load();
    }
  }

  disconnectedCallback() {
    for (const u of this._unsubs) u();
    this._unsubs = [];
    this._resizeObs?.disconnect();
    try { this._graph?._destructor?.(); } catch {}
    this._graph = null;
  }

  // ── Wiring ───────────────────────────────────────────────────────────────────

  _wire() {
    const sr = this.shadowRoot;

    sr.getElementById('btn-load')
      ?.addEventListener('km-click', () => this._load());

    // Filter popover open/close
    sr.getElementById('btn-filter')
      ?.addEventListener('click', (e) => { e.stopPropagation(); this._togglePopover(); });
    sr.getElementById('btn-close-popover')
      ?.addEventListener('click', () => this._closePopover());
    sr.getElementById('btn-reset')
      ?.addEventListener('click', () => this._resetFilters());

    // Close popover on outside click (composed: true traverses shadow boundary)
    document.addEventListener('click', (e) => {
      if (this._popoverOpen && !e.composedPath().includes(sr.getElementById('filter-wrap-root') ?? sr)) {
        this._closePopover();
      }
    });

    // Filter checkboxes
    const cbMap = {
      'f-ic':           'showIc',
      'f-passive':      'showPassive',
      'f-connector':    'showConnector',
      'f-testpoint':    'showTestpoint',
      'f-power':        'showPowerNet',
      'f-signal':       'showSignalNet',
      'f-floating':     'showFloating',
      'f-comp-labels':  'showCompLabels',
      'f-net-labels':   'showNetLabels',
      'f-pin-nums':     'showPinNums',
    };
    for (const [id, key] of Object.entries(cbMap)) {
      sr.getElementById(id)?.addEventListener('change', (e) => {
        this._f[key] = e.target.checked;
        this._onFilterChange();
      });
    }

    // Sync checkbox initial state from _f
    this._syncCheckboxes();

    // Search
    sr.getElementById('search')
      ?.addEventListener('input', (e) => {
        this._searchQuery = e.target.value.trim().toLowerCase();
        this._applySearch();
      });

    // Group by
    sr.getElementById('sel-groupby')
      ?.addEventListener('change', (e) => {
        this._groupBy = e.target.value;
        const refInput = sr.getElementById('groupby-ref');
        refInput?.classList.toggle('hidden', this._groupBy !== 'connected');
        this._applyGroupBy();
      });
    sr.getElementById('groupby-ref')
      ?.addEventListener('input', () => {
        if (this._groupBy === 'connected') this._applyGroupBy();
      });

    // Reset view
    sr.getElementById('btn-reset-view')
      ?.addEventListener('click', () => this._resetView());

    // Focus
    sr.getElementById('sel-focus')
      ?.addEventListener('change', (e) => {
        this._focus = e.target.value;
        const refInput = sr.getElementById('focus-ref');
        refInput?.classList.toggle('hidden', this._focus !== 'connected');
        this._applyFocus();
      });
    sr.getElementById('focus-ref')
      ?.addEventListener('input', () => this._applyFocus());

    // Net list toggle
    sr.getElementById('tog-netlist')
      ?.addEventListener('click', (e) => {
        this._showNetList = !this._showNetList;
        e.currentTarget.classList.toggle('active', this._showNetList);
        sr.getElementById('net-panel')?.classList.toggle('collapsed', !this._showNetList);
        requestAnimationFrame(() => this._syncSize());
      });

    // Sort buttons
    for (const btn of sr.querySelectorAll('.sort-btn')) {
      btn.addEventListener('click', () => {
        this._sortBy = btn.dataset.sort;
        for (const b of sr.querySelectorAll('.sort-btn')) b.classList.toggle('active', b === btn);
        this._renderNetList();
      });
    }

    // Flyout close
    sr.getElementById('flyout-close')
      ?.addEventListener('click', () => this._closeFlyout());
  }

  // ── Filter popover ───────────────────────────────────────────────────────────

  _togglePopover() {
    this._popoverOpen ? this._closePopover() : this._openPopover();
  }

  _openPopover() {
    this._popoverOpen = true;
    this.shadowRoot.getElementById('filter-popover')?.classList.remove('hidden');
    this.shadowRoot.getElementById('btn-filter')?.classList.add('active');
  }

  _closePopover() {
    this._popoverOpen = false;
    this.shadowRoot.getElementById('filter-popover')?.classList.add('hidden');
    this.shadowRoot.getElementById('btn-filter')?.classList.remove('active');
  }

  _resetFilters() {
    this._f = { ...DEFAULT_FILTERS };
    this._syncCheckboxes();
    this._onFilterChange();
  }

  _syncCheckboxes() {
    const sr = this.shadowRoot;
    const set = (id, val) => { const el = sr.getElementById(id); if (el) el.checked = val; };
    set('f-ic',          this._f.showIc);
    set('f-passive',     this._f.showPassive);
    set('f-connector',   this._f.showConnector);
    set('f-testpoint',   this._f.showTestpoint);
    set('f-power',       this._f.showPowerNet);
    set('f-signal',      this._f.showSignalNet);
    set('f-floating',    this._f.showFloating);
    set('f-comp-labels', this._f.showCompLabels);
    set('f-net-labels',  this._f.showNetLabels);
    set('f-pin-nums',    this._f.showPinNums);
  }

  _updateBadge() {
    // Count categories being hidden (unchecked) relative to "show everything"
    const hidden = [
      !this._f.showIc, !this._f.showPassive, !this._f.showConnector, !this._f.showTestpoint,
      !this._f.showPowerNet, !this._f.showSignalNet, !this._f.showFloating,
    ].filter(Boolean).length;

    const badge = this.shadowRoot.getElementById('filter-badge');
    if (!badge) return;
    if (hidden === 0) {
      badge.classList.add('hidden');
    } else {
      badge.classList.remove('hidden');
      badge.textContent = String(hidden);
    }
  }

  _onFilterChange() {
    this._updateBadge();
    if (this._graph) {
      this._graph.graphData(this._filteredData());
      this._applyFocus(); // recompute focus with new node set
    }
    this._renderNetList();
    this._updateStats();
  }

  // ── Data loading ─────────────────────────────────────────────────────────────

  async _load() {
    store.netlistGraphStatus = 'loading';
    store.netlistGraph       = null;
    try {
      const data = await invoke(GET_NETLIST_GRAPH);
      store.netlistGraph       = data;
      store.netlistGraphStatus = 'done';
    } catch (err) {
      Logger.error('NetlistGraph', err, 'cmd_get_netlist_graph failed');
      store.netlistGraphStatus = 'error';
      notify({ type: 'error', title: 'Netlist Graph Failed', message: String(err?.message ?? err) });
    }
  }

  _onStatusChange() { this._render(); }

  _onDataChange() {
    const data = store.netlistGraph;
    if (data) {
      this._floatingSet = new Set(data.floating_nets ?? []);
      this._updateBadge();
    }
    this._render();
  }

  // ── Render ───────────────────────────────────────────────────────────────────

  _render() {
    const status = store.netlistGraphStatus;
    const canvas = this.shadowRoot.getElementById('graph-canvas');

    if (status === 'loading') {
      this._destroyGraph();
      canvas.innerHTML = `<div class="state-msg"><div class="spinner"></div><span class="msg">Building graph for your board…</span></div>`;
      this._clearNetList();
      return;
    }

    if (status === 'error') {
      this._destroyGraph();
      canvas.innerHTML = `<div class="state-msg err"><km-icon name="warning" size="xl"></km-icon><span class="msg">Could not load graph.<br>Make sure the KiCad bridge or IPC is connected<br>and a PCB is open.</span></div>`;
      this._clearNetList();
      return;
    }

    if (status === 'idle' || !store.netlistGraph) {
      this._destroyGraph();
      canvas.innerHTML = `<div class="state-msg"><km-icon name="net" size="xl" style="opacity:0.2"></km-icon><span class="msg">Click <strong>Load Graph</strong> to visualize<br>your PCB netlist as an interactive graph.</span></div>`;
      this._clearNetList();
      return;
    }

    if (!this._graph) {
      this._buildGraph();
      this._applyFocus();
    } else {
      this._graph.graphData(this._filteredData());
    }

    this._renderNetList();
    this._updateStats();
  }

  // ── Graph ─────────────────────────────────────────────────────────────────────

  _buildGraph() {
    const canvas = this.shadowRoot.getElementById('graph-canvas');
    canvas.innerHTML = '';

    this._graph = ForceGraph()(canvas)
      .graphData(this._filteredData())
      .nodeId('id')
      .nodeLabel(n => `${n.label}${n.sub ? ` — ${n.sub}` : ''}`)
      .nodeColor(n => NODE_COLORS[n.node_type] ?? '#888')
      .nodeVal(n => Math.max(2, Math.sqrt(n.degree + 1) * 4))
      .nodeCanvasObject((node, ctx, gs) => this._drawNode(node, ctx, gs))
      .nodeCanvasObjectMode(() => 'replace')
      .linkColor(l => this._linkColor(l))
      .linkWidth(l => this._linkWidth(l))
      .linkLabel(l => this._f.showPinNums ? `Pin ${l.pin}` : '')
      .backgroundColor('transparent')
      .onNodeClick(n => this._showFlyout(n))
      .onNodeHover(n => { this._hoveredNode = n || null; })
      .cooldownTicks(Infinity)  // never stop RAF loop via tick counter
      .d3AlphaMin(0)            // simulation never reaches natural stop threshold
      .d3AlphaDecay(0.05)       // physics converges fast (~2s), then alpha ≈ 0 → no movement
      .d3VelocityDecay(0.6);    // strong damping so nodes stop quickly

    this._syncSize();

    this._resizeObs = new ResizeObserver(() => this._syncSize());
    this._resizeObs.observe(canvas);
  }

  _drawNode(node, ctx, gs) {
    const color     = NODE_COLORS[node.node_type] ?? '#888';
    const isNet     = node.id.startsWith('net:');
    const r         = Math.max(3, Math.sqrt(node.degree + 1) * 2);
    const isFloat   = isNet && this._floatingSet.has(node.label);
    const focused   = !this._focusedIds || this._focusedIds.has(node.id);
    const matched   = !this._highlightIds || this._highlightIds.has(node.id);
    const dim       = !focused || !matched;
    const isHovered = this._hoveredNode?.id === node.id;

    ctx.globalAlpha = dim ? 0.12 : 0.9;

    // Hover highlight ring — drawn first so it sits behind the node
    if (isHovered && !dim) {
      ctx.beginPath();
      ctx.arc(node.x, node.y, r + 5, 0, 2 * Math.PI);
      ctx.fillStyle = `${color}33`;
      ctx.fill();
      ctx.strokeStyle = `${color}99`;
      ctx.lineWidth = 1.5 / gs;
      ctx.stroke();
    }

    // Floating pulse ring
    if (isFloat && !dim) {
      const alpha = 0.35 + 0.35 * Math.sin((Date.now() % 1600) / 1600 * Math.PI * 2);
      ctx.beginPath();
      ctx.arc(node.x, node.y, r + 4, 0, 2 * Math.PI);
      ctx.strokeStyle = `rgba(251,191,36,${alpha})`;
      ctx.lineWidth = 1.5;
      ctx.stroke();
    }

    // Active net ring (from net list click)
    if (this._activeNetId === node.id) {
      ctx.beginPath();
      ctx.arc(node.x, node.y, r + 5, 0, 2 * Math.PI);
      ctx.strokeStyle = 'rgba(255,255,255,0.55)';
      ctx.lineWidth = 2;
      ctx.stroke();
    }

    // Node body
    ctx.beginPath();
    if (isNet) {
      ctx.arc(node.x, node.y, r, 0, 2 * Math.PI);
    } else {
      const w = r * 2 + 4, h = r * 1.7;
      ctx.roundRect(node.x - w / 2, node.y - h / 2, w, h, 2);
    }
    ctx.fillStyle = color;
    ctx.fill();
    ctx.globalAlpha = 1;

    // ── Inline label — only when node is large enough to contain the text ──────
    const showCompLabel = this._f.showCompLabels && !isNet;
    const showNetLabel  = this._f.showNetLabels  && isNet;

    if ((showCompLabel || showNetLabel) && !dim && !isHovered) {
      const fontSize = Math.max(3.5, 10 / gs);
      ctx.font = `${fontSize}px monospace`;
      const textW = ctx.measureText(node.label).width;
      // Only draw inside the node if the text actually fits
      const fits = isNet ? (r * 2 > textW + 2) : (r * 2 + 4 > textW + 2);
      if (fits && (gs > 1.0 || node.degree > 3)) {
        ctx.fillStyle = 'rgba(255,255,255,0.92)';
        ctx.textAlign = 'center';
        ctx.textBaseline = 'middle';
        ctx.fillText(node.label, node.x, node.y);
      }
    }

    // ── Hover tooltip — always shown on hover, floating above the node ─────────
    if (isHovered) {
      this._drawHoverTooltip(node, ctx, gs, r, color);
    }
  }

  _drawHoverTooltip(node, ctx, gs, r, color) {
    const label    = node.label;
    const subLabel = node.sub || (node.node_type ? NODE_TYPE_LABELS[node.node_type] : '');
    const degLabel = `${node.degree} pad${node.degree !== 1 ? 's' : ''}`;

    // Font sizes — keep readable regardless of zoom
    const fs1 = Math.min(13, Math.max(9, 13 / gs));   // label font
    const fs2 = Math.min(10, Math.max(7,  10 / gs));  // sub + degree font

    ctx.font = `bold ${fs1}px monospace`;
    const labelW = ctx.measureText(label).width;

    ctx.font = `${fs2}px sans-serif`;
    const subW = subLabel ? ctx.measureText(subLabel).width : 0;
    const degW = ctx.measureText(degLabel).width;

    const innerW  = Math.max(labelW, subW + degW + 8 / gs);
    const pad     = 7 / gs;
    const lineGap = 3 / gs;
    const boxW    = innerW + pad * 2;
    const boxH    = fs1 + (subLabel ? fs2 + lineGap : 0) + pad * 2;

    // Position above the node, centred horizontally
    const bx = node.x - boxW / 2;
    const by = node.y - r - 8 / gs - boxH;

    // Shadow for depth
    ctx.shadowColor   = 'rgba(0,0,0,0.6)';
    ctx.shadowBlur    = 8 / gs;
    ctx.shadowOffsetY = 2 / gs;

    // Pill background
    ctx.beginPath();
    const rad = Math.min(4 / gs, boxH / 2);
    ctx.roundRect(bx, by, boxW, boxH, rad);
    ctx.fillStyle = 'rgba(8,8,16,0.93)';
    ctx.fill();

    // Accent left border strip
    ctx.beginPath();
    ctx.roundRect(bx, by, 3 / gs, boxH, [rad, 0, 0, rad]);
    ctx.fillStyle = color;
    ctx.fill();

    ctx.shadowColor = 'transparent';
    ctx.shadowBlur  = 0;

    // Border
    ctx.beginPath();
    ctx.roundRect(bx, by, boxW, boxH, rad);
    ctx.strokeStyle = `${color}55`;
    ctx.lineWidth   = 0.8 / gs;
    ctx.stroke();

    // Label text
    const tx = node.x + 1 / gs;
    ctx.font      = `bold ${fs1}px monospace`;
    ctx.fillStyle = '#ffffff';
    ctx.textAlign = 'center';
    ctx.textBaseline = 'top';
    ctx.fillText(label, tx, by + pad);

    // Sub-line: type/value on left, pad count on right
    if (subLabel) {
      const sy = by + pad + fs1 + lineGap;
      ctx.font      = `${fs2}px sans-serif`;
      ctx.fillStyle = 'rgba(255,255,255,0.5)';
      ctx.textAlign = 'left';
      ctx.fillText(subLabel, bx + pad + 3 / gs, sy);
      ctx.fillStyle = `${color}cc`;
      ctx.textAlign = 'right';
      ctx.fillText(degLabel, bx + boxW - pad, sy);
    }
  }

  _linkColor(link) {
    const sid = typeof link.source === 'object' ? link.source.id : link.source;
    const tid = typeof link.target === 'object' ? link.target.id : link.target;

    const activePath = this._activeNetId && (sid === this._activeNetId || tid === this._activeNetId);
    if (activePath) return 'rgba(255,255,255,0.55)';

    const focused = (!this._focusedIds || (this._focusedIds.has(sid) && this._focusedIds.has(tid)));
    const matched = (!this._highlightIds || (this._highlightIds.has(sid) && this._highlightIds.has(tid)));

    if (!focused || !matched) return 'rgba(99,120,150,0.04)';
    return 'rgba(99,180,150,0.3)';
  }

  _linkWidth(link) {
    const sid = typeof link.source === 'object' ? link.source.id : link.source;
    const tid = typeof link.target === 'object' ? link.target.id : link.target;
    const active = this._activeNetId && (sid === this._activeNetId || tid === this._activeNetId);
    return active ? 2 : 1;
  }

  _syncSize() {
    const canvas = this.shadowRoot.getElementById('graph-canvas');
    if (!this._graph || !canvas) return;
    this._graph.width(canvas.clientWidth).height(canvas.clientHeight);
  }

  // ── Filtering ─────────────────────────────────────────────────────────────────

  _filteredData() {
    const data = store.netlistGraph;
    if (!data) return { nodes: [], links: [] };

    const excl = new Set();
    const nodes = data.nodes.filter(n => {
      const keep =
        (n.node_type === 'ic'         && this._f.showIc)        ||
        (n.node_type === 'passive'    && this._f.showPassive)    ||
        (n.node_type === 'connector'  && this._f.showConnector)  ||
        (n.node_type === 'testpoint'  && this._f.showTestpoint)  ||
        (n.node_type === 'power_net'  && this._f.showPowerNet)   ||
        (n.node_type === 'signal_net' && this._f.showSignalNet)  ||
        (n.node_type === 'signal_net' && this._floatingSet.has(n.label) && this._f.showFloating);

      // Extra: if showFloating=false, hide floating signal nets even if showSignalNet=true
      if (n.node_type === 'signal_net' && this._floatingSet.has(n.label) && !this._f.showFloating) {
        excl.add(n.id); return false;
      }

      if (!keep) { excl.add(n.id); return false; }
      return true;
    });

    const links = data.links.filter(l => !excl.has(l.source) && !excl.has(l.target));
    return { nodes, links };
  }

  // ── Search ────────────────────────────────────────────────────────────────────

  _applySearch() {
    const q = this._searchQuery;
    if (!q) {
      this._highlightIds = null;
    } else {
      const data = store.netlistGraph;
      if (!data) { this._highlightIds = null; }
      else {
        const matched = new Set(
          data.nodes.filter(n => n.label.toLowerCase().includes(q) || n.sub.toLowerCase().includes(q)).map(n => n.id)
        );
        // Expand to include direct neighbours of matched nodes
        for (const l of data.links) {
          if (matched.has(l.source)) matched.add(l.target);
          if (matched.has(l.target)) matched.add(l.source);
        }
        this._highlightIds = matched;
      }
    }
    if (this._graph) this._graph.graphData(this._filteredData());
    this._renderNetList();
    this._updateStats();
  }

  // ── Group by ──────────────────────────────────────────────────────────────────

  _applyGroupBy() {
    if (!this._graph) return;

    // Step 1: always refresh graphData so force-graph's internal node objects
    // are up-to-date before we read them back. This fixes the "works once" bug
    // where fy was set on stale references from the previous graphData call.
    this._graph.graphData(this._filteredData());

    // Step 2: read the INTERNAL node objects (force-graph decorates them with
    // x/y/vx/vy). Setting fy on these is what actually constrains the simulation.
    const { nodes } = this._graph.graphData();

    const TYPE_Y = {
      ic:          -200,
      connector:   -100,
      signal_net:    0,
      passive:      120,
      testpoint:    200,
      power_net:    280,
    };

    const POWER_Y = {
      power_net:   -220,  // power net nodes at top
      ic:          -100,  // ICs connected to power just below
      connector:     60,
      signal_net:   160,
      passive:      200,
      testpoint:    260,
    };

    const mode = this._groupBy;

    for (const n of nodes) {
      delete n.fx;

      if (mode === 'none') {
        delete n.fy;

      } else if (mode === 'type') {
        n.fy = TYPE_Y[n.node_type] ?? 0;

      } else if (mode === 'power') {
        // Power nets at top band; components connected to power just below;
        // everything else spread below that.
        n.fy = POWER_Y[n.node_type] ?? 0;

      } else if (mode === 'connected') {
        const ref = this.shadowRoot.getElementById('groupby-ref')?.value?.trim();
        if (!ref) { delete n.fy; continue; }

        const data = store.netlistGraph;
        const q    = ref.toLowerCase();
        // Match by prefix (case-insensitive) — "u1" matches "comp:U1"
        const seedIds = new Set(
          (data?.nodes ?? [])
            .filter(dn => dn.label.toLowerCase() === q || dn.id.toLowerCase().includes(q))
            .map(dn => dn.id)
        );
        // Expand one hop
        for (const l of data?.links ?? []) {
          if (seedIds.has(l.source)) seedIds.add(l.target);
          if (seedIds.has(l.target)) seedIds.add(l.source);
        }

        // Connected cluster → center (no fy), others pushed to bottom band
        if (seedIds.has(n.id)) {
          delete n.fy;
        } else {
          n.fy = 300;
        }

        // Also focus the graph on the connected subgraph
        this._focusedIds = seedIds;
      }
    }

    // Step 3: reheat so the simulation responds to the new fy constraints
    this._graph.d3ReheatSimulation();
  }

  // ── Focus ─────────────────────────────────────────────────────────────────────

  _applyFocus() {
    const data = store.netlistGraph;
    if (!data || !this._graph) return;

    const mode = this._focus;

    if (mode === 'all') {
      this._focusedIds = null;
      this._graph.graphData(this._filteredData());
      return;
    }

    if (mode === 'floating') {
      this._focusedIds = new Set(
        data.nodes.filter(n => n.id.startsWith('net:') && this._floatingSet.has(n.label)).map(n => n.id)
      );
      // Include components connected to floating nets
      for (const l of data.links) {
        if (this._focusedIds.has(l.source)) this._focusedIds.add(l.target);
        if (this._focusedIds.has(l.target)) this._focusedIds.add(l.source);
      }
    } else if (mode === 'power') {
      this._focusedIds = new Set(data.nodes.filter(n => n.node_type === 'power_net').map(n => n.id));
      for (const l of data.links) {
        if (this._focusedIds.has(l.source)) this._focusedIds.add(l.target);
        if (this._focusedIds.has(l.target)) this._focusedIds.add(l.source);
      }
    } else if (mode === 'connected') {
      const ref = this.shadowRoot.getElementById('focus-ref')?.value?.trim();
      if (!ref) { this._focusedIds = null; }
      else {
        const q = ref.toLowerCase();
        const seed = new Set(data.nodes.filter(n => n.label.toLowerCase() === q || n.label.toLowerCase().includes(q)).map(n => n.id));
        for (const l of data.links) {
          if (seed.has(l.source)) seed.add(l.target);
          if (seed.has(l.target)) seed.add(l.source);
        }
        this._focusedIds = seed;
      }
    }

    this._graph.graphData(this._filteredData());
  }

  // ── Reset view ───────────────────────────────────────────────────────────────

  _resetView() {
    const sr = this.shadowRoot;

    // Reset search
    this._searchQuery  = '';
    this._highlightIds = null;
    const searchEl = sr.getElementById('search');
    if (searchEl) searchEl.value = '';

    // Reset filters to defaults
    this._f = { ...DEFAULT_FILTERS };
    this._syncCheckboxes();
    this._updateBadge();

    // Reset group by
    this._groupBy = 'none';
    const groupSel = sr.getElementById('sel-groupby');
    if (groupSel) groupSel.value = 'none';
    sr.getElementById('groupby-ref')?.classList.add('hidden');
    const gbRef = sr.getElementById('groupby-ref');
    if (gbRef) gbRef.value = '';

    // Reset focus
    this._focus = 'all';
    this._focusedIds = null;
    const focusSel = sr.getElementById('sel-focus');
    if (focusSel) focusSel.value = 'all';
    sr.getElementById('focus-ref')?.classList.add('hidden');
    const fRef = sr.getElementById('focus-ref');
    if (fRef) fRef.value = '';

    // Reset active net
    this._activeNetId = null;
    this._closeFlyout();

    // Re-apply to graph — clear all fy/fx and reheat
    if (this._graph) {
      const { nodes } = this._graph.graphData();
      for (const n of nodes) { delete n.fx; delete n.fy; }
      this._graph.graphData(this._filteredData());
      this._graph.d3ReheatSimulation();
      // Zoom to fit after a short settle time
      setTimeout(() => this._graph?.zoomToFit(400, 40), 500);
    }

    this._renderNetList();
    this._updateStats();
  }

  // ── Net list ──────────────────────────────────────────────────────────────────

  _clearNetList() {
    const el = this.shadowRoot.getElementById('net-list');
    if (el) el.innerHTML = '';
    const cnt = this.shadowRoot.getElementById('net-panel-count');
    if (cnt) cnt.textContent = '';
  }

  _renderNetList() {
    const container = this.shadowRoot.getElementById('net-list');
    const countEl   = this.shadowRoot.getElementById('net-panel-count');
    if (!container) return;

    const data = store.netlistGraph;
    if (!data) { container.innerHTML = ''; return; }

    let nets = data.nodes.filter(n => {
      if (!n.id.startsWith('net:')) return false;
      if (n.node_type === 'power_net' && !this._f.showPowerNet) return false;
      if (n.node_type === 'signal_net' && !this._f.showSignalNet) return false;
      if (this._floatingSet.has(n.label) && !this._f.showFloating) return false;
      return true;
    });

    if (this._searchQuery) nets = nets.filter(n => n.label.toLowerCase().includes(this._searchQuery));

    nets = [...nets].sort((a, b) => {
      if (this._sortBy === 'degree')   return b.degree - a.degree;
      if (this._sortBy === 'type')     return a.node_type.localeCompare(b.node_type) || a.label.localeCompare(b.label);
      if (this._sortBy === 'floating') {
        const diff = (this._floatingSet.has(a.label) ? 0 : 1) - (this._floatingSet.has(b.label) ? 0 : 1);
        return diff || a.label.localeCompare(b.label);
      }
      return a.label.localeCompare(b.label);
    });

    if (countEl) countEl.textContent = String(nets.length);

    const q = this._searchQuery;
    container.innerHTML = nets.map(n => {
      const isFloat  = this._floatingSet.has(n.label);
      const isActive = this._activeNetId === n.id;
      const dimmed   = (this._highlightIds && !this._highlightIds.has(n.id)) ||
                       (this._focusedIds && !this._focusedIds.has(n.id));
      const color    = NODE_COLORS[n.node_type] ?? '#888';

      // Bold-highlight the matching substring in the net name
      const displayName = q
        ? _esc(n.label).replace(new RegExp(`(${q.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')})`, 'gi'),
            '<mark style="background:var(--km-accent-muted);color:var(--km-accent);border-radius:2px">$1</mark>')
        : _esc(n.label);

      return `<div class="net-row${isActive ? ' active' : ''}${dimmed ? ' dim' : ''}" data-id="${n.id}" data-label="${_esc(n.label)}">
        <div class="net-dot" style="background:${color}"></div>
        <span class="net-name" title="${_esc(n.label)}">${displayName}</span>
        <span class="net-degree">${n.degree}p</span>
        ${isFloat ? '<span class="net-warn" title="Floating — connected to fewer than 2 pads">⚠</span>' : ''}
      </div>`;
    }).join('');

    for (const row of container.querySelectorAll('.net-row')) {
      row.addEventListener('click', () => {
        const id = row.dataset.id;
        this._activeNetId = (this._activeNetId === id) ? null : id;
        this._renderNetList();
        if (this._graph) this._graph.graphData(this._filteredData());

        if (this._activeNetId) {
          const node = data.nodes.find(n => n.id === id);
          if (node) this._showFlyout(node);
          // Centre graph on this node
          const gNode = this._graph?.graphData().nodes.find(n => n.id === id);
          if (gNode) this._graph.centerAt(gNode.x, gNode.y, 600);
        } else {
          this._closeFlyout();
        }
      });
    }
  }

  // ── Flyout ────────────────────────────────────────────────────────────────────

  _showFlyout(node) {
    const sr    = this.shadowRoot;
    const isNet = node.id.startsWith('net:');
    const data  = store.netlistGraph;

    sr.getElementById('flyout-dot').style.background = NODE_COLORS[node.node_type] ?? '#888';
    sr.getElementById('flyout-label').textContent    = node.label;
    sr.getElementById('flyout-type').textContent     = NODE_TYPE_LABELS[node.node_type] ?? node.node_type;

    const body  = sr.getElementById('flyout-body');
    const float = isNet && this._floatingSet.has(node.label);

    if (isNet) {
      const comps = data.links
        .filter(l => l.target === node.id || l.source === node.id)
        .map(l => (l.source === node.id ? l.target : l.source).replace('comp:', ''));
      body.innerHTML = `
        <div class="flyout-stat"><span class="flyout-stat-label">Pads connected</span><span class="flyout-stat-val">${node.degree}</span></div>
        <div class="flyout-stat"><span class="flyout-stat-label">Components</span><span class="flyout-stat-val">${comps.length}</span></div>
        ${float ? `<div class="flyout-stat"><span class="flyout-stat-label" style="color:#fbbf24">⚠ Floating net</span><span class="flyout-stat-val" style="color:#fbbf24">degree &lt; 2</span></div>` : ''}
        <div class="flyout-section-title">Connected components</div>
        <div class="flyout-chips">
          ${comps.map(r => `<span class="flyout-chip">${_esc(r)}</span>`).join('') || '<span style="opacity:.4;font-size:10px">none</span>'}
        </div>`;
    } else {
      const nets = data.links
        .filter(l => l.source === node.id)
        .map(l => ({ net: l.target.replace('net:', ''), pin: l.pin, float: this._floatingSet.has(l.target.replace('net:', '')) }));
      body.innerHTML = `
        <div class="flyout-stat"><span class="flyout-stat-label">Value</span><span class="flyout-stat-val">${_esc(node.sub || '—')}</span></div>
        <div class="flyout-stat"><span class="flyout-stat-label">Net connections</span><span class="flyout-stat-val">${nets.length}</span></div>
        <div class="flyout-section-title">Connected nets</div>
        <div class="flyout-chips">
          ${nets.map(({ net, pin, float: f }) =>
            `<span class="flyout-chip${f ? ' warn' : ''}" title="Pin ${pin}">${_esc(net)}</span>`
          ).join('') || '<span style="opacity:.4;font-size:10px">none</span>'}
        </div>`;
    }

    sr.getElementById('flyout').classList.add('visible');
  }

  _closeFlyout() {
    this.shadowRoot.getElementById('flyout')?.classList.remove('visible');
    this._activeNetId = null;
    this._renderNetList();
    if (this._graph) this._graph.graphData(this._filteredData());
  }

  // ── Helpers ───────────────────────────────────────────────────────────────────

  _updateStats() {
    const el  = this.shadowRoot.getElementById('stats-text');
    const data = store.netlistGraph;
    if (!el || !data) return;
    const fd  = this._filteredData();
    const s   = data.stats;
    const matchNote = this._highlightIds ? ` · ${this._highlightIds.size} matching` : '';
    el.textContent  = `${fd.nodes.length} nodes · ${fd.links.length} edges · ${s.floating_net_count} floating${matchNote}`;
  }

  _destroyGraph() {
    this._resizeObs?.disconnect();
    this._resizeObs = null;
    try { this._graph?._destructor?.(); } catch {}
    this._graph = null;
    this.shadowRoot.getElementById('flyout')?.classList.remove('visible');
  }
}

function _esc(s) {
  const d = document.createElement('div');
  d.textContent = String(s ?? '');
  return d.innerHTML;
}

customElements.define('km-netlist-graph', NetlistGraph);
