//! Phase 10 — Engineering Notes IPC commands.
//! Reads and writes `.kimaster/notes.md` and `.kimaster/tasks.json`
//! for the currently open project.

use tauri::State;
use crate::AppState::KiMasterState;
use crate::modules::notes::{self, Task};

// ── Helpers ───────────────────────────────────────────────────────────────────

/// Extract the active project's `.kimaster/` directory from state,
/// returning an Err string if no project is open.
fn require_kimaster_dir(state: &State<'_, KiMasterState>) -> Result<String, String> {
    let inner = state.0.lock().map_err(|e| format!("State lock poisoned: {e}"))?;
    inner
        .active_project
        .as_ref()
        .and_then(|p| p.kimaster_dir.clone())
        .ok_or_else(|| "No project is open".to_string())
}

// ── IPC commands ──────────────────────────────────────────────────────────────

/// Read engineering notes from `.kimaster/notes.md`.
/// Returns the raw Markdown string (empty if file does not exist yet).
#[tauri::command]
pub async fn cmd_read_notes(state: State<'_, KiMasterState>) -> Result<String, String> {
    let dir = require_kimaster_dir(&state)?;
    notes::read_notes(&dir).map_err(|e| e.to_string())
}

/// Save engineering notes to `.kimaster/notes.md`.
/// `content` is the full Markdown text — caller sends complete content on every save.
#[tauri::command]
pub async fn cmd_save_notes(
    state: State<'_, KiMasterState>,
    content: String,
) -> Result<(), String> {
    let dir = require_kimaster_dir(&state)?;
    notes::save_notes(&dir, &content).map_err(|e| e.to_string())
}

/// Read the task list from `.kimaster/tasks.json`.
/// Returns `[]` if the file does not exist.
#[tauri::command]
pub async fn cmd_read_tasks(state: State<'_, KiMasterState>) -> Result<Vec<Task>, String> {
    let dir = require_kimaster_dir(&state)?;
    notes::read_tasks(&dir).map_err(|e| e.to_string())
}

/// Overwrite the task list in `.kimaster/tasks.json`.
/// Frontend sends the complete updated array.
#[tauri::command]
pub async fn cmd_save_tasks(
    state: State<'_, KiMasterState>,
    tasks: Vec<Task>,
) -> Result<(), String> {
    let dir = require_kimaster_dir(&state)?;
    notes::save_tasks(&dir, &tasks).map_err(|e| e.to_string())
}
