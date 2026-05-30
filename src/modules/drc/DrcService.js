/**
 * DRC (Design Rule Check) service.
 * Calls the Rust kicad-cli backend and manages result state.
 *
 * @module DrcService
 */

import { invoke } from '../../core/Ipc.js';
import { store } from '../../core/State.js';
import { Logger } from '../../core/Logger.js';
import { RUN_DRC, RUN_ERC } from '../../core/AppCommands.js';

/**
 * @typedef {Object} DrcViolation
 * @property {string} description
 * @property {string} severity       - "error" | "warning"
 * @property {string} violation_type - e.g. "clearance", "courtyard_overlap"
 * @property {Array<{ description: string, pos: { x: number, y: number }, uuid: string }>} items
 */

/**
 * @typedef {Object} DrcReport
 * @property {string} kicad_version
 * @property {string} source
 * @property {string} date
 * @property {DrcViolation[]} violations
 * @property {DrcViolation[]} unconnected_items
 * @property {DrcViolation[]} schematic_parity
 */

/**
 * @typedef {Object} DrcResult
 * @property {DrcReport|null} report
 * @property {{ exit_code: number, stdout: string, stderr: string, success: boolean }} raw
 * @property {string|null} output_file
 */

/**
 * Run DRC on the given PCB file (or active project's PCB).
 * Updates store.drcStatus, store.drcErrors, store.drcResult.
 * @param {string} [pcbFile] - Override PCB path. Uses active project if omitted.
 * @returns {Promise<DrcResult>}
 */
export async function runDrc(pcbFile) {
  const pcb = pcbFile || store.project?.pcbFile;
  if (!pcb) {
    throw new Error('No PCB file specified and no active project');
  }

  store.drcStatus = 'running';
  store.drcErrors = [];
  store.drcResult = null;

  try {
    /** @type {DrcResult} */
    /** @type {DrcResult} */
    const result = await invoke(RUN_DRC, { args: { pcb_file: pcb } });
    store.drcResult = result;

    if (result.report) {
      // Flatten all violation arrays into one list for the UI
      const all = [
        ...(result.report.violations || []),
        ...(result.report.unconnected_items || []),
        ...(result.report.schematic_parity || []),
      ];
      store.drcErrors = all;
      store.drcStatus = 'done';
    } else {
      store.drcStatus = 'error';
    }

    return result;
  } catch (err) {
    store.drcStatus = 'error';
    throw err;
  }
}

/**
 * Run ERC on the given schematic file (or active project's schematic).
 * @param {string} [schFile] - Override schematic path. Uses active project if omitted.
 * @returns {Promise<any>}
 */
export async function runErc(schFile) {
  const sch = schFile || store.project?.schematicFile;
  if (!sch) {
    throw new Error('No schematic file specified and no active project');
  }

  store.ercStatus = 'running';
  store.ercErrors = [];
  store.ercResult = null;

  try {
    const result = await invoke(RUN_ERC, { args: { sch_file: sch } });
    store.ercResult = result;

    if (result.report) {
      const all = result.report.sheets?.flatMap(s => s.violations || []) || [];
      store.ercErrors = all;
      store.ercStatus = 'done';
    } else {
      store.ercStatus = 'error';
    }

    return result;
  } catch (err) {
    store.ercStatus = 'error';
    throw err;
  }
}

// ── Auto-DRC on save ──────────────────────────────────────────────────────────

let _autoDrcTimer = null;

/**
 * Debounced auto-DRC triggered by the file watcher on `.kicad_pcb` save.
 * Safe to call on every file-change event — skips if DRC already running.
 * Returns { newErrors, fixedErrors } for notification logic in main.js.
 *
 * @param {string} pcbFile  Absolute path to the saved .kicad_pcb file.
 * @returns {Promise<{newErrors:number, fixedErrors:number}|null>}
 */
export function autoDrcOnChange(pcbFile) {
  // Debounce: wait 1s after last change event before running
  if (_autoDrcTimer) clearTimeout(_autoDrcTimer);

  return new Promise((resolve) => {
    _autoDrcTimer = setTimeout(async () => {
      _autoDrcTimer = null;

      if (store.drcStatus === 'running') {
        Logger.debug('DrcService', 'Auto-DRC skipped — already running');
        resolve(null);
        return;
      }

      const prevErrorCount = (store.drcErrors ?? []).filter(v => v.severity === 'error').length;

      try {
        Logger.info('DrcService', `Auto-DRC triggered by file save: ${pcbFile}`);
        await runDrc(pcbFile);

        const newErrorCount = (store.drcErrors ?? []).filter(v => v.severity === 'error').length;
        resolve({
          newErrors:   Math.max(0, newErrorCount - prevErrorCount),
          fixedErrors: Math.max(0, prevErrorCount - newErrorCount),
        });
      } catch (err) {
        Logger.error('DrcService', err, 'Auto-DRC failed');
        resolve(null);
      }
    }, 1000);
  });
}

/** @returns {number} count of DRC errors (severity === 'error') */
export function errorCount() {
  return store.drcErrors.filter(v => v.severity === 'error').length;
}

/** @returns {number} count of DRC warnings */
export function warningCount() {
  return store.drcErrors.filter(v => v.severity === 'warning').length;
}

/** @returns {number} total DRC violations */
export function totalCount() {
  return store.drcErrors.length;
}
