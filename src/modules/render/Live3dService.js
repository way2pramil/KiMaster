/**
 * Live3dService — GLB export helper for the live 3D viewer.
 *
 * Wraps cmd_pcb3d_export_marketing_glb.
 * Output lands in <kimaster_dir>/live3d/<board>.glb  (or next to the PCB file).
 *
 * @module Live3dService
 */

import { invoke } from '../../core/Ipc.js';
import { Logger  } from '../../core/Logger.js';
import { store   } from '../../core/State.js';
import { PCB3D_EXPORT_MARKETING_GLB } from '../../core/AppCommands.js';

const TAG = 'Live3dService';

function _activePcb() {
  return store.boardState?.board_name ?? store.project?.pcb_file ?? null;
}

function _outDir() {
  if (store.project?.kimaster_dir) {
    const sep = store.project.kimaster_dir.includes('\\') ? '\\' : '/';
    return `${store.project.kimaster_dir}${sep}live3d`;
  }
  const pcb = _activePcb();
  if (!pcb) return null;
  const sep = pcb.includes('\\') ? '\\' : '/';
  return pcb.split(sep).slice(0, -1).join(sep) + `${sep}.kimaster_live3d`;
}

/**
 * Export the active board as a binary GLTF (.glb) for interactive viewing.
 * KiCad 10 only — kicad-cli pcb export glb.
 * This can take 30 s – 5 min on large boards.
 *
 * @param {{ substModels?: boolean, noDnp?: boolean }} [opts]
 * @returns {Promise<{ success: boolean, output_file: string, message: string }>}
 */
export async function exportGlbForViewer(opts = {}) {
  const pcbFile = _activePcb();
  if (!pcbFile) {
    return { success: false, output_file: '', message: 'No PCB file — open a project or connect the bridge.' };
  }
  const dir = _outDir();
  if (!dir) {
    return { success: false, output_file: '', message: 'Cannot determine output directory.' };
  }
  const sep      = pcbFile.includes('\\') ? '\\' : '/';
  const board    = pcbFile.split(sep).pop().replace(/\.kicad_pcb$/i, '');
  const outFile  = `${dir}${sep}${board}.glb`;

  try {
    const res = await invoke(PCB3D_EXPORT_MARKETING_GLB, {
      args: {
        pcb_file:     pcbFile,
        output_file:  outFile,
        subst_models: opts.substModels ?? true,
        no_dnp:       opts.noDnp      ?? false,
      },
    });
    return {
      success:     res?.success ?? false,
      output_file: res?.output_file ?? outFile,
      message:     res?.message ?? '',
    };
  } catch (err) {
    Logger.error(TAG, 'exportGlbForViewer failed', err);
    return { success: false, output_file: '', message: String(err) };
  }
}

/**
 * Convert an absolute filesystem path to a URL loadable by the webview.
 * @param {string} path
 * @returns {string}
 */
export function toViewerUrl(path) {
  if (!path) return '';
  if (window.__TAURI_INTERNALS__?.convertFileSrc) {
    try { return window.__TAURI_INTERNALS__.convertFileSrc(path); }
    catch { /* fall through */ }
  }
  return 'file:///' + path.replace(/\\/g, '/');
}
