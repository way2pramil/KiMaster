/**
 * @element km-board-render
 * @summary 3D PCB view — static renders (kicad-cli) + live interactive THREE.js viewer.
 *
 * Tabs:
 *   Single view  — big PNG preview for one camera angle
 *   All sides    — 6-up grid (top/bottom/front/back/left/right) rendered in parallel
 *   Live 3D      — interactive THREE.js viewer loaded from an exported .glb
 *
 * Live 3D tab has a ⚙ button that opens an Advanced Settings drawer.
 * Every THREE.js parameter is exposed as a live control; defaults live in
 * VIEWER_DEFAULTS (no hardcoded constants in this file).
 */

import { store, subscribe }          from '../../../core/State.js';
import { Logger }                    from '../../../core/Logger.js';
import { renderSide, renderAllSides } from '../../../modules/render/RenderService.js';
import { exportGlbForViewer, toViewerUrl } from '../../../modules/render/Live3dService.js';
import { VIEWER_DEFAULTS } from './Live3dViewer.js';

const SIDES_6 = ['top', 'bottom', 'front', 'back', 'left', 'right'];

// ── Settings panel HTML helpers ───────────────────────────────────────────────

function _spSection(title, open = true) {
  return `<details${open ? ' open' : ''}><summary class="sp-sec">${title}</summary>`;
}
function _spEnd() { return `</details>`; }

function _spToggle(sec, key, label, val) {
  return `<label class="sp-row">
    <span class="sp-lbl">${label}</span>
    <input type="checkbox" data-section="${sec}" data-key="${key}" data-type="bool"${val ? ' checked' : ''}>
  </label>`;
}

function _spRange(sec, key, label, val, min, max, step) {
  const disp = _fmtVal(val, step);
  return `<label class="sp-row">
    <span class="sp-lbl">${label}</span>
    <span class="sp-range-wrap">
      <input type="range" data-section="${sec}" data-key="${key}" data-type="float"
             data-step="${step}" min="${min}" max="${max}" step="${step}" value="${val}">
      <output id="out-${sec}-${key}" class="sp-out">${disp}</output>
    </span>
  </label>`;
}

function _spColor(sec, key, label, val) {
  return `<label class="sp-row">
    <span class="sp-lbl">${label}</span>
    <input type="color" data-section="${sec}" data-key="${key}" data-type="color" value="${val}">
  </label>`;
}

function _spSelect(sec, key, label, val, options) {
  const opts = options.map(o => `<option value="${o}"${o === String(val) ? ' selected' : ''}>${o}</option>`).join('');
  return `<label class="sp-row">
    <span class="sp-lbl">${label}</span>
    <select data-section="${sec}" data-key="${key}" data-type="select">${opts}</select>
  </label>`;
}

function _fmtVal(v, step) {
  if (step < 0.0001) return Number(v).toFixed(5);
  if (step < 0.01)   return Number(v).toFixed(4);
  if (step < 0.1)    return Number(v).toFixed(2);
  if (step < 1)      return Number(v).toFixed(1);
  return Math.round(v).toString();
}

function _buildSettingsPanelHtml(s) {
  return [
    // ── Export options ──────────────────────────────────────────────────────
    _spSection('Export Options'),
    _spToggle ('glbExport', 'substModels', 'Substitute missing models',  s.glbExport.substModels),
    _spToggle ('glbExport', 'noDnp',       'Exclude DNP components',     s.glbExport.noDnp),
    _spEnd(),

    // ── Renderer ────────────────────────────────────────────────────────────
    _spSection('Renderer'),
    _spRange  ('renderer', 'pixelRatio',          'Pixel ratio',          s.renderer.pixelRatio,          0.5,  3,    0.25),
    _spSelect ('renderer', 'toneMapping',          'Tone mapping',         s.renderer.toneMapping,
               ['None','Linear','Reinhard','Cineon','ACESFilmic','AgX','NeutralToneMapping']),
    _spRange  ('renderer', 'toneMappingExposure',  'Exposure',             s.renderer.toneMappingExposure, 0.1,  5,    0.05),
    _spToggle ('renderer', 'shadowsEnabled',       'Shadows enabled',      s.renderer.shadowsEnabled),
    _spSelect ('renderer', 'shadowMapType',        'Shadow map type',      s.renderer.shadowMapType,
               ['Basic','PCF','PCFSoft','VSM']),
    _spColor  ('renderer', 'clearColor',           'Background colour',    s.renderer.clearColor),
    _spEnd(),

    // ── Fog ─────────────────────────────────────────────────────────────────
    _spSection('Fog', false),
    _spToggle ('fog', 'enabled', 'Fog enabled',  s.fog.enabled),
    _spColor  ('fog', 'color',   'Fog colour',   s.fog.color),
    _spRange  ('fog', 'near',    'Near',         s.fog.near,  1,   200,  1),
    _spRange  ('fog', 'far',     'Far',          s.fog.far,   10,  500,  5),
    _spEnd(),

    // ── Spot light ──────────────────────────────────────────────────────────
    _spSection('Spot Light'),
    _spToggle ('spotLight', 'enabled',       'Enabled',           s.spotLight.enabled),
    _spColor  ('spotLight', 'color',         'Colour',            s.spotLight.color),
    _spRange  ('spotLight', 'intensity',     'Intensity',         s.spotLight.intensity,    0,      8000,    50),
    _spRange  ('spotLight', 'distance',      'Distance',          s.spotLight.distance,     0,      500,     5),
    _spRange  ('spotLight', 'angle',         'Cone angle (rad)',  s.spotLight.angle,         0,      1.57,    0.01),
    _spRange  ('spotLight', 'penumbra',      'Penumbra',          s.spotLight.penumbra,      0,      1,       0.01),
    _spRange  ('spotLight', 'posX',          'Position X',        s.spotLight.posX,         -150,   150,     1),
    _spRange  ('spotLight', 'posY',          'Position Y',        s.spotLight.posY,          0,     200,     1),
    _spRange  ('spotLight', 'posZ',          'Position Z',        s.spotLight.posZ,         -150,   150,     1),
    _spToggle ('spotLight', 'castShadow',    'Cast shadow',       s.spotLight.castShadow),
    _spRange  ('spotLight', 'shadowBias',    'Shadow bias',       s.spotLight.shadowBias,   -0.001,  0.001,  0.00001),
    _spSelect ('spotLight', 'shadowMapSize', 'Shadow map size',   String(s.spotLight.shadowMapSize),
               ['256','512','1024','2048','4096']),
    _spEnd(),

    // ── Ambient light ───────────────────────────────────────────────────────
    _spSection('Ambient Light', false),
    _spToggle ('ambientLight', 'enabled',   'Enabled',   s.ambientLight.enabled),
    _spColor  ('ambientLight', 'color',     'Colour',    s.ambientLight.color),
    _spRange  ('ambientLight', 'intensity', 'Intensity', s.ambientLight.intensity, 0, 5, 0.05),
    _spEnd(),

    // ── Hemisphere light ────────────────────────────────────────────────────
    _spSection('Hemisphere Light', false),
    _spToggle ('hemiLight', 'enabled',     'Enabled',       s.hemiLight.enabled),
    _spColor  ('hemiLight', 'skyColor',    'Sky colour',    s.hemiLight.skyColor),
    _spColor  ('hemiLight', 'groundColor', 'Ground colour', s.hemiLight.groundColor),
    _spRange  ('hemiLight', 'intensity',   'Intensity',     s.hemiLight.intensity, 0, 5, 0.05),
    _spRange  ('hemiLight', 'posX',        'Position X',    s.hemiLight.posX, -100, 100, 1),
    _spRange  ('hemiLight', 'posY',        'Position Y',    s.hemiLight.posY,    0, 200, 1),
    _spRange  ('hemiLight', 'posZ',        'Position Z',    s.hemiLight.posZ, -100, 100, 1),
    _spEnd(),

    // ── Camera ──────────────────────────────────────────────────────────────
    _spSection('Camera', false),
    _spRange  ('camera', 'fov',  'Field of view',  s.camera.fov,   10,  120, 1),
    _spRange  ('camera', 'near', 'Near clip',      s.camera.near,  0.01, 10, 0.01),
    _spRange  ('camera', 'far',  'Far clip',       s.camera.far,   50, 5000, 50),
    _spRange  ('camera', 'posX', 'Default pos X',  s.camera.posX, -100, 100, 0.5),
    _spRange  ('camera', 'posY', 'Default pos Y',  s.camera.posY,    0, 100, 0.5),
    _spRange  ('camera', 'posZ', 'Default pos Z',  s.camera.posZ,    0, 200, 0.5),
    _spEnd(),

    // ── Orbit controls ──────────────────────────────────────────────────────
    _spSection('Orbit Controls', false),
    _spToggle ('controls', 'enableDamping',    'Damping enabled',    s.controls.enableDamping),
    _spRange  ('controls', 'dampingFactor',    'Damping factor',     s.controls.dampingFactor,   0.01, 0.5,  0.01),
    _spToggle ('controls', 'enablePan',        'Pan enabled',        s.controls.enablePan),
    _spToggle ('controls', 'enableZoom',       'Zoom enabled',       s.controls.enableZoom),
    _spRange  ('controls', 'minDistance',      'Min distance',       s.controls.minDistance,     0.1,  50,   0.1),
    _spRange  ('controls', 'maxDistance',      'Max distance',       s.controls.maxDistance,     5,    500,  5),
    _spRange  ('controls', 'minPolarAngle',    'Min polar (rad)',    s.controls.minPolarAngle,   0,    3.14, 0.01),
    _spRange  ('controls', 'maxPolarAngle',    'Max polar (rad)',    s.controls.maxPolarAngle,   0,    3.14, 0.01),
    _spToggle ('controls', 'autoRotate',       'Auto rotate',        s.controls.autoRotate),
    _spRange  ('controls', 'autoRotateSpeed',  'Rotate speed',       s.controls.autoRotateSpeed, 0.1,  20,   0.1),
    _spRange  ('controls', 'targetX',          'Orbit target X',     s.controls.targetX, -20, 20, 0.1),
    _spRange  ('controls', 'targetY',          'Orbit target Y',     s.controls.targetY, -10, 20, 0.1),
    _spRange  ('controls', 'targetZ',          'Orbit target Z',     s.controls.targetZ, -20, 20, 0.1),
    _spEnd(),

    // ── Ground ──────────────────────────────────────────────────────────────
    _spSection('Ground', false),
    _spToggle ('ground', 'visible',   'Visible',   s.ground.visible),
    _spColor  ('ground', 'color',     'Colour',    s.ground.color),
    _spRange  ('ground', 'metalness', 'Metalness', s.ground.metalness, 0, 1, 0.01),
    _spRange  ('ground', 'roughness', 'Roughness', s.ground.roughness, 0, 1, 0.01),
    _spRange  ('ground', 'size',      'Size',      s.ground.size,      1, 500, 1),
    _spEnd(),

    // ── Helpers ─────────────────────────────────────────────────────────────
    _spSection('Helpers', false),
    _spToggle ('helpers', 'axesVisible',   'Show axes',       s.helpers.axesVisible),
    _spRange  ('helpers', 'axesSize',      'Axes size',       s.helpers.axesSize,       1, 50, 1),
    _spToggle ('helpers', 'gridVisible',   'Show grid',       s.helpers.gridVisible),
    _spRange  ('helpers', 'gridSize',      'Grid size',       s.helpers.gridSize,       1, 200, 1),
    _spRange  ('helpers', 'gridDivisions', 'Grid divisions',  s.helpers.gridDivisions,  1,  80, 1),
    _spColor  ('helpers', 'gridColor',     'Grid colour',     s.helpers.gridColor),
    _spEnd(),

    // ── Model ───────────────────────────────────────────────────────────────
    _spSection('Model', false),
    _spToggle ('model', 'wireframe',     'Wireframe',      s.model.wireframe),
    _spToggle ('model', 'castShadow',    'Cast shadow',    s.model.castShadow),
    _spToggle ('model', 'receiveShadow', 'Receive shadow', s.model.receiveShadow),
    _spEnd(),
  ].join('');
}

// ── Template ──────────────────────────────────────────────────────────────────

const TEMPLATE = document.createElement('template');
TEMPLATE.innerHTML = `
<style>
  :host {
    display: flex;
    flex-direction: column;
    height: 100%;
    background: var(--km-bg-primary);
    color: var(--km-text-primary);
    font-family: var(--km-font);
    overflow: hidden;
  }

  /* ── Tabs ── */
  .tabs {
    display: flex;
    align-items: center;
    gap: var(--km-space-2);
    padding: 0 var(--km-space-3);
    height: 38px;
    border-bottom: 1px solid var(--km-border);
    background: var(--km-bg-elevated);
    flex-shrink: 0;
  }
  .tab {
    background: none;
    border: none;
    padding: var(--km-space-1) var(--km-space-3);
    border-radius: var(--km-radius-sm);
    color: var(--km-text-secondary);
    font-size: var(--km-font-size-sm);
    cursor: pointer;
    transition: color var(--km-duration-fast) var(--km-ease),
                background var(--km-duration-fast) var(--km-ease);
    white-space: nowrap;
  }
  .tab:hover  { color: var(--km-text-primary); background: var(--km-bg-surface); }
  .tab.active { color: var(--km-accent);       background: var(--km-accent-muted); }
  .tab-sep { flex: 1; }
  .resolution {
    font-size: var(--km-font-size-xs);
    color: var(--km-text-muted);
    font-variant-numeric: tabular-nums;
  }
  .btn-icon {
    background: none;
    border: none;
    color: var(--km-text-secondary);
    cursor: pointer;
    font-size: 15px;
    padding: 4px 6px;
    border-radius: var(--km-radius-sm);
    line-height: 1;
    transition: color var(--km-duration-fast) var(--km-ease),
                background var(--km-duration-fast) var(--km-ease);
  }
  .btn-icon:hover { color: var(--km-text-primary); background: var(--km-bg-surface); }
  .btn-icon.active { color: var(--km-accent); background: var(--km-accent-muted); }

  /* ── Toolbar ── */
  .toolbar {
    display: flex;
    align-items: center;
    gap: var(--km-space-2);
    padding: var(--km-space-2) var(--km-space-3);
    border-bottom: 1px solid var(--km-border);
    flex-shrink: 0;
    background: var(--km-bg-surface);
    flex-wrap: wrap;
  }
  .toolbar label { color: var(--km-text-secondary); font-size: var(--km-font-size-xs); }
  .toolbar select {
    background: var(--km-bg-input);
    border: 1px solid var(--km-border);
    color: var(--km-text-primary);
    border-radius: var(--km-radius-sm);
    padding: 2px var(--km-space-2);
    font-family: var(--km-font);
    font-size: var(--km-font-size-sm);
    outline: none;
    cursor: pointer;
  }
  .toolbar select:focus { border-color: var(--km-accent); }
  .toolbar-sep { width: 1px; height: 14px; background: var(--km-border); }

  .btn-primary {
    background: var(--km-accent);
    border: none;
    color: #fff;
    padding: var(--km-space-1) var(--km-space-3);
    border-radius: var(--km-radius-sm);
    font-size: var(--km-font-size-sm);
    font-weight: var(--km-font-weight-medium);
    cursor: pointer;
    transition: background var(--km-duration-fast) var(--km-ease);
    white-space: nowrap;
  }
  .btn-primary:hover:not(:disabled) { background: var(--km-accent-hover); }
  .btn-primary:disabled { background: var(--km-bg-elevated); color: var(--km-text-muted); cursor: not-allowed; }

  .btn-secondary {
    background: var(--km-bg-surface);
    border: 1px solid var(--km-border);
    color: var(--km-text-primary);
    padding: var(--km-space-1) var(--km-space-3);
    border-radius: var(--km-radius-sm);
    font-size: var(--km-font-size-sm);
    cursor: pointer;
    transition: background var(--km-duration-fast) var(--km-ease);
    white-space: nowrap;
  }
  .btn-secondary:hover:not(:disabled) { background: var(--km-bg-elevated); }
  .btn-secondary:disabled { opacity: 0.5; cursor: not-allowed; }

  /* ── Pane host ── */
  .pane-host {
    flex: 1;
    position: relative;
    overflow: hidden;
    min-height: 0;
  }

  /* ── Shared pane layout ── */
  .body-pane {
    position: absolute;
    inset: 0;
    overflow: auto;
    padding: var(--km-space-3);
    visibility: hidden;
    pointer-events: none;
  }
  .body-pane.active {
    visibility: visible;
    pointer-events: auto;
  }

  /* ── Single-view canvas ── */
  .single-canvas {
    display: flex;
    align-items: center;
    justify-content: center;
    height: 100%;
    background: var(--km-bg-secondary);
    border-radius: var(--km-radius-md);
    border: 1px solid var(--km-border);
    overflow: hidden;
    position: relative;
  }
  .single-canvas img {
    max-width: 100%;
    max-height: 100%;
    object-fit: contain;
    border-radius: var(--km-radius-sm);
    background: #000;
  }
  .single-canvas.empty {
    color: var(--km-text-muted);
    font-size: var(--km-font-size-sm);
    flex-direction: column;
    gap: var(--km-space-3);
  }
  .single-canvas.empty km-icon { opacity: 0.25; }

  /* ── 6-up grid ── */
  .grid {
    display: grid;
    grid-template-columns: repeat(3, 1fr);
    gap: var(--km-space-3);
  }
  @media (max-width: 900px) { .grid { grid-template-columns: repeat(2, 1fr); } }
  @media (max-width: 600px) { .grid { grid-template-columns: 1fr; } }

  .tile {
    background: var(--km-bg-surface);
    border: 1px solid var(--km-border);
    border-radius: var(--km-radius-md);
    overflow: hidden;
    display: flex;
    flex-direction: column;
    aspect-ratio: 16 / 10;
    position: relative;
  }
  .tile__label {
    position: absolute;
    top: var(--km-space-1);
    left: var(--km-space-2);
    padding: 1px 6px;
    font-size: var(--km-font-size-xs);
    background: var(--km-bg-overlay);
    color: var(--km-text-primary);
    border-radius: var(--km-radius-xs);
    backdrop-filter: blur(8px);
    text-transform: lowercase;
    font-family: var(--km-font-mono);
  }
  .tile__img { width: 100%; height: 100%; object-fit: contain; background: #000; }
  .tile.empty { background: var(--km-bg-secondary); display: flex; align-items: center; justify-content: center; color: var(--km-text-muted); font-size: var(--km-font-size-xs); }
  .tile.spinning::after {
    content: '';
    position: absolute;
    inset: 0;
    background: var(--km-bg-overlay);
    backdrop-filter: blur(4px);
    border-radius: var(--km-radius-md);
  }
  .tile.spinning::before {
    content: '⟳ rendering…';
    position: absolute;
    z-index: 2;
    inset: 0;
    display: flex;
    align-items: center;
    justify-content: center;
    color: var(--km-text-primary);
    font-size: var(--km-font-size-sm);
    font-family: var(--km-font-mono);
  }

  /* ── Live 3D pane ── */
  .live3d-pane {
    padding: 0;
    overflow: hidden;
    display: flex;
    flex-direction: column;
  }
  km-live-3d-viewer {
    flex: 1;
    min-height: 0;
    display: block;
  }
  .live3d-bar {
    flex-shrink: 0;
    height: 36px;
    display: flex;
    align-items: center;
    gap: var(--km-space-2);
    padding: 0 var(--km-space-3);
    background: var(--km-bg-elevated);
    border-top: 1px solid var(--km-border);
  }
  .live3d-status {
    font-size: var(--km-font-size-xs);
    color: var(--km-text-muted);
    font-variant-numeric: tabular-nums;
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
    max-width: 320px;
  }
  .live3d-status.ok    { color: var(--km-trace); }
  .live3d-status.error { color: var(--km-red); }
  .flex1 { flex: 1; }

  /* ── Settings drawer ── */
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
  .sp-row input[type="checkbox"] {
    accent-color: var(--km-accent);
    width: 14px;
    height: 14px;
    cursor: pointer;
    flex-shrink: 0;
  }
  .sp-row input[type="color"] {
    width: 28px;
    height: 22px;
    border: 1px solid var(--km-border);
    border-radius: 3px;
    padding: 1px;
    background: var(--km-bg-input);
    cursor: pointer;
    flex-shrink: 0;
  }
  .sp-row select {
    background: var(--km-bg-input);
    border: 1px solid var(--km-border);
    color: var(--km-text-primary);
    border-radius: var(--km-radius-sm);
    padding: 2px 4px;
    font-family: var(--km-font);
    font-size: var(--km-font-size-xs);
    outline: none;
    cursor: pointer;
    flex-shrink: 0;
    max-width: 120px;
  }
  .sp-range-wrap {
    display: flex;
    align-items: center;
    gap: 5px;
    flex-shrink: 0;
    width: 140px;
  }
  .sp-range-wrap input[type="range"] {
    flex: 1;
    accent-color: var(--km-accent);
    cursor: pointer;
    height: 4px;
    min-width: 0;
  }
  .sp-out {
    font-size: 10px;
    color: var(--km-text-muted);
    font-variant-numeric: tabular-nums;
    font-family: var(--km-font-mono);
    min-width: 40px;
    text-align: right;
  }

  /* ── No-project state ── */
  .no-project {
    flex: 1;
    display: flex;
    flex-direction: column;
    align-items: center;
    justify-content: center;
    gap: var(--km-space-3);
    color: var(--km-text-muted);
    font-size: var(--km-font-size-sm);
  }
  .no-project.hidden { display: none; }

  /* ── Status bar ── */
  .status {
    padding: 3px var(--km-space-3);
    font-size: var(--km-font-size-xs);
    color: var(--km-text-muted);
    border-top: 1px solid var(--km-border);
    background: var(--km-bg-elevated);
    flex-shrink: 0;
    font-variant-numeric: tabular-nums;
  }
  .status.ok    { color: var(--km-trace); }
  .status.error { color: var(--km-red); }

  .hidden { display: none !important; }
</style>

<!-- Tabs -->
<div class="tabs">
  <button class="tab active" data-tab="single">Single view</button>
  <button class="tab"        data-tab="all">All sides</button>
  <button class="tab"        data-tab="live3d">Live 3D</button>
  <span class="tab-sep"></span>
  <span class="resolution" id="resolution">1280 × 720</span>
</div>

<!-- No project state -->
<div class="no-project hidden" id="no-project">
  <km-icon name="pcb" size="xl"></km-icon>
  <span>Open a project or connect the KiCad bridge to render in 3D.</span>
</div>

<!-- Static render toolbar (hidden on live3d tab) -->
<div class="toolbar hidden" id="toolbar">
  <label>Side</label>
  <select id="sel-side">
    <option value="top">top</option>
    <option value="bottom">bottom</option>
    <option value="front">front</option>
    <option value="back">back</option>
    <option value="left">left</option>
    <option value="right">right</option>
    <option value="top_front">top-front</option>
    <option value="top_back">top-back</option>
  </select>
  <div class="toolbar-sep"></div>
  <label>Size</label>
  <select id="sel-size">
    <option value="1280x720">1280 × 720</option>
    <option value="1920x1080">1920 × 1080</option>
    <option value="2560x1440">2560 × 1440</option>
    <option value="800x600">800 × 600</option>
  </select>
  <div class="toolbar-sep"></div>
  <label>Quality</label>
  <select id="sel-quality">
    <option value="high">high</option>
    <option value="basic">basic</option>
  </select>
  <div class="toolbar-sep"></div>
  <label>Background</label>
  <select id="sel-bg">
    <option value="default">default</option>
    <option value="transparent">transparent</option>
    <option value="opaque">opaque</option>
  </select>
  <div class="toolbar-sep"></div>
  <button class="btn-primary" id="btn-render">Render</button>
</div>

<!-- Pane host — all three panes live here simultaneously -->
<div class="pane-host" id="pane-host">
  <!-- Single view -->
  <div class="body-pane" id="pane-single"></div>

  <!-- All sides grid -->
  <div class="body-pane" id="pane-all"></div>

  <!-- Live 3D — permanently mounted, never recreated -->
  <div class="body-pane live3d-pane" id="pane-live3d">
    <km-live-3d-viewer id="viewer-3d"></km-live-3d-viewer>

    <!-- Bottom action bar -->
    <div class="live3d-bar">
      <button class="btn-primary"   id="btn-export3d">Export &amp; Load</button>
      <button class="btn-secondary" id="btn-reset-cam" disabled>Reset view</button>
      <span class="live3d-status" id="live3d-status"></span>
      <span class="flex1"></span>
      <button class="btn-icon" id="btn-settings-toggle" title="Advanced settings (⚙)">⚙</button>
    </div>

    <!-- Advanced settings drawer (slides in from right) -->
    <div class="settings-drawer" id="settings-drawer">
      <div class="settings-head">
        <span>Advanced Settings</span>
        <button class="btn-icon" id="btn-settings-close" title="Close">✕</button>
      </div>
      <div class="settings-body" id="settings-body"></div>
      <div class="settings-foot">
        <button id="btn-reset-settings">Reset to defaults</button>
      </div>
    </div>
  </div>
</div>

<!-- Status bar (static renders) -->
<div class="status" id="status">Ready.</div>
`;

// ── Web Component ─────────────────────────────────────────────────────────────

export class KmBoardRender extends HTMLElement {
  constructor() {
    super();
    this.attachShadow({ mode: 'open' });
    this.shadowRoot.appendChild(TEMPLATE.content.cloneNode(true));

    this._activeTab   = 'single';
    this._lastSingle  = null;
    this._allViews    = {};
    this._busy        = false;
    this._glbExporting = false;
    this._glbLoaded   = false;
    this._settingsOpen = false;
    this._viewerSettings = JSON.parse(JSON.stringify(VIEWER_DEFAULTS));
    this._unsubs      = [];
  }

  connectedCallback() {
    this._unsubs.push(subscribe('project',         () => this._onProjectChange()));
    this._unsubs.push(subscribe('bridgeConnected', () => this._onProjectChange()));
    this._unsubs.push(subscribe('boardState',      () => this._onProjectChange()));

    this._wireTabs();
    this._wireStaticToolbar();
    this._wireLive3d();
    this._onProjectChange();
  }

  disconnectedCallback() {
    for (const u of this._unsubs) u();
    this._unsubs = [];
  }

  // ── Tabs ──────────────────────────────────────────────────────────────────

  _wireTabs() {
    const tabs = this.shadowRoot.querySelectorAll('.tab');
    for (const tab of tabs) {
      tab.addEventListener('click', () => {
        this._activeTab = tab.dataset.tab;
        tabs.forEach(t => t.classList.toggle('active', t.dataset.tab === this._activeTab));
        this._syncPanes();
      });
    }
  }

  // ── Static render toolbar ─────────────────────────────────────────────────

  _wireStaticToolbar() {
    const btn  = this.shadowRoot.getElementById('btn-render');
    const size = this.shadowRoot.getElementById('sel-size');
    const res  = this.shadowRoot.getElementById('resolution');

    size.addEventListener('change', () => {
      res.textContent = size.value.replace('x', ' × ');
    });

    btn.addEventListener('click', () => {
      if (this._activeTab === 'single') this._runSingle();
      else                              this._runAll();
    });
  }

  _readToolbarOptions() {
    const sel = (id) => this.shadowRoot.getElementById(id)?.value;
    const [w, h] = (sel('sel-size') ?? '1280x720').split('x').map(n => parseInt(n, 10));
    return {
      side:       sel('sel-side')    ?? 'top',
      width_px:   w,
      height_px:  h,
      quality:    sel('sel-quality') ?? 'high',
      background: sel('sel-bg')      ?? 'default',
    };
  }

  // ── Live 3D wiring ────────────────────────────────────────────────────────

  _wireLive3d() {
    const btnExport   = this.shadowRoot.getElementById('btn-export3d');
    const btnReset    = this.shadowRoot.getElementById('btn-reset-cam');
    const btnToggle   = this.shadowRoot.getElementById('btn-settings-toggle');
    const btnClose    = this.shadowRoot.getElementById('btn-settings-close');
    const btnDefaults = this.shadowRoot.getElementById('btn-reset-settings');
    const drawer      = this.shadowRoot.getElementById('settings-drawer');
    const body_       = this.shadowRoot.getElementById('settings-body');
    const viewer      = this.shadowRoot.getElementById('viewer-3d');

    btnExport.addEventListener('click', () => this._runLive3dExport());
    btnReset.addEventListener('click', () => {
      viewer.resetCamera();
    });

    btnToggle.addEventListener('click', () => this._toggleSettingsPanel());
    btnClose.addEventListener('click',  () => this._closeSettingsPanel());

    btnDefaults.addEventListener('click', () => {
      this._viewerSettings = JSON.parse(JSON.stringify(VIEWER_DEFAULTS));
      this._populateSettingsPanel();
      viewer.applySettings(this._viewerSettings);
    });

    // Event delegation for all settings controls
    body_.addEventListener('input',  (e) => this._onSettingChange(e));
    body_.addEventListener('change', (e) => this._onSettingChange(e));

    // Populate panel HTML once
    this._populateSettingsPanel();

    // Viewer events
    viewer.addEventListener('load-done', () => {
      this._glbLoaded = true;
      btnReset.disabled = false;
      this._setLive3dStatus('✓ Model loaded — drag to orbit, scroll to zoom', 'ok');
    });
    viewer.addEventListener('load-error', (e) => {
      this._setLive3dStatus(`✗ Load failed: ${e.detail?.error?.message ?? e.detail?.error ?? 'unknown'}`, 'error');
    });
  }

  _populateSettingsPanel() {
    const body_ = this.shadowRoot.getElementById('settings-body');
    if (body_) body_.innerHTML = _buildSettingsPanelHtml(this._viewerSettings);
  }

  _toggleSettingsPanel() {
    if (this._settingsOpen) this._closeSettingsPanel();
    else                    this._openSettingsPanel();
  }

  _openSettingsPanel() {
    this._settingsOpen = true;
    this.shadowRoot.getElementById('settings-drawer')?.classList.add('open');
    this.shadowRoot.getElementById('btn-settings-toggle')?.classList.add('active');
  }

  _closeSettingsPanel() {
    this._settingsOpen = false;
    this.shadowRoot.getElementById('settings-drawer')?.classList.remove('open');
    this.shadowRoot.getElementById('btn-settings-toggle')?.classList.remove('active');
  }

  _onSettingChange(e) {
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

    // For shadowMapSize: the select stores string, viewer expects number
    if (section === 'spotLight' && key === 'shadowMapSize') {
      value = parseInt(el.value, 10);
    }

    // Update local settings mirror
    if (!this._viewerSettings[section]) this._viewerSettings[section] = {};
    this._viewerSettings[section][key] = value;

    // Apply to live viewer
    const viewer = this.shadowRoot.getElementById('viewer-3d');
    viewer?.applySettings({ [section]: { [key]: value } });

    // Update range output label
    if (el.type === 'range') {
      const step   = parseFloat(el.dataset.step ?? el.step ?? 1);
      const outEl  = this.shadowRoot.getElementById(`out-${section}-${key}`);
      if (outEl) outEl.textContent = _fmtVal(value, step);
    }
  }

  // ── Live 3D export & load flow ────────────────────────────────────────────

  async _runLive3dExport() {
    if (this._glbExporting) return;
    this._glbExporting = true;
    const btnExport = this.shadowRoot.getElementById('btn-export3d');
    if (btnExport) { btnExport.disabled = true; btnExport.textContent = 'Exporting…'; }

    this._setLive3dStatus('Exporting GLB (may take 1–5 min on complex boards)…', '');

    try {
      const opts = {
        substModels: this._viewerSettings.glbExport?.substModels ?? true,
        noDnp:       this._viewerSettings.glbExport?.noDnp       ?? false,
      };
      const res = await exportGlbForViewer(opts);
      if (res.success && res.output_file) {
        this._setLive3dStatus(`GLB ready — loading model…`, '');
        const viewer = this.shadowRoot.getElementById('viewer-3d');
        viewer?.loadGlb(toViewerUrl(res.output_file));
      } else {
        this._setLive3dStatus(`✗ Export failed: ${res.message}`, 'error');
      }
    } catch (err) {
      Logger.error('BoardRender', 'Live3D export failed', err);
      this._setLive3dStatus(`✗ Export error: ${err}`, 'error');
    } finally {
      this._glbExporting = false;
      if (btnExport) { btnExport.disabled = false; btnExport.textContent = 'Export & Load'; }
    }
  }

  _setLive3dStatus(text, kind = '') {
    const el = this.shadowRoot.getElementById('live3d-status');
    if (!el) return;
    el.textContent = text;
    el.className   = 'live3d-status' + (kind ? ` ${kind}` : '');
  }

  // ── Project change ────────────────────────────────────────────────────────

  _onProjectChange() {
    const hasPcb = !!(store.boardState?.board_name ?? store.project?.pcb_file);
    this.shadowRoot.getElementById('no-project').classList.toggle('hidden', hasPcb);
    this.shadowRoot.getElementById('pane-host').classList.toggle('hidden', !hasPcb);

    if (!hasPcb) {
      this._lastSingle = null;
      this._allViews   = {};
    }
    this._syncPanes();
  }

  // ── Pane sync ─────────────────────────────────────────────────────────────

  _syncPanes() {
    const hasPcb  = !!(store.boardState?.board_name ?? store.project?.pcb_file);
    const toolbar = this.shadowRoot.getElementById('toolbar');

    // Toolbar: shown for single/all only, and only when there's a project
    if (toolbar) {
      toolbar.classList.toggle('hidden', !hasPcb || this._activeTab === 'live3d');
    }

    // Show/hide panes
    for (const id of ['pane-single', 'pane-all', 'pane-live3d']) {
      const pane = this.shadowRoot.getElementById(id);
      if (!pane) continue;
      const isActive = id === `pane-${this._activeTab}`;
      pane.classList.toggle('active', isActive);
    }

    if (!hasPcb) return;

    if (this._activeTab === 'single') this._updateSinglePane();
    else if (this._activeTab === 'all')  this._updateAllPane();
    // live3d pane is self-managing
  }

  // ── Single view pane ──────────────────────────────────────────────────────

  _updateSinglePane() {
    const pane = this.shadowRoot.getElementById('pane-single');
    if (!pane) return;
    pane.innerHTML = '';

    const wrap = document.createElement('div');
    wrap.className = 'single-canvas' + (this._lastSingle ? '' : ' empty');
    if (this._lastSingle) {
      const img = document.createElement('img');
      img.src = _toAssetUrl(this._lastSingle);
      img.alt = 'Rendered PCB view';
      wrap.appendChild(img);
    } else {
      wrap.innerHTML = `
        <km-icon name="pcb" size="xl"></km-icon>
        <span>Click <b>Render</b> to generate a 3D view of your board.</span>
      `;
    }
    pane.appendChild(wrap);
  }

  // ── All-sides pane ────────────────────────────────────────────────────────

  _updateAllPane() {
    const pane = this.shadowRoot.getElementById('pane-all');
    if (!pane) return;
    pane.innerHTML = '';

    const grid = document.createElement('div');
    grid.className = 'grid';
    for (const side of SIDES_6) {
      const tile = document.createElement('div');
      tile.dataset.side = side;
      tile.className = 'tile';
      const path = this._allViews[side];
      if (path) {
        tile.innerHTML = `
          <span class="tile__label">${side}</span>
          <img class="tile__img" src="${_toAssetUrl(path)}" alt="${side} view"/>
        `;
      } else {
        tile.classList.add('empty');
        tile.innerHTML = `<span class="tile__label">${side}</span><span>—</span>`;
      }
      grid.appendChild(tile);
    }
    pane.appendChild(grid);
  }

  _markTileBusy(side, busy) {
    const pane = this.shadowRoot.getElementById('pane-all');
    const tile = pane?.querySelector(`.tile[data-side="${side}"]`);
    if (tile) tile.classList.toggle('spinning', busy);
  }

  // ── Single static render ──────────────────────────────────────────────────

  async _runSingle() {
    if (this._busy) return;
    const opts = this._readToolbarOptions();
    this._setStatus(`Rendering ${opts.side} (${opts.width_px}×${opts.height_px}) …`, '');
    this._busy = true;
    this._setRenderBtn(true);
    try {
      const r = await renderSide(opts);
      if (r.success) {
        this._lastSingle = r.output_path;
        this._setStatus(`✓ Rendered ${opts.side} → ${r.output_path}`, 'ok');
        this.dispatchEvent(new CustomEvent('km-render-done', {
          bubbles: true, composed: true,
          detail: { side: opts.side, output_path: r.output_path },
        }));
      } else {
        this._setStatus(`✗ Render failed: ${r.message}`, 'error');
        this.dispatchEvent(new CustomEvent('km-render-error', {
          bubbles: true, composed: true,
          detail: { side: opts.side, message: r.message },
        }));
      }
      this._updateSinglePane();
    } catch (err) {
      Logger.error('BoardRender', 'Single render failed', err);
      this._setStatus(`✗ Render error: ${err}`, 'error');
    } finally {
      this._busy = false;
      this._setRenderBtn(false);
    }
  }

  // ── All-sides static render ───────────────────────────────────────────────

  async _runAll() {
    if (this._busy) return;
    const opts = this._readToolbarOptions();
    this._busy = true;
    this._setRenderBtn(true);
    this._setStatus(`Rendering 6 views in parallel (${opts.width_px}×${opts.height_px}) …`, '');

    this._allViews = {};
    this._updateAllPane();
    for (const side of SIDES_6) this._markTileBusy(side, true);

    try {
      const r = await renderAllSides({
        sides:      SIDES_6,
        width_px:   opts.width_px,
        height_px:  opts.height_px,
        quality:    opts.quality,
        background: opts.background,
      });

      for (const path of r.files ?? []) {
        const m = path.match(/render_([a-z_]+)\.(png|jpg|jpeg)/i);
        if (m) this._allViews[m[1]] = path;
      }

      const okCount   = Object.keys(this._allViews).length;
      const failCount = (r.failures ?? []).length;
      if (r.success) {
        this._setStatus(`✓ Rendered ${okCount} views → ${r.output_dir}`, 'ok');
      } else {
        this._setStatus(`Partial: ${okCount} ok, ${failCount} failed — ${(r.failures ?? []).join('; ')}`, 'error');
      }

      this._updateAllPane();
    } catch (err) {
      Logger.error('BoardRender', 'All-sides render failed', err);
      this._setStatus(`✗ Render error: ${err}`, 'error');
    } finally {
      for (const side of SIDES_6) this._markTileBusy(side, false);
      this._busy = false;
      this._setRenderBtn(false);
    }
  }

  // ── Helpers ───────────────────────────────────────────────────────────────

  _setStatus(text, kind = '') {
    const el = this.shadowRoot.getElementById('status');
    if (!el) return;
    el.textContent = text;
    el.className   = 'status' + (kind ? ` ${kind}` : '');
  }

  _setRenderBtn(busy) {
    const btn = this.shadowRoot.getElementById('btn-render');
    if (!btn) return;
    btn.disabled    = busy;
    btn.textContent = busy ? 'Rendering…' : 'Render';
  }
}

function _toAssetUrl(path) {
  if (!path) return '';
  if (window.__TAURI_INTERNALS__?.convertFileSrc) {
    try { return window.__TAURI_INTERNALS__.convertFileSrc(path); }
    catch { /* fall through */ }
  }
  return 'file:///' + path.replace(/\\/g, '/');
}

customElements.define('km-board-render', KmBoardRender);
