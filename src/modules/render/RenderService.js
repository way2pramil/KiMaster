/**
 * RenderService — 3D PCB render client (Phase 11 — D1).
 *
 * Wraps the `kicad-cli pcb render` IPC commands.
 * Output files land in `.kimaster/renders/<timestamp>/render_<side>.png`.
 *
 * Rules: Rule 1 (no UI imports), Rule 2 (AppCommands constants), Rule 3 (Logger).
 *
 * @module RenderService
 */

import { invoke } from '../../core/Ipc.js';
import { Logger  } from '../../core/Logger.js';
import { store   } from '../../core/State.js';
import { RENDER_PCB, RENDER_ALL_SIDES } from '../../core/AppCommands.js';

const TAG = 'RenderService';

/**
 * @typedef {'top'|'bottom'|'front'|'back'|'left'|'right'|
 *           'top_front'|'top_back'|'bottom_front'|'bottom_back'} RenderSide
 *
 * @typedef {Object} RenderOptions
 * @property {RenderSide} [side='top']
 * @property {number}  [width_px=1280]
 * @property {number}  [height_px=720]
 * @property {'default'|'transparent'|'opaque'} [background='default']
 * @property {'basic'|'high'|'user'}            [quality='high']
 * @property {number}  [zoom]
 * @property {boolean} [floor]
 * @property {boolean} [perspective=true]
 * @property {string}  [preset='follow_pcb_editor']
 */

/**
 * Compute a `.kimaster/renders/<ts>/` directory for a fresh render batch.
 * Returns null if no project is open.
 * @returns {string|null}
 */
function renderDir() {
  const proj = store.project;
  if (!proj?.kimaster_dir) return null;
  const stamp = new Date().toISOString().replace(/[:.]/g, '-').slice(0, 19);
  const sep = proj.kimaster_dir.includes('\\') ? '\\' : '/';
  return `${proj.kimaster_dir}${sep}renders${sep}${stamp}`;
}

/**
 * Render a single view of the active project's PCB.
 * @param {RenderOptions} [options]
 * @returns {Promise<{ success: boolean, output_path: string, message: string }>}
 */
export async function renderSide(options = {}) {
  const proj = store.project;
  if (!proj?.pcb_file) {
    return { success: false, output_path: '', message: 'No project / PCB file' };
  }
  const dir  = renderDir();
  const side = options.side ?? 'top';
  const sep  = proj.pcb_file.includes('\\') ? '\\' : '/';
  const outFile = `${dir}${sep}render_${side}.png`;

  try {
    const res = await invoke(RENDER_PCB, {
      pcb_file:    proj.pcb_file,
      output_file: outFile,
      side,
      width_px:    options.width_px    ?? 1280,
      height_px:   options.height_px   ?? 720,
      background:  options.background  ?? 'default',
      quality:     options.quality     ?? 'high',
      zoom:        options.zoom,
      floor:       options.floor,
      perspective: options.perspective ?? true,
      preset:      options.preset      ?? 'follow_pcb_editor',
    });
    return {
      success:     res?.raw?.success ?? true,
      output_path: res?.output_path ?? outFile,
      message:     res?.raw?.stderr || 'Rendered.',
    };
  } catch (err) {
    Logger.error(TAG, 'renderSide failed', err);
    return { success: false, output_path: outFile, message: String(err) };
  }
}

/**
 * Render the 6 standard board views in parallel.
 * @param {Partial<RenderOptions> & { sides?: RenderSide[] }} [options]
 * @returns {Promise<{ success: boolean, output_dir: string, files: string[], failures: string[], message: string }>}
 */
export async function renderAllSides(options = {}) {
  const proj = store.project;
  if (!proj?.pcb_file) {
    return { success: false, output_dir: '', files: [], failures: ['no project'], message: 'No project / PCB file' };
  }
  const dir = renderDir();
  try {
    return await invoke(RENDER_ALL_SIDES, {
      pcb_file:   proj.pcb_file,
      output_dir: dir,
      sides:      options.sides ?? [],
      width_px:   options.width_px   ?? 1280,
      height_px:  options.height_px  ?? 720,
      quality:    options.quality    ?? 'high',
      background: options.background ?? 'default',
    });
  } catch (err) {
    Logger.error(TAG, 'renderAllSides failed', err);
    return { success: false, output_dir: dir ?? '', files: [], failures: [String(err)], message: String(err) };
  }
}
