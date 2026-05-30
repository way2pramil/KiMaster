/**
 * ProjectService — open, close, and manage KiCad projects.
 *
 * Rule 2: All command strings imported from AppCommands.
 * Rule 3: No silent catches — all errors surfaced via Logger.
 * Rule 1: No UI imports — sidebar updates via store subscription in main.js.
 *
 * @module ProjectService
 */

import { invoke, invokeNow } from '../../core/Ipc.js';
import { store } from '../../core/State.js';
import { Logger } from '../../core/Logger.js';
import {
  GET_PROJECT_STATE,
  OPEN_PROJECT,
  CLOSE_PROJECT,
  GET_RECENT_PROJECTS,
  PICK_AND_OPEN_PROJECT,
} from '../../core/AppCommands.js';
import {
  PROJECT_OPENED,
  PROJECT_CLOSED,
  PROJECT_FILE_CHANGED,
} from '../../core/AppEvents.js';

// ── Types ─────────────────────────────────────────────────────────────────────

/**
 * @typedef {Object} ProjectInfo
 * @property {string}      path
 * @property {string}      name
 * @property {string|null} pcb_file
 * @property {string|null} schematic_file
 * @property {string|null} kimaster_dir
 * @property {string|null} last_opened
 */

/**
 * @typedef {Object} OpenProjectResult
 * @property {boolean}          success
 * @property {ProjectInfo|null} project
 * @property {string}           message
 */

// ── Tauri event listeners (call once at boot) ─────────────────────────────────

let _listenersInitialised = false;

/**
 * Register Tauri event listeners for project lifecycle events.
 * Idempotent — safe to call multiple times.
 */
export async function initProjectListeners() {
  if (_listenersInitialised) return;
  _listenersInitialised = true;

  if (!window.__TAURI_INTERNALS__) {
    Logger.info('ProjectService', 'Browser mode — skipping Tauri event listeners');
    return;
  }

  try {
    const { listen } = await import('@tauri-apps/api/event');

    await listen(PROJECT_OPENED, (e) => {
      Logger.info('ProjectService', 'project:opened', e.payload?.name);
      store.project = e.payload ?? null;
    });

    await listen(PROJECT_CLOSED, () => {
      Logger.info('ProjectService', 'project:closed');
      store.project = null;
    });

    await listen(PROJECT_FILE_CHANGED, (e) => {
      Logger.debug('ProjectService', 'project:file_changed', e.payload);
      // Signal to Bridge that board state may have changed
      store.projectFileChanged = e.payload;
    });
  } catch (err) {
    Logger.error('ProjectService', err, 'initProjectListeners failed');
  }
}

// ── Commands ──────────────────────────────────────────────────────────────────

/**
 * Load current project state from the Rust backend into the store.
 * Called once at boot — subsequent updates come via Tauri events.
 * @returns {Promise<ProjectInfo|null>}
 */
export async function loadProjectState() {
  try {
    const resp = await invoke(GET_PROJECT_STATE);
    store.project = resp?.active_project ?? null;
    return store.project;
  } catch (err) {
    Logger.error('ProjectService', err, 'loadProjectState failed');
    return null;
  }
}

/**
 * Open a KiCad project by its `.kicad_pro` file path.
 * The backend provisions `.kimaster/`, opens SQLite, and starts the file watcher.
 * @param {string} proPath  Absolute path to the `.kicad_pro` file.
 * @returns {Promise<OpenProjectResult>}
 */
export async function openProject(proPath) {
  try {
    const result = await invokeNow(OPEN_PROJECT, { pro_path: proPath });
    if (result.success) {
      store.project = result.project;
      Logger.info('ProjectService', `Opened: ${result.project?.name}`);
    } else {
      Logger.warn('ProjectService', `Open failed: ${result.message}`);
    }
    return result;
  } catch (err) {
    Logger.error('ProjectService', err, `openProject(${proPath})`);
    return { success: false, project: null, message: String(err?.message ?? err) };
  }
}

/**
 * Show a native OS file picker and open the selected `.kicad_pro` file.
 * @returns {Promise<OpenProjectResult>}
 */
export async function pickAndOpenProject() {
  try {
    const result = await invokeNow(PICK_AND_OPEN_PROJECT);
    if (result.success) {
      store.project = result.project;
      Logger.info('ProjectService', `Picked & opened: ${result.project?.name}`);
    }
    return result;
  } catch (err) {
    Logger.error('ProjectService', err, 'pickAndOpenProject failed');
    return { success: false, project: null, message: String(err?.message ?? err) };
  }
}

/**
 * Close the active project.
 * Stops the file watcher and clears AppState on the Rust side.
 * @returns {Promise<void>}
 */
export async function closeProject() {
  try {
    await invokeNow(CLOSE_PROJECT);
    store.project = null;
    Logger.info('ProjectService', 'Project closed');
  } catch (err) {
    Logger.error('ProjectService', err, 'closeProject failed');
  }
}

/**
 * Fetch recent projects from the active project's SQLite DB.
 * @returns {Promise<Array<{path:string, name:string, last_opened:string}>>}
 */
export async function getRecentProjects() {
  try {
    return await invoke(GET_RECENT_PROJECTS) ?? [];
  } catch (err) {
    Logger.error('ProjectService', err, 'getRecentProjects failed');
    return [];
  }
}
