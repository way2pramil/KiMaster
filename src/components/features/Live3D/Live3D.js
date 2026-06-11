/**
 * @element km-live-3d
 * @summary Photorealistic real-time 3D PCB viewer powered by Three.js.
 *
 * Two modes toggled from the toolbar:
 *   Custom — Live3DRenderer builds geometry from the parsed .kicad_pcb file.
 *            Reacts to live bridge updates; supports PNG/JPEG/GIF/MP4 export.
 *   GLB    — km-live-3d-viewer loads a kicad-cli–exported .glb with OrbitControls.
 *            Full VIEWER_DEFAULTS advanced settings drawer; photorealistic materials.
 *
 * @fires km-live3d-ready — scene loaded
 * @fires km-live3d-error — { message }
 */

import { store, subscribe }                     from '../../../core/State.js';
import { invoke }                               from '../../../core/Ipc.js';
import { Logger }                               from '../../../core/Logger.js';
import { notify }                               from '../../../core/Notify.js';
import { EXPORT_GLB, FILE_EXISTS }              from '../../../core/AppCommands.js';
import { Live3DRenderer }                       from '../../../modules/live3d/Live3DRenderer.js';
import { startSpin, encodeGif, startVideoRecording, downloadBlob } from '../../../modules/live3d/PcbExporter.js';
import { exportGlbForViewer, toViewerUrl }      from '../../../modules/render/Live3dService.js';
import { VIEWER_DEFAULTS }                      from '../BoardRender/Live3dViewer.js';
import { Live3dV2Manager }                      from './Live3dV2.js';
import { buildSettingsPanelHtml, fmtVal }       from './Live3DPanelBuilder.js';
import './Live3DSettings.js';

const RELOAD_DEBOUNCE_MS = 800;

// ── Template ──────────────────────────────────────────────────────────────────

const TEMPLATE = document.createElement('template');
TEMPLATE.innerHTML = `
<style>
  :host {
    display: flex;
    flex-direction: column;
    height: 100%;
    background: #080808;
    color: var(--km-text-primary);
    font-family: var(--km-font);
    overflow: hidden;
  }

  /* ── Toolbar ── */
  .toolbar {
    display: flex;
    align-items: center;
    gap: var(--km-space-2);
    padding: 0 var(--km-space-3);
    height: 40px;
    background: var(--km-bg-elevated);
    border-bottom: 1px solid var(--km-border);
    flex-shrink: 0;
  }
  .toolbar-title {
    font-size: var(--km-font-size-sm);
    font-weight: 600;
    color: var(--km-text-primary);
    margin-right: var(--km-space-2);
  }
  .sep { width: 1px; height: 16px; background: var(--km-border); margin: 0 var(--km-space-1); }
  .vis-btn {
    display: flex;
    align-items: center;
    gap: 4px;
    padding: 3px 8px;
    border-radius: var(--km-radius-sm);
    border: 1px solid var(--km-border);
    background: transparent;
    color: var(--km-text-secondary);
    font-size: 11px;
    font-family: var(--km-font);
    cursor: pointer;
    transition: all 120ms ease;
    user-select: none;
  }
  .vis-btn:hover  { border-color: var(--km-accent); color: var(--km-text-primary); }
  .vis-btn.active { background: var(--km-accent-muted); color: var(--km-accent); border-color: var(--km-accent); }
  .toolbar-end { margin-left: auto; display: flex; align-items: center; gap: var(--km-space-2); }
  .icon-btn {
    background: none; border: none;
    color: var(--km-text-secondary);
    cursor: pointer; padding: 4px;
    border-radius: var(--km-radius-sm);
    display: flex; align-items: center;
    transition: color 120ms, background 120ms;
  }
  .icon-btn:hover { color: var(--km-text-primary); background: var(--km-bg-surface); }

  /* ── Mode toggle ── */
  .mode-toggle {
    display: flex;
    gap: 2px;
    background: var(--km-bg-surface);
    border: 1px solid var(--km-border);
    border-radius: var(--km-radius-sm);
    padding: 2px;
  }
  .mode-btn {
    padding: 2px 8px;
    border: none;
    background: none;
    border-radius: 3px;
    font-size: 11px;
    font-family: var(--km-font);
    color: var(--km-text-secondary);
    cursor: pointer;
    transition: all 120ms ease;
    white-space: nowrap;
  }
  .mode-btn.active {
    background: var(--km-accent);
    color: #fff;
  }
  .mode-btn:not(.active):hover { color: var(--km-text-primary); background: var(--km-bg-elevated); }

  /* ── Main body ── */
  .body {
    display: flex;
    flex: 1;
    overflow: hidden;
    position: relative;
  }

  /* ── Canvas area (custom mode) ── */
  .canvas-wrap {
    flex: 1;
    position: relative;
    overflow: hidden;
  }
  canvas {
    width: 100% !important;
    height: 100% !important;
    display: block;
    touch-action: none;
  }

  /* ── GLB viewer area ── */
  .glb-wrap {
    position: absolute;
    inset: 0;
    display: flex;
    flex-direction: column;
  }
  km-live-3d-viewer {
    flex: 1;
    min-height: 0;
    display: block;
  }
  km-live3d-settings {
    position: absolute;
    top: 0;
    right: 0;
    height: 100%;
    z-index: 10;
  }
  .glb-bar {
    flex-shrink: 0;
    height: 36px;
    display: flex;
    align-items: center;
    gap: var(--km-space-2);
    padding: 0 var(--km-space-3);
    background: var(--km-bg-elevated);
    border-top: 1px solid var(--km-border);
  }
  .glb-status {
    font-size: var(--km-font-size-xs);
    color: var(--km-text-muted);
    font-variant-numeric: tabular-nums;
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
    max-width: 360px;
  }
  .glb-status.ok    { color: var(--km-trace); }
  .glb-status.error { color: var(--km-red); }
  .flex1 { flex: 1; }

  /* ── Overlay states ── */
  .overlay {
    position: absolute;
    inset: 0;
    display: flex;
    flex-direction: column;
    align-items: center;
    justify-content: center;
    gap: var(--km-space-3);
    pointer-events: none;
    transition: opacity 250ms ease;
  }
  .overlay.hidden { opacity: 0; }
  .overlay-icon {
    font-size: 40px;
    opacity: 0.25;
  }
  .overlay-title {
    font-size: var(--km-font-size-sm);
    color: var(--km-text-secondary);
    text-align: center;
    max-width: 280px;
    line-height: 1.5;
  }
  .spinner {
    width: 28px; height: 28px;
    border: 2px solid var(--km-border);
    border-top-color: var(--km-accent);
    border-radius: 50%;
    animation: spin 0.7s linear infinite;
  }
  @keyframes spin { to { transform: rotate(360deg); } }

  /* ── Advanced settings drawer (GLB mode) ── */
  .settings-drawer {
    position: absolute;
    top: 0;
    right: 0;
    bottom: 36px;
    width: 300px;
    background: var(--km-bg-primary);
    border-left: 1px solid var(--km-border);
    display: flex;
    flex-direction: column;
    transform: translateX(100%);
    transition: transform 0.2s ease;
    z-index: 20;
    box-shadow: -4px 0 24px rgba(0,0,0,0.35);
  }
  .settings-drawer.open { transform: translateX(0); }
  .settings-head {
    display: flex;
    align-items: center;
    justify-content: space-between;
    padding: 0 var(--km-space-3);
    height: 36px;
    border-bottom: 1px solid var(--km-border);
    background: var(--km-bg-elevated);
    flex-shrink: 0;
    font-size: var(--km-font-size-sm);
    font-weight: var(--km-font-weight-medium);
    color: var(--km-text-primary);
  }
  .settings-body {
    flex: 1;
    overflow-y: auto;
    padding: 6px 0;
  }
  .settings-foot {
    flex-shrink: 0;
    padding: var(--km-space-2) var(--km-space-3);
    border-top: 1px solid var(--km-border);
    background: var(--km-bg-elevated);
  }
  .settings-foot button {
    width: 100%;
    background: var(--km-bg-surface);
    border: 1px solid var(--km-border);
    color: var(--km-text-secondary);
    padding: 5px;
    border-radius: var(--km-radius-sm);
    font-size: var(--km-font-size-xs);
    cursor: pointer;
    font-family: var(--km-font);
  }
  .settings-foot button:hover { background: var(--km-bg-elevated); color: var(--km-text-primary); }

  /* ── Settings panel controls ── */
  details { border-bottom: 1px solid var(--km-border); }
  summary.sp-sec {
    list-style: none;
    display: flex;
    align-items: center;
    gap: 6px;
    padding: 5px var(--km-space-3);
    font-size: var(--km-font-size-xs);
    font-weight: var(--km-font-weight-medium);
    color: var(--km-text-secondary);
    text-transform: uppercase;
    letter-spacing: 0.04em;
    cursor: pointer;
    background: var(--km-bg-elevated);
    user-select: none;
  }
  summary.sp-sec::-webkit-details-marker { display: none; }
  summary.sp-sec::before {
    content: '▶';
    font-size: 9px;
    opacity: 0.5;
    transition: transform 0.15s;
  }
  details[open] > summary.sp-sec::before { transform: rotate(90deg); }
  summary.sp-sec:hover { color: var(--km-text-primary); }
  .sp-row {
    display: flex;
    align-items: center;
    justify-content: space-between;
    gap: 8px;
    padding: 4px var(--km-space-3);
    cursor: default;
  }
  .sp-row:hover { background: var(--km-bg-surface); }
  .sp-lbl {
    font-size: var(--km-font-size-xs);
    color: var(--km-text-secondary);
    min-width: 0;
    flex: 1;
    white-space: nowrap;
    overflow: hidden;
    text-overflow: ellipsis;
  }
  .sp-row input[type="checkbox"] { accent-color: var(--km-accent); width: 14px; height: 14px; cursor: pointer; flex-shrink: 0; }
  .sp-row input[type="color"] { width: 28px; height: 22px; border: 1px solid var(--km-border); border-radius: 3px; padding: 1px; background: var(--km-bg-input); cursor: pointer; flex-shrink: 0; }
  .sp-row select { background: var(--km-bg-input); border: 1px solid var(--km-border); color: var(--km-text-primary); border-radius: var(--km-radius-sm); padding: 2px 4px; font-family: var(--km-font); font-size: var(--km-font-size-xs); outline: none; cursor: pointer; flex-shrink: 0; max-width: 120px; }
  .sp-range-wrap { display: flex; align-items: center; gap: 5px; flex-shrink: 0; width: 140px; }
  .sp-range-wrap input[type="range"] { flex: 1; accent-color: var(--km-accent); cursor: pointer; height: 4px; min-width: 0; }
  .sp-out { font-size: 10px; color: var(--km-text-muted); font-variant-numeric: tabular-nums; font-family: var(--km-font-mono); min-width: 40px; text-align: right; }

  /* ── Btn helpers ── */
  .btn-primary {
    background: var(--km-accent); border: none; color: #fff;
    padding: var(--km-space-1) var(--km-space-3);
    border-radius: var(--km-radius-sm);
    font-size: var(--km-font-size-sm); font-weight: 500;
    cursor: pointer; white-space: nowrap; font-family: var(--km-font);
    transition: background var(--km-duration-fast) var(--km-ease);
  }
  .btn-primary:hover:not(:disabled) { background: var(--km-accent-hover); }
  .btn-primary:disabled { background: var(--km-bg-elevated); color: var(--km-text-muted); cursor: not-allowed; }
  .btn-secondary {
    background: var(--km-bg-surface); border: 1px solid var(--km-border);
    color: var(--km-text-primary); padding: var(--km-space-1) var(--km-space-3);
    border-radius: var(--km-radius-sm); font-size: var(--km-font-size-sm);
    cursor: pointer; white-space: nowrap; font-family: var(--km-font);
    transition: background var(--km-duration-fast) var(--km-ease);
  }
  .btn-secondary:hover:not(:disabled) { background: var(--km-bg-elevated); }
  .btn-secondary:disabled { opacity: 0.5; cursor: not-allowed; }
  .btn-icon-sm {
    background: none; border: none; color: var(--km-text-secondary);
    cursor: pointer; font-size: 15px; padding: 4px 6px;
    border-radius: var(--km-radius-sm); line-height: 1; font-family: var(--km-font);
    transition: color var(--km-duration-fast), background var(--km-duration-fast);
  }
  .btn-icon-sm:hover  { color: var(--km-text-primary); background: var(--km-bg-surface); }
  .btn-icon-sm.active { color: var(--km-accent); background: var(--km-accent-muted); }

  /* ── Status bar (custom mode) ── */
  .status-bar {
    display: flex;
    align-items: center;
    gap: var(--km-space-3);
    padding: 0 var(--km-space-3);
    height: 24px;
    background: var(--km-bg-elevated);
    border-top: 1px solid var(--km-border);
    flex-shrink: 0;
    font-size: 10px;
    color: var(--km-text-muted);
  }
  .status-item { display: flex; align-items: center; gap: 4px; }
  .status-live {
    width: 6px; height: 6px; border-radius: 50%;
    background: var(--km-trace);
    animation: pulse-live 2s ease-in-out infinite;
  }
  @keyframes pulse-live { 0%, 100% { opacity: 1; } 50% { opacity: 0.3; } }
  .status-sep { opacity: 0.3; }

  .hidden { display: none !important; }
</style>

<!-- Toolbar -->
<div class="toolbar">
  <span class="toolbar-title">Live 3D</span>
  <div class="sep"></div>

  <!-- Mode toggle -->
  <div class="mode-toggle">
    <button class="mode-btn active" id="btn-mode-custom">Custom</button>
    <button class="mode-btn"        id="btn-mode-glb">GLB Viewer</button>
    <button class="mode-btn"        id="btn-mode-v2">V2 ✦</button>
  </div>

  <div class="sep"></div>

  <!-- Custom-mode controls -->
  <div id="custom-controls" style="display:flex;align-items:center;gap:var(--km-space-2);">
    <button class="icon-btn" id="btn-top" title="Top view">
      <svg width="15" height="15" viewBox="0 0 15 15" fill="none">
        <rect x="2" y="6" width="11" height="7" rx="1" stroke="currentColor" stroke-width="1.4"/>
        <path d="M5 6V4a2.5 2.5 0 0 1 5 0v2" stroke="currentColor" stroke-width="1.4"/>
      </svg>
    </button>
    <button class="icon-btn" id="btn-fit" title="Fit to board">
      <svg width="16" height="16" viewBox="0 0 16 16" fill="none">
        <rect x="2" y="2" width="12" height="12" rx="1" stroke="currentColor" stroke-width="1.5"/>
        <path d="M5 5h2M5 5v2" stroke="currentColor" stroke-width="1.5" stroke-linecap="round"/>
        <path d="M11 5h-2M11 5v2" stroke="currentColor" stroke-width="1.5" stroke-linecap="round"/>
        <path d="M5 11h2M5 11v-2" stroke="currentColor" stroke-width="1.5" stroke-linecap="round"/>
        <path d="M11 11h-2M11 11v-2" stroke="currentColor" stroke-width="1.5" stroke-linecap="round"/>
      </svg>
    </button>
    <div class="sep"></div>
    <button class="icon-btn" id="btn-settings" title="Material settings &amp; export" style="gap:4px;font-size:11px;padding:3px 8px;border:1px solid var(--km-border);border-radius:var(--km-radius-sm);">
      <km-icon name="settings" size="sm"></km-icon>
      <span>Settings</span>
    </button>
  </div>

  <!-- V2-mode controls -->
  <div id="v2-controls" class="hidden" style="display:flex;align-items:center;gap:var(--km-space-2);">
    <button class="icon-btn" id="btn-v2-fit" title="Fit to board">
      <svg width="16" height="16" viewBox="0 0 16 16" fill="none">
        <rect x="2" y="2" width="12" height="12" rx="1" stroke="currentColor" stroke-width="1.5"/>
        <path d="M5 5h2M5 5v2" stroke="currentColor" stroke-width="1.5" stroke-linecap="round"/>
        <path d="M11 5h-2M11 5v2" stroke="currentColor" stroke-width="1.5" stroke-linecap="round"/>
        <path d="M5 11h2M5 11v-2" stroke="currentColor" stroke-width="1.5" stroke-linecap="round"/>
        <path d="M11 11h-2M11 11v-2" stroke="currentColor" stroke-width="1.5" stroke-linecap="round"/>
      </svg>
    </button>
    <div class="sep"></div>
    <button class="icon-btn" id="btn-v2-settings" title="V2 scene settings" style="gap:4px;font-size:11px;padding:3px 8px;border:1px solid var(--km-border);border-radius:var(--km-radius-sm);">
      <km-icon name="settings" size="sm"></km-icon>
      <span>V2 Settings</span>
    </button>
  </div>
</div>

<!-- Body — both modes live here, visibility toggled -->
<div class="body" id="body">

  <!-- ── Custom mode pane ── -->
  <div class="canvas-wrap" id="custom-pane">
    <canvas id="pcb3d"></canvas>
    <div class="overlay" id="overlay">
      <div class="overlay-icon">⬡</div>
      <div class="overlay-title">Open a project or connect the KiCad bridge to view the live 3D board.</div>
    </div>
    <km-live3d-settings id="settings-panel" style="display:none;"></km-live3d-settings>

    <!-- V2 settings drawer — absolute within canvas-wrap -->
    <div class="settings-drawer" id="v2-drawer" style="bottom:0;">
      <div class="settings-head">
        <span>V2 Scene Settings</span>
        <button class="btn-icon-sm" id="btn-v2-settings-close" title="Close">✕</button>
      </div>
      <div class="settings-body" id="v2-settings-body"></div>
      <div class="settings-foot">
        <button id="btn-v2-reset">Reset to defaults</button>
      </div>
    </div>
  </div>

  <!-- ── GLB viewer pane ── -->
  <div class="glb-wrap hidden" id="glb-pane">
    <km-live-3d-viewer id="viewer-3d"></km-live-3d-viewer>

    <!-- GLB action bar -->
    <div class="glb-bar">
      <button class="btn-primary"   id="btn-export3d">Export &amp; Load</button>
      <button class="btn-secondary" id="btn-reset-cam" disabled>Reset view</button>
      <span class="glb-status" id="glb-status"></span>
      <span class="flex1"></span>
      <button class="btn-icon-sm" id="btn-settings-toggle" title="Advanced settings (⚙)">⚙</button>
    </div>

    <!-- Advanced settings drawer -->
    <div class="settings-drawer" id="settings-drawer">
      <div class="settings-head">
        <span>Advanced Settings</span>
        <button class="btn-icon-sm" id="btn-settings-close" title="Close">✕</button>
      </div>
      <div class="settings-body" id="settings-body"></div>
      <div class="settings-foot">
        <button id="btn-reset-settings">Reset to defaults</button>
      </div>
    </div>
  </div>

</div>

<!-- Status bar (custom mode only) -->
<div class="status-bar" id="status-bar">
  <div class="status-item" id="status-source"></div>
  <span class="status-sep">·</span>
  <div class="status-item" id="status-comps"></div>
  <span class="status-sep">·</span>
  <div class="status-item" id="status-fps"></div>
</div>
`;

// ── Web Component ─────────────────────────────────────────────────────────────

export class KmLive3D extends HTMLElement {
  constructor() {
    super();
    this.attachShadow({ mode: 'open' });
    this.shadowRoot.appendChild(TEMPLATE.content.cloneNode(true));

    // Custom mode state
    this._renderer        = null;
    this._debounce        = null;
    this._currentPcb      = null;
    this._loading         = false;
    this._compCount       = 0;
    this._ro              = null;
    this._spinHandle      = null;
    this._videoHandle     = null;
    this._boardGroup_ref  = null;

    // GLB mode state
    this._glbExporting    = false;
    this._glbLoaded       = false;
    this._settingsOpen    = false;
    this._viewerSettings  = JSON.parse(JSON.stringify(VIEWER_DEFAULTS));

    this._mode   = 'custom'; // 'custom' | 'glb' | 'v2'
    this._v2     = null;
    this._unsubs = [];
  }

  connectedCallback() {
    // ── Custom renderer ────────────────────────────────────────────────────
    const canvas = this.shadowRoot.getElementById('pcb3d');
    this._renderer = new Live3DRenderer(canvas);
    this._renderer.mount();
    this._renderer.onFps(fps => {
      const el = this.shadowRoot.getElementById('status-fps');
      if (el) el.textContent = `${fps} fps`;
    });

    this._wireCustomMode();
    this._wireGlbMode();
    this._v2 = new Live3dV2Manager(this.shadowRoot, this._renderer);
    this._wireV2Mode();
    this._wireModeToggle();

    this._ro = new ResizeObserver(entries => {
      const { width, height } = entries[0].contentRect;
      if (width > 0 && height > 0) this._renderer.resize(width, height);
    });
    this._ro.observe(this.shadowRoot.querySelector('.canvas-wrap'));

    this._unsubs.push(
      subscribe('project',            () => this._onProjectChange()),
      subscribe('boardState',         () => this._onProjectChange()),
      subscribe('bridgeConnected',    () => this._onProjectChange()),
      subscribe('projectFileChanged', f  => this._onFileChanged(f)),
      subscribe('boardComponents',    c  => this._onComponentsUpdate(c)),
    );

    this._onProjectChange();
  }

  disconnectedCallback() {
    this._unsubs.forEach(f => f());
    this._unsubs = [];
    this._v2?.deactivate();
    this._renderer?.dispose();
    this._renderer = null;
    this._ro?.disconnect();
    clearTimeout(this._debounce);
  }

  // ── Mode toggle ───────────────────────────────────────────────────────────

  _wireModeToggle() {
    this.shadowRoot.getElementById('btn-mode-custom')?.addEventListener('click', () => this._setMode('custom'));
    this.shadowRoot.getElementById('btn-mode-glb')?.addEventListener('click',    () => this._setMode('glb'));
    this.shadowRoot.getElementById('btn-mode-v2')?.addEventListener('click',     () => this._setMode('v2'));
  }

  _setMode(mode) {
    this._mode = mode;
    const isCustom = mode === 'custom';
    const isGlb    = mode === 'glb';
    const isV2     = mode === 'v2';

    this.shadowRoot.getElementById('btn-mode-custom')?.classList.toggle('active', isCustom);
    this.shadowRoot.getElementById('btn-mode-glb')?.classList.toggle('active',    isGlb);
    this.shadowRoot.getElementById('btn-mode-v2')?.classList.toggle('active',     isV2);

    // Custom + V2 share the same canvas-wrap; GLB has its own pane
    this.shadowRoot.getElementById('custom-pane')?.classList.toggle('hidden',    isGlb);
    this.shadowRoot.getElementById('custom-controls')?.classList.toggle('hidden', !isCustom);
    this.shadowRoot.getElementById('v2-controls')?.classList.toggle('hidden',     !isV2);
    this.shadowRoot.getElementById('glb-pane')?.classList.toggle('hidden',        !isGlb);
    this.shadowRoot.getElementById('status-bar')?.classList.toggle('hidden',      isGlb);

    // Close km-live3d-settings if switching away from Custom
    if (!isCustom) {
      const sp    = this.shadowRoot.getElementById('settings-panel');
      const spBtn = this.shadowRoot.getElementById('btn-settings');
      if (sp)    sp.style.display   = 'none';
      if (spBtn) { spBtn.style.borderColor = ''; spBtn.style.color = ''; }
    }

    // GLB viewer rAF loop
    const viewer = this.shadowRoot.getElementById('viewer-3d');
    if (isGlb) viewer?.resume?.();
    else        viewer?.pause?.();

    // V2 scene overlay
    if (isV2)  this._v2?.activate();
    else       this._v2?.deactivate();
  }

  // ── Custom mode wiring ────────────────────────────────────────────────────

  _wireCustomMode() {
    this.shadowRoot.getElementById('btn-fit')?.addEventListener('click', () => this._renderer.resetCamera());
    this.shadowRoot.getElementById('btn-top')?.addEventListener('click', () => this._renderer.setTopView?.());

    const settingsPanel = this.shadowRoot.getElementById('settings-panel');
    const btnSettings   = this.shadowRoot.getElementById('btn-settings');
    btnSettings?.addEventListener('click', () => {
      const hidden = settingsPanel.style.display === 'none';
      settingsPanel.style.display   = hidden ? '' : 'none';
      btnSettings.style.borderColor = hidden ? 'var(--km-accent)' : '';
      btnSettings.style.color       = hidden ? 'var(--km-accent)' : '';
    });

    settingsPanel?.addEventListener('km-settings-change', (e) => {
      this._renderer.applyMaterialSettings(e.detail.settings);
    });

    settingsPanel?.addEventListener('km-export-png', async (e) => {
      const { scale } = e.detail;
      settingsPanel.setProgress(10, 'Rendering…');
      try {
        const blob = await this._renderer.renderSnapshot({ scale, mime: 'image/png' });
        downloadBlob(blob, `pcb-${Date.now()}.png`);
        settingsPanel.setProgress(100, 'PNG saved');
        setTimeout(() => settingsPanel.setProgress(-1, ''), 2500);
      } catch (err) {
        settingsPanel.setProgress(-1, `Error: ${err.message}`);
        notify({ type: 'error', title: 'PNG export failed', message: err.message });
      }
    });

    settingsPanel?.addEventListener('km-export-jpeg', async (e) => {
      const { scale, quality } = e.detail;
      settingsPanel.setProgress(10, 'Rendering…');
      try {
        const blob = await this._renderer.renderSnapshot({ scale, mime: 'image/jpeg', quality });
        downloadBlob(blob, `pcb-${Date.now()}.jpg`);
        settingsPanel.setProgress(100, 'JPEG saved');
        setTimeout(() => settingsPanel.setProgress(-1, ''), 2500);
      } catch (err) {
        settingsPanel.setProgress(-1, `Error: ${err.message}`);
        notify({ type: 'error', title: 'JPEG export failed', message: err.message });
      }
    });

    settingsPanel?.addEventListener('km-export-gif', (e) => {
      const { frames, fps, scale } = e.detail;
      if (this._spinHandle) { this._spinHandle.cancel(); this._spinHandle = null; }
      if (!this._boardGroup_ref) {
        notify({ type: 'error', title: 'GIF export', message: 'Load a board first.' });
        return;
      }
      settingsPanel.setProgress(0, 'Capturing frames…');
      const capturedFrames = [];
      this._spinHandle = startSpin(
        this._renderer.renderer, this._renderer.scene, this._renderer.camera,
        this._boardGroup_ref, { frames, fps, scale },
        (imgData, idx, total) => {
          if (imgData === null) {
            settingsPanel.setProgress(95, 'Encoding GIF…');
            const w = this._renderer.renderer.domElement.width;
            const h = this._renderer.renderer.domElement.height;
            setTimeout(() => {
              try {
                const blob = encodeGif(capturedFrames, { fps, width: w, height: h, scale });
                downloadBlob(blob, `pcb-spin-${Date.now()}.gif`);
                settingsPanel.setProgress(100, 'GIF saved!');
                setTimeout(() => settingsPanel.setProgress(-1, ''), 3000);
              } catch (err) {
                settingsPanel.setProgress(-1, `GIF error: ${err.message}`);
              }
              this._spinHandle = null;
            }, 50);
          } else {
            capturedFrames.push(imgData);
            settingsPanel.setProgress(Math.round((idx / total) * 90), `Frame ${idx + 1}/${total}`);
          }
        },
      );
    });

    settingsPanel?.addEventListener('km-export-mp4-start', (e) => {
      const canvas = this._renderer.renderer.domElement;
      this._videoHandle = startVideoRecording(canvas, { fps: e.detail?.fps ?? 30, bitrate: 8_000_000 });
      settingsPanel.setRecording(true);
      settingsPanel.setProgress(0, 'Recording… rotate the board, then click Stop.');
      notify({ type: 'info', title: 'Recording started', message: 'Rotate the board. Click Stop & save when done.', duration: 4000 });
    });

    settingsPanel?.addEventListener('km-export-mp4-stop', async () => {
      if (!this._videoHandle) return;
      settingsPanel.setProgress(80, 'Finalizing video…');
      try {
        const blob = await this._videoHandle.stop();
        this._videoHandle = null;
        settingsPanel.setRecording(false);
        const ext = blob.type.includes('mp4') ? 'mp4' : 'webm';
        downloadBlob(blob, `pcb-spin-${Date.now()}.${ext}`);
        settingsPanel.setProgress(100, 'Video saved!');
        setTimeout(() => settingsPanel.setProgress(-1, ''), 3000);
      } catch (err) {
        settingsPanel.setProgress(-1, `Error: ${err.message}`);
        notify({ type: 'error', title: 'Video export failed', message: err.message });
      }
    });
  }

  // ── GLB mode wiring ───────────────────────────────────────────────────────

  _wireGlbMode() {
    const btnExport   = this.shadowRoot.getElementById('btn-export3d');
    const btnReset    = this.shadowRoot.getElementById('btn-reset-cam');
    const btnToggle   = this.shadowRoot.getElementById('btn-settings-toggle');
    const btnClose    = this.shadowRoot.getElementById('btn-settings-close');
    const btnDefaults = this.shadowRoot.getElementById('btn-reset-settings');
    const body_       = this.shadowRoot.getElementById('settings-body');
    const viewer      = this.shadowRoot.getElementById('viewer-3d');

    // Start paused — only run when GLB pane is visible
    viewer.pause?.();

    btnExport.addEventListener('click',  () => this._runGlbExport());
    btnReset.addEventListener('click',   () => viewer.resetCamera());
    btnToggle.addEventListener('click',  () => this._toggleGlbSettings());
    btnClose.addEventListener('click',   () => this._closeGlbSettings());

    btnDefaults.addEventListener('click', () => {
      this._viewerSettings = JSON.parse(JSON.stringify(VIEWER_DEFAULTS));
      this._populateGlbPanel();
      viewer.applySettings(this._viewerSettings);
    });

    body_.addEventListener('input',  (e) => this._onGlbSettingChange(e));
    body_.addEventListener('change', (e) => this._onGlbSettingChange(e));

    this._populateGlbPanel();

    viewer.addEventListener('load-done', () => {
      this._glbLoaded = true;
      this.shadowRoot.getElementById('btn-reset-cam').disabled = false;
      this._setGlbStatus('✓ Model loaded — drag to orbit, scroll to zoom', 'ok');
    });
    viewer.addEventListener('load-error', (e) => {
      this._setGlbStatus(`✗ Load failed: ${e.detail?.error?.message ?? e.detail?.error ?? 'unknown'}`, 'error');
      this.dispatchEvent(new CustomEvent('km-live3d-error', {
        bubbles: true, composed: true,
        detail: { message: e.detail?.error?.message ?? String(e.detail?.error) },
      }));
    });
  }

  // ── V2 mode wiring ────────────────────────────────────────────────────────

  _wireV2Mode() {
    this.shadowRoot.getElementById('btn-v2-fit')?.addEventListener('click',
      () => this._renderer.resetCamera());
    this.shadowRoot.getElementById('btn-v2-settings')?.addEventListener('click',
      () => this._v2.toggleDrawer());
    this.shadowRoot.getElementById('btn-v2-settings-close')?.addEventListener('click',
      () => this._v2.closeDrawer());
    this.shadowRoot.getElementById('btn-v2-reset')?.addEventListener('click',
      () => this._v2.resetDefaults());

    const body = this.shadowRoot.getElementById('v2-settings-body');
    body?.addEventListener('input',  (e) => this._v2.handleInput(e));
    body?.addEventListener('change', (e) => this._v2.handleInput(e));
  }

  _populateGlbPanel() {
    const body_ = this.shadowRoot.getElementById('settings-body');
    if (body_) body_.innerHTML = buildSettingsPanelHtml(this._viewerSettings);
  }

  _toggleGlbSettings() {
    if (this._settingsOpen) this._closeGlbSettings();
    else                    this._openGlbSettings();
  }

  _openGlbSettings() {
    this._settingsOpen = true;
    this.shadowRoot.getElementById('settings-drawer')?.classList.add('open');
    this.shadowRoot.getElementById('btn-settings-toggle')?.classList.add('active');
  }

  _closeGlbSettings() {
    this._settingsOpen = false;
    this.shadowRoot.getElementById('settings-drawer')?.classList.remove('open');
    this.shadowRoot.getElementById('btn-settings-toggle')?.classList.remove('active');
  }

  _onGlbSettingChange(e) {
    const el      = e.target;
    const section = el.dataset.section;
    const key     = el.dataset.key;
    const type    = el.dataset.type;
    if (!section || !key || !type) return;

    let value;
    if      (type === 'bool')  value = el.checked;
    else if (type === 'float') value = parseFloat(el.value);
    else if (type === 'int')   value = parseInt(el.value, 10);
    else                       value = el.value;

    if (section === 'spotLight' && key === 'shadowMapSize') value = parseInt(el.value, 10);

    if (!this._viewerSettings[section]) this._viewerSettings[section] = {};
    this._viewerSettings[section][key] = value;

    this.shadowRoot.getElementById('viewer-3d')?.applySettings({ [section]: { [key]: value } });

    if (el.type === 'range') {
      const step  = parseFloat(el.dataset.step ?? el.step ?? 1);
      const outEl = this.shadowRoot.getElementById(`out-${section}-${key}`);
      if (outEl) outEl.textContent = fmtVal(value, step);
    }
  }

  async _runGlbExport() {
    if (this._glbExporting) return;
    this._glbExporting = true;
    const btn = this.shadowRoot.getElementById('btn-export3d');
    if (btn) { btn.disabled = true; btn.textContent = 'Exporting…'; }
    this._setGlbStatus('Exporting GLB (may take 1–5 min on complex boards)…', '');

    try {
      const opts = {
        substModels: this._viewerSettings.glbExport?.substModels ?? true,
        noDnp:       this._viewerSettings.glbExport?.noDnp       ?? false,
      };
      const res = await exportGlbForViewer(opts);
      if (res.success && res.output_file) {
        this._setGlbStatus('GLB ready — loading model…', '');
        this.shadowRoot.getElementById('viewer-3d')?.loadGlb(toViewerUrl(res.output_file));
      } else {
        this._setGlbStatus(`✗ Export failed: ${res.message}`, 'error');
      }
    } catch (err) {
      Logger.error('Live3D', 'GLB export failed', err);
      this._setGlbStatus(`✗ Export error: ${err}`, 'error');
    } finally {
      this._glbExporting = false;
      if (btn) { btn.disabled = false; btn.textContent = 'Export & Load'; }
    }
  }

  _setGlbStatus(text, kind = '') {
    const el = this.shadowRoot.getElementById('glb-status');
    if (!el) return;
    el.textContent = text;
    el.className   = 'glb-status' + (kind ? ` ${kind}` : '');
  }

  // ── Store reactions ───────────────────────────────────────────────────────

  _onProjectChange() {
    const pcbPath = store.boardState?.board_name ?? store.project?.pcb_file ?? null;
    if (!pcbPath || pcbPath === this._currentPcb) return;
    this._currentPcb = pcbPath;
    this._loadPcbFile(pcbPath);
  }

  _onFileChanged(changedFile) {
    if (!changedFile?.endsWith('.kicad_pcb')) return;
    clearTimeout(this._debounce);
    this._debounce = setTimeout(() => {
      if (changedFile === this._currentPcb) this._loadPcbFile(changedFile);
    }, RELOAD_DEBOUNCE_MS);
  }

  _onComponentsUpdate(comps) {
    if (!comps?.length || !this._renderer) return;
    this._compCount = comps.length;
    this._renderer.updateComponents(comps);
    this._updateStatusComps(comps.length);
  }

  // ── PCB loading (custom mode) ─────────────────────────────────────────────

  async _loadPcbFile(path) {
    if (this._loading) return;
    this._loading = true;

    const glbPath = path.replace(/\.kicad_pcb$/i, '.kimaster.glb');
    this._showOverlay('exporting', 'Exporting 3D model via KiCad…');

    try {
      const glbResult = await this._tryExportGlb(path, glbPath);
      if (!glbResult.success) {
        throw new Error('kicad-cli GLB export failed — ensure KiCad 10 is installed.');
      }

      this._showOverlay('loading', 'Loading 3D model…');
      this._renderer.onProgress(pct => {
        this._showOverlay('loading', `Loading 3D model… ${pct}%`);
      });

      const glbUrl = _toAssetUrl(glbPath);
      await this._renderer.loadGlb(glbUrl);

      const comps = store.boardComponents ?? [];
      if (comps.length) this._renderer.updateComponents(comps);
      this._compCount      = comps.length;
      this._boardGroup_ref = this._renderer.boardGroup;

      this._updateStatusSource('live');
      this._updateStatusComps(this._compCount);
      this._updateStatusMode('Real models · GLB');
      this._hideOverlay();
      this.dispatchEvent(new CustomEvent('km-live3d-ready', { bubbles: true }));

    } catch (err) {
      Logger.error('Live3D', 'GLB load failed', err);
      this._showOverlay('error', `Could not build 3D view: ${err.message ?? err}`);
    } finally {
      this._renderer.onProgress(null);
      this._loading = false;
    }
  }

  async _tryExportGlb(pcbPath, outPath) {
    try {
      const result = await invoke(EXPORT_GLB, { args: {
        pcb_file:           pcbPath,
        output_file:        outPath,
        include_tracks:     true,
        include_pads:       true,
        include_zones:      true,
        include_silkscreen: true,
        include_soldermask: true,
        cut_vias_in_body:   true,
        subst_models:       false,
        no_dnp:             false,
        no_components:      false,
      }});
      Logger.info('Live3D', `GLB export result: exit=${result?.raw?.exit_code} success=${result?.raw?.success}`);
      if (result?.raw?.stderr) Logger.warn('Live3D', 'kicad-cli stderr:', result.raw.stderr.slice(0, 300));
    } catch (err) {
      Logger.warn('Live3D', 'GLB export invoke failed', err);
      return { success: false };
    }

    try {
      const exists = await invoke(FILE_EXISTS, { path: outPath });
      if (!exists) {
        Logger.warn('Live3D', `GLB file not found after export: ${outPath}`);
        return { success: false };
      }
      Logger.info('Live3D', `GLB file confirmed at: ${outPath}`);
      return { success: true };
    } catch (err) {
      Logger.warn('Live3D', 'cmd_file_exists failed', err);
      return { success: false };
    }
  }

  // ── Overlay helpers ───────────────────────────────────────────────────────

  _showOverlay(type, msg) {
    const overlay = this.shadowRoot.getElementById('overlay');
    if (!overlay) return;
    overlay.classList.remove('hidden');
    const icons = { exporting: '⬡', loading: '', error: '⚠' };
    overlay.innerHTML = type === 'loading'
      ? `<div class="spinner"></div><div class="overlay-title">${_esc(msg)}</div>`
      : `<div class="overlay-icon">${icons[type] ?? '⬡'}</div><div class="overlay-title">${_esc(msg)}</div>`;
  }

  _hideOverlay() {
    this.shadowRoot.getElementById('overlay')?.classList.add('hidden');
  }

  _updateStatusSource(source) {
    const el = this.shadowRoot.getElementById('status-source');
    if (!el) return;
    el.innerHTML = source === 'live'
      ? `<div class="status-live"></div><span>Live</span>`
      : `<span>File</span>`;
  }

  _updateStatusMode(label) {
    const el = this.shadowRoot.getElementById('status-comps');
    if (el) el.title = label;
  }

  _updateStatusComps(n) {
    const el = this.shadowRoot.getElementById('status-comps');
    if (el) el.textContent = `${n} parts`;
  }
}

// ── Helpers ───────────────────────────────────────────────────────────────────

function _toAssetUrl(path) {
  if (!path) return '';
  return window.__TAURI_INTERNALS__?.convertFileSrc
    ? window.__TAURI_INTERNALS__.convertFileSrc(path)
    : 'file:///' + path.replace(/\\/g, '/');
}

function _esc(s) {
  const d = document.createElement('div');
  d.textContent = String(s);
  return d.innerHTML;
}

customElements.define('km-live-3d', KmLive3D);
