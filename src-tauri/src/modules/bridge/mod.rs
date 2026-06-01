//! Python plugin WebSocket bridge — Phase 3.
//! WsClient manages the async connection. BridgeInstaller copies the plugin.

pub mod WsClient;

pub use WsClient::{spawn_bridge_task, BridgeCmd};

use std::path::{Path, PathBuf};
use std::time::Duration;
use serde::Serialize;
use crate::AppConfig;

/// Info about one discovered KiCad bridge instance (one running KiCad with plugin active).
#[derive(Debug, Clone, Serialize)]
pub struct KiCadInstance {
    /// WebSocket port this instance is listening on.
    pub port:          u16,
    /// `.kicad_pcb` file path as reported by the plugin's `hello_ack`.
    pub board_name:    Option<String>,
    /// KiCad version string from the plugin.
    pub kicad_version: Option<String>,
}

// ── Path helpers ─────────────────────────────────────────────────────────────

/// Resolve the KiMaster plugin destination inside the user's KiCad plugins dir.
/// `home_dir` is provided by the caller (e.g. from Tauri `app.path().home_dir()`).
pub fn plugin_install_dir(home_dir: &Path) -> PathBuf {
    home_dir
        .join(AppConfig::KICAD_PLUGIN_SUBDIR)
        .join("kimaster_plugin")
}

// ── Plugin install ────────────────────────────────────────────────────────────

/// Copy the bundled bridge plugin to the KiCad scripting plugins directory.
/// Does NOT remove existing files — use `reinstall_bridge_plugin` for a clean wipe.
pub fn install_bridge_plugin(
    plugin_src_dir: &Path,
    home_dir: &Path,
) -> Result<PathBuf, String> {
    let dest = plugin_install_dir(home_dir);
    std::fs::create_dir_all(&dest)
        .map_err(|e| format!("Cannot create plugin dir '{}': {e}", dest.display()))?;
    copy_dir_recursive(plugin_src_dir, &dest)?;
    tracing::info!("Bridge plugin installed to '{}'", dest.display());
    Ok(dest)
}

/// **Clean** reinstall: wipe the existing plugin directory, copy fresh files,
/// then remove all Python bytecode caches so KiCad recompiles from source.
///
/// This is the recommended action when the plugin misbehaves or an update ships.
pub fn reinstall_bridge_plugin(
    plugin_src_dir: &Path,
    home_dir: &Path,
) -> Result<PathBuf, String> {
    let dest = plugin_install_dir(home_dir);

    // 1. Remove old installation entirely
    if dest.exists() {
        std::fs::remove_dir_all(&dest)
            .map_err(|e| format!("Cannot remove old plugin at '{}': {e}", dest.display()))?;
        tracing::info!("Removed old plugin from '{}'", dest.display());
    }

    // 2. Create fresh directory
    std::fs::create_dir_all(&dest)
        .map_err(|e| format!("Cannot create plugin dir '{}': {e}", dest.display()))?;

    // 3. Copy new files
    copy_dir_recursive(plugin_src_dir, &dest)?;

    // 4. Clear Python bytecode caches so KiCad loads fresh source
    clear_pycache(&dest);

    tracing::info!("Bridge plugin cleanly reinstalled to '{}'", dest.display());
    Ok(dest)
}

/// Recursively delete `__pycache__/` dirs and `.pyc` / `.pyo` files.
/// Called after a fresh plugin copy so KiCad doesn't use stale bytecode.
pub fn clear_pycache(dir: &Path) {
    let Ok(entries) = std::fs::read_dir(dir) else { return; };
    for entry in entries.flatten() {
        let path = entry.path();
        let name = entry.file_name();
        let name_s = name.to_string_lossy();
        if path.is_dir() {
            if name_s == "__pycache__" {
                let _ = std::fs::remove_dir_all(&path);
                tracing::debug!("Cleared pycache: {}", path.display());
            } else {
                clear_pycache(&path);
            }
        } else if name_s.ends_with(".pyc") || name_s.ends_with(".pyo") {
            let _ = std::fs::remove_file(&path);
        }
    }
}

// ── Multi-instance port scan ──────────────────────────────────────────────────

/// Scan a range of ports for active KiMaster bridge WebSocket servers.
///
/// For each port in `start_port..start_port+count` (typically 40001–40010):
///   1. Try a TCP connection with a short timeout (~150 ms).
///   2. If TCP connects, attempt a WebSocket handshake + `hello` message.
///   3. Parse the `hello_ack` to extract board name and KiCad version.
///
/// Returns all ports that respond with a valid bridge handshake.
/// A normal single-KiCad setup returns exactly one entry.  Multiple entries
/// mean more than one KiCad instance is running the plugin.
pub async fn scan_bridge_instances(start_port: u16, count: u16) -> Vec<KiCadInstance> {
    let mut handles = Vec::new();

    for offset in 0..count {
        let port = start_port.saturating_add(offset);
        handles.push(tokio::spawn(probe_port(port)));
    }

    let mut instances = Vec::new();
    for handle in handles {
        if let Ok(Some(inst)) = handle.await {
            instances.push(inst);
        }
    }

    // Sort by port for deterministic ordering
    instances.sort_by_key(|i| i.port);
    instances
}

/// Probe one port: TCP → WebSocket handshake → read messages until bridge identified.
///
/// The KiMaster Python plugin sends `board_state` **immediately on connect**
/// before it even reads the client's `hello` message.  So the message sequence
/// from our perspective is:
///   1. We connect
///   2. Plugin → us: `board_state`   (unsolicited, contains board file + nets)
///   3. Plugin → us: `hello_ack`     (response to our hello, contains kicad_version)
///
/// We accept a port as a valid bridge as soon as we receive EITHER message type.
/// Board name comes from whichever arrives first.
async fn probe_port(port: u16) -> Option<KiCadInstance> {
    use tokio::net::TcpStream;
    use tokio::time::{timeout, Instant};
    use tokio_tungstenite::{client_async, tungstenite::Message};
    use futures_util::{SinkExt, StreamExt};
    use serde_json::Value;

    let addr = format!("127.0.0.1:{port}");

    // Step 1: TCP reachability — short timeout so we don't block on closed ports
    let stream = timeout(
        Duration::from_millis(150),
        TcpStream::connect(&addr),
    ).await.ok()?.ok()?;

    // Step 2: WebSocket handshake
    let ws_url = format!("ws://127.0.0.1:{port}");
    let (mut ws, _) = timeout(
        Duration::from_millis(400),
        client_async(ws_url, stream),
    ).await.ok()?.ok()?;

    // Step 3: Send hello (plugin will respond after it sends its initial board_state)
    let hello = serde_json::json!({
        "type": "hello",
        "client": "kimaster-probe",
        "version": "0.1.0"
    });
    if ws.send(Message::Text(hello.to_string().into())).await.is_err() {
        return None;
    }

    // Step 4: Read messages until we identify the bridge or the deadline passes.
    // We may receive board_state BEFORE hello_ack — accept either as confirmation.
    let deadline = Instant::now() + Duration::from_millis(1200);
    let mut board_name:    Option<String> = None;
    let mut kicad_version: Option<String> = None;
    let mut confirmed = false;

    loop {
        let remaining = deadline.saturating_duration_since(Instant::now());
        if remaining.is_zero() { break; }

        let Ok(Some(Ok(msg))) = timeout(remaining, ws.next()).await else { break; };
        let text = match msg { Message::Text(t) => t, _ => continue };
        let Ok(val) = serde_json::from_str::<Value>(&text) else { continue };

        match val["type"].as_str() {
            Some("board_state") => {
                // Plugin sent initial board state — we know this is a live bridge.
                // Extract board file path from the state payload.
                let data = &val["data"];
                board_name = data["file_name"].as_str()
                    .or_else(|| data["board_name"].as_str())
                    .or_else(|| val["board_name"].as_str())
                    .map(String::from);
                confirmed = true;
                // Keep reading — hello_ack may follow with kicad_version
            }
            Some("hello_ack") => {
                // Plugin responded to our hello — confirms bridge + gives version
                kicad_version = val["kicad_version"].as_str().map(String::from);
                if board_name.is_none() {
                    board_name = val["pcb_path"].as_str()
                        .or_else(|| val["board"].as_str())
                        .map(String::from);
                }
                confirmed = true;
                break; // hello_ack is the final confirmation — no need to read more
            }
            _ => continue,
        }
    }

    let _ = ws.close(None).await;

    if confirmed {
        Some(KiCadInstance { port, board_name, kicad_version })
    } else {
        None
    }
}

// ── Internal helpers ─────────────────────────────────────────────────────────

fn copy_dir_recursive(src: &Path, dst: &Path) -> Result<(), String> {
    for entry in std::fs::read_dir(src)
        .map_err(|e| format!("Cannot read '{}': {e}", src.display()))?
    {
        let entry    = entry.map_err(|e| e.to_string())?;
        let src_path = entry.path();
        let dst_path = dst.join(entry.file_name());

        if src_path.is_dir() {
            std::fs::create_dir_all(&dst_path).map_err(|e| e.to_string())?;
            copy_dir_recursive(&src_path, &dst_path)?;
        } else {
            std::fs::copy(&src_path, &dst_path).map_err(|e| {
                format!("Copy '{}' → '{}': {e}", src_path.display(), dst_path.display())
            })?;
        }
    }
    Ok(())
}
