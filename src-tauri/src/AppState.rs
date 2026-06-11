//! Tauri-managed application state. Arc<Mutex<>> wraps all mutable data.

use serde::{Deserialize, Serialize};
use std::sync::{Arc, Mutex};
use tokio::sync::mpsc::UnboundedSender;
use notify::RecommendedWatcher;

use crate::modules::bridge::WsClient::BridgeCmd;
use crate::modules::kicad_ipc::IpcClient::IpcClient;

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

/// Status of the KiCad IPC API connection.
#[derive(Debug, Default, Clone, Serialize, Deserialize)]
pub struct KiCadIpcStatus {
    pub connected:     bool,
    /// Full path/URL of the socket we connected to (for drift detection on rescan).
    pub socket_path:   Option<String>,
    /// The token we used — stored to detect if KiCad restarted and issued a new one.
    pub token:         Option<String>,
    pub kicad_version: Option<String>,
}

/// Cached schematic state received from the Python bridge plugin.
#[derive(Debug, Default, Clone, Serialize, Deserialize)]
pub struct CachedSchematicState {
    /// Absolute path of the .kicad_sch that was parsed.
    pub sch_path: Option<String>,
    /// Number of de-duplicated component references found.
    pub component_count: usize,
    /// Number of net labels (global/local/power) found.
    pub net_label_count: usize,
    /// Number of hierarchical sheets (including root).
    pub sheet_count: usize,
    /// Full raw JSON — passed to frontend as-is.
    pub raw: Option<serde_json::Value>,
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
    /// Most recent schematic state snapshot received from KiCad.
    pub bridge_schematic_state: CachedSchematicState,

    // ── KiCad IPC API (Phase 1+) ──────────────────────────────────────────────
    /// Status of the KiCad IPC connection (for UI display + drift detection).
    pub kicad_ipc_status: KiCadIpcStatus,
    /// Live IPC client shared via Arc across Tauri commands.
    /// None when KiCad is not running or IPC is not connected.
    pub kicad_ipc_client: Option<Arc<IpcClient>>,

    // ── Project lock ───────────────────────────────────────────────────────
    /// Absolute path of the `.kicad_pcb` KiMaster is locked to for this session.
    ///
    /// Set on `hello_ack` when the bridge connects, cleared on disconnect.
    /// **All write commands must carry this path as `board_check`.**
    /// Any command targeting a different path is rejected — both here in Rust
    /// and by the Python plugin's own `_check_board()` guard.
    pub locked_board_path: Option<String>,
    /// The specific port this lock was established on.
    /// Prevents re-use of a cmd_tx from a stale connection.
    pub locked_bridge_port: Option<u16>,
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
