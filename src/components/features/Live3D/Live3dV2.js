/**
 * Live3dV2 — full-settings scene overlay for Live3DRenderer.
 *
 * Shares the Custom-mode canvas. Adds its own SpotLight and HemisphereLight,
 * modifies the existing AmbientLight, and exposes every VIEWER_DEFAULTS knob
 * via the same settings panel used by the GLB Viewer (buildSettingsPanelHtml).
 *
 * @module Live3dV2
 */

import * as THREE from 'three';
import { VIEWER_DEFAULTS }              from '../BoardRender/Live3dViewer.js';
import { buildSettingsPanelHtml, fmtVal } from './Live3DPanelBuilder.js';

// ── Live3dV2Manager ───────────────────────────────────────────────────────────

export class Live3dV2Manager {
  constructor(shadowRoot, renderer) {
    this._root     = shadowRoot;
    this._renderer = renderer;
    this._settings = JSON.parse(JSON.stringify(VIEWER_DEFAULTS));
    this._active   = false;
    this._drawerOpen = false;

    // Objects owned by V2 (created on activate, removed on deactivate)
    this._spotLight  = null;
    this._hemiLight  = null;
    this._ground     = null;
    this._axesHelper = null;
    this._gridHelper = null;

    // Saved state for full restore on deactivate
    this._savedState = null;
  }

  activate() {
    if (this._active) return;
    this._active = true;
    this._saveState();
    this._syncSettingsToCurrent();
    this._createOwnedObjects();
    this._populate();
    this._applyAll();
  }

  deactivate() {
    if (!this._active) return;
    this._active = false;
    this._root.getElementById('v2-drawer')?.classList.remove('open');
    this._root.getElementById('btn-v2-settings')?.classList.remove('active');
    this._drawerOpen = false;
    this._removeOwnedObjects();
    this._restoreState();
  }

  toggleDrawer() {
    this._drawerOpen = !this._drawerOpen;
    this._root.getElementById('v2-drawer')?.classList.toggle('open', this._drawerOpen);
    this._root.getElementById('btn-v2-settings')?.classList.toggle('active', this._drawerOpen);
  }

  closeDrawer() {
    this._drawerOpen = false;
    this._root.getElementById('v2-drawer')?.classList.remove('open');
    this._root.getElementById('btn-v2-settings')?.classList.remove('active');
  }

  resetDefaults() {
    this._settings = JSON.parse(JSON.stringify(VIEWER_DEFAULTS));
    this._populate();
    this._applyAll();
  }

  handleInput(e) {
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

    if (!this._settings[section]) this._settings[section] = {};
    this._settings[section][key] = value;
    this._applySetting(section, key, value);

    if (el.type === 'range') {
      const step  = parseFloat(el.dataset.step ?? el.step ?? 1);
      const outEl = this._root.getElementById(`v2out-${section}-${key}`);
      if (outEl) outEl.textContent = fmtVal(value, step);
    }
  }

  // ── Private ────────────────────────────────────────────────────────────────

  _saveState() {
    const r   = this._renderer;
    if (!r) return;

    const saved = { renderer: {}, scene: {}, camera: {}, controls: {}, lights: [] };

    if (r.renderer) {
      const c = new THREE.Color();
      r.renderer.getClearColor(c);
      saved.renderer.clearColor       = '#' + c.getHexString();
      saved.renderer.pixelRatio       = r.renderer.getPixelRatio();
      saved.renderer.toneMapping      = r.renderer.toneMapping;
      saved.renderer.toneMappingExposure = r.renderer.toneMappingExposure;
      saved.renderer.shadowsEnabled   = r.renderer.shadowMap.enabled;
      saved.renderer.shadowMapType    = r.renderer.shadowMap.type;
    }
    if (r.scene) {
      saved.scene.background = r.scene.background;
      saved.scene.fog        = r.scene.fog;
    }
    if (r.camera) {
      saved.camera.fov  = r.camera.fov;
      saved.camera.near = r.camera.near;
      saved.camera.far  = r.camera.far;
      saved.camera.posX = r.camera.position.x;
      saved.camera.posY = r.camera.position.y;
      saved.camera.posZ = r.camera.position.z;
    }
    if (r.controls) {
      saved.controls.enableDamping    = r.controls.enableDamping;
      saved.controls.dampingFactor    = r.controls.dampingFactor;
      saved.controls.enablePan        = r.controls.enablePan;
      saved.controls.enableZoom       = r.controls.enableZoom;
      saved.controls.minDistance      = r.controls.minDistance;
      saved.controls.maxDistance      = r.controls.maxDistance;
      saved.controls.minPolarAngle    = r.controls.minPolarAngle;
      saved.controls.maxPolarAngle    = r.controls.maxPolarAngle;
      saved.controls.autoRotate       = r.controls.autoRotate;
      saved.controls.autoRotateSpeed  = r.controls.autoRotateSpeed;
      saved.controls.targetX          = r.controls.target.x;
      saved.controls.targetY          = r.controls.target.y;
      saved.controls.targetZ          = r.controls.target.z;
    }

    // Save existing ambient lights so we can restore them
    if (r.scene) {
      r.scene.traverse(obj => {
        if (obj.isAmbientLight) {
          saved.lights.push({ uuid: obj.uuid, color: obj.color.clone(), intensity: obj.intensity, visible: obj.visible });
        }
      });
    }

    this._savedState = saved;
  }

  _restoreState() {
    const s = this._savedState;
    const r = this._renderer;
    if (!s || !r) return;

    if (r.renderer && s.renderer) {
      const c = new THREE.Color(s.renderer.clearColor);
      r.renderer.setClearColor(c, 1);
      r.renderer.setPixelRatio(s.renderer.pixelRatio);
      r.renderer.toneMapping           = _tmValue(s.renderer.toneMapping);
      r.renderer.toneMappingExposure   = s.renderer.toneMappingExposure;
      r.renderer.shadowMap.enabled     = s.renderer.shadowsEnabled;
      r.renderer.shadowMap.type        = _smtValue(s.renderer.shadowMapType);
    }
    if (r.scene && s.scene) {
      r.scene.background = s.scene.background;
      r.scene.fog        = s.scene.fog;
    }
    if (r.camera && s.camera) {
      r.camera.fov  = s.camera.fov;
      r.camera.near = s.camera.near;
      r.camera.far  = s.camera.far;
      r.camera.position.set(s.camera.posX, s.camera.posY, s.camera.posZ);
      r.camera.updateProjectionMatrix();
    }
    if (r.controls && s.controls) {
      Object.assign(r.controls, {
        enableDamping:   s.controls.enableDamping,
        dampingFactor:   s.controls.dampingFactor,
        enablePan:       s.controls.enablePan,
        enableZoom:      s.controls.enableZoom,
        minDistance:     s.controls.minDistance,
        maxDistance:     s.controls.maxDistance,
        minPolarAngle:   s.controls.minPolarAngle,
        maxPolarAngle:   s.controls.maxPolarAngle,
        autoRotate:      s.controls.autoRotate,
        autoRotateSpeed: s.controls.autoRotateSpeed,
      });
      r.controls.target.set(s.controls.targetX, s.controls.targetY, s.controls.targetZ);
      r.controls.update();
    }

    // Restore ambient lights
    if (r.scene && s.lights?.length) {
      r.scene.traverse(obj => {
        if (!obj.isAmbientLight) return;
        const orig = s.lights.find(l => l.uuid === obj.uuid);
        if (orig) {
          obj.color.copy(orig.color);
          obj.intensity = orig.intensity;
          obj.visible   = orig.visible;
        }
      });
    }

    this._savedState = null;
  }

  _syncSettingsToCurrent() {
    const r = this._renderer;
    if (!r) return;
    const s = this._settings;

    if (r.renderer) {
      const c = new THREE.Color();
      r.renderer.getClearColor(c);
      s.renderer.clearColor            = '#' + c.getHexString();
      s.renderer.pixelRatio            = r.renderer.getPixelRatio();
      s.renderer.shadowsEnabled        = r.renderer.shadowMap.enabled;
    }
    if (r.camera) {
      s.camera.fov  = r.camera.fov;
      s.camera.near = r.camera.near;
      s.camera.far  = r.camera.far;
      s.camera.posX = r.camera.position.x;
      s.camera.posY = r.camera.position.y;
      s.camera.posZ = r.camera.position.z;
    }
    if (r.controls) {
      s.controls.dampingFactor   = r.controls.dampingFactor;
      s.controls.enableDamping   = r.controls.enableDamping;
      s.controls.enablePan       = r.controls.enablePan;
      s.controls.enableZoom      = r.controls.enableZoom;
      s.controls.minDistance     = r.controls.minDistance;
      s.controls.maxDistance     = r.controls.maxDistance;
      s.controls.minPolarAngle   = r.controls.minPolarAngle;
      s.controls.maxPolarAngle   = r.controls.maxPolarAngle;
      s.controls.autoRotate      = r.controls.autoRotate;
      s.controls.autoRotateSpeed = r.controls.autoRotateSpeed;
      s.controls.targetX         = r.controls.target.x;
      s.controls.targetY         = r.controls.target.y;
      s.controls.targetZ         = r.controls.target.z;
    }
  }

  _createOwnedObjects() {
    const scene = this._renderer?.scene;
    if (!scene) return;

    // SpotLight
    const sl = new THREE.SpotLight();
    sl.name = '__v2_spot__';
    scene.add(sl);
    scene.add(sl.target);
    this._spotLight = sl;

    // HemisphereLight
    const hl = new THREE.HemisphereLight();
    hl.name = '__v2_hemi__';
    scene.add(hl);
    this._hemiLight = hl;

    // Ground plane
    const geo = new THREE.PlaneGeometry(1, 1);
    const mat = new THREE.MeshStandardMaterial();
    const mesh = new THREE.Mesh(geo, mat);
    mesh.name = '__v2_ground__';
    mesh.rotation.x = -Math.PI / 2;
    mesh.receiveShadow = true;
    scene.add(mesh);
    this._ground = mesh;
  }

  _removeOwnedObjects() {
    const scene = this._renderer?.scene;
    if (this._spotLight) {
      scene?.remove(this._spotLight);
      scene?.remove(this._spotLight.target);
      this._spotLight.dispose?.();
      this._spotLight = null;
    }
    if (this._hemiLight) {
      scene?.remove(this._hemiLight);
      this._hemiLight.dispose?.();
      this._hemiLight = null;
    }
    if (this._ground) {
      scene?.remove(this._ground);
      this._ground.geometry?.dispose();
      this._ground.material?.dispose();
      this._ground = null;
    }
    // Helpers
    if (this._axesHelper) {
      this._renderer?.scene?.remove(this._axesHelper);
      this._axesHelper = null;
    }
    if (this._gridHelper) {
      this._renderer?.scene?.remove(this._gridHelper);
      this._gridHelper.geometry?.dispose?.();
      this._gridHelper.material?.dispose?.();
      this._gridHelper = null;
    }

    // Remove fog and reset wireframe/shadows
    if (this._renderer?.scene) this._renderer.scene.fog = null;
    this._applyWireframe(false);
  }

  _populate() {
    const body = this._root.getElementById('v2-settings-body');
    if (body) body.innerHTML = buildSettingsPanelHtml(this._settings, 'v2out');
  }

  _applyAll() {
    const s = this._settings;
    this._applyRenderer(s.renderer);
    this._applyFog(s.fog);
    this._applySpotLight(s.spotLight);
    this._applyAmbientLight(s.ambientLight);
    this._applyHemiLight(s.hemiLight);
    this._applyCamera(s.camera);
    this._applyControls(s.controls);
    this._applyGround(s.ground);
    this._applyHelpers(s.helpers);
    this._applyWireframe(s.model.wireframe);
    this._applyCastShadow(s.model.castShadow);
    this._applyReceiveShadow(s.model.receiveShadow);
  }

  _applySetting(section, key, value) {
    const s = this._settings;
    switch (section) {
      case 'renderer':     this._applyRenderer(s.renderer);            break;
      case 'fog':          this._applyFog(s.fog);                      break;
      case 'spotLight':    this._applySpotLight(s.spotLight);          break;
      case 'ambientLight': this._applyAmbientLight(s.ambientLight);    break;
      case 'hemiLight':    this._applyHemiLight(s.hemiLight);          break;
      case 'camera':       this._applyCamera(s.camera);                break;
      case 'controls':     this._applyControls(s.controls);            break;
      case 'ground':       this._applyGround(s.ground);                break;
      case 'helpers':      this._applyHelpers(s.helpers);              break;
      case 'model':
        if (key === 'wireframe')     this._applyWireframe(value);
        if (key === 'castShadow')    this._applyCastShadow(value);
        if (key === 'receiveShadow') this._applyReceiveShadow(value);
        break;
    }
  }

  _applyRenderer(r) {
    const ren = this._renderer?.renderer;
    if (!ren) return;

    ren.setPixelRatio(r.pixelRatio);
    ren.toneMapping         = _tmValue(r.toneMapping);
    ren.toneMappingExposure = r.toneMappingExposure;
    ren.shadowMap.enabled   = r.shadowsEnabled;
    ren.shadowMap.type      = _smtValue(r.shadowMapType);
    ren.shadowMap.needsUpdate = true;

    const c = new THREE.Color(r.clearColor);
    ren.setClearColor(c, 1);
    if (this._renderer.scene) this._renderer.scene.background = c;
  }

  _applyFog(f) {
    if (!this._renderer?.scene) return;
    this._renderer.scene.fog = f.enabled
      ? new THREE.Fog(new THREE.Color(f.color), f.near, f.far)
      : null;
  }

  _applySpotLight(sl) {
    const light = this._spotLight;
    if (!light) return;
    light.visible   = sl.enabled;
    light.color.set(sl.color);
    light.intensity = sl.intensity;
    light.distance  = sl.distance;
    light.angle     = sl.angle;
    light.penumbra  = sl.penumbra;
    light.position.set(sl.posX, sl.posY, sl.posZ);
    light.castShadow          = sl.castShadow;
    light.shadow.bias         = sl.shadowBias;
    const sz = sl.shadowMapSize;
    if (light.shadow.mapSize.width !== sz) {
      light.shadow.mapSize.set(sz, sz);
      light.shadow.map?.dispose();
      light.shadow.map = null;
    }
  }

  _applyAmbientLight(al) {
    if (!this._renderer?.scene) return;
    this._renderer.scene.traverse(obj => {
      if (!obj.isAmbientLight) return;
      obj.visible   = al.enabled;
      obj.color.set(al.color);
      obj.intensity = al.intensity;
    });
  }

  _applyHemiLight(hl) {
    const light = this._hemiLight;
    if (!light) return;
    light.visible = hl.enabled;
    light.color.set(hl.skyColor);
    light.groundColor.set(hl.groundColor);
    light.intensity = hl.intensity;
    light.position.set(hl.posX, hl.posY, hl.posZ);
  }

  _applyCamera(c) {
    const cam = this._renderer?.camera;
    if (!cam) return;
    cam.fov  = c.fov;
    cam.near = c.near;
    cam.far  = c.far;
    cam.position.set(c.posX, c.posY, c.posZ);
    cam.updateProjectionMatrix();
    this._renderer.controls?.update();
  }

  _applyControls(c) {
    const ctrl = this._renderer?.controls;
    if (!ctrl) return;
    ctrl.enableDamping   = c.enableDamping;
    ctrl.dampingFactor   = c.dampingFactor;
    ctrl.enablePan       = c.enablePan;
    ctrl.enableZoom      = c.enableZoom;
    ctrl.minDistance     = c.minDistance;
    ctrl.maxDistance     = c.maxDistance;
    ctrl.minPolarAngle   = c.minPolarAngle;
    ctrl.maxPolarAngle   = c.maxPolarAngle;
    ctrl.autoRotate      = c.autoRotate;
    ctrl.autoRotateSpeed = c.autoRotateSpeed;
    ctrl.target.set(c.targetX, c.targetY, c.targetZ);
    ctrl.update();
  }

  _applyGround(g) {
    const mesh = this._ground;
    if (!mesh) return;
    mesh.visible = g.visible;
    mesh.material.color.set(g.color);
    mesh.material.metalness = g.metalness;
    mesh.material.roughness = g.roughness;
    mesh.scale.set(g.size, g.size, 1);
  }

  _applyHelpers(h) {
    const scene = this._renderer?.scene;
    if (!scene) return;

    // Axes
    if (this._axesHelper) {
      scene.remove(this._axesHelper);
      this._axesHelper = null;
    }
    if (h.axesVisible) {
      this._axesHelper = new THREE.AxesHelper(h.axesSize);
      scene.add(this._axesHelper);
    }

    // Grid
    if (this._gridHelper) {
      scene.remove(this._gridHelper);
      this._gridHelper.geometry?.dispose?.();
      this._gridHelper.material?.dispose?.();
      this._gridHelper = null;
    }
    if (h.gridVisible) {
      const c = new THREE.Color(h.gridColor);
      this._gridHelper = new THREE.GridHelper(h.gridSize, h.gridDivisions, c, c);
      scene.add(this._gridHelper);
    }
  }

  _applyWireframe(enabled) {
    if (!this._renderer?.boardGroup) return;
    this._renderer.boardGroup.traverse(obj => {
      if (!obj.isMesh) return;
      if (Array.isArray(obj.material)) obj.material.forEach(m => { if (m) m.wireframe = enabled; });
      else if (obj.material)           obj.material.wireframe = enabled;
    });
  }

  _applyCastShadow(enabled) {
    if (!this._renderer?.boardGroup) return;
    this._renderer.boardGroup.traverse(obj => {
      if (obj.isMesh) obj.castShadow = enabled;
    });
  }

  _applyReceiveShadow(enabled) {
    if (!this._renderer?.boardGroup) return;
    this._renderer.boardGroup.traverse(obj => {
      if (obj.isMesh) obj.receiveShadow = enabled;
    });
  }
}

// ── THREE enum helpers ────────────────────────────────────────────────────────

function _tmValue(name) {
  const map = {
    None:                THREE.NoToneMapping,
    Linear:              THREE.LinearToneMapping,
    Reinhard:            THREE.ReinhardToneMapping,
    Cineon:              THREE.CineonToneMapping,
    ACESFilmic:          THREE.ACESFilmicToneMapping,
    AgX:                 THREE.AgXToneMapping          ?? THREE.ACESFilmicToneMapping,
    NeutralToneMapping:  THREE.NeutralToneMapping      ?? THREE.ACESFilmicToneMapping,
  };
  return map[name] ?? THREE.ACESFilmicToneMapping;
}

function _smtValue(name) {
  const map = {
    Basic:   THREE.BasicShadowMap,
    PCF:     THREE.PCFShadowMap,
    PCFSoft: THREE.PCFSoftShadowMap,
    VSM:     THREE.VSMShadowMap,
  };
  return map[name] ?? THREE.PCFSoftShadowMap;
}
