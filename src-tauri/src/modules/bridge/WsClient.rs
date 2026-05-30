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
            let board_name     = msg["board"].as_str().map(String::from);
            let plugin_version = msg["version"].as_str().map(String::from);

            tracing::info!(
                "Bridge: hello_ack — KiCad={:?}  board={:?}  plugin={:?}",
                kicad_version, board_name, plugin_version
            );

            update_bridge_connected(app, kicad_version.clone(), board_name.clone());

            let _ = app.emit("bridge:connected", BridgeConnectedPayload {
                port,
                kicad_version,
                board_name,
                plugin_version,
            });

            // Immediately request full board state
            // (send through the WS — we use a local approach since we're inside the task)
        }

        "board_state" => {
            if let Some(data) = msg.get("data") {
                cache_board_state(app, data.clone());
                let _ = app.emit("bridge:board_state", data);
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
        inner.bridge_connected = false;
        inner.bridge_cmd_tx    = None;
    }
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
