//! ProjectCommands — Tauri IPC handlers for project management.
//!
//! Rule 3: Each handler is a thin wrapper. All business logic lives in
//! `modules/project/ProjectStore` and `modules/project/FileWatcher`.
//! Argument names must match the JS-side AppCommands.js documentation exactly.

use std::path::PathBuf;
use tauri::{AppHandle, Emitter, State};
#[allow(unused_imports)]
use std::path::Path;
use serde::{Deserialize, Serialize};

use crate::AppState::{KiMasterState, ProjectInfo};
use crate::modules::project::ProjectStore;
use crate::modules::project::FileWatcher;
use crate::modules::uce::LibraryVault;

// ── Return types ──────────────────────────────────────────────────────────────

#[derive(Serialize, Deserialize)]
pub struct OpenProjectResult {
    pub success: bool,
    pub project: Option<ProjectInfo>,
    pub message: String,
}

#[derive(Serialize, Deserialize)]
pub struct ProjectStateResponse {
    pub active_project: Option<ProjectInfo>,
}

// ── cmd_get_project_state ─────────────────────────────────────────────────────

/// Return the current active project info.
#[tauri::command]
pub fn cmd_get_project_state(
    state: State<'_, KiMasterState>,
) -> ProjectStateResponse {
    ProjectStateResponse {
        active_project: state.0.lock().unwrap().active_project.clone(),
    }
}

// ── cmd_open_project ──────────────────────────────────────────────────────────

/// Open a `.kicad_pro` file — provisions `.kimaster/`, opens SQLite, starts
/// file watcher, updates AppState.
///
/// JS arg: `{ pro_path: string }` (absolute path to the .kicad_pro file)
#[tauri::command(rename_all = "snake_case")]
pub fn cmd_open_project(
    app:      AppHandle,
    state:    State<'_, KiMasterState>,
    pro_path: String,
) -> OpenProjectResult {
    let path = PathBuf::from(&pro_path);

    if !path.exists() {
        return OpenProjectResult {
            success: false,
            project: None,
            message: format!("File not found: {pro_path}"),
        };
    }

    let name = path
        .file_stem()
        .and_then(|s| s.to_str())
        .unwrap_or("unknown")
        .to_string();

    let parent = match path.parent() {
        Some(p) => p.to_path_buf(),
        None => return OpenProjectResult {
            success: false,
            project: None,
            message: "Cannot determine project directory".into(),
        },
    };

    // Provision .kimaster/ directory
    let km_dir = match ProjectStore::provision_kimaster_dir(&path) {
        Ok(d) => d,
        Err(e) => return OpenProjectResult {
            success: false,
            project: None,
            message: format!("Cannot provision .kimaster/: {e}"),
        },
    };

    // Open SQLite + upsert recent (non-fatal if it fails)
    if let Err(e) = ProjectStore::open_db(&km_dir)
        .and_then(|conn| ProjectStore::upsert_recent(&conn, &pro_path, &name))
    {
        tracing::warn!("[ProjectCommands] DB error: {e}");
    }

    // Discover sibling PCB / schematic files
    let pcb_file = find_sibling(&parent, &name, "kicad_pcb");
    let sch_file = find_sibling(&parent, &name, "kicad_sch");

    let project = ProjectInfo {
        path:           pro_path.clone(),
        name:           name.clone(),
        pcb_file:       pcb_file.map(|p| p.to_string_lossy().into_owned()),
        schematic_file: sch_file.map(|p| p.to_string_lossy().into_owned()),
        kimaster_dir:   Some(km_dir.to_string_lossy().into_owned()),
        last_opened:    Some(now_secs()),
    };

    // Start file watcher — emit `project:file_changed` on save
    let app_clone = app.clone();
    let watcher = FileWatcher::start_watcher(&parent, move |changed| {
        tracing::info!("[FileWatcher] changed: {:?}", changed);
        let _ = app_clone.emit("project:file_changed", changed.to_string_lossy().as_ref());
    });

    // Provision project-local component vault inside .kimaster/
    let km_str = km_dir.to_string_lossy().into_owned();
    if let Err(e) = LibraryVault::provision_vault(&km_str) {
        tracing::warn!("[ProjectCommands] Project vault provision failed: {e}");
    }

    // Update AppState (drops old watcher, stopping it)
    {
        let mut guard = state.0.lock().unwrap();
        guard.active_project   = Some(project.clone());
        guard.file_watcher     = watcher.ok();
        guard.project_vault_dir = Some(km_str);
    }

    let _ = app.emit("project:opened", &project);

    OpenProjectResult {
        success: true,
        project: Some(project),
        message: format!("Opened: {name}"),
    }
}

// ── cmd_close_project ─────────────────────────────────────────────────────────

/// Close the active project — clears AppState and stops the file watcher.
#[tauri::command]
pub fn cmd_close_project(app: AppHandle, state: State<'_, KiMasterState>) {
    let mut guard = state.0.lock().unwrap();
    guard.active_project    = None;
    guard.file_watcher      = None;
    guard.project_vault_dir = None;
    drop(guard);
    let _ = app.emit("project:closed", ());
}

// ── cmd_get_recent_projects ───────────────────────────────────────────────────

/// Return up to 20 recent projects from the active project's DB.
#[tauri::command]
pub fn cmd_get_recent_projects(
    state: State<'_, KiMasterState>,
) -> Vec<ProjectStore::RecentProject> {
    let guard = state.0.lock().unwrap();
    let Some(proj) = &guard.active_project else { return vec![]; };
    let km_dir = match &proj.kimaster_dir {
        Some(d) => PathBuf::from(d),
        None    => return vec![],
    };
    drop(guard);

    match ProjectStore::open_db(&km_dir).and_then(|c| ProjectStore::get_recent(&c, 20)) {
        Ok(list) => list,
        Err(e) => {
            tracing::warn!("[ProjectCommands] get_recent: {e}");
            vec![]
        }
    }
}

// ── cmd_pick_and_open_project ─────────────────────────────────────────────────

/// Show native file picker → open the chosen `.kicad_pro`.
/// Uses synchronous rfd::FileDialog on a dedicated thread to avoid Tauri async
/// State lifetime constraints (async commands with State refs must return Result).
#[tauri::command]
pub fn cmd_pick_and_open_project(
    app:   AppHandle,
    state: State<'_, KiMasterState>,
) -> OpenProjectResult {
    // Run blocking dialog on its own thread so we don't block the main thread.
    let picked = std::thread::spawn(|| {
        rfd::FileDialog::new()
            .set_title("Open KiCad Project")
            .add_filter("KiCad Project", &["kicad_pro"])
            .pick_file()
    })
    .join()
    .ok()
    .flatten();

    match picked {
        Some(path) => cmd_open_project(app, state, path.to_string_lossy().into_owned()),
        None => OpenProjectResult {
            success: false,
            project: None,
            message: "No file selected".into(),
        },
    }
}

// ── Helpers ───────────────────────────────────────────────────────────────────

fn find_sibling(dir: &std::path::Path, stem: &str, ext: &str) -> Option<PathBuf> {
    let p = dir.join(format!("{stem}.{ext}"));
    if p.exists() { Some(p) } else { None }
}

fn now_secs() -> String {
    use std::time::{SystemTime, UNIX_EPOCH};
    SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .unwrap_or_default()
        .as_secs()
        .to_string()
}
