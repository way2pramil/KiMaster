/**
 * ExportProfileService — Rust-backed export profile CRUD + token resolver.
 *
 * Built-in templates (KiMaster Universal, JLCPCB, PCBWay, Global) are served
 * from compiled-in Rust constants. User profiles persist as JSON files in
 * {app_config_dir}/kimaster/export-profiles/.
 *
 * Falls back to BUILTIN_PROFILES from ExportConfigDefaults.js in browser dev mode.
 *
 * @module ExportProfileService
 */

import { store } from '../../core/State.js';
import { invoke } from '../../core/Ipc.js';
import { EXPORT_PROFILES } from '../../core/AppKeys.js';
import {
  EXPORT_PREPARE_DIR, OPEN_DIRECTORY,
  EXPORT_PROFILE_LIST, EXPORT_PROFILE_LOAD,
  EXPORT_PROFILE_SAVE, EXPORT_PROFILE_DELETE,
  EXPORT_PROFILE_CLONE,
} from '../../core/AppCommands.js';
import { BUILTIN_PROFILES, mergeConfig } from './ExportConfigDefaults.js';

// ── Output type labels ────────────────────────────────────────────────────────

/** Maps export card IDs → folder name used in path patterns. */
export const OUTPUT_TYPE_LABELS = {
  gerbers: 'Gerbers',
  drill:   'Drill',
  pos:     'Assembly',
  svg:     'SVG',
  pdf:     'PCB_PDF',
  bom:     'BOM',
  sch_pdf: 'Sch_PDF',
  sch_svg: 'Sch_SVG',
  step:    'STEP',
};

// ── Profile CRUD (Rust-backed, localStorage fallback) ─────────────────────────

/**
 * List all profiles — built-ins first, then user profiles.
 * @returns {Promise<Array<{ id, name, is_builtin }>>}
 */
export async function listProfiles() {
  try {
    return await invoke(EXPORT_PROFILE_LIST);
  } catch {
    // Browser mode: return built-in list from JS constants
    return BUILTIN_PROFILES.map(p => ({ id: p.id, name: p.name, is_builtin: true }));
  }
}

/**
 * Load a full profile object by id.
 * @param {string} id
 * @returns {Promise<object>}
 */
export async function loadProfile(id) {
  try {
    return await invoke(EXPORT_PROFILE_LOAD, { args: { id } });
  } catch {
    const found = BUILTIN_PROFILES.find(p => p.id === id);
    if (found) return found;
    // User profile from localStorage fallback
    try {
      const raw = localStorage.getItem(`${EXPORT_PROFILES}_${id}`);
      return raw ? JSON.parse(raw) : BUILTIN_PROFILES[0];
    } catch {
      return BUILTIN_PROFILES[0];
    }
  }
}

/**
 * Save a user profile (must not be a built-in).
 * @param {object} profile
 * @returns {Promise<{ id: string }>}
 */
export async function saveProfile(profile) {
  try {
    return await invoke(EXPORT_PROFILE_SAVE, { args: { profile } });
  } catch {
    // localStorage fallback
    localStorage.setItem(`${EXPORT_PROFILES}_${profile.id}`, JSON.stringify(profile));
    return { id: profile.id };
  }
}

/**
 * Delete a user profile by id.
 * @param {string} id
 */
export async function deleteProfile(id) {
  try {
    await invoke(EXPORT_PROFILE_DELETE, { args: { id } });
  } catch {
    localStorage.removeItem(`${EXPORT_PROFILES}_${id}`);
  }
}

/**
 * Clone a built-in profile into a new user-owned profile.
 * @param {string} builtinId
 * @param {string} name
 * @returns {Promise<object>}  the cloned profile
 */
export async function cloneBuiltinProfile(builtinId, name) {
  try {
    return await invoke(EXPORT_PROFILE_CLONE, { args: { builtin_id: builtinId, name } });
  } catch {
    const src = BUILTIN_PROFILES.find(p => p.id === builtinId) ?? BUILTIN_PROFILES[0];
    const cloned = { ...src, id: `user_${builtinId}`, name, is_builtin: false };
    await saveProfile(cloned).catch(() => {});
    return cloned;
  }
}

/**
 * Build the initial configs object for a profile — merges profile.configs
 * with EXPORT_TYPE_DEFAULTS so all keys are always present.
 * @param {object} profile
 * @returns {object}  { gerbers, drill, pos, svg, pdf, bom, sch_pdf, sch_svg, step }
 */
export function buildConfigs(profile) {
  const typeIds = ['gerbers','drill','pos','svg','pdf','bom','sch_pdf','sch_svg','step'];
  const result = {};
  for (const id of typeIds) {
    result[id] = mergeConfig(id, profile?.configs);
  }
  return result;
}

// ── Token resolver ────────────────────────────────────────────────────────────

/**
 * Resolve the full output directory path for a given export type.
 * @param {object} profile
 * @param {{ variant: string, version: string }} context
 * @param {string} outputTypeId
 * @returns {string}
 */
export function resolveOutputDir(profile, context, outputTypeId) {
  const board = store.bridgeBoardName || '';
  if (!board) return '';

  const lastSlash = Math.max(board.lastIndexOf('/'), board.lastIndexOf('\\'));
  const projectDir  = board.substring(0, lastSlash);
  const projectName = board.substring(lastSlash + 1).replace(/\.kicad_pcb$/i, '');

  const root = profile.target === 'project_relative'
    ? `${projectDir}/${profile.rootPath || 'exports'}`
    : (profile.rootPath || '.');

  const timestamp = new Date().toISOString().slice(0, 16).replace(/[T:]/g, '-');

  let pattern = profile.pattern || '{output_type}';
  pattern = pattern.replaceAll('{project_name}', projectName);
  pattern = pattern.replaceAll('{project_dir}',  projectDir);
  pattern = pattern.replaceAll('{variant}',      context.variant  || 'Default');
  pattern = pattern.replaceAll('{version}',      context.version  || 'v1');
  pattern = pattern.replaceAll('{output_type}',  OUTPUT_TYPE_LABELS[outputTypeId] || outputTypeId);
  pattern = pattern.replaceAll('{timestamp}',    timestamp);

  return `${root}/${pattern}`.replace(/\/+/g, '/');
}

// ── Directory preparation ─────────────────────────────────────────────────────

/** Ask Rust to prepare the output directory. */
export function prepareDir(path, mode) {
  return invoke(EXPORT_PREPARE_DIR, { args: { path, mode } });
}

/** Open the output directory in the OS file explorer. */
export function openOutputDir(path) {
  return invoke(OPEN_DIRECTORY, { path });
}
