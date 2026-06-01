//! IPC commands for the Python bridge plugin WebSocket connection.
//! All commands are thin wrappers — logic lives in modules/bridge/.

use serde::Serialize;
use serde_json::{json, Value};
use tauri::{AppHandle, State};

use crate::AppConfig;
use crate::AppState::KiMasterState;
use crate::modules::bridge::{
    spawn_bridge_task, BridgeCmd,
    install_bridge_plugin, reinstall_bridge_plugin, plugin_install_dir,
    scan_bridge_instances, KiCadInstance,
};

// ── Response types ──────────────────────────────────────────────────────────

#[derive(Serialize)]
pub struct BridgeStatusResponse {
    pub connected: bool,
    pub port: u16,
    pub ws_url: String,
    pub board_name: Option<String>,
    pub kicad_version: Option<String>,
    pub component_count: usize,
    pub net_count: usize,
    pub layers: Vec<String>,
}

#[derive(Serialize)]
pub struct BridgeConnectResponse {
    pub success: bool,
    pub message: String,
    pub port: u16,
}

#[derive(Serialize)]
pub struct BridgeInstallResponse {
    pub success: bool,
    pub install_path: Option<String>,
    pub message: String,
}

// ── Commands ────────────────────────────────────────────────────────────────

/// Get current bridge connection status + cached board info.
#[tauri::command]
pub async fn cmd_get_bridge_status(
    state: State<'_, KiMasterState>,
) -> Result<BridgeStatusResponse, String> {
    let inner = state.0.lock().map_err(|e| e.to_string())?;
    Ok(BridgeStatusResponse {
        connected:       inner.bridge_connected,
        port:            inner.bridge_port,
        ws_url:          format!("ws://127.0.0.1:{}", inner.bridge_port),
        board_name:      inner.bridge_board_state.board_name.clone(),
        kicad_version:   inner.bridge_board_state.kicad_version.clone(),
        component_count: inner.bridge_board_state.component_count,
        net_count:       inner.bridge_board_state.net_count,
        layers:          inner.bridge_board_state.layers.clone(),
    })
}

/// Connect to the Python bridge plugin WS server.
/// Spawns a background task; returns immediately.
#[tauri::command]
pub async fn cmd_bridge_connect(
    app: AppHandle,
    state: State<'_, KiMasterState>,
    port: Option<u16>,
) -> Result<BridgeConnectResponse, String> {
    let target_port = port.unwrap_or(AppConfig::BRIDGE_WS_PORT);

    // Disconnect existing task if any
    {
        let mut inner = state.0.lock().map_err(|e| e.to_string())?;
        if let Some(ref tx) = inner.bridge_cmd_tx {
            let _ = tx.send(BridgeCmd::Disconnect);
        }
        inner.bridge_cmd_tx  = None;
        inner.bridge_port    = target_port;
        inner.bridge_connected = false;
    }

    tracing::info!("Bridge: starting connection to port {target_port}");
    let cmd_tx = spawn_bridge_task(app, target_port).await;

    {
        let mut inner = state.0.lock().map_err(|e| e.to_string())?;
        inner.bridge_cmd_tx = Some(cmd_tx);
    }

    Ok(BridgeConnectResponse {
        success: true,
        message: format!("Connecting to ws://127.0.0.1:{target_port} …"),
        port: target_port,
    })
}

/// Disconnect from the bridge plugin.
#[tauri::command]
pub async fn cmd_bridge_disconnect(
    state: State<'_, KiMasterState>,
) -> Result<(), String> {
    let mut inner = state.0.lock().map_err(|e| e.to_string())?;
    if let Some(ref tx) = inner.bridge_cmd_tx {
        let _ = tx.send(BridgeCmd::Disconnect);
    }
    inner.bridge_cmd_tx    = None;
    inner.bridge_connected = false;
    tracing::info!("Bridge: disconnect requested");
    Ok(())
}

/// Send an arbitrary JSON message to the KiCad plugin.
#[tauri::command]
pub async fn cmd_bridge_send(
    state: State<'_, KiMasterState>,
    payload: Value,
) -> Result<(), String> {
    let inner = state.0.lock().map_err(|e| e.to_string())?;
    match &inner.bridge_cmd_tx {
        Some(tx) => {
            tx.send(BridgeCmd::Send(payload))
                .map_err(|_| "Bridge task has stopped".into())
        }
        None => Err("Not connected to bridge".into()),
    }
}

/// Request the plugin to send a fresh board state snapshot.
#[tauri::command]
pub async fn cmd_bridge_request_board_state(
    state: State<'_, KiMasterState>,
) -> Result<(), String> {
    let inner = state.0.lock().map_err(|e| e.to_string())?;
    match &inner.bridge_cmd_tx {
        Some(tx) => {
            tx.send(BridgeCmd::Send(json!({ "type": "get_board_state" })))
                .map_err(|_| "Bridge task has stopped".into())
        }
        None => Err("Not connected to bridge".into()),
    }
}

/// Return the last cached board state.
#[tauri::command]
pub async fn cmd_bridge_get_board_state(
    state: State<'_, KiMasterState>,
) -> Result<Option<Value>, String> {
    let inner = state.0.lock().map_err(|e| e.to_string())?;
    Ok(inner.bridge_board_state.raw.clone())
}

/// Ask the plugin to highlight a component by reference designator.
#[tauri::command]
pub async fn cmd_bridge_highlight_component(
    state: State<'_, KiMasterState>,
    reference: String,
) -> Result<(), String> {
    let inner = state.0.lock().map_err(|e| e.to_string())?;
    match &inner.bridge_cmd_tx {
        Some(tx) => tx
            .send(BridgeCmd::Send(json!({
                "type": "highlight_component",
                "data": { "ref": reference }
            })))
            .map_err(|_| "Bridge task has stopped".into()),
        None => Err("Not connected to bridge".into()),
    }
}

/// Ask the plugin to highlight a net by name.
#[tauri::command]
pub async fn cmd_bridge_highlight_net(
    state: State<'_, KiMasterState>,
    net: String,
) -> Result<(), String> {
    let inner = state.0.lock().map_err(|e| e.to_string())?;
    match &inner.bridge_cmd_tx {
        Some(tx) => tx
            .send(BridgeCmd::Send(json!({
                "type": "highlight_net",
                "data": { "net": net }
            })))
            .map_err(|_| "Bridge task has stopped".into()),
        None => Err("Not connected to bridge".into()),
    }
}

/// Trigger `pcbnew.ZONE_FILLER` on all copper zones matching the filter.
/// Result arrives asynchronously via `bridge:op_result` Tauri event
/// with `op == "regenerate_zones"`.
///
/// Args: `filter_layer` (e.g. "F.Cu", empty = all),
///       `filter_net`   (e.g. "GND", empty = all),
///       `check_fill`   (verify result — slower but safer).
#[tauri::command(rename_all = "snake_case")]
pub async fn cmd_bridge_regenerate_zones(
    state:        State<'_, KiMasterState>,
    filter_layer: Option<String>,
    filter_net:   Option<String>,
    check_fill:   Option<bool>,
) -> Result<(), String> {
    send_write_to_bridge(&state, json!({
        "type": "regenerate_zones",
        "data": {
            "filter_layer": filter_layer.unwrap_or_default(),
            "filter_net":   filter_net.unwrap_or_default(),
            "check_fill":   check_fill.unwrap_or(true),
        }
    }))
}

/// Find and (optionally) remove vias that have no track or pad on either side.
/// Result lands asynchronously via `bridge:op_result` with `op == "purge_orphan_vias"`.
/// Use `dry_run = true` to preview before destroying anything.
///
/// Args: `filter_net` (e.g. "GND", empty = all),
///       `dry_run`    (preview only — no board write)
#[tauri::command(rename_all = "snake_case")]
pub async fn cmd_bridge_purge_orphan_vias(
    state:      State<'_, KiMasterState>,
    filter_net: Option<String>,
    dry_run:    Option<bool>,
) -> Result<(), String> {
    send_write_to_bridge(&state, json!({
        "type": "purge_orphan_vias",
        "data": {
            "filter_net": filter_net.unwrap_or_default(),
            "dry_run":    dry_run.unwrap_or(true),
        }
    }))
}

/// Ask the plugin to compute and broadcast net analytics for `net`.
/// The result arrives asynchronously via the `bridge:net_info` Tauri event.
#[tauri::command]
pub async fn cmd_bridge_request_net_info(
    state: State<'_, KiMasterState>,
    net: String,
) -> Result<(), String> {
    let inner = state.0.lock().map_err(|e| e.to_string())?;
    match &inner.bridge_cmd_tx {
        Some(tx) => tx
            .send(BridgeCmd::Send(json!({
                "type": "get_net_info",
                "data": { "net": net }
            })))
            .map_err(|_| "Bridge task has stopped".into()),
        None => Err("Not connected to bridge".into()),
    }
}

/// Clear all KiCad highlights.
#[tauri::command]
pub async fn cmd_bridge_clear_highlight(
    state: State<'_, KiMasterState>,
) -> Result<(), String> {
    let inner = state.0.lock().map_err(|e| e.to_string())?;
    match &inner.bridge_cmd_tx {
        Some(tx) => tx
            .send(BridgeCmd::Send(json!({ "type": "clear_highlight" })))
            .map_err(|_| "Bridge task has stopped".into()),
        None => Err("Not connected to bridge".into()),
    }
}

// ── Phase 5 write commands ─────────────────────────────────────────────────────
// Arg names must match AppCommands.js JSDoc exactly (Rule 3).
// All ops save the board and trigger board_changed → fresh state pushed to UI.

/// **Project-locked** write command helper.
///
/// Stamps every write command with `board_check = <locked_board_path>` before
/// sending it to the KiCad bridge plugin.  The plugin's `_check_board()` guard
/// verifies the path matches the board that is currently open — if not, it
/// rejects the command and returns an error `op_result`.
///
/// This is the Rust-side fence.  The Python-side fence is `_check_board()`.
/// Both must pass for a write to execute.
fn send_write_to_bridge(state: &State<'_, KiMasterState>, mut payload: Value) -> Result<(), String> {
    let inner = state.0.lock().map_err(|e| e.to_string())?;

    // Require an active project lock — writes without one are always rejected
    let board_path = inner.locked_board_path.as_deref()
        .ok_or_else(|| "No active project lock — connect the bridge and open a board first".to_string())?;

    // Stamp the payload so the Python plugin can verify it
    payload["board_check"] = serde_json::Value::String(board_path.to_string());

    match &inner.bridge_cmd_tx {
        Some(tx) => tx.send(BridgeCmd::Send(payload))
            .map_err(|_| "Bridge task has stopped".into()),
        None => Err("Bridge not connected".into()),
    }
}

/// Read-only / non-destructive helper (no board_check needed).
fn send_to_bridge(state: &State<'_, KiMasterState>, payload: Value) -> Result<(), String> {
    let inner = state.0.lock().map_err(|e| e.to_string())?;
    match &inner.bridge_cmd_tx {
        Some(tx) => tx.send(BridgeCmd::Send(payload))
            .map_err(|_| "Bridge task has stopped".into()),
        None => Err("Not connected to bridge".into()),
    }
}

/// Move a footprint to an absolute position.
/// Args: { reference, x_mm, y_mm }
#[tauri::command(rename_all = "snake_case")]
pub fn cmd_bridge_move_component(
    state:     State<'_, KiMasterState>,
    reference: String,
    x_mm:      f64,
    y_mm:      f64,
) -> Result<(), String> {
    // ← uses send_write_to_bridge: board_check is stamped automatically
    send_write_to_bridge(&state, json!({
        "type": "move_component",
        "data": { "ref": reference, "x_mm": x_mm, "y_mm": y_mm }
    }))
}

/// Set the absolute rotation of a footprint.
/// Args: { reference, angle_deg }
#[tauri::command(rename_all = "snake_case")]
pub fn cmd_bridge_rotate_component(
    state:     State<'_, KiMasterState>,
    reference: String,
    angle_deg: f64,
) -> Result<(), String> {
    send_write_to_bridge(&state, json!({
        "type": "rotate_component",
        "data": { "ref": reference, "angle_deg": angle_deg }
    }))
}

/// Lock or unlock a footprint.
/// Args: { reference, locked }
#[tauri::command]
pub fn cmd_bridge_set_locked(
    state:     State<'_, KiMasterState>,
    reference: String,
    locked:    bool,
) -> Result<(), String> {
    send_write_to_bridge(&state, json!({
        "type": "set_locked",
        "data": { "ref": reference, "locked": locked }
    }))
}

/// Set or clear the DNP (Do Not Place) flag.
/// Args: { reference, dnp }
#[tauri::command]
pub fn cmd_bridge_set_dnp(
    state:     State<'_, KiMasterState>,
    reference: String,
    dnp:       bool,
) -> Result<(), String> {
    send_write_to_bridge(&state, json!({
        "type": "set_dnp",
        "data": { "ref": reference, "dnp": dnp }
    }))
}

/// Install the KiMaster bridge plugin to the KiCad scripting plugins directory.
///
/// Source location depends on build mode:
///   - **dev (debug):** uses `bridge/kimaster_plugin` from the workspace root
///     (via `env!("CARGO_MANIFEST_DIR")`) — no copy step required.
///   - **release:** uses the bundled resource at `<resource_dir>/bridge/kimaster_plugin`.
#[tauri::command]
pub async fn cmd_install_bridge_plugin(
    app: AppHandle,
) -> Result<BridgeInstallResponse, String> {
    use tauri::Manager;
    use std::path::PathBuf;

    // Locate the plugin source. Different strategy in dev vs. release.
    let plugin_src: PathBuf = if cfg!(debug_assertions) {
        // Dev: walk up from src-tauri/ to repo root, then bridge/kimaster_plugin
        let manifest_dir = std::path::Path::new(env!("CARGO_MANIFEST_DIR"));
        manifest_dir
            .parent()
            .unwrap_or(manifest_dir)
            .join("bridge")
            .join("kimaster_plugin")
    } else {
        // Release: use Tauri-bundled resources
        let resource_dir = app.path().resource_dir()
            .map_err(|e| format!("Cannot resolve resource dir: {e}"))?;
        resource_dir.join("bridge").join("kimaster_plugin")
    };

    if !plugin_src.exists() {
        return Ok(BridgeInstallResponse {
            success: false,
            install_path: None,
            message: format!(
                "Plugin source not found at '{}'. \
                 In dev, the workspace must contain `bridge/kimaster_plugin/`. \
                 In release, ensure tauri.conf.json bundle.resources includes the bridge dir.",
                plugin_src.display()
            ),
        });
    }

    // Resolve home dir
    let home_dir = app.path().home_dir()
        .map_err(|e| format!("Cannot resolve home dir: {e}"))?;

    match install_bridge_plugin(&plugin_src, &home_dir) {
        Ok(dest) => Ok(BridgeInstallResponse {
            success: true,
            install_path: Some(dest.to_string_lossy().into_owned()),
            message: format!(
                "Plugin installed to '{}'. Restart KiCad and activate from \
                 Tools → External Plugins → KiMaster Bridge.",
                dest.display()
            ),
        }),
        Err(e) => Ok(BridgeInstallResponse {
            success: false,
            install_path: None,
            message: e,
        }),
    }
}

/// Check whether the plugin is installed and return its path.
/// Checks for the presence of `__init__.py` inside the expected plugin directory.
#[derive(Serialize)]
pub struct PluginStatusResponse {
    /// True if the plugin directory and `__init__.py` both exist.
    pub installed:    bool,
    /// Absolute path to the plugin directory (may or may not exist yet).
    pub install_path: String,
}

#[tauri::command]
pub async fn cmd_check_plugin_installed(
    app: AppHandle,
) -> Result<PluginStatusResponse, String> {
    use tauri::Manager;
    let home_dir = app.path().home_dir()
        .map_err(|e| format!("Cannot resolve home dir: {e}"))?;
    let dir = plugin_install_dir(&home_dir);
    let installed = dir.join("__init__.py").exists();
    Ok(PluginStatusResponse {
        installed,
        install_path: dir.to_string_lossy().into_owned(),
    })
}

/// Get the expected plugin installation path (for display in UI).
#[tauri::command]
pub async fn cmd_get_plugin_install_path(
    app: AppHandle,
) -> Result<String, String> {
    use tauri::Manager;
    let home_dir = app.path().home_dir()
        .map_err(|e| format!("Cannot resolve home dir: {e}"))?;
    Ok(plugin_install_dir(&home_dir).to_string_lossy().into_owned())
}

/// **Clean** reinstall: wipe old plugin dir, copy fresh files, clear Python bytecode caches.
/// Use this when the plugin misbehaves or after a KiMaster update.
#[tauri::command]
pub async fn cmd_reinstall_bridge_plugin(
    app: AppHandle,
) -> Result<BridgeInstallResponse, String> {
    use tauri::Manager;
    use std::path::PathBuf;

    let plugin_src: PathBuf = if cfg!(debug_assertions) {
        let manifest_dir = std::path::Path::new(env!("CARGO_MANIFEST_DIR"));
        manifest_dir.parent().unwrap_or(manifest_dir)
            .join("bridge").join("kimaster_plugin")
    } else {
        let resource_dir = app.path().resource_dir()
            .map_err(|e| format!("Cannot resolve resource dir: {e}"))?;
        resource_dir.join("bridge").join("kimaster_plugin")
    };

    if !plugin_src.exists() {
        return Ok(BridgeInstallResponse {
            success: false,
            install_path: None,
            message: format!(
                "Plugin source not found at '{}'. Ensure your KiMaster installation is complete.",
                plugin_src.display()
            ),
        });
    }

    let home_dir = app.path().home_dir()
        .map_err(|e| format!("Cannot resolve home dir: {e}"))?;

    match reinstall_bridge_plugin(&plugin_src, &home_dir) {
        Ok(dest) => Ok(BridgeInstallResponse {
            success: true,
            install_path: Some(dest.to_string_lossy().into_owned()),
            message: format!(
                "Plugin cleanly reinstalled to '{}'. Old files and Python caches were removed. \
                 Restart KiCad and re-activate from Tools → External Plugins → KiMaster Bridge.",
                dest.display()
            ),
        }),
        Err(e) => Ok(BridgeInstallResponse {
            success: false,
            install_path: None,
            message: e,
        }),
    }
}

/// Scan ports 40001–40010 for active KiMaster bridge WebSocket servers.
///
/// Returns one entry per responding port. A normal setup returns one entry.
/// Multiple entries mean multiple KiCad instances are running the plugin
/// simultaneously — the user must choose which one KiMaster connects to.
#[tauri::command]
pub async fn cmd_scan_kicad_instances() -> Result<Vec<KiCadInstance>, String> {
    let instances = scan_bridge_instances(AppConfig::BRIDGE_WS_PORT, 10).await;
    tracing::info!("Instance scan: found {} bridge(s) in port range {}-{}",
        instances.len(),
        AppConfig::BRIDGE_WS_PORT,
        AppConfig::BRIDGE_WS_PORT + 9,
    );
    Ok(instances)
}
