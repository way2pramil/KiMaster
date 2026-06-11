/**
 * LayerExporter — Pipeline A step 1.
 * Calls Rust cmd_pcb3d_export_layers → 6 SVG files on disk.
 * Returns { dir, files: {FCu, BCu, FMask, BMask, FSilk, BSilk}, boardMm: {w,h} }
 */

import { invoke } from '../../../core/Ipc.js';
import { Logger }  from '../../../core/Logger.js';

export const PCB3D_EXPORT_LAYERS = 'cmd_pcb3d_export_layers';
export const PCB3D_LIST_DIR      = 'cmd_pcb3d_list_dir';

const LAYER_NAMES = ['F_Cu', 'B_Cu', 'F_Mask', 'B_Mask', 'F_SilkS', 'B_SilkS'];

/**
 * Export PCB layer SVGs via kicad-cli.
 * @param {string} pcbFile  - absolute path to .kicad_pcb
 * @param {string} cacheDir - where to write SVGs
 * @returns {Promise<LayerExportData|null>}
 */
export async function exportLayers(pcbFile, cacheDir) {
  try {
    // Tauri 2 maps snake_case Rust params to camelCase in JS
    const result = await invoke(PCB3D_EXPORT_LAYERS, {
      pcbFile:   pcbFile,
      outputDir: cacheDir,
    });

    if (!result?.success) {
      Logger.warn('PCB3D:LayerExporter', 'Layer export failed', result?.message);
      return null;
    }

    // Resolve actual file paths for each layer
    const allFiles = await invoke(PCB3D_LIST_DIR, { dir: cacheDir, ext: 'svg' }).catch(() => []); // 'dir'+'ext' are single-word — no camelCase needed
    const files = {};
    for (const name of LAYER_NAMES) {
      const match = allFiles.find(f => f.includes(name));
      if (match) files[name] = match;
    }

    Logger.info('PCB3D:LayerExporter', `Layers ready: ${Object.keys(files).join(', ')}`);
    return { dir: cacheDir, files };

  } catch (err) {
    Logger.error('PCB3D:LayerExporter', 'Export threw', err);
    return null;
  }
}
