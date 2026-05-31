//! Tauri-managed application state. Arc<Mutex<>> wraps all mutable data.

use serde::{Deserialize, Serialize};
use std::sync::Mutex;
use tokio::sync::mpsc::UnboundedSender;
use notify::RecommendedWatcher;

use crate::modules::bridge::WsClient::BridgeCmd;

/// Lightweight project descriptor stored in AppState and serialised to the frontend.
#[derive(Debug, Default, Clone, Serialize, Deserialize)]
pub struct ProjectInfo {
    /// Absolute path to the `.kicad_pro` file.
    pub path: String,
    /// Human-readable project name (stem of the `.kicad_pro` file).
    pub name: String,
    /// Absolute path to the `.kicad_pcb` file, if present.
    pub pcb_file: Option<String>,
    /// Absolute path to the `.kicad_sch` file, if present.
    pub schematic_file: Option<String>,
    /// Absolute path to the `.kimaster/` working directory.
    pub kimaster_dir: Option<String>,
    /// ISO-8601 timestamp of when this project was last opened.
    pub last_opened: Option<String>,
}

/// Cached board state received from the Python bridge plugin.
#[derive(Debug, Default, Clone, Serialize, Deserialize)]
pub struct CachedBoardState {
    pub board_name: Option<String>,
    pub kicad_version: Option<String>,
    pub component_count: usize,
    pub net_count: usize,
    pub layers: Vec<String>,
    /// Full raw JSON — passed to frontend as-is
    pub raw: Option<serde_json::Value>,
}

#[derive(Debug, Default)]
pub struct KiMasterStateInner {
    /// Resolved kicad-cli path (set on startup / re-discover)
    pub kicad_cli_path: Option<String>,
    /// Active .kicad_pro project
    pub active_project: Option<ProjectInfo>,
    /// Global vault directory — user-configurable, persisted across sessions.
    /// Default on Windows: `%USERPROFILE%\Documents\KiMaster Library`
    pub global_vault_dir: Option<String>,
    /// Project-local vault — auto-set to `<project>/.kimaster/` when a project is open.
    /// Cleared when the project is closed.
    pub project_vault_dir: Option<String>,

    // ── Project (Phase 4A) ───────────────────────────────────────────────
    /// Recent projects list (persisted in .kimaster/db.sqlite per project).
    pub recent_projects: Vec<ProjectInfo>,
    /// Active file-system watcher. Kept alive for the duration of the project session.
    pub file_watcher: Option<RecommendedWatcher>,

    // ── Bridge (Phase 3) ──────────────────────────────────────────────────
    /// True when the WS client task is connected to the Python plugin.
    pub bridge_connected: bool,
    /// Port of the Python plugin WS server (default: 40001).
    pub bridge_port: u16,
    /// Channel for sending commands to the background WS task.
    /// None when no connection is active.
    pub bridge_cmd_tx: Option<UnboundedSender<BridgeCmd>>,
    /// Most recent board state snapshot received from KiCad.
    pub bridge_board_state: CachedBoardState,
}

/// Tauri-managed state. Access via `State<'_, KiMasterState>` in commands.
pub struct KiMasterState(pub Mutex<KiMasterStateInner>);

impl KiMasterState {
    pub fn new() -> Self {
        Self(Mutex::new(KiMasterStateInner {
            bridge_port: crate::AppConfig::BRIDGE_WS_PORT,
            ..Default::default()
        }))
    }
}

impl Default for KiMasterState {
    fn default() -> Self {
        Self::new()
    }
}
