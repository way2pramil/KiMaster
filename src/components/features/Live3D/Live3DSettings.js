/**
 * @element km-live3d-settings
 * @summary Material & export settings panel for the Live 3D viewer.
 *
 * Sections:
 *   Render profile — Default / Photorealistic / Glassy Lacquer / Sharp & Crisp presets
 *   Board Finish — ENIG / HASL / None / Custom (roughness, metalness, color)
 *   Solder Mask  — preset colors + custom, roughness, opacity, clearcoat + clearcoat roughness
 *   Silkscreen   — color, roughness
 *   Lighting     — background, ambient, key, exposure, env intensity
 *   Post-process — SSAO toggle+radius, bloom toggle+strength, sharpen
 *   Export       — PNG / JPEG (resolution scale) | GIF spin | MP4 spin
 *
 * @fires km-settings-change  — { settings: object }
 * @fires km-export-png       — { scale, width, height }
 * @fires km-export-jpeg      — { scale, quality }
 * @fires km-export-gif       — { frames, fps, scale }
 * @fires km-export-mp4-start — {}
 * @fires km-export-mp4-stop  — {}
 * @fires km-export-sequence  — { frames, fps, scale }
 */

import { DEFAULT_SETTINGS, MASK_PRESETS, FINISH_PRESETS, RENDER_PROFILES } from '../../../modules/live3d/PcbMaterials.js';

const MASK_LABELS = {
  green: 'Green', red: 'Red', yellow: 'Yellow', blue: 'Blue',
  purple: 'Purple', white: 'White', black: 'Black', matte_black: 'Matte Black', custom: 'Custom',
};
const FINISH_LABELS = { enig: 'ENIG (Gold)', hasl: 'HASL (Silver)', none: 'OSP / Bare', custom: 'Custom' };

const T = document.createElement('template');
T.innerHTML = `
<style>
  :host {
    display: flex;
    flex-direction: column;
    width: 260px;
    height: 100%;
    background: var(--km-bg-surface);
    border-left: 1px solid var(--km-border);
    overflow-y: auto;
    font-family: var(--km-font);
    font-size: 11px;
    color: var(--km-text-primary);
    scrollbar-width: thin;
    scrollbar-color: var(--km-border) transparent;
  }

  .panel-header {
    display: flex; align-items: center; justify-content: space-between;
    padding: 0 var(--km-space-3);
    height: 40px;
    border-bottom: 1px solid var(--km-border);
    flex-shrink: 0;
    font-weight: 600;
    font-size: var(--km-font-size-sm);
  }
  .panel-header km-icon { color: var(--km-text-muted); }

  .profile-bar {
    padding: 10px var(--km-space-3);
    border-bottom: 1px solid var(--km-border);
    flex-shrink: 0;
    display: flex;
    flex-direction: column;
    gap: 4px;
  }
  .profile-bar .row-label {
    display: flex; justify-content: space-between; align-items: center;
    color: var(--km-text-secondary); font-size: 10px;
  }

  .section {
    border-bottom: 1px solid var(--km-border);
    overflow: hidden;
    flex-shrink: 0;
  }
  .section-header {
    display: flex; align-items: center; justify-content: space-between;
    padding: 8px var(--km-space-3);
    cursor: pointer;
    user-select: none;
    font-weight: 600;
    font-size: 10px;
    text-transform: uppercase;
    letter-spacing: 0.06em;
    color: var(--km-text-secondary);
  }
  .section-header:hover { color: var(--km-text-primary); }
  .chevron { transition: transform 200ms ease; font-size: 9px; }
  .section.collapsed .chevron { transform: rotate(-90deg); }
  .section.collapsed .section-body { display: none; }

  .section-body { padding: 4px var(--km-space-3) 20px; display: flex; flex-direction: column; gap: 12px; }

  /* Row */
  .row { display: flex; flex-direction: column; gap: 3px; }
  .row-label {
    display: flex; justify-content: space-between; align-items: center;
    color: var(--km-text-secondary); font-size: 10px;
  }
  .row-value { color: var(--km-text-muted); font-size: 10px; font-variant-numeric: tabular-nums; }

  /* Slider */
  input[type=range] {
    -webkit-appearance: none; appearance: none;
    width: 100%; height: 3px;
    border-radius: 2px;
    background: var(--km-border);
    outline: none; cursor: pointer;
  }
  input[type=range]::-webkit-slider-thumb {
    -webkit-appearance: none;
    width: 12px; height: 12px;
    border-radius: 50%;
    background: var(--km-accent);
    cursor: pointer;
    box-shadow: 0 0 0 2px rgba(37,99,235,0.3);
  }

  /* Select */
  select {
    width: 100%;
    background: var(--km-bg-elevated);
    border: 1px solid var(--km-border);
    border-radius: var(--km-radius-sm);
    color: var(--km-text-primary);
    font-family: var(--km-font);
    font-size: 11px;
    padding: 4px 6px;
    cursor: pointer;
    outline: none;
  }
  select:focus { border-color: var(--km-accent); }

  /* Color swatch */
  .color-row { display: flex; align-items: center; gap: 6px; }
  input[type=color] {
    width: 24px; height: 24px;
    border: 1px solid var(--km-border);
    border-radius: var(--km-radius-sm);
    padding: 1px; cursor: pointer; background: transparent;
  }

  /* Toggle */
  .toggle-row { display: flex; align-items: center; justify-content: space-between; }
  .toggle {
    position: relative; width: 28px; height: 15px;
    display: inline-block; cursor: pointer;
  }
  .toggle input { opacity: 0; width: 0; height: 0; }
  .slider-track {
    position: absolute; inset: 0;
    background: var(--km-border);
    border-radius: 10px;
    transition: background 150ms ease;
  }
  .slider-track::after {
    content: ''; position: absolute;
    left: 2px; top: 2px;
    width: 11px; height: 11px;
    border-radius: 50%;
    background: #fff;
    transition: transform 150ms ease;
  }
  .toggle input:checked + .slider-track { background: var(--km-accent); }
  .toggle input:checked + .slider-track::after { transform: translateX(13px); }

  /* Export section */
  .export-grid { display: grid; grid-template-columns: 1fr 1fr; gap: 6px; }
  .exp-btn {
    display: flex; flex-direction: column; align-items: center; gap: 3px;
    padding: 8px 4px;
    border: 1px solid var(--km-border);
    border-radius: var(--km-radius-sm);
    background: var(--km-bg-elevated);
    color: var(--km-text-secondary);
    font-family: var(--km-font);
    font-size: 10px;
    cursor: pointer;
    transition: all 120ms ease;
  }
  .exp-btn:hover { border-color: var(--km-accent); color: var(--km-accent); }
  .exp-btn.recording { border-color: var(--km-red); color: var(--km-red); animation: blink 1s ease-in-out infinite; }
  .exp-btn .exp-icon { font-size: 16px; }
  .exp-btn .exp-label { font-weight: 600; }
  .exp-btn .exp-sub { font-size: 9px; color: var(--km-text-muted); }

  @keyframes blink { 0%,100%{opacity:1;} 50%{opacity:0.5;} }

  .progress-bar {
    height: 3px; background: var(--km-border); border-radius: 2px; overflow: hidden;
    display: none;
  }
  .progress-bar.visible { display: block; }
  .progress-fill { height: 100%; background: var(--km-accent); transition: width 200ms ease; }

  .reset-btn {
    margin: var(--km-space-2) var(--km-space-3);
    padding: 5px;
    background: none;
    border: 1px solid var(--km-border);
    border-radius: var(--km-radius-sm);
    color: var(--km-text-muted);
    font-size: 10px;
    font-family: var(--km-font);
    cursor: pointer;
    width: calc(100% - 2 * var(--km-space-3));
  }
  .reset-btn:hover { border-color: var(--km-accent); color: var(--km-text-primary); }
</style>

<div class="panel-header">
  <span>Material Settings</span>
  <km-icon name="settings" size="sm"></km-icon>
</div>

<div class="profile-bar">
  <div class="row-label"><span>Render profile</span></div>
  <select id="sel-profile">
    ${Object.entries(RENDER_PROFILES).map(([key, p]) => `<option value="${key}">${p.label}</option>`).join('')}
  </select>
</div>

<!-- Board Finish -->
<div class="section" id="sec-finish">
  <div class="section-header">
    Board Finish <span class="chevron">▾</span>
  </div>
  <div class="section-body">
    <div class="row">
      <div class="row-label"><span>Surface finish</span></div>
      <select id="sel-finish">
        <option value="enig">ENIG (Gold)</option>
        <option value="hasl">HASL (Silver)</option>
        <option value="none">OSP / Bare copper</option>
      </select>
    </div>
    <div class="row" id="row-finish-color">
      <div class="row-label"><span>Copper color</span></div>
      <div class="color-row">
        <input type="color" id="clr-finish" value="#efdfbb">
        <span style="font-size:10px;color:var(--km-text-muted)">Custom override</span>
      </div>
    </div>
    <div class="row">
      <div class="row-label"><span>Roughness</span><span class="row-value" id="val-finish-rough">0.10</span></div>
      <input type="range" id="rng-finish-rough" min="0.01" max="0.60" step="0.01" value="0.10">
    </div>
    <div class="row">
      <div class="row-label"><span>Metalness</span><span class="row-value" id="val-finish-metal">1.00</span></div>
      <input type="range" id="rng-finish-metal" min="0.50" max="1.00" step="0.01" value="1.00">
    </div>
  </div>
</div>

<!-- Solder Mask -->
<div class="section collapsed" id="sec-mask">
  <div class="section-header">Solder Mask <span class="chevron">▾</span></div>
  <div class="section-body">
    <div class="row">
      <div class="row-label"><span>Color</span></div>
      <select id="sel-mask">
        <option value="green">Green</option>
        <option value="red">Red</option>
        <option value="blue">Blue</option>
        <option value="yellow">Yellow</option>
        <option value="purple">Purple</option>
        <option value="white">White</option>
        <option value="black">Black</option>
        <option value="matte_black">Matte Black</option>
        <option value="custom">Custom…</option>
      </select>
    </div>
    <div class="row" id="row-mask-custom" style="display:none">
      <div class="row-label"><span>Custom color</span></div>
      <div class="color-row">
        <input type="color" id="clr-mask" value="#43a142">
      </div>
    </div>
    <div class="row">
      <div class="row-label"><span>Roughness</span><span class="row-value" id="val-mask-rough">0.45</span></div>
      <input type="range" id="rng-mask-rough" min="0.05" max="1.00" step="0.01" value="0.45">
    </div>
    <div class="row">
      <div class="row-label"><span>Opacity</span><span class="row-value" id="val-mask-opacity">0.92</span></div>
      <input type="range" id="rng-mask-opacity" min="0.10" max="1.00" step="0.01" value="0.92">
    </div>
    <div class="row">
      <div class="row-label"><span>Clearcoat</span><span class="row-value" id="val-mask-clearcoat">0.00</span></div>
      <input type="range" id="rng-mask-clearcoat" min="0.00" max="1.00" step="0.01" value="0.00">
    </div>
    <div class="row">
      <div class="row-label"><span>Clearcoat roughness</span><span class="row-value" id="val-mask-clearcoat-rough">0.10</span></div>
      <input type="range" id="rng-mask-clearcoat-rough" min="0.00" max="1.00" step="0.01" value="0.10">
    </div>
  </div>
</div>

<!-- Silkscreen -->
<div class="section collapsed" id="sec-silk">
  <div class="section-header">Silkscreen <span class="chevron">▾</span></div>
  <div class="section-body">
    <div class="row">
      <div class="row-label"><span>Color</span></div>
      <div class="color-row">
        <input type="color" id="clr-silk" value="#f0f0ee">
        <span style="font-size:10px;color:var(--km-text-muted)">Ink color</span>
      </div>
    </div>
    <div class="row">
      <div class="row-label"><span>Roughness</span><span class="row-value" id="val-silk-rough">0.25</span></div>
      <input type="range" id="rng-silk-rough" min="0.05" max="0.80" step="0.01" value="0.25">
    </div>
  </div>
</div>

<!-- Board substrate -->
<div class="section collapsed" id="sec-board">
  <div class="section-header">Board Substrate <span class="chevron">▾</span></div>
  <div class="section-body">
    <div class="row">
      <div class="row-label"><span>FR-4 edge color</span></div>
      <div class="color-row">
        <input type="color" id="clr-board" value="#75612f">
        <span style="font-size:10px;color:var(--km-text-muted)">KiCad default</span>
      </div>
    </div>
    <div class="row">
      <div class="row-label"><span>Roughness</span><span class="row-value" id="val-board-rough">0.88</span></div>
      <input type="range" id="rng-board-rough" min="0.40" max="1.00" step="0.01" value="0.88">
    </div>
  </div>
</div>

<!-- Lighting -->
<div class="section collapsed" id="sec-light">
  <div class="section-header">Lighting <span class="chevron">▾</span></div>
  <div class="section-body">
    <div class="row">
      <div class="row-label"><span>Background</span></div>
      <div class="color-row">
        <input type="color" id="clr-background" value="#0d1117">
        <span style="font-size:10px;color:var(--km-text-muted)">Studio backdrop</span>
      </div>
    </div>
    <div class="row">
      <div class="row-label"><span>Exposure</span><span class="row-value" id="val-exposure">1.40</span></div>
      <input type="range" id="rng-exposure" min="0.50" max="3.00" step="0.05" value="1.40">
    </div>
    <div class="row">
      <div class="row-label"><span>Key light</span><span class="row-value" id="val-key">1.50</span></div>
      <input type="range" id="rng-key" min="0.20" max="4.00" step="0.05" value="1.50">
    </div>
    <div class="row">
      <div class="row-label"><span>Ambient</span><span class="row-value" id="val-ambient">0.28</span></div>
      <input type="range" id="rng-ambient" min="0.00" max="1.00" step="0.02" value="0.28">
    </div>
    <div class="row">
      <div class="row-label"><span>Environment</span><span class="row-value" id="val-env">0.55</span></div>
      <input type="range" id="rng-env" min="0.00" max="2.00" step="0.05" value="0.55">
    </div>
  </div>
</div>

<!-- Post-process -->
<div class="section collapsed" id="sec-post">
  <div class="section-header">Post-processing <span class="chevron">▾</span></div>
  <div class="section-body">
    <div class="toggle-row">
      <span>SSAO (ambient occlusion)</span>
      <label class="toggle"><input type="checkbox" id="tog-ssao" checked><span class="slider-track"></span></label>
    </div>
    <div class="row">
      <div class="row-label"><span>AO radius</span><span class="row-value" id="val-ssao">5</span></div>
      <input type="range" id="rng-ssao" min="1" max="20" step="1" value="5">
    </div>
    <div class="toggle-row">
      <span>Ground shadow (board + components)</span>
      <label class="toggle"><input type="checkbox" id="tog-shadow" checked><span class="slider-track"></span></label>
    </div>
    <div class="row">
      <div class="row-label"><span>Shadow strength</span><span class="row-value" id="val-shadow">0.55</span></div>
      <input type="range" id="rng-shadow" min="0.00" max="1.00" step="0.01" value="0.55">
    </div>
    <div class="toggle-row">
      <span>Bloom (copper glow)</span>
      <label class="toggle"><input type="checkbox" id="tog-bloom" checked><span class="slider-track"></span></label>
    </div>
    <div class="row">
      <div class="row-label"><span>Bloom strength</span><span class="row-value" id="val-bloom">0.15</span></div>
      <input type="range" id="rng-bloom" min="0.00" max="1.00" step="0.01" value="0.15">
    </div>
    <div class="row">
      <div class="row-label"><span>Sharpen</span><span class="row-value" id="val-sharpen">0.15</span></div>
      <input type="range" id="rng-sharpen" min="0.00" max="1.00" step="0.01" value="0.15">
    </div>
    <div class="toggle-row">
      <span>Sharp texture detail (anisotropic filtering)</span>
      <label class="toggle"><input type="checkbox" id="tog-aniso" checked><span class="slider-track"></span></label>
    </div>
    <div class="toggle-row">
      <span>Depth of field (background blur)</span>
      <label class="toggle"><input type="checkbox" id="tog-dof" checked><span class="slider-track"></span></label>
    </div>
    <div class="row">
      <div class="row-label"><span>DOF strength</span><span class="row-value" id="val-dof">0.35</span></div>
      <input type="range" id="rng-dof" min="0.00" max="1.00" step="0.01" value="0.35">
    </div>
  </div>
</div>

<!-- Export -->
<div class="section" id="sec-export">
  <div class="section-header">Export <span class="chevron">▾</span></div>
  <div class="section-body">
    <div class="row">
      <div class="row-label"><span>Resolution scale</span><span class="row-value" id="val-scale">2×</span></div>
      <input type="range" id="rng-scale" min="1" max="8" step="1" value="2">
    </div>
    <div class="row">
      <div class="row-label"><span>JPEG quality</span><span class="row-value" id="val-quality">95%</span></div>
      <input type="range" id="rng-quality" min="50" max="100" step="1" value="95">
    </div>
    <div class="export-grid">
      <button class="exp-btn" id="btn-png">
        <span class="exp-icon">🖼</span>
        <span class="exp-label">PNG</span>
        <span class="exp-sub">Lossless</span>
      </button>
      <button class="exp-btn" id="btn-jpg">
        <span class="exp-icon">📷</span>
        <span class="exp-label">JPEG</span>
        <span class="exp-sub">Compressed</span>
      </button>
      <button class="exp-btn" id="btn-gif">
        <span class="exp-icon">🔄</span>
        <span class="exp-label">GIF Spin</span>
        <span class="exp-sub">72 frames</span>
      </button>
      <button class="exp-btn" id="btn-mp4">
        <span class="exp-icon">🎬</span>
        <span class="exp-label">MP4 Spin</span>
        <span class="exp-sub" id="lbl-mp4">360° video</span>
      </button>
    </div>
    <div class="progress-bar" id="progress-bar">
      <div class="progress-fill" id="progress-fill" style="width:0%"></div>
    </div>
    <div id="status-text" style="font-size:9px;color:var(--km-text-muted);text-align:center;min-height:12px;"></div>
  </div>
</div>

<button class="reset-btn" id="btn-reset">↺ Reset to defaults</button>
`;

export class KmLive3DSettings extends HTMLElement {
  constructor() {
    super();
    this.attachShadow({ mode: 'open' });
    this.shadowRoot.appendChild(T.content.cloneNode(true));
    this._settings    = { ...DEFAULT_SETTINGS };
    this._recording   = false;
    this._gifScale    = 1;
  }

  connectedCallback() {
    this._wire();
    this._syncUI();
  }

  get settings() { return { ...this._settings }; }

  setProgress(pct, label = '') {
    const bar  = this.shadowRoot.getElementById('progress-bar');
    const fill = this.shadowRoot.getElementById('progress-fill');
    const txt  = this.shadowRoot.getElementById('status-text');
    if (pct >= 0 && pct < 100) {
      bar.classList.add('visible');
      fill.style.width = pct + '%';
      if (label) txt.textContent = label;
    } else {
      bar.classList.remove('visible');
      fill.style.width = '0%';
      txt.textContent  = label;
    }
  }

  setRecording(on) {
    this._recording = on;
    const btn = this.shadowRoot.getElementById('btn-mp4');
    const lbl = this.shadowRoot.getElementById('lbl-mp4');
    if (on) {
      btn.classList.add('recording');
      btn.querySelector('.exp-icon').textContent = '⏹';
      lbl.textContent = 'Stop & save';
    } else {
      btn.classList.remove('recording');
      btn.querySelector('.exp-icon').textContent = '🎬';
      lbl.textContent = '360° video';
    }
  }

  // ── Wiring ──────────────────────────────────────────────────────────────

  _wire() {
    const r = (id) => this.shadowRoot.getElementById(id);

    // Section collapse toggles
    this.shadowRoot.querySelectorAll('.section-header').forEach(h => {
      h.addEventListener('click', () => h.closest('.section').classList.toggle('collapsed'));
    });

    // Render profile
    r('sel-profile').addEventListener('change', e => {
      const profile = RENDER_PROFILES[e.target.value];
      if (!profile) return;
      this._settings = { ...DEFAULT_SETTINGS, ...profile.overrides };
      this._syncUI();
      this._emit();
    });

    // Finish select
    r('sel-finish').addEventListener('change', e => {
      const v = e.target.value;
      this._settings.finish = v;
      if (v !== 'custom') {
        const p = FINISH_PRESETS[v];
        r('rng-finish-rough').value  = p.roughness;
        r('val-finish-rough').textContent = p.roughness.toFixed(2);
        r('rng-finish-metal').value  = p.metalness;
        r('val-finish-metal').textContent = p.metalness.toFixed(2);
        this._settings.finishRoughness = p.roughness;
        this._settings.finishMetalness = p.metalness;
        this._settings.finishColor     = DEFAULT_SETTINGS.finishColor; // use preset
      }
      this._emit();
    });

    // Finish sliders
    this._slider('rng-finish-rough', 'val-finish-rough', 'finishRoughness', 2);
    this._slider('rng-finish-metal', 'val-finish-metal', 'finishMetalness', 2);
    this._color ('clr-finish', 'finishColor');

    // Mask
    r('sel-mask').addEventListener('change', e => {
      const v = e.target.value;
      this._settings.maskColor = v;
      r('row-mask-custom').style.display = v === 'custom' ? '' : 'none';
      if (v !== 'custom') {
        const p = MASK_PRESETS[v];
        r('rng-mask-rough').value = p.roughness;
        r('val-mask-rough').textContent = p.roughness.toFixed(2);
        this._settings.maskRoughness = p.roughness;
      }
      this._emit();
    });
    this._slider('rng-mask-rough',          'val-mask-rough',          'maskRoughness',          2);
    this._slider('rng-mask-opacity',        'val-mask-opacity',        'maskOpacity',            2);
    this._slider('rng-mask-clearcoat',      'val-mask-clearcoat',      'maskClearcoat',          2);
    this._slider('rng-mask-clearcoat-rough','val-mask-clearcoat-rough','maskClearcoatRoughness', 2);
    this._color ('clr-mask',  'maskCustomColor');

    // Silk
    this._slider('rng-silk-rough', 'val-silk-rough', 'silkRoughness', 2);
    this._color ('clr-silk', 'silkColor');

    // Board
    this._slider('rng-board-rough', 'val-board-rough', 'boardRoughness', 2);
    this._color ('clr-board', 'boardColor');

    // Lighting
    this._color ('clr-background', 'background');
    this._slider('rng-exposure', 'val-exposure', 'exposure',         2);
    this._slider('rng-key',      'val-key',      'keyIntensity',     2);
    this._slider('rng-ambient',  'val-ambient',  'ambientIntensity', 2);
    this._slider('rng-env',      'val-env',      'envIntensity',     2);

    // Post-process
    r('tog-ssao').addEventListener('change', e => {
      this._settings.ssaoEnabled = e.target.checked;
      this._emit();
    });
    this._slider('rng-ssao',  'val-ssao',  'ssaoRadius',    0);
    r('tog-shadow').addEventListener('change', e => {
      this._settings.shadowsEnabled = e.target.checked;
      this._emit();
    });
    this._slider('rng-shadow', 'val-shadow', 'shadowStrength', 2);
    r('tog-bloom').addEventListener('change', e => {
      this._settings.bloomEnabled = e.target.checked;
      this._emit();
    });
    this._slider('rng-bloom', 'val-bloom', 'bloomStrength', 2);
    this._slider('rng-sharpen', 'val-sharpen', 'sharpness', 2);
    r('tog-aniso').addEventListener('change', e => {
      this._settings.anisotropyEnabled = e.target.checked;
      this._emit();
    });
    r('tog-dof').addEventListener('change', e => {
      this._settings.dofEnabled = e.target.checked;
      this._emit();
    });
    this._slider('rng-dof', 'val-dof', 'dofStrength', 2);

    // Export scale/quality display
    r('rng-scale').addEventListener('input', e => {
      r('val-scale').textContent = e.target.value + '×';
    });
    r('rng-quality').addEventListener('input', e => {
      r('val-quality').textContent = e.target.value + '%';
    });

    // Export buttons
    r('btn-png').addEventListener('click', () => {
      const scale = parseInt(r('rng-scale').value, 10);
      this.dispatchEvent(new CustomEvent('km-export-png', { bubbles: true, composed: true, detail: { scale } }));
    });
    r('btn-jpg').addEventListener('click', () => {
      const scale   = parseInt(r('rng-scale').value, 10);
      const quality = parseInt(r('rng-quality').value, 10) / 100;
      this.dispatchEvent(new CustomEvent('km-export-jpeg', { bubbles: true, composed: true, detail: { scale, quality } }));
    });
    r('btn-gif').addEventListener('click', () => {
      const scale = parseInt(r('rng-scale').value, 10);
      this.dispatchEvent(new CustomEvent('km-export-gif', { bubbles: true, composed: true, detail: { frames: 72, fps: 24, scale } }));
    });
    r('btn-mp4').addEventListener('click', () => {
      if (this._recording) {
        this.dispatchEvent(new CustomEvent('km-export-mp4-stop', { bubbles: true, composed: true }));
      } else {
        this.dispatchEvent(new CustomEvent('km-export-mp4-start', { bubbles: true, composed: true, detail: { fps: 30 } }));
      }
    });

    // Reset
    r('btn-reset').addEventListener('click', () => {
      this._settings = { ...DEFAULT_SETTINGS };
      this._syncUI();
      this._emit();
    });
  }

  _slider(rangeId, valId, key, decimals) {
    const input = this.shadowRoot.getElementById(rangeId);
    const label = this.shadowRoot.getElementById(valId);
    input?.addEventListener('input', e => {
      const v = parseFloat(e.target.value);
      if (label) label.textContent = decimals === 0 ? String(v) : v.toFixed(decimals);
      this._settings[key] = v;
      this._emit();
    });
  }

  _color(inputId, key) {
    const input = this.shadowRoot.getElementById(inputId);
    input?.addEventListener('input', e => {
      this._settings[key] = e.target.value;
      this._emit();
    });
  }

  _emit() {
    this.dispatchEvent(new CustomEvent('km-settings-change', {
      bubbles: true, composed: true,
      detail: { settings: { ...this._settings } },
    }));
  }

  _syncUI() {
    const r   = (id) => this.shadowRoot.getElementById(id);
    const s   = this._settings;
    const set = (id, v) => { const el = r(id); if (el) el.value = v; };
    const txt = (id, v) => { const el = r(id); if (el) el.textContent = v; };

    r('sel-finish').value = s.finish;
    set('rng-finish-rough', s.finishRoughness); txt('val-finish-rough', s.finishRoughness.toFixed(2));
    set('rng-finish-metal', s.finishMetalness); txt('val-finish-metal', s.finishMetalness.toFixed(2));

    r('sel-mask').value = s.maskColor;
    r('row-mask-custom').style.display = s.maskColor === 'custom' ? '' : 'none';
    set('rng-mask-rough',   s.maskRoughness); txt('val-mask-rough',   s.maskRoughness.toFixed(2));
    set('rng-mask-opacity', s.maskOpacity);   txt('val-mask-opacity', s.maskOpacity.toFixed(2));
    set('rng-mask-clearcoat',       s.maskClearcoat);          txt('val-mask-clearcoat',       s.maskClearcoat.toFixed(2));
    set('rng-mask-clearcoat-rough', s.maskClearcoatRoughness); txt('val-mask-clearcoat-rough', s.maskClearcoatRoughness.toFixed(2));

    set('rng-silk-rough',  s.silkRoughness);  txt('val-silk-rough',  s.silkRoughness.toFixed(2));
    set('rng-board-rough', s.boardRoughness); txt('val-board-rough', s.boardRoughness.toFixed(2));
    r('clr-background').value = s.background;
    set('rng-exposure', s.exposure);          txt('val-exposure', s.exposure.toFixed(2));
    set('rng-key',      s.keyIntensity);      txt('val-key',      s.keyIntensity.toFixed(2));
    set('rng-ambient',  s.ambientIntensity);  txt('val-ambient',  s.ambientIntensity.toFixed(2));
    set('rng-env',      s.envIntensity);      txt('val-env',      s.envIntensity.toFixed(2));
    set('rng-ssao',     s.ssaoRadius);        txt('val-ssao',     s.ssaoRadius);
    set('rng-shadow',   s.shadowStrength);    txt('val-shadow',   s.shadowStrength.toFixed(2));
    set('rng-bloom',    s.bloomStrength);     txt('val-bloom',    s.bloomStrength.toFixed(2));
    set('rng-sharpen',  s.sharpness);         txt('val-sharpen',  s.sharpness.toFixed(2));
    set('rng-dof',      s.dofStrength);       txt('val-dof',      s.dofStrength.toFixed(2));

    r('tog-ssao').checked   = s.ssaoEnabled;
    r('tog-shadow').checked = s.shadowsEnabled;
    r('tog-bloom').checked  = s.bloomEnabled;
    r('tog-aniso').checked  = s.anisotropyEnabled;
    r('tog-dof').checked    = s.dofEnabled;
  }
}

customElements.define('km-live3d-settings', KmLive3DSettings);
