//! Async WebSocket client for the KiMaster Python bridge plugin.
//!
//! Architecture:
//!   IPC command (BridgeCommands.rs)
//!       └─► spawn_bridge_task()  →  background tokio task
//!               ├─ connects to ws://127.0.0.1:<port>
//!               ├─ sends hello + gets board state on connect
//!               ├─ forwards every server message → Tauri event to frontend
//!               ├─ auto-reconnects with exponential backoff (max 30s)
//!               └─ receives BridgeCmd via UnboundedReceiver for outbound messages
//!
//! Tauri events emitted:
//!   "bridge:connected"         → BridgeConnectedPayload
//!   "bridge:disconnected"      → {}
//!   "bridge:board_state"       → serde_json::Value (raw from plugin)
//!   "bridge:board_changed"     → {} (signal to re-fetch board state)
//!   "bridge:selection"         → SelectionPayload
//!   "bridge:error"             → BridgeErrorPayload

use std::time::Duration;

use futures_util::{SinkExt, StreamExt};
use serde::{Deserialize, Serialize};
use serde_json::{json, Value};
use tauri::{AppHandle, Emitter, Manager};
use tokio::sync::mpsc::{self, UnboundedReceiver, UnboundedSender};
use tokio::time::sleep;
use tokio_tungstenite::{connect_async, tungstenite::Message};

use crate::AppState::KiMasterState;
use crate::modules::project::ProjectStore;
use crate::modules::uce::LibraryVault;

// ── Command enum ────────────────────────────────────────────────────────────

/// Commands sent from the IPC layer to the background WS task.
#[derive(Debug)]
pub enum BridgeCmd {
    /// Send a JSON payload to the KiCad plugin.
    Send(Value),
    /// Gracefully disconnect and exit the task.
    Disconnect,
}

// ── Tauri event payloads ────────────────────────────────────────────────────

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct BridgeConnectedPayload {
    pub port: u16,
    pub kicad_version: Option<String>,
    pub board_name: Option<String>,
    pub plugin_version: Option<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct BridgeErrorPayload {
    pub message: String,
}

// ── Public API ──────────────────────────────────────────────────────────────

/// Spawn the background WS connection task.
/// Returns the command sender used by IPC commands to send messages.
pub async fn spawn_bridge_task(app: AppHandle, port: u16) -> UnboundedSender<BridgeCmd> {
    let (cmd_tx, cmd_rx) = mpsc::unbounded_channel::<BridgeCmd>();
    tokio::spawn(bridge_task_main(app, port, cmd_rx));
    cmd_tx
}

// ── Background task ─────────────────────────────────────────────────────────

async fn bridge_task_main(
    app: AppHandle,
    port: u16,
    mut cmd_rx: UnboundedReceiver<BridgeCmd>,
) {
    let url = format!("ws://127.0.0.1:{port}");
    let mut backoff_secs: u64 = 1;
    const MAX_BACKOFF: u64 = 30;

    loop {
        tracing::info!("Bridge: connecting to {url}");

        match connect_async(&url).await {
            Ok((ws_stream, _)) => {
                backoff_secs = 1;
                tracing::info!("Bridge: WebSocket connected");

                let should_reconnect =
                    run_connection(&app, port, ws_stream, &mut cmd_rx).await;

                // Always mark disconnected after session ends
                update_bridge_disconnected(&app);
                let _ = app.emit("bridge:disconnected", json!({}));

                if !should_reconnect {
                    tracing::info!("Bridge: explicit disconnect — task stopping");
                    return;
                }
                tracing::info!("Bridge: connection dropped — reconnecting in {backoff_secs}s");
            }
            Err(e) => {
                tracing::debug!("Bridge: connect failed: {e} — retry in {backoff_secs}s");
            }
        }

        // Wait with early-exit on Disconnect command
        let delay = sleep(Duration::from_secs(backoff_secs));
        tokio::pin!(delay);
        loop {
            tokio::select! {
                _ = &mut delay => break,
                cmd = cmd_rx.recv() => {
                    match cmd {
                        Some(BridgeCmd::Disconnect) | None => {
                            tracing::info!("Bridge: disconnect during backoff — stopping");
                            return;
                        }
                        _ => {} // discard other commands during reconnect
                    }
                }
            }
        }

        backoff_secs = (backoff_secs * 2).min(MAX_BACKOFF);
    }
}

/// Drive a single connected session.
/// Returns `true`  = connection dropped naturally (should reconnect).
/// Returns `false` = Disconnect command received (should stop).
async fn run_connection(
    app: &AppHandle,
    port: u16,
    ws_stream: tokio_tungstenite::WebSocketStream<
        tokio_tungstenite::MaybeTlsStream<tokio::net::TcpStream>,
    >,
    cmd_rx: &mut UnboundedReceiver<BridgeCmd>,
) -> bool {
    let (mut sink, mut stream) = ws_stream.split();

    // Send hello immediately
    let hello = json!({
        "type": "hello",
        "client": "kimaster",
        "version": "0.1.0"
    });
    if sink.send(Message::Text(hello.to_string().into())).await.is_err() {
        return true;
    }

    let mut ping_interval = tokio::time::interval(Duration::from_secs(20));
    ping_interval.tick().await; // consume first tick

    loop {
        tokio::select! {
            // Inbound message from KiCad plugin
            msg = stream.next() => {
                match msg {
                    Some(Ok(Message::Text(text))) => {
                        handle_server_message(app, port, &text);
                    }
                    Some(Ok(Message::Ping(data))) => {
                        let _ = sink.send(Message::Pong(data)).await;
                    }
                    Some(Ok(Message::Close(_))) | None => {
                        tracing::info!("Bridge: server closed connection");
                        return true;
                    }
                    Some(Err(e)) => {
                        tracing::warn!("Bridge: WS error: {e}");
                        return true;
                    }
                    _ => {}
                }
            }

            // Command from IPC layer
            cmd = cmd_rx.recv() => {
                match cmd {
                    Some(BridgeCmd::Send(payload)) => {
                        if sink.send(Message::Text(payload.to_string().into())).await.is_err() {
                            return true;
                        }
                    }
                    Some(BridgeCmd::Disconnect) | None => {
                        let _ = sink.send(Message::Close(None)).await;
                        return false; // caller should NOT reconnect
                    }
                }
            }

            // Keepalive ping
            _ = ping_interval.tick() => {
                if sink.send(Message::Ping(vec![].into())).await.is_err() {
                    return true;
                }
            }
        }
    }
}

// ── Message handler ──────────────────────────────────────────────────────────

fn handle_server_message(app: &AppHandle, port: u16, text: &str) {
    let msg: Value = match serde_json::from_str(text) {
        Ok(v) => v,
        Err(e) => {
            tracing::warn!("Bridge: malformed JSON: {e}");
            return;
        }
    };

    let msg_type = msg["type"].as_str().unwrap_or("unknown");
    tracing::debug!("Bridge ← {msg_type}");

    match msg_type {
        "hello_ack" => {
            let kicad_version  = msg["kicad_version"].as_str().map(String::from);
            // "board" / "pcb_path" both carry the full path to the .kicad_pcb file
            let board_name     = msg["pcb_path"].as_str()
                .or_else(|| msg["board"].as_str())
                .map(String::from);
            let plugin_version = msg["version"].as_str().map(String::from);

            tracing::info!(
                "Bridge: hello_ack — KiCad={:?}  board={:?}  plugin={:?}",
                kicad_version, board_name, plugin_version
            );

            // ── Set project lock ─────────────────────────────────────────────
            // This is the SINGLE point where KiMaster locks itself to one project.
            // Every write command will carry this path as `board_check` and the
            // Python plugin will validate it before executing anything.
            if let Ok(mut inner) = app.state::<KiMasterState>().0.lock() {
                inner.locked_board_path  = board_name.clone();
                inner.locked_bridge_port = Some(port);
            }
            tracing::info!("Project lock set to {:?} on port {}", board_name, port);

            update_bridge_connected(app, kicad_version.clone(), board_name.clone());

            // Auto-provision the project vault from the PCB file path
            if let Some(ref pcb_path) = board_name {
                auto_provision_project_vault(app, pcb_path);
            }

            let _ = app.emit("bridge:connected", BridgeConnectedPayload {
                port,
                kicad_version,
                board_name,
                plugin_version,
            });
        }

        "board_state" => {
            if let Some(data) = msg.get("data") {
                // ── Board mismatch detection ─────────────────────────────────
                // If the board reported in a state update differs from the locked
                // path, the user has switched boards inside KiCad mid-session.
                // Emit a warning event so the frontend can disable write ops.
                if let Some(new_board) = data["board_name"].as_str()
                    .or_else(|| data["file_name"].as_str())
                {
                    let locked = app.state::<KiMasterState>().0.lock()
                        .ok()
                        .and_then(|g| g.locked_board_path.clone());

                    if let Some(ref expected) = locked {
                        let norm = |s: &str| s.replace('\\', "/");
                        if norm(new_board) != norm(expected) {
                            tracing::warn!(
                                "Board mismatch: locked={expected:?} but bridge reports {new_board:?}"
                            );
                            let _ = app.emit("bridge:project_mismatch", json!({
                                "expected": expected,
                                "actual":   new_board,
                                "port":     port,
                            }));
                        }
                    }
                }

                cache_board_state(app, data.clone());
                let _ = app.emit("bridge:board_state", data);
            }
        }

        "schematic_state" => {
            if let Some(data) = msg.get("data") {
                cache_schematic_state(app, data.clone());
                let _ = app.emit("bridge:schematic_state", data);
            }
        }

        "board_changed" => {
            let _ = app.emit("bridge:board_changed", json!({}));
        }

        "selection_changed" => {
            if let Some(data) = msg.get("data") {
                let _ = app.emit("bridge:selection", data);
            }
        }

        "net_info" => {
            if let Some(data) = msg.get("data") {
                let _ = app.emit("bridge:net_info", data);
            }
        }

        "stackup_data" => {
            if let Some(data) = msg.get("data") {
                let _ = app.emit("bridge:stackup_data", data);
            }
        }

        "op_result" => {
            // Forward write-op results (move/rotate/lock/dnp/regenerate_zones).
            // Payload keeps the full message so JS can dispatch by `op` field.
            let _ = app.emit("bridge:op_result", &msg);
        }

        "poll_intervals" => {
            if let Some(data) = msg.get("data") {
                tracing::debug!("Bridge: poll_intervals = {data}");
                let _ = app.emit("bridge:poll_intervals", data);
            }
        }

        "error" => {
            let message = msg["message"].as_str().unwrap_or("Unknown plugin error").to_string();
            tracing::warn!("Bridge plugin error: {message}");
            let _ = app.emit("bridge:error", BridgeErrorPayload { message });
        }

        "pong" => {} // keepalive — ignore

        // Plugin sends this before shutting down the server (user clicked Stop in KiCad)
        "server_stopping" => {
            let msg = msg["message"].as_str().unwrap_or("Bridge server stopped by KiCad").to_string();
            tracing::info!("Bridge: server_stopping — {msg}");
            // Emit a dedicated event so the frontend can show a clear "stopped" banner
            // rather than the generic "disconnected / reconnecting" state.
            let _ = app.emit("bridge:server_stopped", serde_json::json!({ "message": msg }));
        }

        other => {
            tracing::trace!("Bridge: unhandled type '{other}'");
        }
    }
}

// ── State mutators ───────────────────────────────────────────────────────────

fn update_bridge_connected(
    app: &AppHandle,
    kicad_version: Option<String>,
    board_name: Option<String>,
) {
    if let Ok(mut inner) = app.state::<KiMasterState>().0.lock() {
        inner.bridge_connected = true;
        inner.bridge_board_state.kicad_version = kicad_version;
        inner.bridge_board_state.board_name    = board_name;
    }
}

fn update_bridge_disconnected(app: &AppHandle) {
    if let Ok(mut inner) = app.state::<KiMasterState>().0.lock() {
        inner.bridge_connected        = false;
        inner.bridge_cmd_tx           = None;
        inner.project_vault_dir       = None;
        inner.bridge_schematic_state  = Default::default();
        // Release the project lock — no project is active until the next connection
        inner.locked_board_path  = None;
        inner.locked_bridge_port = None;
    }
}

/// Derive the project directory from a `.kicad_pcb` path, then:
///   1. Create `.kimaster/` + `assets/` subdirectory
///   2. Provision the component vault inside `.kimaster/`
///   3. Set `project_vault_dir` in AppState
///   4. Emit `project:auto_detected` so the frontend can update the settings panel
fn auto_provision_project_vault(app: &AppHandle, pcb_path: &str) {
    use std::path::Path;

    let pcb = Path::new(pcb_path);
    let project_dir = match pcb.parent() {
        Some(p) => p,
        None => {
            tracing::warn!("Bridge: cannot derive project dir from PCB path: {pcb_path}");
            return;
        }
    };

    // 1. Create .kimaster/ + assets/
    let km_dir = match ProjectStore::provision_kimaster_in(project_dir) {
        Ok(d) => d,
        Err(e) => {
            tracing::warn!("Bridge: failed to provision .kimaster/: {e}");
            return;
        }
    };

    // 2. Provision component vault (library/, KiMaster.pretty/, 3dmodels/, vault.db)
    let km_str = km_dir.to_string_lossy().into_owned();
    if let Err(e) = LibraryVault::provision_vault(&km_str) {
        tracing::warn!("Bridge: failed to provision project vault: {e}");
    }

    // 3. Update AppState
    if let Ok(mut inner) = app.state::<KiMasterState>().0.lock() {
        // Only set if not already pointing at the same project
        if inner.project_vault_dir.as_deref() != Some(&km_str) {
            tracing::info!("Bridge: project vault auto-set to {km_str}");
            inner.project_vault_dir = Some(km_str.clone());
        }
    }

    // 4. Notify frontend — settings panel and vault UI can refresh
    let _ = app.emit("project:auto_detected", serde_json::json!({
        "project_dir":   project_dir.to_string_lossy(),
        "kimaster_dir":  km_str,
        "pcb_path":      pcb_path,
    }));
}

fn cache_board_state(app: &AppHandle, data: Value) {
    if let Ok(mut inner) = app.state::<KiMasterState>().0.lock() {
        let state = &mut inner.bridge_board_state;
        state.board_name      = data["board_name"].as_str().map(String::from);
        state.component_count = data["components"].as_array().map(|a| a.len()).unwrap_or(0);
        state.net_count       = data["nets"].as_array().map(|a| a.len()).unwrap_or(0);
        state.layers          = data["layers"]
            .as_array()
            .map(|a| a.iter().filter_map(|v| v.as_str().map(String::from)).collect())
            .unwrap_or_default();
        state.raw             = Some(data);
    }
}

fn cache_schematic_state(app: &AppHandle, data: Value) {
    if let Ok(mut inner) = app.state::<KiMasterState>().0.lock() {
        let state = &mut inner.bridge_schematic_state;
        state.sch_path        = data["sch_path"].as_str().map(String::from);
        state.component_count = data["components"].as_array().map(|a| a.len()).unwrap_or(0);
        state.net_label_count = data["net_labels"].as_array().map(|a| a.len()).unwrap_or(0);
        state.sheet_count     = data["sheet_count"].as_u64().unwrap_or(0) as usize;
        state.raw             = Some(data);
    }
}
