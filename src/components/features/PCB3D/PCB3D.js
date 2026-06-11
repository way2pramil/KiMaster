/**
 * @element km-pcb3d
 * @summary Parallel-pipeline photorealistic PCB 3D viewer.
 *
 * Three concurrent pipelines on board load:
 *   A. SVG layers → rasterize → GLSL shader     (~2-5s)  photorealistic board
 *   B. VRML export → VRMLLoader → model cache   (~5-15s) real component models
 *   C. Marketing GLB (user-triggered only)       (~1-5min) full photorealistic
 *
 * The scene upgrades silently as each pipeline completes.
 * Board appears immediately with synthetic geometry, then upgrades.
 *
 * KiCad 10+ required.
 */

import { store, subscribe }    from '../../../core/State.js';
import { invoke }              from '../../../core/Ipc.js';
import { Logger }              from '../../../core/Logger.js';
import { notify }              from '../../../core/Notify.js';
import { PCB3DRenderer }       from '../../../modules/pcb3d/renderer/PCB3DRenderer.js';
import { exportLayers }        from '../../../modules/pcb3d/pipeline/LayerExporter.js';
import { buildLayerTextures }  from '../../../modules/pcb3d/pipeline/LayerRasterizer.js';
import { exportVrml, loadComponents } from '../../../modules/pcb3d/pipeline/VrmlLibrary.js';

// Import new AppCommands for pcb3d pipeline
const PCB3D_MARKETING_GLB = 'cmd_pcb3d_export_marketing_glb';
const PCB3D_FILE_EXISTS   = 'cmd_pcb3d_file_exists';

const DEBOUNCE_MS = 1000;

// ── Template ─────────────────────────────────────────────────────────────────

const T = document.createElement('template');
T.innerHTML = `
<style>
  :host {
    display: flex; flex-direction: column;
    height: 100%; background: #0d1117;
    color: var(--km-text-primary);
    font-family: var(--km-font);
    overflow: hidden;
    container-type: size;
  }

  /* ── Toolbar ── */
  .toolbar {
    display: flex; align-items: center; gap: var(--km-space-2);
    padding: 0 var(--km-space-3); height: 40px;
    background: var(--km-bg-elevated);
    border-bottom: 1px solid var(--km-border);
    flex-shrink: 0; flex-wrap: nowrap;
  }
  .t-title { font-size: var(--km-font-size-sm); font-weight: 600; margin-right: 4px; }
  .t-sep   { width:1px; height:16px; background:var(--km-border); flex-shrink:0; }
  .t-end   { margin-left: auto; display: flex; align-items: center; gap: 6px; }

  .pill {
    display: flex; align-items: center; gap: 4px;
    padding: 3px 8px; border-radius: 999px;
    border: 1px solid var(--km-border);
    background: transparent; color: var(--km-text-secondary);
    font-size: 11px; font-family: var(--km-font);
    cursor: pointer; user-select: none;
    transition: all 120ms ease;
  }
  .pill:hover  { border-color: var(--km-accent); color: var(--km-text-primary); }
  .pill.on     { background: rgba(37,99,235,.15); color: var(--km-accent); border-color: var(--km-accent); }
  .pill-dot    { width:7px; height:7px; border-radius:50%; display:inline-block; }

  .icon-btn {
    background:none; border:none; color:var(--km-text-secondary);
    cursor:pointer; padding:4px; border-radius:var(--km-radius-sm);
    display:flex; align-items:center; transition:color 120ms, background 120ms;
  }
  .icon-btn:hover { color:var(--km-text-primary); background:var(--km-bg-surface); }

  .export-btn {
    display: flex; align-items: center; gap: 4px;
    padding: 4px 10px; border-radius: var(--km-radius-sm);
    border: 1px solid var(--km-border);
    background: var(--km-bg-surface);
    color: var(--km-text-secondary);
    font-family: var(--km-font); font-size: 11px;
    cursor: pointer; transition: all 120ms ease;
  }
  .export-btn:hover { border-color: var(--km-accent); color: var(--km-accent); }

  /* ── Body ── */
  .body { display: flex; flex: 1; overflow: hidden; }
  .canvas-wrap { flex:1; position:relative; overflow:hidden; }
  canvas { width:100%!important; height:100%!important; display:block; touch-action:none; }

  /* ── Overlay ── */
  .overlay {
    position:absolute; inset:0;
    display:flex; flex-direction:column; align-items:center; justify-content:center;
    gap:var(--km-space-3); pointer-events:none; transition:opacity 300ms ease;
  }
  .overlay.hidden { opacity:0; pointer-events:none; }
  .ov-icon  { font-size:40px; opacity:.2; }
  .ov-title { font-size:var(--km-font-size-sm); color:var(--km-text-secondary); text-align:center; max-width:300px; line-height:1.5; }
  .spinner  { width:28px;height:28px; border:2px solid var(--km-border); border-top-color:var(--km-accent); border-radius:50%; animation:spin .7s linear infinite; }
  @keyframes spin { to{transform:rotate(360deg)} }

  /* ── Pipeline upgrade chips ── */
  .chips {
    position:absolute; bottom:var(--km-space-3); left:var(--km-space-3);
    display:flex; flex-direction:column; gap:6px;
    pointer-events:none;
  }
  .chip {
    display:flex; flex-direction:column; gap:4px;
    background:rgba(0,0,0,.82); backdrop-filter:blur(8px);
    border:1px solid var(--km-border); border-radius:var(--km-radius);
    padding:7px 11px; min-width:200px;
    opacity:0; transform:translateY(6px);
    transition:opacity 200ms ease, transform 200ms ease;
  }
  .chip.vis { opacity:1; transform:translateY(0); }
  .chip-row { display:flex; align-items:center; gap:7px; font-size:11px; color:var(--km-text-secondary); }
  .chip-label { flex:1; font-size:10px; color:var(--km-text-muted); }
  .chip-pct   { font-size:10px; color:var(--km-accent); min-width:30px; text-align:right; }
  .chip-bar   { height:2px; background:var(--km-border); border-radius:1px; overflow:hidden; }
  .chip-fill  { height:100%; background:var(--km-accent); transition:width 300ms ease; }
  .chip-fill.ind { width:35%!important; animation:ind 1.3s ease-in-out infinite; }
  @keyframes ind { 0%{transform:translateX(-100%)} 100%{transform:translateX(380%)} }
  .cspin { width:11px;height:11px;flex-shrink:0; border:1.5px solid var(--km-border);border-top-color:var(--km-accent); border-radius:50%; animation:spin .7s linear infinite; }
  .chip-done { color:var(--km-trace)!important; }

  /* ── Status bar ── */
  .status-bar {
    display:flex; align-items:center; gap:var(--km-space-3);
    padding:0 var(--km-space-3); height:24px;
    background:var(--km-bg-elevated); border-top:1px solid var(--km-border);
    flex-shrink:0; font-size:10px; color:var(--km-text-muted);
  }
  .status-dot { width:6px;height:6px;border-radius:50%;background:var(--km-trace); animation:pulse 2s ease-in-out infinite; }
  @keyframes pulse { 0%,100%{opacity:1} 50%{opacity:.3} }
</style>

<!-- Toolbar -->
<div class="toolbar">
  <span class="t-title">PCB 3D</span>
  <div class="t-sep"></div>
  <button class="pill on" data-layer="board"  title="Toggle board"><span class="pill-dot" style="background:#43a142"></span>Board</button>
  <button class="pill on" data-layer="comps"  title="Toggle components"><span class="pill-dot" style="background:#2563EB"></span>Parts</button>
  <button class="pill on" data-layer="silk"   title="Toggle silkscreen"><span class="pill-dot" style="background:#e0e0d8"></span>Silk</button>
  <div class="t-end">
    <button class="icon-btn" id="btn-top"  title="Top view">↑</button>
    <button class="icon-btn" id="btn-fit"  title="Fit board">⤢</button>
    <div class="t-sep"></div>
    <button class="export-btn" id="btn-marketing">⬡ Full Export</button>
    <button class="export-btn" id="btn-png" title="Save PNG">PNG</button>
    <button class="export-btn" id="btn-jpg" title="Save JPEG">JPEG</button>
  </div>
</div>

<!-- Body -->
<div class="body">
  <div class="canvas-wrap" id="canvas-wrap">
    <canvas id="canvas3d"></canvas>

    <!-- Initial overlay -->
    <div class="overlay" id="overlay">
      <div class="ov-icon">⬡</div>
      <div class="ov-title">Open a project or connect KiCad Bridge to view Live 3D.</div>
    </div>

    <!-- Pipeline progress chips -->
    <div class="chips">
      <div class="chip" id="chip-a">
        <div class="chip-row"><div class="cspin"></div><span class="chip-label" id="chip-a-label">Exporting layers…</span><span class="chip-pct" id="chip-a-pct"></span></div>
        <div class="chip-bar"><div class="chip-fill ind" id="chip-a-fill"></div></div>
      </div>
      <div class="chip" id="chip-b">
        <div class="chip-row"><div class="cspin"></div><span class="chip-label" id="chip-b-label">Exporting component models…</span><span class="chip-pct" id="chip-b-pct"></span></div>
        <div class="chip-bar"><div class="chip-fill ind" id="chip-b-fill"></div></div>
      </div>
    </div>
  </div>
</div>

<!-- Status bar -->
<div class="status-bar">
  <div id="s-source"></div>
  <span>·</span>
  <span id="s-comps">—</span>
  <span>·</span>
  <span id="s-fps">— fps</span>
  <span>·</span>
  <span id="s-mode">Initializing</span>
</div>
`;

export class KmPcb3D extends HTMLElement {
  constructor() {
    super();
    this.attachShadow({ mode: 'open' });
    this.shadowRoot.appendChild(T.content.cloneNode(true));
    this._renderer   = null;
    this._unsubs     = [];
    this._ro         = null;
    this._debounce   = null;
    this._curPcb     = null;
    this._pipelineA  = null; // layer export promise
    this._pipelineB  = null; // vrml export promise
    this._layers     = { board: true, comps: true, silk: true };
    this._footprints = [];
    this._cacheDir   = null;
  }

  connectedCallback() {
    const canvas = this.shadowRoot.getElementById('canvas3d');
    this._renderer = new PCB3DRenderer(canvas);
    this._renderer.mount();
    this._renderer.onFps(fps => this._set('s-fps', `${fps} fps`));
    this._renderer.onProgress(pct => this._chipProgress('a', pct));

    // Resize
    this._ro = new ResizeObserver(([e]) => {
      const { width, height } = e.contentRect;
      if (width > 0 && height > 0) this._renderer.resize(width, height);
    });
    this._ro.observe(this.shadowRoot.getElementById('canvas-wrap'));

    // Toolbar
    this.shadowRoot.querySelectorAll('[data-layer]').forEach(btn => {
      btn.addEventListener('click', () => {
        btn.classList.toggle('on');
        this._layers[btn.dataset.layer] = btn.classList.contains('on');
        this._applyVisibility();
      });
    });
    this.shadowRoot.getElementById('btn-fit')?.addEventListener('click', () => this._renderer.fitCamera());
    this.shadowRoot.getElementById('btn-top')?.addEventListener('click', () => this._renderer.setTopView());

    this.shadowRoot.getElementById('btn-png')?.addEventListener('click', () => this._exportImage('image/png', 'png'));
    this.shadowRoot.getElementById('btn-jpg')?.addEventListener('click', () => this._exportImage('image/jpeg', 'jpg'));
    this.shadowRoot.getElementById('btn-marketing')?.addEventListener('click', () => this._startMarketingExport());

    // Store subscriptions
    this._unsubs.push(
      subscribe('project',            () => this._onProjectChange()),
      subscribe('boardState',         () => this._onProjectChange()),
      subscribe('boardComponents',  comps => this._renderer.updateComponents(comps)),
      subscribe('projectFileChanged', f  => this._onFileChanged(f)),
    );

    this._onProjectChange();
  }

  disconnectedCallback() {
    this._unsubs.forEach(f => f());
    this._unsubs   = [];
    this._renderer?.dispose();
    this._renderer = null;
    this._ro?.disconnect();
    clearTimeout(this._debounce);
  }

  // ── Store reactions ──────────────────────────────────────────────────────

  _onProjectChange() {
    const pcb = store.boardState?.board_name ?? store.project?.pcb_file ?? null;
    if (!pcb || pcb === this._curPcb) return;
    this._curPcb  = pcb;
    this._cacheDir = pcb.replace(/\.kicad_pcb$/i, '.kimaster-3d');
    this._launchParallelPipelines(pcb);
  }

  _onFileChanged(f) {
    if (!f?.endsWith?.('.kicad_pcb') || f !== this._curPcb) return;
    clearTimeout(this._debounce);
    this._debounce = setTimeout(() => {
      this._chipShow('a', 'Board changed — refreshing layers…');
      this._pipelineA = this._runPipelineA(f);
    }, DEBOUNCE_MS);
  }

  // ── Parallel pipeline launcher ───────────────────────────────────────────

  _launchParallelPipelines(pcbFile) {
    this._showOverlay('loading', 'Preparing 3D view…');

    // Immediate synthetic board from bridge state
    const comps = store.boardComponents ?? [];
    if (comps.length) {
      const bounds = this._guessBoundsFromComps(comps);
      // Pass centroid so board and components share the same origin
      this._renderer.buildSyntheticBoard(bounds.w, bounds.h);
      this._renderer.buildSyntheticComponents(comps, { x: bounds.cx, y: bounds.cy });
      this._footprints = comps;
      this._set('s-comps', `${comps.length} parts (synthetic)`);
      this._hideOverlay();
    }

    // Pipeline A and B run in parallel — each upgrades the scene independently
    this._pipelineA = this._runPipelineA(pcbFile);
    this._pipelineB = this._runPipelineB(pcbFile);

    // Surface any top-level errors
    Promise.allSettled([this._pipelineA, this._pipelineB]).then(results => {
      const allFailed = results.every(r => r.status === 'rejected');
      if (allFailed && !comps.length) {
        this._showOverlay('error', 'Could not load 3D view. Is KiCad 10 installed?');
      }
    });
  }

  // ── Pipeline A: SVG layers → texture board ───────────────────────────────

  async _runPipelineA(pcbFile) {
    this._chipShow('a', 'Exporting PCB layers…');
    try {
      const layerData = await exportLayers(pcbFile, this._cacheDir + '/layers');
      if (!layerData) { this._chipHide('a'); return; }

      this._chipUpdate('a', 'Rasterizing layers…');
      const textures = await buildLayerTextures(layerData.files);

      this._renderer.applyLayerTextures(textures.boardMm, textures);
      this._chipDone('a', 'Board textures ready');
      this._set('s-mode', 'Layer textures · Pipeline A ✓');
      this._hideOverlay();
      setTimeout(() => this._chipHide('a'), 2500);

    } catch (err) {
      Logger.error('PCB3D', 'Pipeline A failed', err);
      this._chipHide('a');
    }
  }

  // ── Pipeline B: VRML component models ────────────────────────────────────

  async _runPipelineB(pcbFile) {
    this._chipShow('b', 'Exporting component models…');
    try {
      const vrmlResult = await exportVrml(pcbFile, this._cacheDir + '/vrml');
      if (!vrmlResult?.success) { this._chipHide('b'); return; }

      this._chipUpdate('b', 'Loading 3D models…');
      const footprints = store.boardComponents ?? this._footprints;
      const modelMap   = await loadComponents(vrmlResult.components_dir, footprints);

      if (modelMap.size > 0) {
        this._renderer.applyComponentModels(modelMap, footprints);
        this._set('s-comps', `${modelMap.size} real models`);
        this._chipDone('b', `${modelMap.size} component models loaded`);
        this._set('s-mode', 'Layer textures + VRML models · Pipeline A+B ✓');
        notify({ type: 'success', title: 'PCB 3D upgraded', message: `Real models loaded (${modelMap.size} components)`, duration: 3000 });
        setTimeout(() => this._chipHide('b'), 2500);
      } else {
        this._chipHide('b');
      }

    } catch (err) {
      Logger.warn('PCB3D', 'Pipeline B failed', err);
      this._chipHide('b');
    }
  }

  // ── Pipeline C: Marketing GLB ─────────────────────────────────────────────

  async _startMarketingExport() {
    if (!this._curPcb) return;
    const outFile = this._cacheDir + '/marketing.glb';

    this._chipShow('a', 'Generating photorealistic GLB… (may take a few minutes)');

    try {
      // MarketingGlbArgs is a Rust struct — Tauri expects { args: { snake_case } }
      const result = await invoke(PCB3D_MARKETING_GLB, {
        args: {
          pcb_file:     this._curPcb,
          output_file:  outFile,
          subst_models: true,
          no_dnp:       false,
        }
      });

      if (!result?.success) {
        this._chipHide('a');
        notify({ type: 'error', title: 'Marketing export failed', message: result?.message ?? 'Unknown error' });
        return;
      }

      this._chipUpdate('a', 'Loading full 3D scene…');
      await this._renderer.applyMarketingGlb(_assetUrl(outFile));
      this._chipDone('a', 'Marketing render ready');
      this._set('s-mode', 'Full GLB · Pipeline C ✓');
      notify({ type: 'success', title: 'Full 3D render loaded', message: 'All component models visible.', duration: 4000 });
      setTimeout(() => this._chipHide('a'), 2000);

    } catch (err) {
      Logger.error('PCB3D', 'Pipeline C failed', err);
      this._chipHide('a');
      notify({ type: 'error', title: 'Marketing export error', message: String(err?.message ?? err) });
    }
  }

  // ── Export ────────────────────────────────────────────────────────────────

  async _exportImage(mime, ext) {
    try {
      const blob = await this._renderer.renderSnapshot({ scale: 4, mime });
      const url  = URL.createObjectURL(blob);
      const a    = document.createElement('a');
      a.href = url; a.download = `pcb-${Date.now()}.${ext}`; a.click();
      setTimeout(() => URL.revokeObjectURL(url), 5000);
    } catch (err) {
      notify({ type: 'error', title: 'Export failed', message: err.message });
    }
  }

  // ── Helpers ───────────────────────────────────────────────────────────────

  _applyVisibility() {
    // Visibility for synthetic vs real based on layer toggles
    const g = this._renderer;
    if (g._boardGroup)  g._boardGroup.visible  = this._layers.board;
    if (g._synthGroup)  g._synthGroup.visible  = this._layers.comps;
    if (g._compGroup)   g._compGroup.visible   = this._layers.comps;
  }

  _guessBoundsFromComps(comps) {
    if (!comps?.length) return { w: 50, h: 40, cx: 0, cy: 0 };
    let minX = Infinity, maxX = -Infinity, minY = Infinity, maxY = -Infinity;
    for (const c of comps) {
      const x = c.position?.x ?? 0, y = c.position?.y ?? 0;
      if (x < minX) minX = x; if (x > maxX) maxX = x;
      if (y < minY) minY = y; if (y > maxY) maxY = y;
    }
    return {
      w:  Math.max(20, (maxX - minX) * 1.3),
      h:  Math.max(15, (maxY - minY) * 1.3),
      cx: (minX + maxX) / 2,   // KiCad board centroid X
      cy: (minY + maxY) / 2,   // KiCad board centroid Y
    };
  }

  // ── UI helpers ────────────────────────────────────────────────────────────

  _showOverlay(type, msg) {
    const el = this.shadowRoot.getElementById('overlay');
    if (!el) return;
    el.classList.remove('hidden');
    el.innerHTML = type === 'loading'
      ? `<div class="spinner"></div><div class="ov-title">${_esc(msg)}</div>`
      : `<div class="ov-icon">⚠</div><div class="ov-title">${_esc(msg)}</div>`;
  }

  _hideOverlay() {
    this.shadowRoot.getElementById('overlay')?.classList.add('hidden');
  }

  _chipShow(id, label) {
    const chip = this.shadowRoot.getElementById(`chip-${id}`);
    const lbl  = this.shadowRoot.getElementById(`chip-${id}-label`);
    const fill = this.shadowRoot.getElementById(`chip-${id}-fill`);
    if (lbl)  lbl.textContent = label;
    if (fill) { fill.classList.add('ind'); fill.style.width = ''; fill.classList.remove('chip-done'); }
    chip?.classList.add('vis');
  }

  _chipUpdate(id, label, pct = null) {
    const lbl  = this.shadowRoot.getElementById(`chip-${id}-label`);
    const pctEl= this.shadowRoot.getElementById(`chip-${id}-pct`);
    const fill = this.shadowRoot.getElementById(`chip-${id}-fill`);
    if (lbl)  lbl.textContent  = label;
    if (pctEl) pctEl.textContent = pct != null ? `${pct}%` : '';
    if (fill && pct != null) {
      fill.classList.remove('ind');
      fill.style.width = `${Math.min(100, pct)}%`;
    }
  }

  _chipProgress(id, pct) { this._chipUpdate(id, null, pct); }

  _chipDone(id, label) {
    const lbl  = this.shadowRoot.getElementById(`chip-${id}-label`);
    const fill = this.shadowRoot.getElementById(`chip-${id}-fill`);
    const chip = this.shadowRoot.getElementById(`chip-${id}`);
    const spin = chip?.querySelector('.cspin');
    if (lbl)  { lbl.textContent = label; lbl.classList.add('chip-done'); }
    if (fill) { fill.classList.remove('ind'); fill.style.width = '100%'; fill.style.background = 'var(--km-trace)'; }
    if (spin) { spin.style.borderTopColor = 'var(--km-trace)'; spin.style.animation = 'none'; }
  }

  _chipHide(id) {
    this.shadowRoot.getElementById(`chip-${id}`)?.classList.remove('vis');
  }

  _set(id, text) {
    const el = this.shadowRoot.getElementById(id);
    if (el) el.textContent = text;
  }
}

customElements.define('km-pcb3d', KmPcb3D);

// ── Utils ─────────────────────────────────────────────────────────────────────

function _esc(s) {
  const d = document.createElement('div');
  d.textContent = String(s ?? '');
  return d.innerHTML;
}

function _assetUrl(p) {
  return window.__TAURI_INTERNALS__?.convertFileSrc
    ? window.__TAURI_INTERNALS__.convertFileSrc(p)
    : 'file:///' + p.replace(/\\/g, '/');
}
