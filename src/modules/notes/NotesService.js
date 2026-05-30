/**
 * NotesService — CRUD for engineering notes and project tasks.
 *
 * Backed by `.kimaster/notes.md` (Markdown) and `.kimaster/tasks.json`.
 * All persistence calls go through Ipc → Rust → filesystem.
 *
 * Rules:
 *  - Rule 1: no UI/component imports.
 *  - Rule 2: use AppCommands constants — never raw strings.
 *  - Rule 3: all errors through Logger, no silent catches.
 *
 * @module NotesService
 */

import { invoke } from '../../core/Ipc.js';
import { Logger  } from '../../core/Logger.js';
import {
  READ_NOTES, SAVE_NOTES,
  READ_TASKS, SAVE_TASKS,
} from '../../core/AppCommands.js';

const TAG = 'NotesService';

// ── Auto-save debounce ────────────────────────────────────────────────────────

/** @type {ReturnType<typeof setTimeout>|null} */
let _saveTimer = null;

/** @type {string} Last content flushed to disk — avoids no-op writes. */
let _lastSaved = null;

/**
 * Schedule an auto-save 800 ms after the last keystroke.
 * @param {string} content  Current Markdown content.
 * @param {(ts: string) => void} [onSaved]  Called with ISO timestamp on success.
 */
export function scheduleAutoSave(content, onSaved) {
  if (_saveTimer) clearTimeout(_saveTimer);
  _saveTimer = setTimeout(async () => {
    if (content === _lastSaved) return;   // nothing changed
    try {
      await saveNotes(content);
      _lastSaved = content;
      onSaved?.(new Date().toISOString());
    } catch (err) {
      Logger.error(TAG, 'Auto-save failed', err);
    }
  }, 800);
}

// ── Notes ─────────────────────────────────────────────────────────────────────

/**
 * Load notes Markdown from the active project.
 * @returns {Promise<string>}
 */
export async function loadNotes() {
  try {
    const content = await invoke(READ_NOTES);
    _lastSaved = content;
    return content ?? '';
  } catch (err) {
    Logger.error(TAG, 'Failed to load notes', err);
    return '';
  }
}

/**
 * Persist notes Markdown immediately.
 * @param {string} content
 * @returns {Promise<void>}
 */
export async function saveNotes(content) {
  await invoke(SAVE_NOTES, { content });
}

// ── Tasks ─────────────────────────────────────────────────────────────────────

/**
 * @typedef {{ id: string, text: string, done: boolean, created_at: string }} Task
 */

/**
 * Load task list from the active project.
 * @returns {Promise<Task[]>}
 */
export async function loadTasks() {
  try {
    const tasks = await invoke(READ_TASKS);
    return tasks ?? [];
  } catch (err) {
    Logger.error(TAG, 'Failed to load tasks', err);
    return [];
  }
}

/**
 * Persist the full task list immediately.
 * @param {Task[]} tasks
 * @returns {Promise<void>}
 */
export async function saveTasks(tasks) {
  await invoke(SAVE_TASKS, { tasks });
}

/**
 * Create a new task and persist.
 * @param {Task[]} existing  Current task array.
 * @param {string} text
 * @returns {Promise<Task[]>}  Updated array.
 */
export async function addTask(existing, text) {
  const task = {
    id: crypto.randomUUID(),
    text: text.trim(),
    done: false,
    created_at: new Date().toISOString(),
  };
  const updated = [...existing, task];
  await saveTasks(updated);
  return updated;
}

/**
 * Toggle a task's done state and persist.
 * @param {Task[]} existing
 * @param {string} id
 * @returns {Promise<Task[]>}
 */
export async function toggleTask(existing, id) {
  const updated = existing.map(t => t.id === id ? { ...t, done: !t.done } : t);
  await saveTasks(updated);
  return updated;
}

/**
 * Delete a task by id and persist.
 * @param {Task[]} existing
 * @param {string} id
 * @returns {Promise<Task[]>}
 */
export async function deleteTask(existing, id) {
  const updated = existing.filter(t => t.id !== id);
  await saveTasks(updated);
  return updated;
}
