//! Engineering Notes module — pure Rust, zero Tauri imports.
//!
//! Reads and writes two files inside the `.kimaster/` project directory:
//!   - `notes.md`  — free-form Markdown engineering notes
//!   - `tasks.json` — project-local checklist tasks
//!
//! Both operations are synchronous (called from async IPC handlers via spawn_blocking).

use serde::{Deserialize, Serialize};
use std::fs;
use std::path::{Path, PathBuf};

// ── Types ─────────────────────────────────────────────────────────────────────

/// A single checklist task stored in `.kimaster/tasks.json`.
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct Task {
    /// UUID-style unique identifier, generated on creation.
    pub id: String,
    /// Task description text (plain text, no Markdown in tasks).
    pub text: String,
    /// Whether the task has been checked off.
    pub done: bool,
    /// ISO-8601 creation timestamp.
    pub created_at: String,
}

// ── Notes (notes.md) ─────────────────────────────────────────────────────────

/// Returns the path to `<kimaster_dir>/notes.md`.
fn notes_path(kimaster_dir: &str) -> PathBuf {
    Path::new(kimaster_dir).join("notes.md")
}

/// Read engineering notes. Returns empty string if the file does not yet exist.
pub fn read_notes(kimaster_dir: &str) -> anyhow::Result<String> {
    let path = notes_path(kimaster_dir);
    if !path.exists() {
        return Ok(String::new());
    }
    let content = fs::read_to_string(&path)?;
    Ok(content)
}

/// Write engineering notes. Creates the file (and parent directory) if needed.
pub fn save_notes(kimaster_dir: &str, content: &str) -> anyhow::Result<()> {
    let dir = Path::new(kimaster_dir);
    if !dir.exists() {
        fs::create_dir_all(dir)?;
    }
    fs::write(notes_path(kimaster_dir), content)?;
    Ok(())
}

// ── Tasks (tasks.json) ────────────────────────────────────────────────────────

/// Returns the path to `<kimaster_dir>/tasks.json`.
fn tasks_path(kimaster_dir: &str) -> PathBuf {
    Path::new(kimaster_dir).join("tasks.json")
}

/// Read tasks list. Returns an empty Vec if the file does not yet exist.
pub fn read_tasks(kimaster_dir: &str) -> anyhow::Result<Vec<Task>> {
    let path = tasks_path(kimaster_dir);
    if !path.exists() {
        return Ok(Vec::new());
    }
    let json = fs::read_to_string(&path)?;
    let tasks: Vec<Task> = serde_json::from_str(&json)?;
    Ok(tasks)
}

/// Write the full tasks list (replaces file entirely — frontend sends complete array).
pub fn save_tasks(kimaster_dir: &str, tasks: &[Task]) -> anyhow::Result<()> {
    let dir = Path::new(kimaster_dir);
    if !dir.exists() {
        fs::create_dir_all(dir)?;
    }
    let json = serde_json::to_string_pretty(tasks)?;
    fs::write(tasks_path(kimaster_dir), json)?;
    Ok(())
}
