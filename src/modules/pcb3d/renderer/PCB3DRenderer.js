/**
 * PCB3DRenderer — fresh Three.js renderer for the parallel pipeline.
 *
 * Accepts upgrades from three independent pipelines:
 *   A. applyLayerTextures(textures)  — replaces synthetic with texture-based board
 *   B. applyComponentModels(map)     — replaces synthetic boxes with real WRL models
 *   C. applyMarketingGlb(url)        — full photorealistic GLB for export/view
 *
 * Each pipeline can arrive independently and in any order.
 * The scene gracefully upgrades as each pipeline completes.
 */

import * as THREE               from 'three';
import { OrbitControls }        from 'three/addons/controls/OrbitControls.js';
import { GLTFLoader }           from 'three/addons/loaders/GLTFLoader.js';
import { RoomEnvironment }      from 'three/addons/environments/RoomEnvironment.js';
import { RectAreaLightUniformsLib } from 'three/addons/lights/RectAreaLightUniformsLib.js';
import { EffectComposer }       from 'three/addons/postprocessing/EffectComposer.js';
import { RenderPass }           from 'three/addons/postprocessing/RenderPass.js';
import { SSAOPass }             from 'three/addons/postprocessing/SSAOPass.js';
import { UnrealBloomPass }      from 'three/addons/postprocessing/UnrealBloomPass.js';
import { OutputPass }           from 'three/addons/postprocessing/OutputPass.js';

import { buildBoardMesh, updateBoardTextures, applyBoardSettings } from './BoardMesh.js';
import { positionComponent }    from '../pipeline/VrmlLibrary.js';

const BOARD_THICKNESS = 1.6; // mm default

export class PCB3DRenderer {
  constructor(canvas) {
    this._canvas      = canvas;
    this._disposed    = false;
    this._renderer    = null;
    this._scene       = null;
    this._camera      = null;
    this._controls    = null;
    this._composer    = null;

    // Scene objects managed per pipeline
    this._boardGroup    = null;   // pipeline A board mesh
    this._compGroup     = null;   // pipeline B component models
    this._synthGroup    = null;   // synthetic fallback boxes
    this._glbGroup      = null;   // pipeline C marketing GLB

    this._frontMat    = null;
    this._backMat     = null;
    this._boardMm     = null;

    this._compMeshes   = new Map(); // ref → Object3D (for live transform updates)
    this._originOffset = { x: 0, y: 0 }; // KiCad board centroid → Three.js origin
    this._raf          = null;
    this._fpsCount    = 0;
    this._fpsLast     = 0;
    this._onFps       = null;
    this._onProgress  = null;
  }

  // ── Lifecycle ──────────────────────────────────────────────────────────────

  mount() {
    const canvas = this._canvas;

    this._renderer = new THREE.WebGLRenderer({
      canvas,
      antialias:              true,
      logarithmicDepthBuffer: true,
    });
    this._renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
    this._renderer.outputColorSpace     = THREE.SRGBColorSpace;
    this._renderer.toneMapping          = THREE.ACESFilmicToneMapping;
    this._renderer.toneMappingExposure  = 1.4;
    this._renderer.shadowMap.enabled    = true;
    this._renderer.shadowMap.type       = THREE.PCFSoftShadowMap;

    RectAreaLightUniformsLib.init();

    this._scene = new THREE.Scene();
    this._scene.background = new THREE.Color(0x0d1117);

    const w = Math.max(canvas.clientWidth  || 800, 1);
    const h = Math.max(canvas.clientHeight || 600, 1);

    this._camera = new THREE.PerspectiveCamera(38, w / h, 0.01, 5000);
    this._renderer.setSize(w, h, false);

    this._controls = new OrbitControls(this._camera, canvas);
    this._controls.enableDamping = true;
    this._controls.dampingFactor = 0.07;
    this._controls.minDistance   = 0.5;
    this._controls.maxDistance   = 2000;

    this._setupEnv();
    this._setupLights();
    this._setupPost(w, h);
    this._startLoop();
  }

  dispose() {
    this._disposed = true;
    cancelAnimationFrame(this._raf);
    this._clearAll();
    this._controls?.dispose();
    this._composer?.dispose();
    this._renderer?.dispose();
  }

  onFps(cb)      { this._onFps      = cb; }
  onProgress(cb) { this._onProgress = cb; }

  // ── Pipeline A: Layer texture board ───────────────────────────────────────

  /**
   * Build/update board mesh with SVG layer textures.
   * @param {{ width, height }} boardMm
   * @param {LayerTextures} textures - from LayerRasterizer
   * @param {object} opts - material options
   */
  applyLayerTextures(boardMm, textures, opts = {}) {
    this._boardMm = boardMm;

    if (this._boardGroup && this._frontMat) {
      // Already built — just swap textures (file changed, same board size)
      updateBoardTextures(this._frontMat, this._backMat, textures);
      return;
    }

    // Remove synthetic placeholder board if any
    this._clearGroup('board');
    const { group, frontMat, backMat } = buildBoardMesh(boardMm, BOARD_THICKNESS, textures, opts);
    this._boardGroup = group;
    this._frontMat   = frontMat;
    this._backMat    = backMat;
    this._scene.add(group);

    this.fitCamera();
  }

  /** Live update material settings without rebuilding geometry. */
  updateMaterialSettings(opts) {
    if (this._frontMat && this._backMat) {
      applyBoardSettings(this._frontMat, this._backMat, opts);
    }
    if (opts.exposure        != null) this._renderer.toneMappingExposure = opts.exposure;
    if (opts.envIntensity    != null) this._scene.environmentIntensity   = opts.envIntensity;
    if (opts.ssaoEnabled     != null && this._ssaoPass) this._ssaoPass.enabled = opts.ssaoEnabled;
    if (opts.bloomEnabled    != null && this._bloomPass) this._bloomPass.enabled = opts.bloomEnabled;
    if (opts.bloomStrength   != null && this._bloomPass) this._bloomPass.strength = opts.bloomStrength;
    if (opts.keyIntensity    != null) {
      this._scene.traverse(o => { if (o.isDirectionalLight && o.castShadow) o.intensity = opts.keyIntensity; });
    }
    if (opts.ambientIntensity != null) {
      this._scene.traverse(o => { if (o.isAmbientLight) o.intensity = opts.ambientIntensity; });
    }
  }

  // ── Pipeline B: Real VRML component models ────────────────────────────────

  /**
   * Replace synthetic component boxes with real WRL models.
   * @param {Map<string, THREE.Object3D>} modelMap - ref → Object3D
   * @param {Array} footprints - from bridge boardComponents
   */
  applyComponentModels(modelMap, footprints) {
    // Remove old synthetic group
    if (this._synthGroup) {
      this._scene.remove(this._synthGroup);
      this._synthGroup.traverse(o => { if (o.geometry) o.geometry.dispose(); });
      this._synthGroup = null;
    }

    // Remove old component group
    this._clearGroup('comp');
    const group = new THREE.Group();
    group.name  = 'pcb3d_components';
    this._compGroup   = group;
    this._compMeshes  = new Map();

    const ox = this._originOffset.x;
    const oy = this._originOffset.y;

    for (const fp of (footprints ?? [])) {
      const obj = modelMap.get(fp.ref);
      if (obj) {
        // Apply centroid offset so models align with board
        const fpCentered = {
          ...fp,
          position: {
            x: (fp.position?.x ?? 0) - ox,
            y: (fp.position?.y ?? 0) - oy,
          },
        };
        positionComponent(obj, fpCentered, BOARD_THICKNESS);
        group.add(obj);
        this._compMeshes.set(fp.ref, obj);
      }
    }

    this._scene.add(group);
  }

  // ── Pipeline C: Marketing GLB ─────────────────────────────────────────────

  async applyMarketingGlb(glbUrl) {
    this._clearGroup('glb');

    const loader = new GLTFLoader();
    return new Promise((resolve, reject) => {
      loader.load(
        glbUrl,
        (gltf) => {
          const root = gltf.scene;
          root.name  = 'pcb3d_marketing';

          root.traverse(obj => {
            if (!obj.isMesh) return;
            obj.castShadow    = true;
            obj.receiveShadow = true;
            const ref = obj.name || obj.parent?.name;
            if (ref && /^[A-Z]+\d+/.test(ref)) this._compMeshes.set(ref, obj.parent ?? obj);
          });

          this._glbGroup = root;
          this._scene.add(root);

          // Hide texture board when GLB is loaded
          if (this._boardGroup) this._boardGroup.visible = false;
          if (this._synthGroup) this._synthGroup.visible = false;
          if (this._compGroup)  this._compGroup.visible  = false;

          this.fitCamera();
          resolve();
        },
        (xhr) => { if (xhr.total > 0) this._onProgress?.(Math.round(xhr.loaded / xhr.total * 100)); },
        reject,
      );
    });
  }

  /** Dismiss marketing GLB, restore texture board. */
  dismissMarketingGlb() {
    this._clearGroup('glb');
    if (this._boardGroup) this._boardGroup.visible = true;
    if (this._synthGroup) this._synthGroup.visible = true;
    if (this._compGroup)  this._compGroup.visible  = true;
  }

  // ── Synthetic fallback (immediate first render) ───────────────────────────

  /**
   * Build simple component boxes from bridge board state.
   * Shown until pipeline B delivers real models.
   * @param {Array} footprints
   * @param {{ x: number, y: number }} [origin] - centroid to subtract (centers scene at origin)
   */
  buildSyntheticComponents(footprints, origin = { x: 0, y: 0 }) {
    this._originOffset = origin;
    this._clearGroup('synth');
    const group = new THREE.Group();
    group.name  = 'pcb3d_synthetic';
    this._synthGroup  = group;
    this._compMeshes  = new Map();

    const darkMat = new THREE.MeshStandardMaterial({ color: 0x0f0f12, roughness: 0.62, metalness: 0.06 });
    const tanMat  = new THREE.MeshStandardMaterial({ color: 0xa08855, roughness: 0.58, metalness: 0.0 });

    for (const fp of (footprints ?? [])) {
      const isPassive = /[0-9.]+[pnuμmkMΩr]|^[CR]\d/.test((fp.value ?? '').toLowerCase());
      const w  = Math.max(0.4, fp.courtyard?.width  ?? 1.5);
      const d  = Math.max(0.4, fp.courtyard?.height ?? 1.0);
      const h  = 0.8;
      const z  = fp.on_back ? -(h / 2 + 0.04) : BOARD_THICKNESS + h / 2 + 0.04;

      const raw_x = fp.position?.x ?? fp.at?.x ?? 0;
      const raw_y = fp.position?.y ?? fp.at?.y ?? 0;

      const mesh = new THREE.Mesh(
        new THREE.BoxGeometry(w, d, h),
        isPassive ? tanMat : darkMat,
      );
      // Subtract origin offset so everything is centered at (0,0,0)
      mesh.position.set(raw_x - origin.x, -(raw_y - origin.y), z);
      mesh.rotation.z = ((fp.rotation ?? 0) * Math.PI) / 180;
      mesh.name = `syn_${fp.ref}`;
      mesh.castShadow = true;
      group.add(mesh);
      if (fp.ref) this._compMeshes.set(fp.ref, mesh);
    }

    this._scene.add(group);
  }

  /** Build synthetic board plane as placeholder until pipeline A completes. */
  buildSyntheticBoard(widthMm, heightMm) {
    if (this._boardGroup) return;
    this._boardMm = { width: widthMm, height: heightMm };

    // Simple placeholder: green plane
    const mat  = new THREE.MeshStandardMaterial({ color: 0x1a4a1a, roughness: 0.85 });
    const geo  = new THREE.BoxGeometry(widthMm, heightMm, BOARD_THICKNESS);
    const mesh = new THREE.Mesh(geo, mat);
    mesh.position.z   = BOARD_THICKNESS / 2;
    mesh.castShadow   = true;
    mesh.receiveShadow = true;
    mesh.name = 'pcb3d_board_placeholder';

    const g = new THREE.Group();
    g.name  = 'pcb3d_board_placeholder_group';
    g.add(mesh);
    this._boardGroup = g;
    this._scene.add(g);
    this.fitCamera();
  }

  // ── Live transform updates (all pipelines) ────────────────────────────────

  updateComponents(components) {
    const ox = this._originOffset.x;
    const oy = this._originOffset.y;
    for (const c of (components ?? [])) {
      const obj = this._compMeshes.get(c.ref);
      if (!obj) continue;
      if (c.position) {
        obj.position.x =  (c.position.x - ox);
        obj.position.y = -(c.position.y - oy);
      }
      if (c.rotation != null) obj.rotation.z = (c.rotation * Math.PI) / 180;
    }
  }

  // ── Camera ─────────────────────────────────────────────────────────────────

  fitCamera() {
    const target = this._glbGroup ?? this._boardGroup;
    if (!target) return;

    const box    = new THREE.Box3().setFromObject(target);
    const center = box.getCenter(new THREE.Vector3());
    const size   = box.getSize(new THREE.Vector3());
    const maxDim = Math.max(size.x, size.y, size.z, 10);
    const fovRad = this._camera.fov * Math.PI / 180;
    const dist   = (maxDim * 0.6) / Math.tan(fovRad / 2);

    this._camera.position.set(
      center.x - maxDim * 0.25,
      center.y + maxDim * 0.40,
      center.z + dist,
    );
    this._controls.target.copy(center);
    this._controls.update();
  }

  setTopView() {
    const target = this._glbGroup ?? this._boardGroup;
    if (!target) return;
    const box    = new THREE.Box3().setFromObject(target);
    const center = box.getCenter(new THREE.Vector3());
    const size   = box.getSize(new THREE.Vector3());
    const maxDim = Math.max(size.x, size.y, 10);
    const fovRad = this._camera.fov * Math.PI / 180;
    const dist   = (maxDim * 0.6) / Math.tan(fovRad / 2);
    this._camera.position.set(center.x, center.y, center.z + dist);
    this._controls.target.copy(center);
    this._controls.update();
  }

  // ── High-res snapshot ──────────────────────────────────────────────────────

  async renderSnapshot(opts = {}) {
    const scale = opts.scale  ?? 2;
    const cw    = this._canvas.clientWidth;
    const ch    = this._canvas.clientHeight;
    const w     = opts.width  ?? Math.round(cw  * scale);
    const h     = opts.height ?? Math.round(ch  * scale);
    const mime  = opts.mime   ?? 'image/png';
    const q     = opts.quality ?? 1.0;

    const off = document.createElement('canvas');
    off.width  = w; off.height = h;

    const r2 = new THREE.WebGLRenderer({ canvas: off, antialias: true, logarithmicDepthBuffer: true });
    r2.setSize(w, h, false);
    r2.setPixelRatio(1);
    r2.outputColorSpace    = this._renderer.outputColorSpace;
    r2.toneMapping         = this._renderer.toneMapping;
    r2.toneMappingExposure = this._renderer.toneMappingExposure;
    r2.shadowMap.enabled   = true;

    const cam2 = this._camera.clone();
    cam2.aspect = w / h;
    cam2.updateProjectionMatrix();

    r2.render(this._scene, cam2);
    r2.render(this._scene, cam2);

    return new Promise(resolve => {
      off.toBlob(blob => { r2.dispose(); resolve(blob); }, mime, q);
    });
  }

  get rendererEl()  { return this._renderer?.domElement; }
  get sceneRef()    { return this._scene; }
  get cameraRef()   { return this._camera; }
  get boardGroup()  { return this._boardGroup; }

  // ── Resize ─────────────────────────────────────────────────────────────────

  resize(w, h) {
    if (!this._renderer || w < 1 || h < 1) return;
    this._renderer.setSize(w, h, false);
    this._composer?.setSize(w, h);
    this._ssaoPass?.setSize(w, h);
    this._camera.aspect = w / h;
    this._camera.updateProjectionMatrix();
  }

  // ── Private ────────────────────────────────────────────────────────────────

  _setupEnv() {
    const pmrem = new THREE.PMREMGenerator(this._renderer);
    pmrem.compileCubemapShader();
    const envRT = pmrem.fromScene(new RoomEnvironment(this._renderer), 0.04);
    this._scene.environment          = envRT.texture;
    this._scene.environmentIntensity = 0.55;
    pmrem.dispose();
  }

  _setupLights() {
    this._scene.add(new THREE.AmbientLight(0xffffff, 0.28));

    const key = new THREE.DirectionalLight(0xfff8f0, 1.5);
    key.position.set(80, 120, 100);
    key.castShadow = true;
    key.shadow.mapSize.set(2048, 2048);
    key.shadow.camera.near = 0.5; key.shadow.camera.far = 2000;
    key.shadow.camera.left = key.shadow.camera.bottom = -250;
    key.shadow.camera.right = key.shadow.camera.top  =  250;
    key.shadow.bias = -0.0005; key.shadow.normalBias = 0.02;
    this._scene.add(key);

    const fill = new THREE.DirectionalLight(0xd0e8ff, 0.40);
    fill.position.set(-60, 80, 60);
    this._scene.add(fill);

    const rim = new THREE.DirectionalLight(0xffeedd, 0.18);
    rim.position.set(0, -50, -80);
    this._scene.add(rim);
  }

  _setupPost(w, h) {
    this._composer = new EffectComposer(this._renderer);
    this._composer.addPass(new RenderPass(this._scene, this._camera));

    const ssao = new SSAOPass(this._scene, this._camera, w, h);
    ssao.kernelRadius = 5;
    ssao.minDistance  = 0.001;
    ssao.maxDistance  = 0.06;
    this._ssaoPass = ssao;
    this._composer.addPass(ssao);

    const bloom = new UnrealBloomPass(new THREE.Vector2(w, h), 0.15, 0.5, 0.85);
    this._bloomPass = bloom;
    this._composer.addPass(bloom);

    this._composer.addPass(new OutputPass());
  }

  _clearGroup(which) {
    const key = `_${which}Group`;
    if (this[key]) {
      this._scene?.remove(this[key]);
      this[key].traverse(o => { if (o.geometry) o.geometry.dispose(); });
      this[key] = null;
    }
  }

  _clearAll() {
    for (const g of ['board', 'synth', 'comp', 'glb']) this._clearGroup(g);
    this._compMeshes.clear();
  }

  _startLoop() {
    const tick = () => {
      if (this._disposed) return;
      this._raf = requestAnimationFrame(tick);
      this._controls?.update();

      this._fpsCount++;
      const now = performance.now();
      if (now - this._fpsLast >= 1000) {
        this._onFps?.(this._fpsCount);
        this._fpsCount = 0;
        this._fpsLast  = now;
      }

      this._composer
        ? this._composer.render()
        : this._renderer.render(this._scene, this._camera);
    };
    this._fpsLast = performance.now();
    tick();
  }
}
