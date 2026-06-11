/**
 * Live3DRenderer — Three.js PCB renderer with two loading modes:
 *
 * Mode A — GLB (primary, photorealistic):
 *   kicad-cli pcb export glb → .glb file → GLTFLoader → real KiCad 3D models,
 *   copper, vias, silkscreen, soldermask exactly as KiCad renders them.
 *   Component transforms are updated in real-time from bridge without re-export.
 *
 * Mode B — Synthetic (fallback, no KiCad 10 / file unavailable):
 *   Client-side parsed geometry with PBR materials + Perlin normal maps.
 *
 * Post-processing: SSAO → UnrealBloom → OutputPass (ACESFilmic tone mapping)
 */

import * as THREE                        from 'three';
import { OrbitControls }                 from 'three/addons/controls/OrbitControls.js';
import { GLTFLoader }                    from 'three/addons/loaders/GLTFLoader.js';
import { EffectComposer }                from 'three/addons/postprocessing/EffectComposer.js';
import { RenderPass }                    from 'three/addons/postprocessing/RenderPass.js';
import { SSAOPass }                      from 'three/addons/postprocessing/SSAOPass.js';
import { OutputPass }                    from 'three/addons/postprocessing/OutputPass.js';
import { UnrealBloomPass }               from 'three/addons/postprocessing/UnrealBloomPass.js';
import { BokehPass }                     from 'three/addons/postprocessing/BokehPass.js';
import { ShaderPass }                    from 'three/addons/postprocessing/ShaderPass.js';
import { SharpenShader }                 from './SharpenShader.js';
import { createMaterials, applySettings, DEFAULT_SETTINGS, MASK_PRESETS, FINISH_PRESETS, generateMicroNormalMap, generateFiberglassWeaveMap } from './PcbMaterials.js';

// Depth-of-field base aperture at unit scale (maxDim=1), before the user's
// dofStrength multiplier. Rescaled to BASE/maxDim in _rescaleLightingToScale()
// — see that function and _setupPostprocessing() for the full derivation.
const DOF_BASE_APERTURE = 0.006;

/**
 * kicad-cli's GLB export bakes per-mesh materials named after the PCB layer
 * they came from (e.g. "F_Cu", "B_Mask", "F_SilkS", "PCB"/"Edge_Cuts"/"FR4").
 * Classify each by substring so the settings panel can retune the GLB's REAL
 * materials live — names are checked defensively since exact kicad-cli naming
 * has drifted across versions.
 * @returns {'copper'|'mask'|'silk'|'board'|null}
 */
/**
 * Set anisotropic-filtering level on a baked GLB decal material's texture
 * maps. GLTFLoader never sets `texture.anisotropy` (defaults to 1 =
 * isotropic bilinear/trilinear), so thin baked-in details — silkscreen
 * stroke edges, mask-vs-copper boundaries — lose definition and shimmer/dim
 * at oblique view angles where a texel footprint stretches across many
 * screen pixels in one direction (mipmapping alone blurs uniformly; aniso
 * samples along the stretch direction instead). Distinct from the Z-fighting
 * fix above — this is a *texture-sampling* artifact, not a depth-buffer one,
 * but both manifest as "dims/breaks up at an angle" so both needed checking.
 *
 * @param level - target value: GPU max when the panel toggle is on, 1
 *   (isotropic / GPU baseline) when off — so toggling off cleanly restores
 *   the pre-fix look for comparison or low-end-hardware headroom.
 */
function _applyAnisotropy(mat, level) {
  if (!level || level < 1) return;
  for (const key of ['map', 'normalMap', 'roughnessMap', 'metalnessMap', 'aoMap']) {
    const tex = mat[key];
    if (tex && tex.anisotropy !== level) {
      tex.anisotropy = level;
      tex.needsUpdate = true;
    }
  }
}

function _classifyGlbMaterial(matName, meshName) {
  const n = `${matName} ${meshName}`.toLowerCase();
  if (/silk/.test(n))                              return 'silk';
  if (/mask/.test(n))                              return 'mask';
  if (/(^|[^a-z])cu([^a-z]|$)|copper|pad|via|track|trace/.test(n)) return 'copper';
  if (/pcb|board|fr4|fr-4|substrate|edge_?cuts|dielectric/.test(n)) return 'board';
  return null;
}

/**
 * GLB mask materials load as MeshStandardMaterial, which has no clearcoat BRDF
 * lobe — `mat.clearcoat = …` would be a silent no-op. Upgrade to
 * MeshPhysicalMaterial (superset shader) so the "glassy lacquer" look can
 * actually render. Properties are copied explicitly rather than via
 * MeshPhysicalMaterial.copy(), which would pull `undefined` clearcoat fields
 * off a MeshStandardMaterial source and break the shader.
 */
function _upgradeMaskToPhysical(std) {
  return new THREE.MeshPhysicalMaterial({
    name:            std.name,
    color:           std.color.clone(),
    map:             std.map,
    normalMap:       std.normalMap,
    roughnessMap:    std.roughnessMap,
    metalnessMap:    std.metalnessMap,
    aoMap:           std.aoMap,
    roughness:       std.roughness,
    metalness:       std.metalness,
    transparent:     std.transparent,
    opacity:         std.opacity,
    side:            std.side,
    envMapIntensity: std.envMapIntensity,
  });
}
import { Logger }                         from '../../core/Logger.js';

export class Live3DRenderer {
  constructor(canvas) {
    this._canvas     = canvas;
    this._disposed   = false;
    this._scene      = null;
    this._camera     = null;
    this._renderer   = null;
    this._composer   = null;
    this._controls   = null;
    this._mats       = null;
    this._boardGroup = null;
    this._groundPlane = null;  // THREE.ShadowMaterial plane — receives key-light shadow for visual grounding
    this._compMeshes = new Map(); // ref → Object3D (for live transform updates)
    this._glbMatGroups = null;    // { copper, mask, silk, board } → Set<MeshStandardMaterial|MeshPhysicalMaterial> (real GLB materials; mask is upgraded to MeshPhysicalMaterial for clearcoat support)
    this._microNormalMap = null;  // shared procedural normal map — breaks up flat reflections on silk (lazily built, see _applyGlbMaterialSettings)
    this._fiberglassMap  = null;  // anisotropic woven-FR4 normal map for board substrate (lazily built, see _applyGlbMaterialSettings)
    this._lastSettings = null;    // last applied settings object — replayed onto newly-loaded GLBs
    this._glbOffset  = null;      // board-center offset applied to recenter GLB at origin
    this._frameBox   = null;      // board mesh's own bbox — used for camera framing
    this._bounds     = null;
    this._mode       = 'none';    // 'glb' | 'none'
    this._gizmo      = null;      // { canvas, renderer, scene, camera } — bottom-left XYZ orientation indicator
    this._raf        = null;
    this._fpsCount   = 0;
    this._fpsLast    = 0;
    this._onFps      = null;
    this._onProgress = null;
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
    // GPU's max anisotropic-filtering level — applied to GLB decal textures
    // (silk/mask) below so thin baked-in lines stay crisp at grazing angles
    // instead of shimmering/dimming from mip-level texture-sampling aliasing.
    this._maxAnisotropy = this._renderer.capabilities.getMaxAnisotropy();
    this._renderer.shadowMap.enabled   = true;
    this._renderer.shadowMap.type      = THREE.PCFSoftShadowMap;
    this._renderer.outputColorSpace    = THREE.SRGBColorSpace;
    this._renderer.toneMapping         = THREE.ACESFilmicToneMapping;
    this._renderer.toneMappingExposure = 1.15;

    this._scene = new THREE.Scene();
    this._scene.background = new THREE.Color(DEFAULT_SETTINGS.background);

    const w = Math.max(canvas.clientWidth  || 800, 1);
    const h = Math.max(canvas.clientHeight || 600, 1);

    this._camera = new THREE.PerspectiveCamera(38, w / h, 0.01, 5000);
    this._renderer.setSize(w, h, false);

    this._controls = new OrbitControls(this._camera, canvas);
    this._controls.enableDamping = true;
    this._controls.dampingFactor = 0.07;
    this._controls.minDistance   = 0.5;
    this._controls.maxDistance   = 2000;
    this._controls.panSpeed      = 1.2;
    this._controls.zoomSpeed     = 1.4;

    this._mats = createMaterials();
    this._setupLighting();
    this._setupGroundPlane();
    this._setupEnvMap();
    this._setupPostprocessing(w, h);
    this._setupAxisGizmo();
    this._startLoop();
  }

  dispose() {
    this._disposed = true;
    cancelAnimationFrame(this._raf);
    this._disposeAxisGizmo();
    this._clearBoard();
    if (this._groundPlane) {
      this._scene?.remove(this._groundPlane);
      this._groundPlane.geometry.dispose();
      this._groundPlane.material.dispose();
      this._groundPlane = null;
    }
    this._mats?.dispose();
    this._controls?.dispose();
    this._composer?.dispose();
    this._renderer?.dispose();
  }

  onFps(cb)      { this._onFps      = cb; }
  onProgress(cb) { this._onProgress = cb; }

  // ── Mode A: GLB (photorealistic, real KiCad 3D models) ────────────────────

  /**
   * Load a kicad-cli–generated .glb file.
   * The GLB contains the full photorealistic scene: board, copper, components.
   * We index every mesh by its name (which kicad-cli sets to ref designator)
   * so we can update transforms in real-time from bridge state.
   *
   * @param {string} glbUrl - Tauri asset URL (convertFileSrc result)
   * @returns {Promise<void>}
   */
  async loadGlb(glbUrl) {
    this._clearBoard();
    this._mode = 'glb';

    const loader = new GLTFLoader();

    return new Promise((resolve, reject) => {
      loader.load(
        glbUrl,
        (gltf) => {
          const root  = gltf.scene;
          root.name   = 'glb_board';

          // kicad-cli emits the board at its real KiCad sheet coordinates
          // (often far from the origin), while our lighting rig and camera
          // framing assume the model sits near (0,0,0). Find the largest mesh
          // (the board substrate) and recenter the whole scene on it so
          // lighting/SSAO/camera all behave — without this the board renders
          // as a tiny, poorly-lit speck off in a corner.
          // kicad-cli emits the board fragmented into hundreds of tiny per-pad/
          // per-zone sub-meshes (no single "big" mesh to key off), positioned
          // at the board's real KiCad sheet coordinates, in METERS (~0.05 x 0.06
          // for a small board) — while our lighting rig/camera defaults assumed
          // millimeter-scale geometry near the origin. Recenter on the whole
          // scene's bbox (which IS tightly bounded — no stray far nodes) and
          // drop the old mm-scale "maxDim floor" in resetCamera/setTopView.
          const rawBox    = new THREE.Box3().setFromObject(root);
          const rawCenter = rawBox.getCenter(new THREE.Vector3());
          const rawSize   = rawBox.getSize(new THREE.Vector3());
          Logger.info('Live3DRenderer',
            `GLB raw scene box: size=(${rawSize.toArray().map(n=>n.toFixed(4))}) ` +
            `center=(${rawCenter.toArray().map(n=>n.toFixed(4))}) — recentering root on this`);

          this._glbOffset = rawCenter.clone(); // local = absoluteKiCad + offset
          root.position.sub(rawCenter);
          root.updateMatrixWorld(true);

          this._frameBox = new THREE.Box3().setFromObject(root);
          const center = this._frameBox.getCenter(new THREE.Vector3());
          const size   = this._frameBox.getSize(new THREE.Vector3());
          Logger.info('Live3DRenderer',
            `Frame box (post-recenter): size=(${size.toArray().map(n=>n.toFixed(4))}) ` +
            `center=(${center.toArray().map(n=>n.toFixed(4))})`);

          // OrbitControls.minDistance/maxDistance and camera near/far were tuned
          // for millimeter-scale synthetic geometry (~100 units). kicad-cli GLBs
          // are in METERS (a small board ≈ 0.05-0.1 units) — the old minDistance
          // of 0.5 alone would force the camera to stay ~5-10x the board's size
          // away at all times. Rescale every distance constant to the loaded
          // model's actual scale so zoom/clipping behave correctly either way.
          const maxDim = Math.max(size.x, size.y, size.z, 1e-4);
          this._controls.minDistance = maxDim * 0.05;
          this._controls.maxDistance = maxDim * 200;
          this._camera.near = Math.max(maxDim * 0.01, 1e-5);
          this._camera.far  = maxDim * 1000;
          this._camera.updateProjectionMatrix();
          Logger.info('Live3DRenderer',
            `Rescaled controls/clipping to maxDim=${maxDim.toFixed(4)}: ` +
            `minDistance=${this._controls.minDistance.toFixed(4)} maxDistance=${this._controls.maxDistance.toFixed(2)} ` +
            `near=${this._camera.near.toFixed(6)} far=${this._camera.far.toFixed(2)}`);

          // Lighting rig, shadow frustum and SSAO were authored against the
          // old mm-scale synthetic geometry (~100 units: light positions at
          // ±100, shadow ortho frustum ±250, SSAO kernel radius 5). Against a
          // ~0.06-unit GLB board those numbers put the shadow camera's frustum
          // ~4000x larger than the board (crushing shadow-map resolution to
          // nothing) and made the SSAO kernel ~80x bigger than the board itself
          // (zero contact-shadow detail). Rescale the whole rig to maxDim so
          // the "professional photorealistic" defaults hold at any board size.
          this._rescaleLightingToScale(maxDim);

          this._bounds = {
            centerX: center.x, centerY: center.y,
            width: size.x, height: size.y,
          };

          // Index meshes by name for live transform updates, and classify each
          // mesh's baked-in material by name so the settings panel's Finish/
          // Mask/Silk/Substrate sliders can tune the GLB's REAL materials in
          // real time (the GLB ships its own PBR materials — createMaterials()
          // in PcbMaterials.js builds an orphan set that nothing renders, so
          // without this classification those sliders would be silent no-ops).
          this._compMeshes.clear();
          this._glbMatGroups = { copper: new Set(), mask: new Set(), silk: new Set(), board: new Set() };
          const matNames = new Set();
          root.traverse(obj => {
            if (!obj.isMesh) return;
            // kicad-cli names component meshes after their reference designator
            const ref = obj.name || obj.parent?.name;
            if (ref && /^[A-Z]+\d+/.test(ref)) {
              this._compMeshes.set(ref, obj.parent ?? obj);
            }
            // Enable shadows
            obj.castShadow    = true;
            obj.receiveShadow = true;

            const isArray = Array.isArray(obj.material);
            const mats = isArray ? obj.material : [obj.material];
            let replaced = false;
            // Explicit per-layer draw order — the technique professional PCB
            // viewers (incl. KiCad's own) use to composite coplanar layers:
            // never rely on depth-buffer precision to pick a winner between
            // surfaces baked near-coplanar (mask over copper/board, silk over
            // mask). Combined with depthWrite=false on mask/silk materials
            // (see _applyGlbMaterialSettings), this guarantees silk always
            // draws over mask over substrate at every angle/zoom — fixing the
            // root cause of the angle-dependent dimming/vanishing, which was
            // Z-fighting made WORSE (not better) by polygonOffset interacting
            // unpredictably with logarithmicDepthBuffer (Three.js writes
            // gl_FragDepthEXT directly in the log-depth shader chunk, so the
            // GPU's standard offset-vs-depth-test pipeline doesn't apply
            // uniformly across the depth range — explaining why the bias
            // "won" at some distances/angles and not others).
            let meshOrder = 0;
            const nextMats = mats.map(mat => {
              if (!mat || !mat.isMeshStandardMaterial) return mat;
              matNames.add(mat.name || '(unnamed)');
              const kind = _classifyGlbMaterial(mat.name || '', obj.name || '');
              if (kind === 'mask') meshOrder = Math.max(meshOrder, 1);
              if (kind === 'silk') meshOrder = Math.max(meshOrder, 2);
              if (kind === 'mask' && !mat.isMeshPhysicalMaterial) {
                const physical = _upgradeMaskToPhysical(mat);
                mat.dispose();
                this._glbMatGroups.mask.add(physical);
                replaced = true;
                return physical;
              }
              if (kind) this._glbMatGroups[kind].add(mat);
              return mat;
            });
            if (meshOrder) obj.renderOrder = meshOrder;
            if (replaced) obj.material = isArray ? nextMats : nextMats[0];
          });
          Logger.info('Live3DRenderer',
            `GLB material names: [${[...matNames].join(', ')}] — classified: ` +
            `copper=${this._glbMatGroups.copper.size} mask=${this._glbMatGroups.mask.size} ` +
            `silk=${this._glbMatGroups.silk.size} board=${this._glbMatGroups.board.size}`);

          this._boardGroup = root;
          this._scene.add(root);
          this._applyGlbMaterialSettings(this._lastSettings ?? DEFAULT_SETTINGS);
          this.resetCamera();
          resolve();
        },
        (xhr) => {
          if (xhr.total > 0) {
            this._onProgress?.(Math.round(xhr.loaded / xhr.total * 100));
          }
        },
        (err) => reject(err),
      );
    });
  }

  // ── Live transform updates ─────────────────────────────────────────────────

  /**
   * Update component positions from bridge state.
   * Works for both GLB mode (updates real model meshes) and synthetic (updates boxes).
   * Called on every bridge board_state event — no re-export needed.
   */
  updateComponents(components) {
    for (const comp of components) {
      const obj = this._compMeshes.get(comp.ref);
      if (!obj) continue;
      if (comp.position) {
        const off = this._glbOffset ?? { x: 0, y: 0 };
        obj.position.x =  comp.position.x + off.x; // recentered to match root shift
        obj.position.y = -comp.position.y + off.y; // KiCad Y-flip
      }
      if (comp.rotation != null) {
        obj.rotation.z = (comp.rotation * Math.PI) / 180;
      }
    }
  }

  // ── Camera ─────────────────────────────────────────────────────────────────

  resetCamera() {
    const obj = this._boardGroup;
    if (!obj) return;

    // Frame on the board mesh's own box — NOT the whole scene graph. kicad-cli
    // GLBs can include stray far-away nodes (origin markers, empty transforms);
    // boxing the whole root inflates maxDim and pushes the camera far away,
    // rendering the board as a tiny speck. _frameBox is the recentered board box.
    const box    = this._frameBox ?? new THREE.Box3().setFromObject(obj);
    const center = new THREE.Vector3();
    const size   = new THREE.Vector3();
    box.getCenter(center);
    box.getSize(size);

    // No hardcoded floor here — kicad-cli GLBs are in METERS (a small board is
    // ~0.05-0.1 units), unlike the old millimeter-scale synthetic geometry that
    // the previous "floor of 10" was tuned for. A floor that large would make
    // a real board's maxDim be treated as 10x-100x bigger than it actually is.
    const maxDim = Math.max(size.x, size.y, size.z, 1e-4);

    // Distance to fit the object using vertical FOV
    const fovRad = this._camera.fov * (Math.PI / 180);
    const fitDist = (maxDim * 0.6) / Math.tan(fovRad / 2);

    // Angled view: slightly above-right, matching KiCad default perspective
    this._camera.position.set(
      center.x - maxDim * 0.25,
      center.y + maxDim * 0.40,
      center.z + fitDist,
    );
    this._camera.up.set(0, 1, 0);
    this._controls.target.copy(center);
    this._controls.update();

    Logger.info('Live3DRenderer',
      `resetCamera: maxDim=${maxDim.toFixed(2)} fitDist=${fitDist.toFixed(2)} ` +
      `camPos=(${this._camera.position.toArray().map(n=>n.toFixed(2))}) ` +
      `target=(${center.toArray().map(n=>n.toFixed(2))}) ` +
      `near=${this._camera.near} far=${this._camera.far} fov=${this._camera.fov}`);
  }

  setTopView() {
    const obj = this._boardGroup;
    if (!obj) return;

    const box    = this._frameBox ?? new THREE.Box3().setFromObject(obj);
    const center = new THREE.Vector3();
    const size   = new THREE.Vector3();
    box.getCenter(center);
    box.getSize(size);

    const maxDim  = Math.max(size.x, size.y, 1e-4);
    const fovRad  = this._camera.fov * (Math.PI / 180);
    const fitDist = (maxDim * 0.6) / Math.tan(fovRad / 2);

    this._camera.position.set(center.x, center.y, center.z + fitDist);
    this._controls.target.copy(center);
    this._controls.update();
  }

  // ── Resize ─────────────────────────────────────────────────────────────────

  resize(w, h) {
    if (!this._renderer || w < 1 || h < 1) return;
    this._renderer.setSize(w, h, false);
    this._composer?.setSize(w, h);
    this._ssaoPass?.setSize(w, h);
    this._sharpenPass?.uniforms.resolution.value.set(w, h);
    this._camera.aspect = w / h;
    this._camera.updateProjectionMatrix();
  }

  get mode()     { return this._mode; }
  get renderer() { return this._renderer; }
  get scene()    { return this._scene; }
  get camera()   { return this._camera; }
  get boardGroup(){ return this._boardGroup; }

  // ── Material settings (live update, no rebuild needed) ────────────────────

  applyMaterialSettings(settings) {
    this._lastSettings = { ...settings };

    // Orphan material set kept only for API compatibility — the GLB ships its
    // own baked materials, so the real live-preview path is _applyGlbMaterialSettings.
    if (this._mats) applySettings(this._mats, settings);
    this._applyGlbMaterialSettings(settings);

    // Lighting
    if (settings.ambientIntensity != null) {
      this._scene.traverse(obj => {
        if (obj.isAmbientLight) obj.intensity = settings.ambientIntensity;
      });
    }
    if (settings.keyIntensity != null) {
      this._scene.traverse(obj => {
        if (obj.isDirectionalLight && obj.castShadow) obj.intensity = settings.keyIntensity;
      });
    }
    if (settings.exposure != null)    this._renderer.toneMappingExposure = settings.exposure;
    if (settings.envIntensity != null) this._scene.environmentIntensity  = settings.envIntensity;

    // Scene background
    if (settings.background != null) {
      if (this._scene.background?.isColor) this._scene.background.set(settings.background);
      else this._scene.background = new THREE.Color(settings.background);
    }

    // SSAO
    if (this._ssaoPass) {
      if (settings.ssaoEnabled != null) this._ssaoPass.enabled = settings.ssaoEnabled;
      if (settings.ssaoRadius  != null) this._ssaoPass.kernelRadius = settings.ssaoRadius;
    }
    // Bloom
    if (this._bloomPass) {
      if (settings.bloomEnabled   != null) this._bloomPass.enabled   = settings.bloomEnabled;
      if (settings.bloomStrength  != null) this._bloomPass.strength  = settings.bloomStrength;
    }
    // Sharpen
    if (this._sharpenPass && settings.sharpness != null) {
      this._sharpenPass.uniforms.amount.value = settings.sharpness;
    }
    // Ground-plane shadow-catcher — toggle also disables the key light's
    // castShadow (kills contact shadows on the board/components too, since
    // that's the same shadow-map pass), strength tunes catcher visibility.
    if (this._groundPlane) {
      if (settings.shadowsEnabled != null) {
        this._groundPlane.visible = settings.shadowsEnabled;
        if (this._keyLight) this._keyLight.castShadow = settings.shadowsEnabled;
      }
      if (settings.shadowStrength != null) {
        this._groundPlane.material.opacity = settings.shadowStrength;
      }
    }
    // Depth of field
    if (this._dofPass) {
      if (settings.dofEnabled  != null) this._dofPass.enabled = settings.dofEnabled;
      if (settings.dofStrength != null) {
        this._dofStrength = settings.dofStrength;
        if (this._dofBaseAperture != null) {
          this._dofPass.uniforms['aperture'].value = this._dofBaseAperture * this._dofStrength;
        }
      }
    }
  }

  /**
   * Tune the GLB's actual baked-in materials (grouped at load time by
   * _classifyGlbMaterial) so Finish/Mask/Silk/Substrate sliders produce a
   * real, instant change in the rendered board — not just an orphan
   * THREE.MeshStandardMaterial set that nothing in the scene references.
   */
  _applyGlbMaterialSettings(settings) {
    if (!this._glbMatGroups) return;
    const cfg = { ...DEFAULT_SETTINGS, ...settings };
    // 1 = isotropic (texture's default / GPU baseline) — toggling off restores it.
    const targetAnisotropy = cfg.anisotropyEnabled ? this._maxAnisotropy : 1;

    const finish = FINISH_PRESETS[cfg.finish] ?? FINISH_PRESETS.enig;
    const copperColor = new THREE.Color(
      cfg.finishColor !== DEFAULT_SETTINGS.finishColor ? cfg.finishColor : finish.color);
    for (const mat of this._glbMatGroups.copper) {
      mat.color.copy(copperColor);
      mat.metalness = cfg.finishMetalness;
      mat.roughness = cfg.finishRoughness;
      mat.envMapIntensity = 2.2;
      _applyAnisotropy(mat, targetAnisotropy);
      mat.needsUpdate = true;
    }

    const maskPreset = MASK_PRESETS[cfg.maskColor] ?? MASK_PRESETS.green;
    const maskHex    = cfg.maskColor === 'custom' ? cfg.maskCustomColor : null;
    const maskColor  = maskHex ? new THREE.Color(maskHex) : new THREE.Color(maskPreset.light);
    const maskRough  = cfg.maskRoughness ?? maskPreset.roughness;
    for (const mat of this._glbMatGroups.mask) {
      mat.color.copy(maskColor);
      mat.roughness   = maskRough;
      mat.transparent = true;
      mat.opacity     = cfg.maskOpacity;
      // Decal technique: mask sits a hair above copper/board in the bake but
      // close enough to Z-fight at distance. Don't let it WRITE depth — it
      // only needs to be drawn (in order, via renderOrder=1 set at classify
      // time) over what's beneath; depthTest stays on so components in front
      // still occlude it correctly.
      mat.depthWrite  = false;
      _applyAnisotropy(mat, targetAnisotropy);
      if (mat.isMeshPhysicalMaterial) {
        mat.clearcoat          = cfg.maskClearcoat;
        mat.clearcoatRoughness = cfg.maskClearcoatRoughness;
      }
      mat.needsUpdate = true;
    }

    if (!this._microNormalMap) this._microNormalMap = generateMicroNormalMap();
    if (!this._fiberglassMap)  this._fiberglassMap  = generateFiberglassWeaveMap();

    for (const mat of this._glbMatGroups.silk) {
      mat.color.set(cfg.silkColor);
      mat.roughness   = cfg.silkRoughness;
      mat.normalMap   = this._microNormalMap;
      mat.normalScale.set(0.15, 0.15); // subtle — raised-ink texture, not gravel
      // kicad-cli bakes silkscreen as a paper-thin decal essentially coplanar
      // with the solder mask beneath it. polygonOffsetFactor contributes ~0
      // bias for coplanar/parallel surfaces (it scales with depth-slope, which
      // is identical for both) — only polygonOffsetUnits did any work, and its
      // effect is a FIXED depth-buffer-resolution bias that means something
      // different at every camera distance. Worse, this renderer uses
      // logarithmicDepthBuffer (needed for the board's huge near/far range),
      // and Three.js's log-depth shader chunk writes gl_FragDepthEXT directly
      // — bypassing the GPU's standard polygon-offset-vs-depth-test pipeline,
      // so the bias "wins" at some distances/angles and not others. That's
      // EXACTLY the "little bit stable but still happening" symptom: the fix
      // was fighting the depth buffer instead of sidestepping it.
      //
      // Professional viewers (incl. KiCad's own) don't resolve coplanar PCB
      // layers via the depth buffer at all — they composite them in explicit
      // draw order (substrate → mask → silk), each overlay layer not writing
      // its own depth. That's the decal technique: depthWrite=false here +
      // obj.renderOrder=2 (set at GLB-classify time, mask=1/silk=2) guarantees
      // silk always draws over mask over substrate, at every angle and zoom,
      // with zero dependency on depth-buffer precision. depthTest stays on so
      // components genuinely in front of the board still occlude the silk.
      mat.depthWrite  = false;
      // Light backup bias only — guards against silk-vs-silk self-overlap
      // (overlapping glyph strokes baked into the same mesh/material), not
      // silk-vs-mask (that's now renderOrder's job).
      mat.polygonOffset       = true;
      mat.polygonOffsetFactor = -1;
      mat.polygonOffsetUnits  = -1;
      _applyAnisotropy(mat, targetAnisotropy);
      mat.needsUpdate = true;
    }

    for (const mat of this._glbMatGroups.board) {
      mat.color.set(cfg.boardColor);
      mat.roughness   = cfg.boardRoughness;
      mat.normalMap   = this._fiberglassMap;
      mat.normalScale.set(0.45, 0.45); // woven-cloth grain on exposed FR-4 edges
      _applyAnisotropy(mat, targetAnisotropy);
      mat.needsUpdate = true;
    }
  }

  /** Render one frame at high resolution to an off-screen canvas, return as Blob. */
  async renderSnapshot(opts = {}) {
    const scale = opts.scale ?? 2;
    const cw    = this._canvas.clientWidth;
    const ch    = this._canvas.clientHeight;
    const w     = opts.width  ?? Math.round(cw  * scale);
    const h     = opts.height ?? Math.round(ch  * scale);
    const mime  = opts.mime   ?? 'image/png';
    const q     = opts.quality ?? 1.0;

    const off = document.createElement('canvas');
    off.width  = w;
    off.height = h;

    const r2 = new THREE.WebGLRenderer({ canvas: off, antialias: true, logarithmicDepthBuffer: true });
    r2.setSize(w, h, false);
    r2.setPixelRatio(1);
    r2.outputColorSpace    = this._renderer.outputColorSpace;
    r2.toneMapping         = this._renderer.toneMapping;
    r2.toneMappingExposure = this._renderer.toneMappingExposure;
    r2.shadowMap.enabled   = true;
    r2.shadowMap.type      = THREE.PCFSoftShadowMap;

    const cam2 = this._camera.clone();
    cam2.aspect = w / h;
    cam2.updateProjectionMatrix();

    r2.render(this._scene, cam2);
    r2.render(this._scene, cam2); // two passes for stable shadows

    return new Promise(resolve => {
      off.toBlob(blob => { r2.dispose(); resolve(blob); }, mime, q);
    });
  }

  // ── Private: scene setup ───────────────────────────────────────────────────

  /**
   * Build a small "photo studio" scene — backdrop + softbox panels — and bake
   * it into a PMREM environment map. The key softbox is thrown along the EXACT
   * same direction as the key DirectionalLight (_unitLightPositions.key, set
   * up in _setupLighting which runs first): IBL specular highlights and cast
   * shadows must agree, or a glint with no matching shadow reads as fake.
   * Fill/rim softboxes carry the duty the old fill/rim DirectionalLights did —
   * ambient contribution from a real environment looks more cohesive than
   * extra directional lights throwing their own, differently-angled highlights.
   */
  _setupEnvMap() {
    const pmrem = new THREE.PMREMGenerator(this._renderer);
    pmrem.compileCubemapShader();

    const studio = new THREE.Scene();

    const backdrop = new THREE.Mesh(
      new THREE.SphereGeometry(100, 32, 16),
      new THREE.MeshBasicMaterial({ color: 0x0a0a0c, side: THREE.BackSide }),
    );
    studio.add(backdrop);

    // Overhead key softbox — long strip thrown along _unitLightPositions.key
    // so its highlight direction is identical to the key light's shadow.
    // Wider than before (25→45) — a larger emissive area spreads its baked
    // highlight across more of the environment instead of acting like a
    // small, near-point "sun" when mirrored by a glossy clearcoat.
    const key = new THREE.Mesh(
      new THREE.PlaneGeometry(45, 95),
      new THREE.MeshBasicMaterial({ color: 0xffffff, side: THREE.DoubleSide }),
    );
    key.position.copy(this._unitLightPositions.key).multiplyScalar(30);
    key.lookAt(0, 0, 0);
    studio.add(key);

    // Opposing fill softbox — warm, broad, catches edge-cut and component rims
    const fill = new THREE.Mesh(
      new THREE.PlaneGeometry(35, 35),
      new THREE.MeshBasicMaterial({ color: 0xfff5ea, side: THREE.DoubleSide }),
    );
    fill.position.set(-45, 25, -20);
    fill.lookAt(0, 0, 0);
    studio.add(fill);

    // Cool rim softbox — low and behind; faint kicker along the board edge
    const rim = new THREE.Mesh(
      new THREE.PlaneGeometry(20, 20),
      new THREE.MeshBasicMaterial({ color: 0xccdaff, side: THREE.DoubleSide }),
    );
    rim.position.set(0, -20, -45);
    rim.lookAt(0, 0, 0);
    studio.add(rim);

    // Heavier blur than a "sharp" baking pass — a real softbox is large AND
    // diffused, so it spreads its highlight across a broad area at moderate
    // peak brightness. A near-sharp bake (0.04) reads as a small, blinding
    // point when mirrored by a glossy clearcoat — exactly the blown-out
    // hotspot a diffusion panel exists to prevent.
    const envRT = pmrem.fromScene(studio, 0.09);
    this._scene.environment          = envRT.texture;
    this._scene.environmentIntensity = 0.85;

    for (const obj of [backdrop, key, fill, rim]) {
      obj.geometry.dispose();
      obj.material.dispose();
    }
    pmrem.dispose();
  }

  _setupLighting() {
    // Position/frustum below is authored at "unit scale" (board maxDim ≈ 1)
    // and proportionally rescaled to the loaded model's actual size in
    // _rescaleLightingToScale() once a GLB is loaded — this keeps the same
    // photographic relationships (angle, throw distance, frustum coverage)
    // regardless of whether the GLB is meter-scale (kicad-cli) or otherwise.
    //
    // Single shadow-casting key light + ambient: fill/rim duty moved to the
    // studio environment map (_setupEnvMap, which reads this position back to
    // stay aligned). Multiple independent directional lights threw highlights
    // at angles that didn't match any cast shadow — the classic "fake" tell.
    this._unitLightPositions = {
      key: new THREE.Vector3(0.8, 1.2, 1.0),
    };

    this._scene.add(new THREE.AmbientLight(0xffffff, 0.18));

    // Key light — top-right, casts shadows for component depth
    const key = new THREE.DirectionalLight(0xfff8f0, 2.10);
    key.castShadow = true;
    key.shadow.mapSize.set(2048, 2048);
    key.shadow.bias = -0.0005;
    key.shadow.normalBias = 0.02;
    this._scene.add(key);
    this._keyLight = key;

    // Apply unit-scale defaults (maxDim=1) until a model loads and rescales.
    this._rescaleLightingToScale(1);
  }

  /**
   * Shadow-catcher ground plane — receives the key light's cast shadow so the
   * board reads as sitting in space rather than floating against a flat
   * background. THREE.ShadowMaterial supports no alphaMap/falloff (checked
   * upstream: its shader is color+opacity only) — a rectangular plane would
   * show its hard-edged silhouette as a "dull masked rectangle" wherever it
   * crosses the frame. Two fixes instead: (1) a circular disc has no corners
   * to read as a graphic shape, and (2) _rescaleLightingToScale() sizes its
   * radius far larger than any reasonable framing, so its boundary always
   * sits outside the visible frustum — only the shadow it catches is ever seen.
   */
  _setupGroundPlane() {
    const ground = new THREE.Mesh(
      new THREE.CircleGeometry(0.5, 64),
      new THREE.ShadowMaterial({ opacity: DEFAULT_SETTINGS.shadowStrength }),
    );
    ground.rotation.x   = -Math.PI / 2;
    ground.receiveShadow = true;
    this._scene.add(ground);
    this._groundPlane = ground;
  }

  /**
   * Rescale the lighting rig, shadow frustum and SSAO kernel proportionally
   * to the loaded model's bounding-box maxDim. Keeps "professional photo
   * studio" proportions (light throw distance ≈ 1.5x board size, shadow
   * frustum ≈ 2x board size, SSAO radius ≈ 8% of board size) valid whether
   * the GLB is meter-scale (kicad-cli, ~0.06 units) or any other scale.
   * @param {number} maxDim
   */
  _rescaleLightingToScale(maxDim) {
    const m = Math.max(maxDim, 1e-4);
    const p = this._unitLightPositions;

    if (this._keyLight) {
      this._keyLight.position.copy(p.key).multiplyScalar(m);
      this._keyLight.shadow.camera.near = m * 0.1;
      this._keyLight.shadow.camera.far  = m * 20;
      this._keyLight.shadow.camera.left   = this._keyLight.shadow.camera.bottom = -m * 1.2;
      this._keyLight.shadow.camera.right  = this._keyLight.shadow.camera.top    =  m * 1.2;
      this._keyLight.shadow.camera.updateProjectionMatrix();
    }
    if (this._ssaoPass) {
      this._ssaoPass.kernelRadius = m * 0.08;
      this._ssaoPass.minDistance  = m * 0.0005;
      this._ssaoPass.maxDistance  = m * 0.5;
    }
    if (this._dofPass) {
      // aperture·factor must stay scale-invariant: factor (focus−depth) scales
      // with m, so the base aperture must scale with 1/m; the user's
      // dofStrength (applyMaterialSettings) then multiplies on top.
      this._dofBaseAperture = DOF_BASE_APERTURE / m;
      this._dofPass.uniforms['aperture'].value = this._dofBaseAperture * this._dofStrength;
    }
    if (this._groundPlane) {
      // Radius far larger than any reasonable framing distance (resetCamera
      // fits the board to ~1.3x maxDim away) — keeps the disc's circular edge
      // permanently outside the view frustum, so only its caught shadow shows.
      const radius = m * 20;
      const floorY = this._frameBox ? this._frameBox.min.y : -m * 0.5;
      this._groundPlane.scale.set(radius, radius, 1);
      this._groundPlane.position.y = floorY - m * 0.01;
    }

    Logger.info('Live3DRenderer',
      `Rescaled lighting/shadow/SSAO rig to maxDim=${m.toFixed(4)}: ` +
      `keyPos=(${this._keyLight?.position.toArray().map(n=>n.toFixed(3))}) ` +
      `shadowFrustum=±${(m*1.2).toFixed(3)} ssaoRadius=${this._ssaoPass?.kernelRadius.toFixed(4)}`);
  }

  _setupPostprocessing(w, h) {
    this._composer = new EffectComposer(this._renderer);
    this._composer.addPass(new RenderPass(this._scene, this._camera));

    // SSAO — biggest realism gain: via holes, under-component occlusion.
    // Kernel radius/min/max distances are unit-scale defaults; rescaled to
    // the loaded model's actual size in _rescaleLightingToScale().
    const ssao = new SSAOPass(this._scene, this._camera, w, h);
    ssao.kernelRadius = 0.08;
    ssao.minDistance  = 0.0005;
    ssao.maxDistance  = 0.5;
    this._ssaoPass = ssao;
    this._composer.addPass(ssao);

    // Subtle bloom — copper highlight glow. Threshold raised from the
    // UnrealBloomPass default-ish 0.85: glossy clearcoat/ENIG specular
    // highlights legitimately sit near 0.85-0.9 after ACES tonemapping —
    // blooming those turns a crisp glint into a giant blown-out halo.
    // 0.92 lets only genuinely clipped pixels bloom.
    const bloom = new UnrealBloomPass(new THREE.Vector2(w, h), 0.22, 0.5, 0.92);
    this._bloomPass = bloom;
    this._composer.addPass(bloom);

    // Depth of field — softens elements BEHIND the board so it reads as a
    // photographed product, not a flat render; the board itself must stay
    // sharp at any orbit angle/zoom (product shots use a small aperture/large
    // DOF, the opposite of portrait bokeh). `focus` is re-aimed at the orbit
    // target every frame (_startLoop). `aperture`'s base value is rescaled to
    // DOF_BASE_APERTURE/maxDim in _rescaleLightingToScale() — keeping
    // aperture·(focus−depth) scale-invariant — then multiplied by the user's
    // `dofStrength` slider (DEFAULT_SETTINGS, 0-1). `maxblur` stays low so
    // even a fully-open aperture only lightly softens the background.
    const dof = new BokehPass(this._scene, this._camera, {
      focus:    1.3,
      aperture: DOF_BASE_APERTURE * DEFAULT_SETTINGS.dofStrength,
      maxblur:  0.12,
    });
    this._dofPass = dof;
    this._dofStrength = DEFAULT_SETTINGS.dofStrength;
    this._composer.addPass(dof);

    // Sharpen — counters the softness GLB/SSAO/bloom add, crisp final detail
    const sharpen = new ShaderPass(SharpenShader);
    sharpen.uniforms.resolution.value.set(w, h);
    sharpen.uniforms.amount.value = DEFAULT_SETTINGS.sharpness;
    this._sharpenPass = sharpen;
    this._composer.addPass(sharpen);

    this._composer.addPass(new OutputPass());
  }

  /**
   * Fixed-size XYZ orientation indicator, bottom-left of the viewport — its
   * own tiny canvas/renderer/scene/camera, layered over the main canvas via
   * absolute positioning. Each frame (_startLoop) its camera is re-aimed to
   * match the main camera's current orientation so the arrows always show
   * "which way is X/Y/Z" relative to the live view, the way CAD viewports do.
   */
  _setupAxisGizmo() {
    const SIZE = 64;
    // The shadow-root stylesheet forces `canvas { width:100% !important;
    // height:100% !important }` (sizing the main viewport canvas) — that
    // would stretch this small buffer to fill the whole view. Sizing a
    // wrapper div instead lets that 100% resolve against a small box.
    const wrap = document.createElement('div');
    wrap.style.cssText =
      `position:absolute; left:10px; bottom:10px; width:${SIZE}px; height:${SIZE}px; pointer-events:none;`;
    const canvas = document.createElement('canvas');
    canvas.width  = SIZE;
    canvas.height = SIZE;
    wrap.appendChild(canvas);
    this._canvas.parentElement?.appendChild(wrap);

    const renderer = new THREE.WebGLRenderer({ canvas, alpha: true, antialias: true });
    renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
    renderer.setSize(SIZE, SIZE, false);

    const scene  = new THREE.Scene();
    const camera = new THREE.OrthographicCamera(-1.6, 1.6, 1.6, -1.6, 0.1, 10);

    const AXES = [
      { dir: new THREE.Vector3(1, 0, 0), color: 0xe5534b, label: 'X' },
      { dir: new THREE.Vector3(0, 1, 0), color: 0x4caf50, label: 'Y' },
      { dir: new THREE.Vector3(0, 0, 1), color: 0x4f8fe5, label: 'Z' },
    ];
    for (const { dir, color, label } of AXES) {
      scene.add(new THREE.ArrowHelper(dir, new THREE.Vector3(), 1, color, 0.32, 0.16));
      const sprite = this._makeAxisLabel(label, color);
      sprite.position.copy(dir).multiplyScalar(1.35);
      scene.add(sprite);
    }

    this._gizmo = { wrap, renderer, scene, camera };
  }

  /** Small canvas-texture sprite for a gizmo axis label — same CanvasTexture approach as generateMicroNormalMap. */
  _makeAxisLabel(text, color) {
    const size = 64;
    const canvas = document.createElement('canvas');
    canvas.width = canvas.height = size;
    const ctx = canvas.getContext('2d');
    ctx.fillStyle    = `#${color.toString(16).padStart(6, '0')}`;
    ctx.font         = 'bold 40px sans-serif';
    ctx.textAlign    = 'center';
    ctx.textBaseline = 'middle';
    ctx.fillText(text, size / 2, size / 2 + 2);

    const texture  = new THREE.CanvasTexture(canvas);
    const material = new THREE.SpriteMaterial({ map: texture, depthTest: false, depthWrite: false });
    const sprite   = new THREE.Sprite(material);
    sprite.scale.set(0.4, 0.4, 1);
    return sprite;
  }

  /** Re-aim the gizmo camera to match the main camera's current orientation, then render it. */
  _renderAxisGizmo() {
    const g = this._gizmo;
    if (!g) return;
    g.camera.position.set(0, 0, 1).applyQuaternion(this._camera.quaternion).multiplyScalar(4);
    g.camera.up.copy(this._camera.up);
    g.camera.lookAt(0, 0, 0);
    g.renderer.render(g.scene, g.camera);
  }

  _disposeAxisGizmo() {
    const g = this._gizmo;
    if (!g) return;
    g.scene.traverse(obj => {
      obj.geometry?.dispose();
      if (obj.material) {
        obj.material.map?.dispose();
        obj.material.dispose();
      }
    });
    g.renderer.dispose();
    g.wrap.remove();
    this._gizmo = null;
  }

  _clearBoard() {
    if (this._boardGroup) {
      this._scene?.remove(this._boardGroup);
      this._boardGroup.traverse(obj => { if (obj.geometry) obj.geometry.dispose(); });
      this._boardGroup = null;
    }
    this._compMeshes.clear();
    this._bounds    = null;
    this._glbOffset   = null;
    this._frameBox    = null;
    this._glbMatGroups = null;
    this._mode      = 'none';
  }

  _startLoop() {
    const render = () => {
      if (this._disposed) return;
      this._raf = requestAnimationFrame(render);
      this._controls?.update();

      if (this._dofPass && this._controls) {
        this._dofPass.uniforms['focus'].value = this._camera.position.distanceTo(this._controls.target);
      }

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
      this._renderAxisGizmo();
    };
    this._fpsLast = performance.now();
    render();
  }
}
