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

/// Ask the plugin to parse the .kicad_sch file and send the schematic state.
/// The result arrives asynchronously via the `bridge:schematic_state` Tauri event.
#[tauri::command]
pub async fn cmd_bridge_request_schematic_state(
    state: State<'_, KiMasterState>,
) -> Result<(), String> {
    let inner = state.0.lock().map_err(|e| e.to_string())?;
    match &inner.bridge_cmd_tx {
        Some(tx) => tx
            .send(BridgeCmd::Send(json!({ "type": "get_schematic_state" })))
            .map_err(|_| "Bridge task has stopped".into()),
        None => Err("Not connected to bridge".into()),
    }
}

/// Return the last cached schematic state (raw JSON), or null if not yet received.
#[tauri::command]
pub async fn cmd_bridge_get_schematic_state(
    state: State<'_, KiMasterState>,
) -> Result<Option<Value>, String> {
    let inner = state.0.lock().map_err(|e| e.to_string())?;
    Ok(inner.bridge_schematic_state.raw.clone())
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

/// Ask the plugin to read the live board stackup via pcbnew API.
/// The result arrives asynchronously via the `bridge:stackup_data` Tauri event.
#[tauri::command]
pub async fn cmd_bridge_request_stackup(
    state: State<'_, KiMasterState>,
) -> Result<(), String> {
    let inner = state.0.lock().map_err(|e| e.to_string())?;
    match &inner.bridge_cmd_tx {
        Some(tx) => tx
            .send(BridgeCmd::Send(json!({ "type": "get_stackup" })))
            .map_err(|_| "Bridge task has stopped".into()),
        None => Err("Not connected to bridge".into()),
    }
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

// ── Board-ops write commands ───────────────────────────────────────────────────

/// Place stitching vias inside a copper zone or board outline.
/// dry_run=true → preview only (no write). Result arrives via `bridge:op_result`.
#[tauri::command(rename_all = "snake_case")]
pub fn cmd_bridge_via_stitch(
    state:       State<'_, KiMasterState>,
    net:         String,
    via_size_mm: f64,
    drill_mm:    f64,
    pitch_mm:    f64,
    layer_from:  String,
    layer_to:    String,
    zone_name:   Option<String>,
    dry_run:     Option<bool>,
) -> Result<(), String> {
    let msg = json!({
        "type": "via_stitch",
        "data": {
            "net":         net,
            "via_size_mm": via_size_mm,
            "drill_mm":    drill_mm,
            "pitch_mm":    pitch_mm,
            "layer_from":  layer_from,
            "layer_to":    layer_to,
            "zone_name":   zone_name,
            "dry_run":     dry_run.unwrap_or(true),
        }
    });
    // dry_run=true → read-only (no board_check needed).
    // dry_run=false → write path — stamp board_check.
    if dry_run.unwrap_or(true) {
        send_to_bridge(&state, msg)
    } else {
        send_write_to_bridge(&state, msg)
    }
}

/// Apply teardrops to pads/vias. dry_run=true → preview count, no write.
/// Result arrives via `bridge:op_result` with op='apply_teardrops'.
#[tauri::command(rename_all = "snake_case")]
pub fn cmd_bridge_apply_teardrops(
    state:             State<'_, KiMasterState>,
    targets:           Option<String>,
    size_ratio:        Option<f64>,
    curve_points:      Option<u32>,
    prefer_zone_fills: Option<bool>,
    dry_run:           Option<bool>,
) -> Result<(), String> {
    let msg = json!({
        "type": "apply_teardrops",
        "data": {
            "targets":           targets.unwrap_or_else(|| "all".into()),
            "size_ratio":        size_ratio.unwrap_or(0.5),
            "curve_points":      curve_points.unwrap_or(5),
            "prefer_zone_fills": prefer_zone_fills.unwrap_or(true),
            "dry_run":           dry_run.unwrap_or(true),
        }
    });
    if dry_run.unwrap_or(true) {
        send_to_bridge(&state, msg)
    } else {
        send_write_to_bridge(&state, msg)
    }
}

/// Remove all teardrops from the board.
/// Result arrives via `bridge:op_result` with op='remove_teardrops'.
#[tauri::command]
pub fn cmd_bridge_remove_teardrops(
    state: State<'_, KiMasterState>,
) -> Result<(), String> {
    send_write_to_bridge(&state, json!({ "type": "remove_teardrops", "data": {} }))
}

/// Duplicate board into an N×M panel. dry_run=true → preview outline only.
/// Result arrives via `bridge:op_result` with op='panelize_board'.
#[tauri::command(rename_all = "snake_case")]
pub fn cmd_bridge_panelize_board(
    state:                  State<'_, KiMasterState>,
    cols:                   u32,
    rows:                   u32,
    gap_mm:                 f64,
    rail_mm:                f64,
    mouse_bites:            Option<bool>,
    mouse_bite_dia_mm:      Option<f64>,
    mouse_bite_spacing_mm:  Option<f64>,
    v_score:                Option<bool>,
    output_path:            Option<String>,
    dry_run:                Option<bool>,
) -> Result<(), String> {
    let msg = json!({
        "type": "panelize_board",
        "data": {
            "cols":                  cols,
            "rows":                  rows,
            "gap_mm":                gap_mm,
            "rail_mm":               rail_mm,
            "mouse_bites":           mouse_bites.unwrap_or(true),
            "mouse_bite_dia_mm":     mouse_bite_dia_mm.unwrap_or(0.5),
            "mouse_bite_spacing_mm": mouse_bite_spacing_mm.unwrap_or(0.8),
            "v_score":               v_score.unwrap_or(false),
            "output_path":           output_path,
            "dry_run":               dry_run.unwrap_or(true),
        }
    });
    if dry_run.unwrap_or(true) {
        send_to_bridge(&state, msg)
    } else {
        send_write_to_bridge(&state, msg)
    }
}

/// Install the KiMaster bridge plugin to the KiCad scripting plugins directory.
/// Plugin files are embedded in the binary — no external resource directory needed.
#[tauri::command]
pub async fn cmd_install_bridge_plugin(
    app: AppHandle,
) -> Result<BridgeInstallResponse, String> {
    use tauri::Manager;

    let home_dir = app.path().home_dir()
        .map_err(|e| format!("Cannot resolve home dir: {e}"))?;

    match install_bridge_plugin(&home_dir) {
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

/// **Clean** reinstall: wipe old plugin dir, write fresh embedded files, clear Python bytecode caches.
/// Use this when the plugin misbehaves or after a KiMaster update.
#[tauri::command]
pub async fn cmd_reinstall_bridge_plugin(
    app: AppHandle,
) -> Result<BridgeInstallResponse, String> {
    use tauri::Manager;

    let home_dir = app.path().home_dir()
        .map_err(|e| format!("Cannot resolve home dir: {e}"))?;

    match reinstall_bridge_plugin(&home_dir) {
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
