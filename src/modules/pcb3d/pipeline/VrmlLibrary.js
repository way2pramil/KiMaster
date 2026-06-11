/**
 * VrmlLibrary — Pipeline B.
 * Manages the persistent KiMaster 3D component model cache.
 *
 * Flow:
 *   1. cmd_pcb3d_export_vrml → components/*.wrl files on disk
 *   2. VRMLLoader loads each .wrl → THREE.Group
 *   3. Cached in-memory (by wrl path) for instant reuse across boards
 *   4. Each component group positioned using footprint at/scale/rotate from board state
 *
 * Cache grows with usage — same C0402 appearing in 50 boards loads once.
 */

import * as THREE          from 'three';
import { VRMLLoader }      from 'three/addons/loaders/VRMLLoader.js';
import { invoke }          from '../../../core/Ipc.js';
import { Logger }          from '../../../core/Logger.js';

export const PCB3D_EXPORT_VRML = 'cmd_pcb3d_export_vrml';
export const PCB3D_LIST_DIR    = 'cmd_pcb3d_list_dir';

/** In-memory geometry cache: wrl_path → THREE.BufferGeometry[] */
const _geoCache = new Map();
const _loader   = new VRMLLoader();

/**
 * Export component VRML files for a board via kicad-cli.
 * @param {string} pcbFile
 * @param {string} cacheDir
 * @returns {Promise<{ pcbWrl, componentsDir, success }>}
 */
export async function exportVrml(pcbFile, cacheDir) {
  try {
    // Tauri 2 maps snake_case Rust params to camelCase in JS
    const result = await invoke(PCB3D_EXPORT_VRML, {
      pcbFile:   pcbFile,
      outputDir: cacheDir,
    });
    return result;
  } catch (err) {
    Logger.warn('PCB3D:VrmlLibrary', 'VRML export failed', err);
    return { success: false };
  }
}

/**
 * Load a .wrl file as a THREE.Group.
 * Returns cached result if already loaded.
 * @param {string} wrlPath - absolute path
 * @returns {Promise<THREE.Group|null>}
 */
export async function loadWrl(wrlPath) {
  if (_geoCache.has(wrlPath)) {
    return _geoCache.get(wrlPath).clone();
  }

  const url = _toAssetUrl(wrlPath);
  return new Promise((resolve) => {
    _loader.load(
      url,
      (obj) => {
        _geoCache.set(wrlPath, obj);
        Logger.info('PCB3D:VrmlLibrary', `Loaded + cached: ${wrlPath.split(/[\\/]/).pop()}`);
        resolve(obj.clone());
      },
      null,
      (err) => {
        Logger.warn('PCB3D:VrmlLibrary', `Failed to load ${wrlPath}`, err);
        resolve(null);
      },
    );
  });
}

/**
 * Load all component WRL files from a directory and return a map ref→Object3D.
 * @param {string} componentsDir
 * @param {Array<{ref, position, rotation, model_path}>} footprints
 * @returns {Promise<Map<string, THREE.Object3D>>}
 */
export async function loadComponents(componentsDir, footprints) {
  const map     = new Map();
  const wrlFiles = await invoke(PCB3D_LIST_DIR, { dir: componentsDir, ext: 'wrl' }) // single-word params, no conversion
    .catch(() => []);

  // Load all WRL files in parallel (cached after first load)
  const loads = wrlFiles.map(async (wrlPath) => {
    const group = await loadWrl(wrlPath);
    if (group) {
      // kicad-cli names component WRLs after their reference designator
      const ref = wrlPath.replace(/\\/g, '/').split('/').pop().replace('.wrl', '');
      map.set(ref, group);
    }
  });

  await Promise.all(loads);
  Logger.info('PCB3D:VrmlLibrary', `Loaded ${map.size} component models`);
  return map;
}

/**
 * Position a component Object3D according to footprint data.
 * KiCad → Three.js coordinate transform: Y-flip, Z = board surface.
 */
export function positionComponent(obj, fp, boardThicknessZ) {
  if (!obj || !fp) return;

  const z = fp.on_back
    ? -(boardThicknessZ + 0.04)
    : (boardThicknessZ + 0.04);

  obj.position.set(fp.position.x, -fp.position.y, z);
  obj.rotation.z = (fp.rotation ?? 0) * Math.PI / 180;

  if (fp.on_back) {
    obj.rotation.x = Math.PI; // flip for bottom-side components
  }
}

function _toAssetUrl(p) {
  return window.__TAURI_INTERNALS__?.convertFileSrc
    ? window.__TAURI_INTERNALS__.convertFileSrc(p)
    : 'file:///' + p.replace(/\\/g, '/');
}
