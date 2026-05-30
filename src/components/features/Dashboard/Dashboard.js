/**
 * @element km-dashboard
 * @summary Full-screen dashboard — 6-zone Armory-Crate-inspired layout.
 *
 * Zones:
 *  [1] Hero — animated KiMaster logo with PCB trace comet animation
 *  [2] System bar — KiCad version, device, kicad-cli status
 *  [3] Bridge bar — connection status, connect/disconnect, refresh
 *  [4] Project tree — interactive file tree of active project
 *  [5] Vault counts + Tool shortcuts (split)
 *  [6] Recent projects list
 *
 * @fires km-nav — { route } when a tool shortcut is clicked
 */

import { Logger }              from '../../../core/Logger.js';
import { invoke }              from '../../../core/Ipc.js';
import { store, subscribe }    from '../../../core/State.js';
import { KM_NAV }              from '../../../core/AppEvents.js';
import {
  GET_RECENT_PROJECTS,
  GET_VAULT_DIR,
  UCE_GET_VAULT,
  VAULT_LIST_STACKUPS,
  VAULT_LIST_TEMPLATES,
  VAULT_LIST_BLOCKS,
} from '../../../core/AppCommands.js';

/* ── Template ──────────────────────────────────────────────────────────────── */

const T = document.createElement('template');
T.innerHTML = /* html */`
<style>
  /* ─── Host ─── */
  :host {
    display: block;
    height: 100%;
    overflow-y: auto;
    overflow-x: hidden;
    font-family: var(--km-font);
    color: var(--km-text-primary);
    background: var(--km-bg-primary);
  }

  /* ─── 6-zone grid ─── */
  .dash {
    display: grid;
    grid-template-columns: 1fr 1fr;
    grid-template-rows: auto 1fr auto;
    gap: var(--km-space-5);
    padding: var(--km-space-6) var(--km-space-8);
    min-height: 100%;
    max-width: 1280px;
    margin: 0 auto;
  }

  /* ─── Zone 1 — Hero (spans both cols) — logo + bridge merged ─── */
  .zone-hero {
    grid-column: 1 / -1;
    display: flex;
    flex-direction: column;
    gap: 0;
    background: var(--km-bg-surface);
    border: 1px solid var(--km-border);
    border-radius: var(--km-radius-xl);
    overflow: hidden;
    position: relative;
    animation: dash-fade-in 0.4s var(--km-ease) both;
    transition: border-color 0.3s var(--km-ease), box-shadow 0.3s var(--km-ease);
  }
  .zone-hero.live {
    border-color: var(--km-live-border);
    box-shadow: 0 0 14px rgba(6, 182, 212, 0.10);
  }

  /* Top row: animation + info */
  .hero-top {
    display: flex;
    align-items: center;
    gap: var(--km-space-6);
    padding: var(--km-space-5) var(--km-space-6);
  }

  /* PCB trace animation canvas */
  .hero-anim {
    position: relative;
    width: 160px;
    height: 80px;
    flex-shrink: 0;
  }
  .hero-anim svg {
    width: 100%;
    height: 100%;
  }
  .trace-path {
    fill: none;
    stroke-width: 2;
    stroke-linecap: round;
    stroke-linejoin: round;
  }
  .trace-path.t1 { stroke: var(--km-accent); stroke-dasharray: 40 200; animation: comet 3s linear infinite; }
  .trace-path.t2 { stroke: var(--km-live);   stroke-dasharray: 30 200; animation: comet 3.5s linear infinite 0.6s; }
  .trace-path.t3 { stroke: var(--km-trace);  stroke-dasharray: 25 200; animation: comet 4s linear infinite 1.2s; }
  .trace-glow    { fill: none; stroke-width: 5; stroke-linecap: round; opacity: 0.25; filter: blur(3px); }
  .trace-glow.t1 { stroke: var(--km-accent); stroke-dasharray: 40 200; animation: comet 3s linear infinite; }
  .trace-glow.t2 { stroke: var(--km-live);   stroke-dasharray: 30 200; animation: comet 3.5s linear infinite 0.6s; }
  .trace-glow.t3 { stroke: var(--km-trace);  stroke-dasharray: 25 200; animation: comet 4s linear infinite 1.2s; }
  /* Via pads */
  .via-pad { fill: var(--km-bg-elevated); stroke: var(--km-accent); stroke-width: 1.5; }
  .via-dot { fill: var(--km-accent); }

  @keyframes comet {
    0%   { stroke-dashoffset: 240; }
    100% { stroke-dashoffset: 0; }
  }

  .hero-info {
    display: flex;
    flex-direction: column;
    gap: var(--km-space-2);
    min-width: 0;
  }
  .hero-title {
    font-size: var(--km-font-size-2xl);
    font-weight: var(--km-font-weight-bold);
    letter-spacing: -0.03em;
    background: linear-gradient(135deg, var(--km-accent-hover) 0%, var(--km-live) 100%);
    -webkit-background-clip: text;
    -webkit-text-fill-color: transparent;
    background-clip: text;
  }
  .hero-version {
    font-size: var(--km-font-size-sm);
    color: var(--km-text-muted);
    font-family: var(--km-font-mono);
    font-variant-numeric: tabular-nums;
  }
  .hero-sys {
    font-size: var(--km-font-size-xs);
    color: var(--km-text-muted);
    display: flex;
    gap: var(--km-space-3);
    flex-wrap: wrap;
  }
  .hero-sys span { display: inline-flex; align-items: center; gap: var(--km-space-1); }

  /* ─── Bridge strip inside hero ─── */
  .hero-bridge {
    display: flex;
    align-items: center;
    gap: var(--km-space-4);
    padding: var(--km-space-2-5) var(--km-space-6);
    border-top: 1px solid var(--km-border);
    background: var(--km-bg-elevated);
  }
  .bridge-dot {
    width: 8px; height: 8px; border-radius: 50%; flex-shrink: 0;
    background: var(--km-text-muted);
    transition: background 0.3s, box-shadow 0.3s;
  }
  .bridge-dot.on {
    background: var(--km-live);
    box-shadow: 0 0 8px var(--km-live);
    animation: breathe 3s ease-in-out infinite;
  }
  @keyframes breathe {
    0%,100% { box-shadow: 0 0 6px var(--km-live); }
    50%     { box-shadow: 0 0 14px var(--km-live); }
  }
  .bridge-label {
    font-size: var(--km-font-size-sm);
    font-weight: var(--km-font-weight-medium);
  }
  .bridge-msg {
    flex: 1;
    font-size: var(--km-font-size-xs);
    color: var(--km-text-muted);
    font-family: var(--km-font-mono);
    min-width: 0;
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
  }
  .bridge-actions { display: flex; gap: var(--km-space-2); flex-shrink: 0; }
  .btn {
    background: none;
    border: 1px solid var(--km-border);
    color: var(--km-text-secondary);
    padding: var(--km-space-1-5) var(--km-space-3);
    border-radius: var(--km-radius-sm);
    font-size: var(--km-font-size-xs);
    font-family: var(--km-font);
    cursor: pointer;
    transition: all var(--km-duration-fast) var(--km-ease);
    display: inline-flex;
    align-items: center;
    gap: var(--km-space-1);
  }
  .btn:hover { color: var(--km-text-primary); border-color: var(--km-accent); }
  .btn.primary { background: var(--km-accent); border-color: var(--km-accent); color: #fff; }
  .btn.primary:hover { background: var(--km-accent-hover); }
  .btn.danger:hover { border-color: var(--km-danger); color: var(--km-danger); }

  /* ─── Zone 4 — Project tree (left column) ─── */
  .zone-tree {
    display: flex;
    flex-direction: column;
    background: var(--km-bg-surface);
    border: 1px solid var(--km-border);
    border-radius: var(--km-radius-xl);
    overflow: hidden;
    min-height: 260px;
    animation: dash-fade-in 0.35s var(--km-ease) both 0.15s;
  }
  .zone-hdr {
    display: flex;
    align-items: center;
    gap: var(--km-space-2);
    padding: var(--km-space-3) var(--km-space-4);
    border-bottom: 1px solid var(--km-border);
    background: var(--km-bg-elevated);
  }
  .zone-hdr-title {
    font-size: var(--km-font-size-sm);
    font-weight: var(--km-font-weight-semibold);
    color: var(--km-text-secondary);
    flex: 1;
  }
  .zone-hdr km-icon { color: var(--km-accent-hover); }

  .tree-body {
    flex: 1;
    overflow-y: auto;
    padding: var(--km-space-2) 0;
  }
  .tree-item {
    display: flex;
    align-items: center;
    gap: var(--km-space-2);
    padding: var(--km-space-1-5) var(--km-space-4);
    font-size: var(--km-font-size-sm);
    color: var(--km-text-secondary);
    cursor: pointer;
    transition: background var(--km-duration-fast) var(--km-ease);
    white-space: nowrap;
    overflow: hidden;
    text-overflow: ellipsis;
  }
  .tree-item:hover { background: var(--km-bg-elevated); }
  .tree-item km-icon { flex-shrink: 0; }
  .tree-item.indent-1 { padding-left: calc(var(--km-space-4) + 16px); }
  .tree-item.indent-2 { padding-left: calc(var(--km-space-4) + 32px); }
  .tree-item .tree-name { flex: 1; min-width: 0; overflow: hidden; text-overflow: ellipsis; }
  .tree-item.active { color: var(--km-accent); background: var(--km-accent-muted); }
  .tree-empty {
    padding: var(--km-space-6);
    text-align: center;
    color: var(--km-text-muted);
    font-size: var(--km-font-size-sm);
  }
  .tree-empty .btn { margin-top: var(--km-space-3); }

  /* ─── Zone 5 — Vault + Tools (right column) ─── */
  .zone-right {
    display: flex;
    flex-direction: column;
    gap: var(--km-space-5);
    animation: dash-fade-in 0.35s var(--km-ease) both 0.2s;
  }

  /* Vault counts */
  .vault-grid {
    display: grid;
    grid-template-columns: 1fr 1fr;
    gap: var(--km-space-3);
  }
  .vault-card {
    display: flex;
    align-items: center;
    gap: var(--km-space-3);
    padding: var(--km-space-3) var(--km-space-4);
    background: var(--km-bg-surface);
    border: 1px solid var(--km-border);
    border-radius: var(--km-radius-xl);
    cursor: pointer;
    transition: all var(--km-duration-base) var(--km-ease);
  }
  .vault-card:hover {
    border-color: var(--km-border-strong);
    background: var(--km-bg-elevated);
    transform: translateY(-1px);
  }
  .vault-card km-icon { color: var(--km-accent-hover); }
  .vault-card-info { flex: 1; min-width: 0; }
  .vault-card-name { font-size: var(--km-font-size-sm); font-weight: var(--km-font-weight-medium); }
  .vault-card-count {
    font-family: var(--km-font-mono);
    font-size: var(--km-font-size-xl);
    font-weight: var(--km-font-weight-bold);
    color: var(--km-accent-hover);
    font-variant-numeric: tabular-nums;
  }

  /* Tool shortcuts */
  .tools-grid {
    display: grid;
    grid-template-columns: 1fr 1fr;
    gap: var(--km-space-3);
  }
  .tool-btn {
    display: flex;
    align-items: center;
    gap: var(--km-space-3);
    padding: var(--km-space-3) var(--km-space-4);
    background: var(--km-bg-surface);
    border: 1px solid var(--km-border);
    border-radius: var(--km-radius-xl);
    cursor: pointer;
    transition: all var(--km-duration-base) var(--km-ease);
    text-decoration: none;
    color: inherit;
    font-family: var(--km-font);
  }
  .tool-btn:hover {
    border-color: var(--km-accent-border);
    background: var(--km-bg-elevated);
    transform: translateY(-1px);
  }
  .tool-btn:hover km-icon { color: var(--km-accent); }
  .tool-btn km-icon {
    color: var(--km-text-muted);
    transition: color var(--km-duration-fast) var(--km-ease);
  }
  .tool-btn-name {
    font-size: var(--km-font-size-sm);
    font-weight: var(--km-font-weight-medium);
  }
  .tool-btn.disabled {
    opacity: 0.35;
    pointer-events: none;
  }

  /* ─── Zone 6 — Recent projects (spans both cols) ─── */
  .zone-recent {
    grid-column: 1 / -1;
    background: var(--km-bg-surface);
    border: 1px solid var(--km-border);
    border-radius: var(--km-radius-xl);
    overflow: hidden;
    animation: dash-fade-in 0.35s var(--km-ease) both 0.25s;
  }
  .recent-list { padding: var(--km-space-1) 0; }
  .recent-item {
    display: flex;
    align-items: center;
    gap: var(--km-space-3);
    padding: var(--km-space-2-5) var(--km-space-5);
    transition: background var(--km-duration-fast) var(--km-ease);
    cursor: pointer;
  }
  .recent-item:hover { background: var(--km-bg-elevated); }
  .recent-item .dot {
    width: 6px; height: 6px; border-radius: 50%;
    background: var(--km-text-muted); flex-shrink: 0;
  }
  .recent-item .dot.active { background: var(--km-live); box-shadow: 0 0 4px var(--km-live); }
  .recent-name {
    font-size: var(--km-font-size-md);
    font-weight: var(--km-font-weight-medium);
    min-width: 100px;
  }
  .recent-path {
    flex: 1;
    font-family: var(--km-font-mono);
    font-size: var(--km-font-size-xs);
    color: var(--km-text-muted);
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
    min-width: 0;
  }
  .recent-actions { display: flex; gap: var(--km-space-1); flex-shrink: 0; }
  .icon-btn {
    background: none; border: none; padding: var(--km-space-1);
    color: var(--km-text-muted); cursor: pointer;
    border-radius: var(--km-radius-sm);
    transition: color var(--km-duration-fast) var(--km-ease), background var(--km-duration-fast) var(--km-ease);
    display: inline-flex; align-items: center;
  }
  .icon-btn:hover { color: var(--km-text-primary); background: rgba(255,255,255,0.05); }
  .icon-btn.danger:hover { color: var(--km-danger); }
  .recent-empty {
    padding: var(--km-space-5);
    text-align: center;
    color: var(--km-text-muted);
    font-size: var(--km-font-size-sm);
  }

  /* ─── Animations ─── */
  @keyframes dash-fade-in {
    from { opacity: 0; transform: translateY(8px); }
    to   { opacity: 1; transform: translateY(0); }
  }

  /* ─── Responsive ─── */
  @media (max-width: 800px) {
    .dash { grid-template-columns: 1fr; }
    .zone-hero, .zone-recent { grid-column: 1; }
  }
</style>

<div class="dash">

  <!-- [1]+[2]+[3] Hero — logo animation + system info + bridge -->
  <div class="zone-hero" id="zone-hero">
    <div class="hero-top">
      <div class="hero-anim">
        <svg viewBox="0 0 180 90" xmlns="http://www.w3.org/2000/svg">
          <path class="trace-glow t1" d="M10 45 H50 L65 20 H120 L135 45 H170"/>
          <path class="trace-path t1" d="M10 45 H50 L65 20 H120 L135 45 H170"/>
          <path class="trace-glow t2" d="M10 60 H40 L55 75 H90 L105 50 H140 L155 70 H170"/>
          <path class="trace-path t2" d="M10 60 H40 L55 75 H90 L105 50 H140 L155 70 H170"/>
          <path class="trace-glow t3" d="M10 30 H30 L45 15 H75 L90 45 H110 L125 30 H170"/>
          <path class="trace-path t3" d="M10 30 H30 L45 15 H75 L90 45 H110 L125 30 H170"/>
          <circle class="via-pad" cx="50" cy="45" r="5"/><circle class="via-dot" cx="50" cy="45" r="2"/>
          <circle class="via-pad" cx="120" cy="20" r="4"/><circle class="via-dot" cx="120" cy="20" r="1.5"/>
          <circle class="via-pad" cx="90" cy="45" r="5"/><circle class="via-dot" cx="90" cy="45" r="2"/>
          <circle class="via-pad" cx="140" cy="50" r="4"/><circle class="via-dot" cx="140" cy="50" r="1.5"/>
        </svg>
      </div>
      <div class="hero-info">
        <div class="hero-title">KiMaster</div>
        <div class="hero-version" id="hero-ver">v0.1.0</div>
        <div class="hero-sys" id="hero-sys"></div>
      </div>
    </div>
    <!-- Bridge strip — integrated inside hero -->
    <div class="hero-bridge" id="hero-bridge">
      <div class="bridge-dot" id="bridge-dot"></div>
      <span class="bridge-label" id="bridge-label">Not connected</span>
      <span class="bridge-msg" id="bridge-msg"></span>
      <div class="bridge-actions" id="bridge-actions"></div>
    </div>
  </div>

  <!-- [4] Project tree -->
  <div class="zone-tree">
    <div class="zone-hdr">
      <km-icon name="folder-tree" size="sm"></km-icon>
      <span class="zone-hdr-title">Project files</span>
    </div>
    <div class="tree-body" id="tree-body"></div>
  </div>

  <!-- [5] Vault + Tools -->
  <div class="zone-right">
    <div>
      <div class="zone-hdr" style="border-radius:var(--km-radius-xl) var(--km-radius-xl) 0 0; border:1px solid var(--km-border); border-bottom:none; background:var(--km-bg-elevated);">
        <km-icon name="database" size="sm"></km-icon>
        <span class="zone-hdr-title">Vault</span>
      </div>
      <div class="vault-grid" id="vault-grid" style="border:1px solid var(--km-border); border-top:none; border-radius:0 0 var(--km-radius-xl) var(--km-radius-xl); padding:var(--km-space-3); background:var(--km-bg-surface);"></div>
    </div>
    <div>
      <div class="zone-hdr" style="border-radius:var(--km-radius-xl) var(--km-radius-xl) 0 0; border:1px solid var(--km-border); border-bottom:none; background:var(--km-bg-elevated);">
        <km-icon name="layout-grid" size="sm"></km-icon>
        <span class="zone-hdr-title">Tools</span>
      </div>
      <div class="tools-grid" id="tools-grid" style="border:1px solid var(--km-border); border-top:none; border-radius:0 0 var(--km-radius-xl) var(--km-radius-xl); padding:var(--km-space-3); background:var(--km-bg-surface);"></div>
    </div>
  </div>

  <!-- [6] Recent projects -->
  <div class="zone-recent">
    <div class="zone-hdr">
      <km-icon name="clock" size="sm"></km-icon>
      <span class="zone-hdr-title">Recent projects</span>
    </div>
    <div class="recent-list" id="recent-list"></div>
  </div>

</div>
`;

/* ── Component ─────────────────────────────────────────────────────────────── */

export class KmDashboard extends HTMLElement {
  constructor() {
    super();
    this.attachShadow({ mode: 'open' });
    this.shadowRoot.appendChild(T.content.cloneNode(true));
    this._unsubs = [];
  }

  connectedCallback() {
    this._renderHero();
    this._renderBridge();
    this._renderTree();
    this._renderVault();
    this._renderTools();
    this._loadRecent();

    // Live subscriptions
    this._unsubs.push(
      subscribe('bridgeConnected',    () => { this._renderBridge(); this._renderTree(); }),
      subscribe('boardComponents',    () => this._renderTree()),
      subscribe('bridgeKicadVersion', () => { this._renderHero(); this._renderBridge(); }),
      subscribe('bridgeBoardName',    () => this._renderTree()),
      subscribe('project',            () => { this._renderTree(); this._renderHero(); }),
    );
  }

  disconnectedCallback() {
    this._unsubs.forEach(u => u());
    this._unsubs = [];
  }

  // ── [1]+[2] Hero ─────────────────────────────────────────────────────────

  _renderHero() {
    const ver = this.shadowRoot.getElementById('hero-ver');
    const sys = this.shadowRoot.getElementById('hero-sys');
    ver.textContent = `v${store.appVersion || '0.1.0'}`;

    const parts = [];
    if (store.bridgeKicadVersion)
      parts.push(`<span><km-icon name="cpu" size="sm"></km-icon> KiCad ${_esc(store.bridgeKicadVersion)}</span>`);
    if (store.kicadCliPath)
      parts.push(`<span><km-icon name="check" size="sm" style="color:var(--km-trace)"></km-icon> kicad-cli found</span>`);
    else
      parts.push(`<span><km-icon name="warning" size="sm" style="color:var(--km-warning)"></km-icon> kicad-cli not found</span>`);
    sys.innerHTML = parts.join('');
  }

  // ── [3] Bridge ───────────────────────────────────────────────────────────

  _renderBridge() {
    const on = store.bridgeConnected;
    const hero = this.shadowRoot.getElementById('zone-hero');
    const dot  = this.shadowRoot.getElementById('bridge-dot');
    const label= this.shadowRoot.getElementById('bridge-label');
    const msg  = this.shadowRoot.getElementById('bridge-msg');
    const acts = this.shadowRoot.getElementById('bridge-actions');

    hero.classList.toggle('live', on);
    dot.classList.toggle('on', on);
    label.textContent = on ? 'Bridge connected' : 'Bridge disconnected';
    msg.textContent = on
      ? `ws://127.0.0.1:40001${store.bridgeBoardName ? ` · ${store.bridgeBoardName}` : ''}`
      : 'Auto-connecting to port 40001…';

    if (on) {
      acts.innerHTML = `
        <button class="btn" id="btn-refresh"><km-icon name="refresh" size="sm"></km-icon></button>
        <button class="btn danger" id="btn-disconnect">Disconnect</button>
      `;
      acts.querySelector('#btn-refresh')?.addEventListener('click', () => {
        import('../../../modules/kicad-bridge/BridgeClient.js').then(m => m.requestBoardState());
      });
      acts.querySelector('#btn-disconnect')?.addEventListener('click', () => {
        import('../../../modules/kicad-bridge/BridgeClient.js').then(m => m.disconnectBridge());
      });
    } else {
      acts.innerHTML = `<button class="btn primary" id="btn-connect">Connect</button>`;
      acts.querySelector('#btn-connect')?.addEventListener('click', () => {
        import('../../../modules/kicad-bridge/BridgeClient.js').then(m => m.connectBridge(40001));
      });
    }
  }

  // ── [4] Project tree ─────────────────────────────────────────────────────

  _renderTree() {
    const body = this.shadowRoot.getElementById('tree-body');
    const proj = store.project;
    const boardName = store.bridgeBoardName;

    if (!proj && !boardName) {
      body.innerHTML = `
        <div class="tree-empty">
          <km-icon name="folder-open" size="xl" style="color:var(--km-text-muted);opacity:0.4;"></km-icon>
          <div style="margin-top:var(--km-space-2)">No project open</div>
          <button class="btn primary" id="btn-open-tree" style="margin-top:var(--km-space-3)">Open project</button>
        </div>
      `;
      body.querySelector('#btn-open-tree')?.addEventListener('click', () => {
        import('../../../modules/project/ProjectService.js').then(m => m.pickAndOpenProject());
      });
      return;
    }

    const name = proj?.name || boardName?.replace(/\\/g, '/').split('/').pop()?.replace(/\.kicad_pcb$/, '') || 'Project';
    const pcb = proj?.pcb_file?.split(/[\\/]/).pop() || (boardName ? boardName.split(/[\\/]/).pop() : null);
    const sch = proj?.schematic_file?.split(/[\\/]/).pop() || (pcb ? pcb.replace(/\.kicad_pcb$/, '.kicad_sch') : null);
    const pro = pcb ? pcb.replace(/\.kicad_pcb$/, '.kicad_pro') : null;

    let html = '';
    html += _treeItem('folder-open', name, 0, 'active');
    if (pro)  html += _treeItem('file', pro, 1);
    if (pcb)  html += _treeItem('pcb', pcb, 1);
    if (sch)  html += _treeItem('schematic', sch, 1);
    html += _treeItem('folder', '.kimaster/', 1);
    html += _treeItem('vault', 'library/', 2);
    html += _treeItem('notes', 'notes.md', 2);
    html += _treeItem('task', 'tasks.json', 2);

    body.innerHTML = html;
  }

  // ── [5] Vault ────────────────────────────────────────────────────────────

  async _renderVault() {
    const grid = this.shadowRoot.getElementById('vault-grid');
    let components = 0, stackups = 0, templates = 0, blocks = 0;
    try {
      const [c, s, t, b] = await Promise.all([
        invoke(UCE_GET_VAULT).catch(() => []),
        invoke(VAULT_LIST_STACKUPS).catch(() => []),
        invoke(VAULT_LIST_TEMPLATES).catch(() => []),
        invoke(VAULT_LIST_BLOCKS).catch(() => []),
      ]);
      components = c?.length ?? 0;
      stackups   = s?.length ?? 0;
      templates  = t?.length ?? 0;
      blocks     = b?.length ?? 0;
    } catch (e) {
      Logger.warn('Dashboard', 'vault counts failed', e);
    }

    grid.innerHTML = `
      ${_vaultCard('component', 'Components', components)}
      ${_vaultCard('layers',    'Stackups',   stackups)}
      ${_vaultCard('file',      'Templates',  templates)}
      ${_vaultCard('box',       'Blocks',     blocks)}
    `;

    for (const c of grid.querySelectorAll('.vault-card')) {
      c.addEventListener('click', () => this._nav('/vault'));
    }
  }

  // ── [5] Tools ────────────────────────────────────────────────────────────

  _renderTools() {
    const grid = this.shadowRoot.getElementById('tools-grid');
    const hasProj = !!store.project || store.bridgeConnected;

    grid.innerHTML = `
      ${_toolBtn('drc',     'Design checks', '/drc',        hasProj)}
      ${_toolBtn('gerber',  'Export',         '/export',     hasProj)}
      ${_toolBtn('search',  'Parts catalog',  '/vault')}
      ${_toolBtn('notes',   'Notes',          '/notes',      hasProj)}
      ${_toolBtn('render',  '3D Render',      '/render',     hasProj)}
      ${_toolBtn('history', 'History',        '/history',    hasProj)}
    `;

    for (const btn of grid.querySelectorAll('.tool-btn:not(.disabled)')) {
      btn.addEventListener('click', () => this._nav(btn.dataset.route));
    }
  }

  // ── [6] Recent ───────────────────────────────────────────────────────────

  async _loadRecent() {
    const list = this.shadowRoot.getElementById('recent-list');
    try {
      const projects = await invoke(GET_RECENT_PROJECTS);
      if (!projects || projects.length === 0) {
        list.innerHTML = `<div class="recent-empty">No recent projects</div>`;
        return;
      }
      const currentName = store.project?.name || '';
      list.innerHTML = projects.map(p => {
        const name = p.name || p.path?.split(/[\\/]/).pop()?.replace(/\.kicad_pro$/, '') || '?';
        const isCurrent = name === currentName;
        return `
          <div class="recent-item" data-path="${_esc(p.path || '')}">
            <div class="dot${isCurrent ? ' active' : ''}"></div>
            <span class="recent-name">${_esc(name)}</span>
            <span class="recent-path">${_esc(p.path || '')}</span>
            <div class="recent-actions">
              <button class="icon-btn" title="Open folder" data-folder="${_esc(p.path || '')}">
                <km-icon name="folder-open" size="sm"></km-icon>
              </button>
              <button class="icon-btn danger" title="Remove from list" data-remove="${_esc(p.path || '')}">
                <km-icon name="trash" size="sm"></km-icon>
              </button>
            </div>
          </div>
        `;
      }).join('');

      for (const item of list.querySelectorAll('.recent-item')) {
        item.addEventListener('click', (e) => {
          if (e.target.closest('.icon-btn')) return;
          const path = item.dataset.path;
          if (path) {
            import('../../../modules/project/ProjectService.js')
              .then(m => m.openProject?.(path) ?? invoke('cmd_open_project', { pro_path: path }));
          }
        });
      }
    } catch (err) {
      Logger.warn('Dashboard', 'Failed to load recent projects', err);
      list.innerHTML = `<div class="recent-empty">Could not load recent projects</div>`;
    }
  }

  // ── Helpers ──────────────────────────────────────────────────────────────

  _nav(route) {
    this.dispatchEvent(new CustomEvent(KM_NAV, {
      bubbles: true, composed: true,
      detail: { route },
    }));
  }
}

/* ── Pure helpers ──────────────────────────────────────────────────────────── */

function _esc(s) {
  const d = document.createElement('div');
  d.textContent = String(s ?? '');
  return d.innerHTML;
}

function _treeItem(icon, label, indent = 0, cls = '') {
  return `<div class="tree-item${indent ? ` indent-${indent}` : ''}${cls ? ` ${cls}` : ''}">
    <km-icon name="${icon}" size="sm"></km-icon>
    <span class="tree-name">${_esc(label)}</span>
  </div>`;
}

function _vaultCard(icon, name, count) {
  return `<div class="vault-card">
    <km-icon name="${icon}" size="md"></km-icon>
    <div class="vault-card-info">
      <div class="vault-card-name">${name}</div>
    </div>
    <div class="vault-card-count">${count}</div>
  </div>`;
}

function _toolBtn(icon, name, route, enabled = true) {
  return `<div class="tool-btn${enabled ? '' : ' disabled'}" data-route="${route}">
    <km-icon name="${icon}" size="md"></km-icon>
    <span class="tool-btn-name">${name}</span>
  </div>`;
}

customElements.define('km-dashboard', KmDashboard);
