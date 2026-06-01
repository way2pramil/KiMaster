/**
 * UceService — Unified Component Engine client (Phase 9B).
 *
 * Talks to the Rust UCE backend over Tauri IPC. The backend:
 *   1. Fetches raw EasyEDA JSON via HTTPS (no Python).
 *   2. Parses the tilde-delimited data string in pure Rust.
 *   3. Runs the Brand Sanitizer rule engine.
 *   4. Generates `.kicad_sym` / `.kicad_mod` S-expressions natively.
 *   5. Writes them to the global `<app_data>/vault/library/` (project-independent).
 *
 * Rules:
 *   - Rule 1: no UI imports
 *   - Rule 2: all command strings from AppCommands
 *   - Rule 3: all errors through Logger
 *
 * @module UceService
 */

import { invoke } from '../../core/Ipc.js';
import { Logger } from '../../core/Logger.js';
import {
  UCE_SEARCH, UCE_PREVIEW_COMPONENT,
  UCE_ADD_TO_VAULT, UCE_GET_VAULT, UCE_REMOVE_FROM_VAULT,
} from '../../core/AppCommands.js';

const TAG = 'UceService';

/**
 * @typedef {Object} UceSearchItem
 * @property {string} lcsc
 * @property {string} name
 * @property {string} package
 * @property {string} description
 * @property {number} stock
 * @property {number|null} price
 * @property {string} part_type        Basic | Extended
 * @property {string} datasheet
 * @property {string} category
 * @property {boolean} in_vault
 */

/**
 * @typedef {Object} UceComponentPreview
 * @property {string} lcsc_id
 * @property {string} title
 * @property {string} package
 * @property {string} manufacturer
 * @property {string} mpn
 * @property {string} datasheet
 * @property {number} pin_count
 * @property {number} pad_count
 * @property {boolean} has_symbol
 * @property {boolean} has_footprint
 * @property {boolean} in_vault
 */

/**
 * @typedef {Object} VaultEntry
 * @property {string} lcsc_id
 * @property {string} name
 * @property {string} package
 * @property {string} manufacturer
 * @property {string} mpn
 * @property {string} description
 * @property {string} added_at
 */

/**
 * Search JLCPCB/LCSC parts catalogue.
 * @param {string} keyword
 * @param {number} [page=1]
 * @returns {Promise<{ total: number, results: UceSearchItem[] }>}
 */
export async function searchComponents(keyword, page = 1) {
  if (!keyword || !keyword.trim()) return { total: 0, results: [] };
  try {
    return await invoke(UCE_SEARCH, { keyword: keyword.trim(), page });
  } catch (err) {
    Logger.error(TAG, 'searchComponents failed', err);
    return { total: 0, results: [] };
  }
}

/**
 * Fetch & parse component preview (no vault write).
 * @param {string} lcscId
 * @returns {Promise<UceComponentPreview|null>}
 */
export async function previewComponent(lcscId) {
  try {
    return await invoke(UCE_PREVIEW_COMPONENT, { lcsc_id: lcscId });
  } catch (err) {
    Logger.error(TAG, 'previewComponent failed', err);
    return null;
  }
}

/**
 * Add component to vault (write .kicad_sym entry + .kicad_mod file).
 * @param {string} lcscId
 * @param {object|null} ppConfig  Post-processing config from Advanced panel (null = Rust defaults)
 */
export async function addToVault(lcscId, ppConfig = null) {
  const t0 = performance.now();
  try {
    const r = await invoke(UCE_ADD_TO_VAULT, {
      lcsc_id:   lcscId,
      pp_config: ppConfig ?? undefined,
    });
    const ui_ms = Math.round(performance.now() - t0);
    // Log timing breakdown to DevTools console
    if (r?.timings) {
      const t = r.timings;
      console.groupCollapsed(
        `%c[KiMaster UCE] ${lcscId} — ${t.total_ms}ms total`,
        'color:#4ade80;font-weight:600'
      );
      console.table({
        'Fetch (EasyEDA + JLCPCB parallel)': { ms: t.fetch_ms },
        'Parse + post-process':              { ms: t.parse_ms },
        '3D model download':                 { ms: t.model_ms, cached: t.model_cached },
        'S-expression generate':             { ms: t.generate_ms },
        'Vault write (disk)':                { ms: t.write_ms },
        'Total (Rust)':                      { ms: t.total_ms },
        'Total (UI round-trip)':             { ms: ui_ms },
      });
      console.groupEnd();
    }
    return r;
  } catch (err) {
    Logger.error(TAG, 'addToVault failed', err);
    return { success: false, lcsc_id: lcscId, sym_path: '', mod_path: '', message: String(err) };
  }
}

/**
 * Bulk add: queue multiple LCSC IDs and report aggregate results.
 * @param {string[]} lcscIds
 * @param {(progress: { current: number, total: number, lcsc: string, success: boolean }) => void} [onProgress]
 * @returns {Promise<{ added: string[], failed: { lcsc: string, message: string }[] }>}
 */
export async function bulkAddToVault(lcscIds, onProgress) {
  const added  = [];
  const failed = [];
  const total  = lcscIds.length;
  for (let i = 0; i < total; i++) {
    const lcsc = lcscIds[i];
    const r = await addToVault(lcsc);
    if (r.success) added.push(lcsc);
    else           failed.push({ lcsc, message: r.message });
    onProgress?.({ current: i + 1, total, lcsc, success: r.success });
  }
  return { added, failed };
}

/**
 * Get all vault entries (global — works without an open project).
 * @returns {Promise<VaultEntry[]>}
 */
export async function getVault() {
  try {
    return await invoke(UCE_GET_VAULT);
  } catch (err) {
    Logger.error(TAG, 'getVault failed', err);
    return [];
  }
}

/**
 * Remove a component from the vault.
 * @param {string} lcscId
 * @returns {Promise<boolean>}
 */
export async function removeFromVault(lcscId) {
  try {
    await invoke(UCE_REMOVE_FROM_VAULT, { lcsc_id: lcscId });
    return true;
  } catch (err) {
    Logger.error(TAG, 'removeFromVault failed', err);
    return false;
  }
}
