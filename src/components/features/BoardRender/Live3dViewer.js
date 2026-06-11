/**
 * @element km-live-3d-viewer
 * @summary Interactive THREE.js viewer that loads a GLB model and renders it
 *          with full orbit controls, configurable lights, and shadow mapping.
 *
 * Public API:
 *   viewer.loadGlb(assetUrl)          — load/reload a .glb file
 *   viewer.applySettings(patch)       — hot-apply a partial settings object
 *   viewer.resetCamera()              — fly camera back to default position
 *   viewer.getSettings()              — return current live settings object
 *   viewer.pause() / viewer.resume()  — stop/start render loop (for hidden tabs)
 *
 * Emits:
 *   load-start  — GLB fetch started
 *   load-done   — model in scene
 *   load-error  — { error }
 *
 * @exports VIEWER_DEFAULTS  Single source of truth for every numeric/bool param.
 */

import * as THREE from 'three';
import { OrbitControls } from 'three/addons/controls/OrbitControls.js';
import { GLTFLoader }    from 'three/addons/loaders/GLTFLoader.js';

// ── Single source of truth — no magic numbers anywhere else ─────────────────

export const VIEWER_DEFAULTS = {
  renderer: {
    pixelRatio:           1.5,
    toneMapping:          'ACESFilmic',
    toneMappingExposure:  1.2,
    shadowsEnabled:       true,
    shadowMapType:        'PCFSoft',
    clearColor:           '#111827',
  },
  camera: {
    fov:   45,
    near:  0.5,
    far:   1000,
    posX:  4,
    posY:  8,
    posZ:  16,
  },
  controls: {
    enableDamping:   true,
    dampingFactor:   0.05,
    enablePan:       true,
    enableZoom:      true,
    minDistance:     1,
    maxDistance:     80,
    minPolarAngle:   0,
    maxPolarAngle:   1.5,
    autoRotate:      false,
    autoRotateSpeed: 2.0,
    targetX: 0,
    targetY: 0,
    targetZ: 0,
  },
  spotLight: {
    enabled:       true,
    color:         '#ffffff',
    intensity:     3000,
    distance:      100,
    angle:         0.22,
    penumbra:      1.0,
    posX:          0,
    posY:          25,
    posZ:          0,
    castShadow:    true,
    shadowBias:    -0.0001,
    shadowMapSize: 1024,
  },
  ambientLight: {
    enabled:   true,
    color:     '#404040',
    intensity: 0.4,
  },
  hemiLight: {
    enabled:     true,
    skyColor:    '#b1e1ff',
    groundColor: '#b97a20',
    intensity:   0.5,
    posX: 0,
    posY: 20,
    posZ: 0,
  },
  ground: {
    visible:   true,
    color:     '#555555',
    metalness: 0.0,
    roughness: 1.0,
    size:      50,
  },
  fog: {
    enabled: false,
    color:   '#111827',
    near:    40,
    far:     200,
  },
  helpers: {
    axesVisible:   false,
    axesSize:      5,
    gridVisible:   false,
    gridSize:      20,
    gridDivisions: 20,
    gridColor:     '#333333',
  },
  model: {
    wireframe:    false,
    castShadow:   true,
    receiveShadow: true,
  },
  glbExport: {
    substModels: true,
    noDnp:       false,
  },
};

// ── Look-up tables ───────────────────────────────────────────────────────────

const TONE_MAP_IDS = {
  None:               THREE.NoToneMapping,
  Linear:             THREE.LinearToneMapping,
  Reinhard:           THREE.ReinhardToneMapping,
  Cineon:             THREE.CineonToneMapping,
  ACESFilmic:         THREE.ACESFilmicToneMapping,
  AgX:                THREE.AgXToneMapping,
  NeutralToneMapping: THREE.NeutralToneMapping,
};

const SHADOW_TYPE_IDS = {
  Basic:   THREE.BasicShadowMap,
  PCF:     THREE.PCFShadowMap,
  PCFSoft: THREE.PCFSoftShadowMap,
  VSM:     THREE.VSMShadowMap,
};

// ── Template ─────────────────────────────────────────────────────────────────

const TEMPLATE = document.createElement('template');
TEMPLATE.innerHTML = `
<style>
  :host {
    display: block;
    position: relative;
    overflow: hidden;
    background: #111827;
  }
  canvas {
    display: block;
    width: 100%;
    height: 100%;
    touch-action: none;
    outline: none;
  }
  .overlay {
    position: absolute;
    inset: 0;
    display: flex;
    flex-direction: column;
    align-items: center;
    justify-content: center;
    gap: 12px;
    color: rgba(255,255,255,0.45);
    font-size: 13px;
    font-family: var(--km-font, system-ui, sans-serif);
    pointer-events: none;
    z-index: 5;
  }
  .overlay.hidden { display: none; }
  .spinner {
    width: 28px;
    height: 28px;
    border: 2.5px solid rgba(255,255,255,0.12);
    border-top-color: rgba(255,255,255,0.65);
    border-radius: 50%;
    animation: spin 0.75s linear infinite;
  }
  @keyframes spin { to { transform: rotate(360deg); } }
  .overlay-msg { text-align: center; max-width: 260px; line-height: 1.5; }
</style>
<div class="overlay hidden" id="overlay">
  <div class="spinner" id="spinner"></div>
  <div class="overlay-msg" id="overlay-msg"></div>
</div>
`;

// ── Web Component ─────────────────────────────────────────────────────────────

export class KmLive3dViewer extends HTMLElement {
  constructor() {
    super();
    this.attachShadow({ mode: 'open' });
    this.shadowRoot.appendChild(TEMPLATE.content.cloneNode(true));

    this._renderer  = null;
    this._scene     = null;
    this._camera    = null;
    this._controls  = null;
    this._spotLight = null;
    this._ambLight  = null;
    this._hemiLight = null;
    this._ground    = null;
    this._axesHelper = null;
    this._gridHelper = null;
    this._model     = null;
    this._rafId     = null;
    this._ro        = null;
    this._paused    = false;
    this._settings  = null;
  }

  connectedCallback() {
    if (!this._renderer) this._init();
    this._ro = new ResizeObserver(() => this._onResize());
    this._ro.observe(this);
    this._resume();
  }

  disconnectedCallback() {
    this._ro?.disconnect();
    this._ro = null;
    this._pause();
  }

  // ── Initialise scene ───────────────────────────────────────────────────────

  _init() {
    const s = this._settings = _deepClone(VIEWER_DEFAULTS);

    this._renderer = new THREE.WebGLRenderer({ antialias: true, powerPreference: 'high-performance' });
    this._renderer.outputColorSpace    = THREE.SRGBColorSpace;
    this._renderer.shadowMap.enabled   = s.renderer.shadowsEnabled;
    this._renderer.shadowMap.type      = SHADOW_TYPE_IDS[s.renderer.shadowMapType] ?? THREE.PCFSoftShadowMap;
    this._renderer.toneMapping         = TONE_MAP_IDS[s.renderer.toneMapping]      ?? THREE.ACESFilmicToneMapping;
    this._renderer.toneMappingExposure = s.renderer.toneMappingExposure;
    this._renderer.setPixelRatio(Math.min(s.renderer.pixelRatio, window.devicePixelRatio));
    this._renderer.setClearColor(new THREE.Color(s.renderer.clearColor));

    const w = this.clientWidth  || 800;
    const h = this.clientHeight || 600;
    this._renderer.setSize(w, h, false);
    this.shadowRoot.insertBefore(this._renderer.domElement, this.shadowRoot.getElementById('overlay'));

    this._scene = new THREE.Scene();
    this._scene.background = new THREE.Color(s.renderer.clearColor);

    this._camera = new THREE.PerspectiveCamera(s.camera.fov, w / h, s.camera.near, s.camera.far);
    this._camera.position.set(s.camera.posX, s.camera.posY, s.camera.posZ);

    this._controls = new OrbitControls(this._camera, this._renderer.domElement);
    this._applyControls(s.controls);

    // Spot light
    this._spotLight = new THREE.SpotLight();
    this._applySpotLight(s.spotLight);
    this._scene.add(this._spotLight);
    this._scene.add(this._spotLight.target);

    // Ambient
    this._ambLight = new THREE.AmbientLight();
    this._applyAmbLight(s.ambientLight);
    this._scene.add(this._ambLight);

    // Hemisphere
    this._hemiLight = new THREE.HemisphereLight();
    this._applyHemiLight(s.hemiLight);
    this._scene.add(this._hemiLight);

    // Ground
    const groundGeo = new THREE.PlaneGeometry(1, 1);
    groundGeo.rotateX(-Math.PI / 2);
    this._ground = new THREE.Mesh(groundGeo, new THREE.MeshStandardMaterial({ side: THREE.DoubleSide }));
    this._ground.castShadow    = false;
    this._ground.receiveShadow = true;
    this._applyGround(s.ground);
    this._scene.add(this._ground);

    // Helpers
    this._axesHelper = new THREE.AxesHelper(s.helpers.axesSize);
    this._axesHelper.userData.size = s.helpers.axesSize;
    this._axesHelper.visible = s.helpers.axesVisible;
    this._scene.add(this._axesHelper);

    const gc = new THREE.Color(s.helpers.gridColor);
    this._gridHelper = new THREE.GridHelper(s.helpers.gridSize, s.helpers.gridDivisions, gc, gc);
    this._gridHelper.userData = { size: s.helpers.gridSize, divs: s.helpers.gridDivisions, color: s.helpers.gridColor };
    this._gridHelper.visible = s.helpers.gridVisible;
    this._scene.add(this._gridHelper);

    this._applyFog(s.fog);
  }

  _resume() {
    if (this._paused) return;
    if (this._rafId) return;
    const tick = () => {
      this._rafId = requestAnimationFrame(tick);
      this._controls?.update();
      if (this._renderer && this._scene && this._camera) {
        this._renderer.render(this._scene, this._camera);
      }
    };
    tick();
  }

  _pause() {
    cancelAnimationFrame(this._rafId);
    this._rafId = null;
  }

  pause()  { this._paused = true;  this._pause(); }
  resume() { this._paused = false; this._resume(); }

  _onResize() {
    if (!this._renderer || !this._camera) return;
    const w = this.clientWidth;
    const h = this.clientHeight;
    if (w < 2 || h < 2) return;
    this._renderer.setSize(w, h, false);
    this._camera.aspect = w / h;
    this._camera.updateProjectionMatrix();
  }

  // ── Public API ────────────────────────────────────────────────────────────

  loadGlb(assetUrl) {
    if (!assetUrl) return;
    this._showOverlay(true, 'Exporting model…');
    this._dropModel();
    this.dispatchEvent(new CustomEvent('load-start', { bubbles: true, composed: true }));

    const loader = new GLTFLoader();
    loader.load(
      assetUrl,
      (gltf) => {
        const s    = this._settings;
        this._model = gltf.scene;
        this._model.traverse(child => {
          if (!child.isMesh) return;
          child.castShadow    = s.model.castShadow;
          child.receiveShadow = s.model.receiveShadow;
          if (child.material) child.material.wireframe = s.model.wireframe;
        });

        // Centre model and fit camera
        const box    = new THREE.Box3().setFromObject(this._model);
        const center = box.getCenter(new THREE.Vector3());
        const size   = box.getSize(new THREE.Vector3());
        const maxDim = Math.max(size.x, size.y, size.z);

        this._model.position.sub(center);
        this._model.position.y += size.y * 0.5;
        this._scene.add(this._model);

        // Place ground flush with model bottom
        const bottom = -center.y + size.y * 0.5 + box.min.y - center.y;
        this._ground.position.y = Math.min(0, -size.y * 0.5);

        // Fit camera to bounding sphere
        const dist = maxDim * 2.2;
        this._camera.near = maxDim * 0.01;
        this._camera.far  = maxDim * 50;
        this._camera.updateProjectionMatrix();
        this._camera.position.set(dist * 0.6, dist * 0.45, dist);
        this._controls.target.set(0, 0, 0);
        this._controls.minDistance = maxDim * 0.1;
        this._controls.maxDistance = maxDim * 10;
        this._controls.update();

        // Scale spot light to model
        this._spotLight.position.set(
          s.spotLight.posX,
          Math.max(s.spotLight.posY, maxDim * 1.8),
          s.spotLight.posZ,
        );

        this._showOverlay(false);
        this.dispatchEvent(new CustomEvent('load-done', { bubbles: true, composed: true }));
      },
      (xhr) => {
        const pct = xhr.total ? `${Math.round(xhr.loaded / xhr.total * 100)}%` : '…';
        this._showOverlay(true, `Loading ${pct}`);
      },
      (err) => {
        this._showOverlay(true, `Load failed: ${err?.message ?? err}`, false);
        this.dispatchEvent(new CustomEvent('load-error', {
          bubbles: true, composed: true, detail: { error: err },
        }));
      },
    );
  }

  applySettings(patch) {
    if (!this._settings) return;
    _deepMerge(this._settings, patch);
    const s = this._settings;

    if (patch.renderer) {
      const r = patch.renderer;
      if (r.toneMapping !== undefined)
        this._renderer.toneMapping = TONE_MAP_IDS[r.toneMapping] ?? this._renderer.toneMapping;
      if (r.toneMappingExposure !== undefined)
        this._renderer.toneMappingExposure = r.toneMappingExposure;
      if (r.shadowsEnabled !== undefined)
        this._renderer.shadowMap.enabled = r.shadowsEnabled;
      if (r.shadowMapType !== undefined)
        this._renderer.shadowMap.type = SHADOW_TYPE_IDS[r.shadowMapType] ?? this._renderer.shadowMap.type;
      if (r.pixelRatio !== undefined)
        this._renderer.setPixelRatio(Math.min(r.pixelRatio, window.devicePixelRatio));
      if (r.clearColor !== undefined) {
        const col = new THREE.Color(r.clearColor);
        this._renderer.setClearColor(col);
        this._scene.background = col;
      }
    }
    if (patch.camera)      this._applyCamera(s.camera);
    if (patch.controls)    this._applyControls(s.controls);
    if (patch.spotLight)   this._applySpotLight(s.spotLight);
    if (patch.ambientLight) this._applyAmbLight(s.ambientLight);
    if (patch.hemiLight)   this._applyHemiLight(s.hemiLight);
    if (patch.ground)      this._applyGround(s.ground);
    if (patch.fog)         this._applyFog(s.fog);
    if (patch.helpers)     this._applyHelpers(s.helpers);
    if (patch.model)       this._applyModel(s.model);
  }

  resetCamera() {
    const s = this._settings;
    this._camera.position.set(s.camera.posX, s.camera.posY, s.camera.posZ);
    this._controls.target.set(s.controls.targetX, s.controls.targetY, s.controls.targetZ);
    this._controls.update();
  }

  getSettings() { return this._settings; }

  // ── Apply helpers ─────────────────────────────────────────────────────────

  _applyCamera(c) {
    this._camera.fov  = c.fov;
    this._camera.near = c.near;
    this._camera.far  = c.far;
    this._camera.position.set(c.posX, c.posY, c.posZ);
    this._camera.updateProjectionMatrix();
  }

  _applyControls(c) {
    this._controls.enableDamping   = c.enableDamping;
    this._controls.dampingFactor   = c.dampingFactor;
    this._controls.enablePan       = c.enablePan;
    this._controls.enableZoom      = c.enableZoom;
    this._controls.minDistance     = c.minDistance;
    this._controls.maxDistance     = c.maxDistance;
    this._controls.minPolarAngle   = c.minPolarAngle;
    this._controls.maxPolarAngle   = c.maxPolarAngle;
    this._controls.autoRotate      = c.autoRotate;
    this._controls.autoRotateSpeed = c.autoRotateSpeed;
    this._controls.target.set(c.targetX, c.targetY, c.targetZ);
    this._controls.update();
  }

  _applySpotLight(l) {
    this._spotLight.visible   = l.enabled;
    this._spotLight.color.set(l.color);
    this._spotLight.intensity = l.intensity;
    this._spotLight.distance  = l.distance;
    this._spotLight.angle     = l.angle;
    this._spotLight.penumbra  = l.penumbra;
    this._spotLight.position.set(l.posX, l.posY, l.posZ);
    this._spotLight.castShadow = l.castShadow;
    this._spotLight.shadow.bias = l.shadowBias;
    this._spotLight.shadow.mapSize.set(l.shadowMapSize, l.shadowMapSize);
  }

  _applyAmbLight(l) {
    this._ambLight.visible   = l.enabled;
    this._ambLight.color.set(l.color);
    this._ambLight.intensity = l.intensity;
  }

  _applyHemiLight(l) {
    this._hemiLight.visible = l.enabled;
    this._hemiLight.color.set(l.skyColor);
    this._hemiLight.groundColor.set(l.groundColor);
    this._hemiLight.intensity = l.intensity;
    this._hemiLight.position.set(l.posX, l.posY, l.posZ);
  }

  _applyGround(g) {
    this._ground.visible = g.visible;
    const mat = this._ground.material;
    mat.color.set(g.color);
    mat.metalness = g.metalness;
    mat.roughness = g.roughness;
    mat.needsUpdate = true;
    this._ground.scale.set(g.size, 1, g.size);
  }

  _applyFog(f) {
    this._scene.fog = f.enabled ? new THREE.Fog(f.color, f.near, f.far) : null;
  }

  _applyHelpers(h) {
    // Axes: recreate if size changed
    if (this._axesHelper.userData.size !== h.axesSize) {
      this._scene.remove(this._axesHelper);
      this._axesHelper = new THREE.AxesHelper(h.axesSize);
      this._axesHelper.userData.size = h.axesSize;
      this._scene.add(this._axesHelper);
    }
    this._axesHelper.visible = h.axesVisible;

    // Grid: recreate if size/divisions/color changed
    const ud = this._gridHelper.userData;
    if (ud.size !== h.gridSize || ud.divs !== h.gridDivisions || ud.color !== h.gridColor) {
      this._scene.remove(this._gridHelper);
      const c = new THREE.Color(h.gridColor);
      this._gridHelper = new THREE.GridHelper(h.gridSize, h.gridDivisions, c, c);
      this._gridHelper.userData = { size: h.gridSize, divs: h.gridDivisions, color: h.gridColor };
      this._scene.add(this._gridHelper);
    }
    this._gridHelper.visible = h.gridVisible;
  }

  _applyModel(m) {
    if (!this._model) return;
    this._model.traverse(child => {
      if (!child.isMesh) return;
      child.castShadow    = m.castShadow;
      child.receiveShadow = m.receiveShadow;
      if (child.material) {
        child.material.wireframe   = m.wireframe;
        child.material.needsUpdate = true;
      }
    });
  }

  _dropModel() {
    if (this._model) {
      this._scene.remove(this._model);
      this._model = null;
    }
  }

  _showOverlay(visible, msg = '', showSpinner = true) {
    const ov  = this.shadowRoot.getElementById('overlay');
    const msg_ = this.shadowRoot.getElementById('overlay-msg');
    const spin = this.shadowRoot.getElementById('spinner');
    ov.classList.toggle('hidden', !visible);
    if (msg_) msg_.textContent = msg;
    if (spin) spin.style.display = showSpinner ? '' : 'none';
  }
}

// ── Utilities ─────────────────────────────────────────────────────────────────

function _deepClone(obj) {
  return JSON.parse(JSON.stringify(obj));
}

function _deepMerge(target, source) {
  for (const k of Object.keys(source)) {
    if (source[k] !== null && typeof source[k] === 'object' && !Array.isArray(source[k])) {
      if (typeof target[k] !== 'object') target[k] = {};
      _deepMerge(target[k], source[k]);
    } else {
      target[k] = source[k];
    }
  }
  return target;
}

customElements.define('km-live-3d-viewer', KmLive3dViewer);
