//! Python plugin WebSocket bridge — Phase 3.
//! WsClient manages the async connection. BridgeInstaller writes the plugin.

pub mod WsClient;

pub use WsClient::{spawn_bridge_task, BridgeCmd};

use std::path::{Path, PathBuf};
use std::time::Duration;
use serde::Serialize;
use crate::AppConfig;

// ── Embedded plugin files ─────────────────────────────────────────────────────
// All Python source files are baked into the binary at compile time.
// No external resource directory is needed at runtime.

const PLUGIN_FILES: &[(&str, &str)] = &[
    ("__init__.py",          include_str!("../../../../bridge/kimaster_plugin/__init__.py")),
    ("KiMasterPlugin.py",    include_str!("../../../../bridge/kimaster_plugin/KiMasterPlugin.py")),
    ("WsServer.py",          include_str!("../../../../bridge/kimaster_plugin/WsServer.py")),
    ("BoardExporter.py",     include_str!("../../../../bridge/kimaster_plugin/BoardExporter.py")),
    ("BoardChangeWatcher.py",include_str!("../../../../bridge/kimaster_plugin/BoardChangeWatcher.py")),
    ("SelectionWatcher.py",  include_str!("../../../../bridge/kimaster_plugin/SelectionWatcher.py")),
    ("SchematicExporter.py", include_str!("../../../../bridge/kimaster_plugin/SchematicExporter.py")),
    ("metadata.json",        include_str!("../../../../bridge/kimaster_plugin/metadata.json")),
    // Board-ops package — imported by WsServer.py as `from .ops import ViaStitch, Teardrops, Panelize`.
    // Written into an `ops/` subdirectory by write_embedded_plugin (path contains '/').
    ("ops/__init__.py",      include_str!("../../../../bridge/kimaster_plugin/ops/__init__.py")),
    ("ops/ViaStitch.py",     include_str!("../../../../bridge/kimaster_plugin/ops/ViaStitch.py")),
    ("ops/Teardrops.py",     include_str!("../../../../bridge/kimaster_plugin/ops/Teardrops.py")),
    ("ops/Panelize.py",      include_str!("../../../../bridge/kimaster_plugin/ops/Panelize.py")),
];

/// Binary plugin assets (icons) — referenced by KiMasterPlugin.py via
/// `resources/icon.png` / `resources/icon@2x.png`.
const PLUGIN_BINARY_FILES: &[(&str, &[u8])] = &[
    ("resources/icon.png",    include_bytes!("../../../../bridge/kimaster_plugin/resources/icon.png")),
    ("resources/icon@2x.png", include_bytes!("../../../../bridge/kimaster_plugin/resources/icon@2x.png")),
];

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

/// Write the embedded bridge plugin files to the KiCad scripting plugins directory.
/// Does NOT remove existing files — use `reinstall_bridge_plugin` for a clean wipe.
pub fn install_bridge_plugin(home_dir: &Path) -> Result<PathBuf, String> {
    let dest = plugin_install_dir(home_dir);
    std::fs::create_dir_all(&dest)
        .map_err(|e| format!("Cannot create plugin dir '{}': {e}", dest.display()))?;
    write_embedded_plugin(&dest)?;
    tracing::info!("Bridge plugin installed to '{}'", dest.display());
    Ok(dest)
}

/// **Clean** reinstall: wipe the existing plugin directory, write fresh embedded files,
/// then remove all Python bytecode caches so KiCad recompiles from source.
pub fn reinstall_bridge_plugin(home_dir: &Path) -> Result<PathBuf, String> {
    let dest = plugin_install_dir(home_dir);

    if dest.exists() {
        std::fs::remove_dir_all(&dest)
            .map_err(|e| format!("Cannot remove old plugin at '{}': {e}", dest.display()))?;
        tracing::info!("Removed old plugin from '{}'", dest.display());
    }

    std::fs::create_dir_all(&dest)
        .map_err(|e| format!("Cannot create plugin dir '{}': {e}", dest.display()))?;
    write_embedded_plugin(&dest)?;
    clear_pycache(&dest);

    tracing::info!("Bridge plugin cleanly reinstalled to '{}'", dest.display());
    Ok(dest)
}

/// Write all embedded plugin files to `dest/`. Filenames may contain `/`
/// (e.g. `ops/ViaStitch.py`) — parent directories are created as needed.
fn write_embedded_plugin(dest: &Path) -> Result<(), String> {
    for (filename, content) in PLUGIN_FILES {
        write_one(dest, filename, content.as_bytes())?;
    }
    for (filename, bytes) in PLUGIN_BINARY_FILES {
        write_one(dest, filename, bytes)?;
    }
    Ok(())
}

fn write_one(dest: &Path, filename: &str, bytes: &[u8]) -> Result<(), String> {
    let path = dest.join(filename);
    if let Some(parent) = path.parent() {
        std::fs::create_dir_all(parent)
            .map_err(|e| format!("Cannot create dir '{}': {e}", parent.display()))?;
    }
    std::fs::write(&path, bytes)
        .map_err(|e| format!("Cannot write '{}': {e}", path.display()))
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

    // Sort by port so lowest port (original activation) comes first
    instances.sort_by_key(|i| i.port);

    // Deduplicate by board_name: two ports serving the same .kicad_pcb file
    // means the plugin was activated twice in the same KiCad session (e.g.,
    // after Rescan Plugins without a full restart).  Keep the lowest port —
    // that's the original (and only intentional) server.
    let mut seen: std::collections::HashSet<String> = std::collections::HashSet::new();
    instances.retain(|inst| {
        let key = inst.board_name.as_deref().unwrap_or("")
            .to_lowercase()
            .replace('\\', "/");
        // insert() returns true the FIRST time (keep it), false for duplicates (drop)
        if key.is_empty() {
            true  // no board name — can't dedup, keep all
        } else {
            seen.insert(key)
        }
    });

    instances
}

/// Probe one port: TCP → WS handshake → send probe hello → read hello_ack.
///
/// Updated protocol (probe-aware plugin):
///   1. We connect
///   2. We send `{"type":"hello","client":"kimaster-probe",...}` immediately
///   3. Plugin reads our hello FIRST, detects it is a probe
///   4. Plugin → us: `hello_ack`  (board_name + kicad_version, no board data)
///   5. Plugin closes its side
///
/// The plugin's `_handler` now reads the hello before sending anything.
/// Probe connections bypass the MAX_CLIENTS=1 guard — they never receive
/// board data, just enough metadata for the scan to identify the bridge.
async fn probe_port(port: u16) -> Option<KiCadInstance> {
    use tokio::net::TcpStream;
    use tokio::time::{timeout, Instant};
    use tokio_tungstenite::{client_async, tungstenite::Message};
    use futures_util::{SinkExt, StreamExt};
    use serde_json::Value;

    let addr = format!("127.0.0.1:{port}");

    // Step 1: TCP reachability — very short timeout (closed ports fail fast)
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

    // Step 3: Send probe hello IMMEDIATELY (plugin waits for this before doing anything)
    let hello = serde_json::json!({
        "type":    "hello",
        "client":  "kimaster-probe",
        "version": "0.1.0"
    });
    if ws.send(Message::Text(hello.to_string().into())).await.is_err() {
        return None;
    }

    // Step 4: Wait for hello_ack — the only response a probe receives.
    // The plugin may also send an error if it's an older version without probe
    // support; in that case we fall back to accepting board_state too.
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
            Some("hello_ack") => {
                kicad_version = val["kicad_version"].as_str().map(String::from);
                board_name    = val["pcb_path"].as_str()
                    .or_else(|| val["board"].as_str())
                    .map(String::from);
                confirmed = true;
                break;
            }
            // Fallback: older plugin versions still send board_state first
            Some("board_state") => {
                let data = &val["data"];
                board_name = data["file_name"].as_str()
                    .or_else(|| data["board_name"].as_str())
                    .map(String::from);
                confirmed = true;
                // Keep reading — hello_ack may follow
            }
            Some("error") => {
                // Older plugin at capacity (no probe-aware code yet) —
                // something IS running on this port; break without board details
                tracing::debug!("Bridge probe on port {port}: received error (older plugin?)");
                break;
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

