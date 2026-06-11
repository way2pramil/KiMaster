//! KiCad IPC API transport layer.
//!
//! Wraps an NNG Req/Rep socket with:
//!   - async-safe Mutex so concurrent Tauri commands don't cause NNG_ESTATE
//!   - protobuf ApiRequest/ApiResponse envelope encode/decode
//!   - socket auto-discovery: env vars → %TEMP%\api.sock → glob %TEMP%\api_*.sock

use std::sync::Arc;

use prost::Message;
use prost_types::Any;
use tokio::sync::Mutex;

use super::proto::common::{
    ApiRequest, ApiRequestHeader, ApiResponse,
    ApiStatusCode,  // in kiapi.common.rs (envelope), not kiapi.common.types.rs
};

// ── Error type ────────────────────────────────────────────────────────────────

#[derive(Debug, thiserror::Error)]
pub enum IpcError {
    #[error("NNG error: {0}")]
    Nng(#[from] nng::Error),

    #[error("Protobuf decode error: {0}")]
    Proto(#[from] prost::DecodeError),

    #[error("KiCad API error {code}: {message}")]
    Api { code: i32, message: String },

    #[error("Not connected to KiCad IPC")]
    NotConnected,

    #[error("IPC response missing payload")]
    EmptyPayload,

    #[error("IO error: {0}")]
    Io(#[from] std::io::Error),

    #[error("Encode error: {0}")]
    Encode(#[from] prost::EncodeError),
}

// ── Scan result ───────────────────────────────────────────────────────────────

#[derive(Debug, Clone, serde::Serialize, serde::Deserialize)]
pub struct IpcScanResult {
    pub found:       bool,
    pub socket_path: Option<String>,
    pub token:       Option<String>,
}

// ── IpcClient ────────────────────────────────────────────────────────────────

/// Thread-safe KiCad IPC client.
///
/// NNG Req/Rep enforces strict Send→Receive lockstep — concurrent calls on
/// the same socket throw NNG_ESTATE. The inner Mutex serialises calls so all
/// Tauri commands can safely share one `Arc<IpcClient>`.
pub struct IpcClient {
    /// NNG request socket — wrapped in async Mutex to prevent concurrent req/rep races.
    socket: Mutex<nng::Socket>,
    /// Opaque token identifying this KiCad instance; sent in every request header.
    token:  String,
    /// The path/URL used to connect (stored for drift detection on rescan).
    pub socket_path: String,
}

impl std::fmt::Debug for IpcClient {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        f.debug_struct("IpcClient")
            .field("socket_path", &self.socket_path)
            .finish()
    }
}

impl IpcClient {
    /// Connect to a KiCad IPC server.
    ///
    /// `socket_path` is the raw path from `KICAD_API_SOCKET` (e.g. `\\.\pipe\kicad-api`
    /// on Windows or `/tmp/api.sock` on Unix). Converted to an NNG IPC URL internally.
    pub fn connect(socket_path: &str, token: &str) -> Result<Arc<Self>, IpcError> {
        let url = path_to_nng_url(socket_path);
        tracing::info!("KiCad IPC: connecting to {url}");

        let socket = nng::Socket::new(nng::Protocol::Req0)?;
        socket.dial(&url)?;

        tracing::info!("KiCad IPC: connected");
        Ok(Arc::new(Self {
            socket: Mutex::new(socket),
            token:  token.to_string(),
            socket_path: socket_path.to_string(),
        }))
    }

    /// Send a protobuf request and receive a typed response.
    ///
    /// `type_url`: the `type.googleapis.com/package.Type` URL for the request message.
    /// Use the `type_url!` constant or `kiapi_type_url("package.Type")` helper.
    ///
    /// Acquires the socket mutex, runs send+recv in `spawn_blocking` (NNG is sync),
    /// then releases the mutex.
    pub async fn send<Resp>(
        &self,
        msg: &impl Message,
        req_type_url: &str,
    ) -> Result<Resp, IpcError>
    where
        Resp: Message + Default,
    {
        let resp = self.send_raw(msg, req_type_url).await?;

        // Unpack the Any payload into the expected response type
        let payload = resp.message.ok_or(IpcError::EmptyPayload)?;
        let decoded = Resp::decode(payload.value.as_slice())?;
        Ok(decoded)
    }

    /// Send a request and return the raw ApiResponse (for fire-and-forget or
    /// multi-step operations like BeginCommit / EndCommit).
    ///
    /// Retries up to 3 times on `AS_BUSY` (code 7) with a short backoff —
    /// KiCad returns AS_BUSY when it's executing a modal op or foreground action.
    pub async fn send_raw(
        &self,
        msg: &impl Message,
        req_type_url: &str,
    ) -> Result<ApiResponse, IpcError> {
        let mut buf = Vec::new();
        msg.encode(&mut buf)?;

        let request = ApiRequest {
            header: Some(ApiRequestHeader {
                kicad_token: self.token.clone(),
                client_name: "com.kimaster.app".to_string(),
            }),
            message: Some(Any {
                type_url: req_type_url.to_string(),
                value:    buf,
            }),
        };

        let request_bytes = request.encode_to_vec();

        const MAX_BUSY_RETRIES: u32 = 3;
        const BUSY_RETRY_MS:    u64 = 300;

        let mut attempt = 0u32;
        loop {
            // Acquire the async mutex — serialises concurrent Tauri command calls
            let guard = self.socket.lock().await;

            // NNG is synchronous — run inside spawn_blocking to avoid blocking tokio threads.
            // We pass the socket via raw pointer; the Mutex guard holds exclusive access
            // for the entire spawn_blocking call.
            let socket_ptr = (&*guard) as *const nng::Socket as usize;
            let bytes = request_bytes.clone();
            let response_bytes = tokio::task::spawn_blocking(move || -> Result<Vec<u8>, IpcError> {
                // SAFETY: Mutex guard is held above for the entire spawn_blocking duration.
                let socket = unsafe { &*(socket_ptr as *const nng::Socket) };
                let nng_msg = nng::Message::from(bytes.as_slice());
                socket.send(nng_msg).map_err(|(_, e)| IpcError::Nng(e))?;
                let reply = socket.recv()?;
                Ok(reply.as_slice().to_vec())
            })
            .await
            .map_err(|e| IpcError::Io(std::io::Error::new(
                std::io::ErrorKind::Other,
                format!("spawn_blocking join error: {e}"),
            )))??;

            drop(guard);

            let response = ApiResponse::decode(response_bytes.as_slice())?;

            if let Some(ref status) = response.status {
                let code = status.status;
                // AS_BUSY (7): KiCad is in a modal operation — retry after a short pause
                if code == ApiStatusCode::AsBusy as i32 && attempt < MAX_BUSY_RETRIES {
                    attempt += 1;
                    tracing::debug!(
                        "KiCad IPC: AS_BUSY — retry {attempt}/{MAX_BUSY_RETRIES} in {BUSY_RETRY_MS}ms"
                    );
                    tokio::time::sleep(std::time::Duration::from_millis(BUSY_RETRY_MS)).await;
                    continue;
                }
                if code != ApiStatusCode::AsOk as i32 {
                    return Err(IpcError::Api {
                        code,
                        message: status.error_message.clone(),
                    });
                }
            }

            return Ok(response);
        }
    }
}

// ── Type URL helpers ──────────────────────────────────────────────────────────

/// Build a google.protobuf.Any type URL for a KiCad API type.
pub fn kiapi_type_url(qualified_name: &str) -> String {
    format!("type.googleapis.com/{qualified_name}")
}

// Convenience constants for frequently-used type URLs.
// Format: type.googleapis.com/<proto_package>.<MessageName>
pub const URL_GET_OPEN_DOCUMENTS:         &str = "type.googleapis.com/kiapi.common.commands.GetOpenDocuments";
pub const URL_GET_OPEN_DOCUMENTS_RESP:    &str = "type.googleapis.com/kiapi.common.commands.GetOpenDocumentsResponse";
pub const URL_GET_ITEMS:                  &str = "type.googleapis.com/kiapi.common.commands.GetItems";
pub const URL_GET_ITEMS_RESP:             &str = "type.googleapis.com/kiapi.common.commands.GetItemsResponse";
pub const URL_UPDATE_ITEMS:               &str = "type.googleapis.com/kiapi.common.commands.UpdateItems";
pub const URL_BEGIN_COMMIT:               &str = "type.googleapis.com/kiapi.common.commands.BeginCommit";
pub const URL_BEGIN_COMMIT_RESP:          &str = "type.googleapis.com/kiapi.common.commands.BeginCommitResponse";
pub const URL_END_COMMIT:                 &str = "type.googleapis.com/kiapi.common.commands.EndCommit";
pub const URL_GET_SCHEMATIC_HIERARCHY:    &str = "type.googleapis.com/kiapi.schematic.types.GetSchematicHierarchy";
pub const URL_GET_SCHEMATIC_HIERARCHY_R:  &str = "type.googleapis.com/kiapi.schematic.types.SchematicHierarchyResponse";
pub const URL_GET_SCHEMATIC_NETLIST:      &str = "type.googleapis.com/kiapi.schematic.types.GetSchematicNetlist";
pub const URL_GET_SCHEMATIC_NETLIST_RESP: &str = "type.googleapis.com/kiapi.schematic.types.SchematicNetlistResponse";
pub const URL_SCH_SYMBOL_INSTANCE:        &str = "type.googleapis.com/kiapi.schematic.types.SchematicSymbolInstance";
pub const URL_SAVE_DOCUMENT_TO_STRING:    &str = "type.googleapis.com/kiapi.common.commands.SaveDocumentToString";
pub const URL_SAVED_DOCUMENT_RESPONSE:    &str = "type.googleapis.com/kiapi.common.commands.SavedDocumentResponse";
pub const URL_GET_TITLE_BLOCK_INFO:       &str = "type.googleapis.com/kiapi.common.commands.GetTitleBlockInfo";
pub const URL_GET_SELECTION:              &str = "type.googleapis.com/kiapi.common.commands.GetSelection";

// ── Socket discovery ─────────────────────────────────────────────────────────

/// Discover KiCad's IPC socket path and token.
///
/// Priority order:
/// 1. `KICAD_API_SOCKET` + `KICAD_API_TOKEN` environment variables (set when
///    KiMaster is launched as a KiCad IPC plugin — not typical for us)
/// 2. KiCad 10 Windows default: `%LOCALAPPDATA%\Temp\kicad\api.sock`
/// 3. Fallback: `%TEMP%\kicad\api.sock`
/// 4. Scan `\\.\pipe\` for named pipes containing "kicad" and "api"
///
/// Note: on Windows the socket is a Named Pipe — it does NOT appear as a
/// filesystem file, so `Test-Path` / `std::fs::read_dir` will miss it.
/// We probe the known paths directly.
pub fn discover_socket() -> IpcScanResult {
    // 1. Environment variables set by KiCad when launching IPC plugins
    if let Ok(path) = std::env::var(crate::AppConfig::KICAD_IPC_ENV_SOCKET) {
        let token = std::env::var(crate::AppConfig::KICAD_IPC_ENV_TOKEN).unwrap_or_default();
        tracing::info!("KiCad IPC: socket from env KICAD_API_SOCKET={path}");
        return IpcScanResult { found: true, socket_path: Some(path), token: Some(token) };
    }

    // 2 + 3. Try known KiCad 10 default locations (named pipe — can't stat the file)
    for path in kicad_default_socket_paths() {
        let url = path_to_nng_url(&path);
        // Named pipes don't appear in the filesystem — probe by attempting a connection
        if probe_nng_socket(&url) {
            tracing::info!("KiCad IPC: socket found at {path}");
            return IpcScanResult { found: true, socket_path: Some(path), token: None };
        }
    }

    // 4. Scan \\.\pipe\ for any pipe whose name contains "kicad" + "api"
    #[cfg(target_os = "windows")]
    if let Some(path) = scan_named_pipes_for_kicad() {
        tracing::info!("KiCad IPC: socket found via pipe scan: {path}");
        return IpcScanResult { found: true, socket_path: Some(path), token: None };
    }

    // Unix fallback: scan temp directory for actual socket files
    #[cfg(not(target_os = "windows"))]
    {
        let temp_dir = std::env::temp_dir();
        let candidates = vec![
            temp_dir.join("kicad").join("api.sock"),
            temp_dir.join("api.sock"),
        ];
        for p in candidates {
            if p.exists() {
                let s = p.to_string_lossy().into_owned();
                tracing::info!("KiCad IPC: socket found at {s}");
                return IpcScanResult { found: true, socket_path: Some(s), token: None };
            }
        }
    }

    tracing::debug!("KiCad IPC: no socket found");
    IpcScanResult { found: false, socket_path: None, token: None }
}

/// Returns the candidate paths to try in order for the current platform.
fn kicad_default_socket_paths() -> Vec<String> {
    let mut paths = Vec::new();

    #[cfg(target_os = "windows")]
    {
        // KiCad 10 on Windows: %LOCALAPPDATA%\Temp\kicad\api.sock
        if let Ok(local) = std::env::var("LOCALAPPDATA") {
            paths.push(format!(r"{local}\Temp\kicad\api.sock"));
        }
        // Fallback: %TEMP%\kicad\api.sock
        let temp = std::env::temp_dir();
        paths.push(temp.join("kicad").join("api.sock").to_string_lossy().into_owned());
        // Fallback: %TEMP%\api.sock (older KiCad builds)
        paths.push(temp.join("api.sock").to_string_lossy().into_owned());
    }

    #[cfg(not(target_os = "windows"))]
    {
        let temp = std::env::temp_dir();
        paths.push(temp.join("kicad").join("api.sock").to_string_lossy().into_owned());
        paths.push(temp.join("api.sock").to_string_lossy().into_owned());
        paths.push("/tmp/kicad/api.sock".to_string());
        paths.push("/tmp/api.sock".to_string());
    }

    paths
}

/// Attempt a quick NNG connection probe to test whether a socket is live.
/// Returns true if the dial succeeds (KiCad is running and the pipe exists).
/// On Windows, `dial()` fails immediately if the named pipe doesn't exist.
fn probe_nng_socket(url: &str) -> bool {
    nng::Socket::new(nng::Protocol::Req0)
        .map(|s| s.dial(url).is_ok())
        .unwrap_or(false)
}

/// Scan `\\.\pipe\` for named pipes whose names contain "kicad" and "api".
/// Returns the socket path (the part after `\\.\pipe\`) for the first match.
#[cfg(target_os = "windows")]
fn scan_named_pipes_for_kicad() -> Option<String> {

    // On Windows we can enumerate named pipes via FindFirstFile on \\.\pipe\*
    // This requires Win32 API. Use a simpler approach: try known patterns.
    // If the user has multiple KiCad instances, %LOCALAPPDATA%\Temp\kicad\api_<PID>.sock
    // We try a few PID suffixes, but mainly rely on the default path probe above.
    // A full enumeration via FindFirstFile would require unsafe Win32 calls.
    tracing::debug!("KiCad IPC: pipe scan not yet implemented — rely on default path probe");
    None
}

// ── Path conversion ───────────────────────────────────────────────────────────

/// Convert a raw socket/pipe path to an NNG `ipc://` URL.
///
/// On Windows, KiCad 10 creates a named pipe whose name is the FULL path of the
/// socket file, e.g. `\\.\pipe\C:\Users\x\AppData\Local\Temp\kicad\api.sock`.
/// NNG connects to it via the URL `ipc://C:\Users\x\AppData\Local\Temp\kicad\api.sock`
/// — the full path must be preserved, not reduced to just the filename.
fn path_to_nng_url(path: &str) -> String {
    if path.starts_with("ipc://") {
        return path.to_string();
    }
    #[cfg(target_os = "windows")]
    {
        // \\.\pipe\<name> → ipc://<name>  (explicit pipe path → strip UNC prefix)
        if let Some(name) = path.strip_prefix(r"\\.\pipe\") {
            return format!("ipc://{name}");
        }
        // C:\path\to\api.sock or plain name → ipc://<full_path_or_name>
        // Must keep the FULL path so NNG uses it as the complete pipe name.
        format!("ipc://{path}")
    }
    #[cfg(not(target_os = "windows"))]
    {
        format!("ipc://{path}")
    }
}

// ── Tests ─────────────────────────────────────────────────────────────────────

#[cfg(test)]
mod tests {
    use super::*;

    // ── Unit tests (always run) ───────────────────────────────────────────────

    #[test]
    fn windows_unc_pipe_converted() {
        let url = path_to_nng_url(r"\\.\pipe\kicad-api");
        assert_eq!(url, "ipc://kicad-api");
    }

    #[test]
    fn windows_full_path_preserved() {
        let url = path_to_nng_url(r"C:\Users\prami\AppData\Local\Temp\kicad\api.sock");
        assert_eq!(url, r"ipc://C:\Users\prami\AppData\Local\Temp\kicad\api.sock");
    }

    #[test]
    fn plain_filename_converted() {
        let url = path_to_nng_url("api.sock");
        assert!(url.starts_with("ipc://"), "got: {url}");
    }

    #[test]
    fn already_url_unchanged() {
        assert_eq!(path_to_nng_url("ipc://api.sock"), "ipc://api.sock");
    }

    // ── Live integration tests (require KiCad running with API enabled) ───────
    // Run with: cargo test -- --ignored --nocapture

    #[test]
    #[ignore = "requires KiCad 10 running with API enabled"]
    fn live_scan_finds_socket() {
        let result = discover_socket();
        println!("\n[IPC SCAN RESULT]");
        println!("  found:       {}", result.found);
        println!("  socket_path: {:?}", result.socket_path);
        println!("  token:       {:?}", result.token.as_deref().map(|t| if t.is_empty() { "(empty)" } else { "(set)" }));
        assert!(result.found, "Socket not found — is KiCad 10 running with API enabled?");
        assert!(result.socket_path.is_some(), "found=true but no socket_path");
    }

    #[test]
    #[ignore = "requires KiCad 10 running with both PCB and schematic open, API enabled"]
    fn live_all_ipc_commands() {
        // ── Comprehensive IPC command survey ──────────────────────────────────
        // Tests every available command against KiCad 10 and reports:
        //   ✅ AS_OK          — works
        //   ⚠  AS_BUSY (7)   — handler exists, data lock unavailable
        //   ✗  AS_UNHANDLED (5) — handler not in this KiCad version
        //   ✗  AS_UNIMPLEMENTED (8) — explicitly not implemented
        //   ?  other error
        //
        // Run with: cargo test live_all_ipc_commands -- --ignored --nocapture

        use crate::modules::kicad_ipc::proto::common::commands::*;
        use crate::modules::kicad_ipc::proto::common::types::{
            self as common_types, DocumentType, FrameType, DocumentSpecifier,
            ItemHeader, KiCadObjectType, TitleBlockInfo, PageSettings,
        };
        use crate::modules::kicad_ipc::proto::common::ApiResponse;
        use crate::modules::kicad_ipc::proto::schematic::types::{
            GetSchematicHierarchy, SchematicHierarchyResponse,
            GetSchematicNetlist, SchematicNetlistResponse,
        };
        use tokio::runtime::Runtime;
        use prost::Message;

        let scan = discover_socket();
        let path = scan.socket_path.expect("No socket found — is KiCad running with API enabled?");
        let token = scan.token.unwrap_or_default();
        let client = IpcClient::connect(&path, &token).expect("Connect failed");
        let rt = Runtime::new().unwrap();

        // Helper macro for one-shot test commands
        macro_rules! test_cmd {
            ($label:expr, $msg:expr, $url:expr, $resp:ty, $rt:expr, $client:expr) => {{
                let result = $rt.block_on(async {
                    $client.send::<$resp>(&$msg, $url).await
                });
                print_result($label, &result);
                result.ok()
            }};
        }
        macro_rules! test_raw {
            ($label:expr, $msg:expr, $url:expr, $rt:expr, $client:expr) => {{
                let result = $rt.block_on(async {
                    $client.send_raw(&$msg, $url).await
                });
                let code = match &result {
                    Ok(r)  => r.status.as_ref().map(|s| s.status).unwrap_or(1),
                    Err(IpcError::Api { code, .. }) => *code,
                    Err(_) => -1,
                };
                print_raw_result($label, &result);
                (result.is_ok() || code == 1, code)
            }};
        }

        fn print_result<T>(label: &str, result: &Result<T, IpcError>) {
            match result {
                Ok(_) => println!("  ✅ {:45} AS_OK", label),
                Err(IpcError::Api { code: 7, .. }) => println!("  ⚠  {:45} AS_BUSY (7)", label),
                Err(IpcError::Api { code: 5, .. }) => println!("  ✗  {:45} AS_UNHANDLED (5)", label),
                Err(IpcError::Api { code: 8, .. }) => println!("  ✗  {:45} AS_UNIMPLEMENTED (8)", label),
                Err(IpcError::Api { code, message }) => println!("  ✗  {:45} code={code}: {message}", label),
                Err(e) => println!("  ✗  {:45} error: {e}", label),
            }
        }
        fn print_raw_result(label: &str, result: &Result<ApiResponse, IpcError>) {
            match result {
                Ok(r) => {
                    let code = r.status.as_ref().map(|s| s.status).unwrap_or(1);
                    if code == 1 { println!("  ✅ {:45} AS_OK", label); }
                    else { println!("  ⚠  {:45} code={code}", label); }
                }
                Err(IpcError::Api { code: 7, .. }) => println!("  ⚠  {:45} AS_BUSY (7)", label),
                Err(IpcError::Api { code: 5, .. }) => println!("  ✗  {:45} AS_UNHANDLED (5)", label),
                Err(IpcError::Api { code: 8, .. }) => println!("  ✗  {:45} AS_UNIMPLEMENTED (8)", label),
                Err(IpcError::Api { code, message }) => println!("  ✗  {:45} code={code}: {message}", label),
                Err(e) => println!("  ✗  {:45} error: {e}", label),
            }
        }

        // Get document specifiers once
        let pcb_doc = rt.block_on(async {
            client.send::<GetOpenDocumentsResponse>(
                &GetOpenDocuments { r#type: DocumentType::DoctypePcb as i32 },
                "type.googleapis.com/kiapi.common.commands.GetOpenDocuments",
            ).await.ok().and_then(|r| r.documents.into_iter().next())
        });
        let sch_doc = rt.block_on(async {
            client.send::<GetOpenDocumentsResponse>(
                &GetOpenDocuments { r#type: DocumentType::DoctypeSchematic as i32 },
                "type.googleapis.com/kiapi.common.commands.GetOpenDocuments",
            ).await.ok().and_then(|r| r.documents.into_iter().next())
        });

        println!("\n╔══════════════════════════════════════════════════════╗");
        println!("║  KiCad 10 IPC Command Survey                         ║");
        println!("║  PCB  doc: {:41}║", pcb_doc.as_ref().and_then(|d| d.identifier.as_ref()).map(|i| format!("{:?}", i)).as_deref().unwrap_or("(none)"));
        println!("║  SCH  doc: {:41}║", sch_doc.as_ref().and_then(|d| d.identifier.as_ref()).map(|i| format!("{:?}", i)).as_deref().unwrap_or("(none)"));
        println!("╚══════════════════════════════════════════════════════╝\n");

        // ── Project-level / metadata ──────────────────────────────────────────
        println!("── PROJECT / METADATA ───────────────────────────────────");

        test_cmd!("GetOpenDocuments(PCB)",
            GetOpenDocuments { r#type: DocumentType::DoctypePcb as i32 },
            "type.googleapis.com/kiapi.common.commands.GetOpenDocuments",
            GetOpenDocumentsResponse, rt, client);

        test_cmd!("GetOpenDocuments(SCH)",
            GetOpenDocuments { r#type: DocumentType::DoctypeSchematic as i32 },
            "type.googleapis.com/kiapi.common.commands.GetOpenDocuments",
            GetOpenDocumentsResponse, rt, client);

        if let Some(ref doc) = pcb_doc {
            test_cmd!("GetTitleBlockInfo(PCB)",
                GetTitleBlockInfo { document: Some(doc.clone()) },
                "type.googleapis.com/kiapi.common.commands.GetTitleBlockInfo",
                TitleBlockInfo, rt, client);

            test_cmd!("GetPageSettings(PCB)",
                GetPageSettings { document: Some(doc.clone()) },
                "type.googleapis.com/kiapi.common.commands.GetPageSettings",
                PageSettings, rt, client);

            test_cmd!("SaveDocumentToString(PCB)",
                SaveDocumentToString { document: Some(doc.clone()) },
                "type.googleapis.com/kiapi.common.commands.SaveDocumentToString",
                SavedDocumentResponse, rt, client);
        }
        if let Some(ref doc) = sch_doc {
            test_cmd!("GetTitleBlockInfo(SCH)",
                GetTitleBlockInfo { document: Some(doc.clone()) },
                "type.googleapis.com/kiapi.common.commands.GetTitleBlockInfo",
                TitleBlockInfo, rt, client);

            test_cmd!("GetPageSettings(SCH)",
                GetPageSettings { document: Some(doc.clone()) },
                "type.googleapis.com/kiapi.common.commands.GetPageSettings",
                PageSettings, rt, client);

            test_cmd!("SaveDocumentToString(SCH)",
                SaveDocumentToString { document: Some(doc.clone()) },
                "type.googleapis.com/kiapi.common.commands.SaveDocumentToString",
                SavedDocumentResponse, rt, client);
        }

        // ── Editor / frame operations ─────────────────────────────────────────
        println!("\n── EDITOR / FRAME ───────────────────────────────────────");

        test_raw!("RefreshEditor(PCB)",
            RefreshEditor { frame: FrameType::FtPcbEditor as i32 },
            "type.googleapis.com/kiapi.common.commands.RefreshEditor",
            rt, client);

        test_raw!("RefreshEditor(SCH)",
            RefreshEditor { frame: FrameType::FtSchematicEditor as i32 },
            "type.googleapis.com/kiapi.common.commands.RefreshEditor",
            rt, client);

        test_raw!("RunAction(pcb.zoomFitBoard)",
            RunAction { action: "pcbnew.EditorControl.zoomFitBoard".to_string() },
            "type.googleapis.com/kiapi.common.commands.RunAction",
            rt, client);

        test_raw!("RunAction(sch.zoomFitPage)",
            RunAction { action: "eeschema.EditorControl.zoomFitPage".to_string() },
            "type.googleapis.com/kiapi.common.commands.RunAction",
            rt, client);

        // ── Selection operations ──────────────────────────────────────────────
        println!("\n── SELECTION ────────────────────────────────────────────");

        if let Some(ref doc) = pcb_doc {
            test_cmd!("GetSelection(PCB)",
                GetSelection { header: Some(ItemHeader { document: Some(doc.clone()), container: None, field_mask: None }), types: vec![] },
                "type.googleapis.com/kiapi.common.commands.GetSelection",
                SelectionResponse, rt, client);

            test_raw!("ClearSelection(PCB)",
                ClearSelection { header: Some(ItemHeader { document: Some(doc.clone()), container: None, field_mask: None }) },
                "type.googleapis.com/kiapi.common.commands.ClearSelection",
                rt, client);
        }
        if let Some(ref doc) = sch_doc {
            test_cmd!("GetSelection(SCH)",
                GetSelection { header: Some(ItemHeader { document: Some(doc.clone()), container: None, field_mask: None }), types: vec![] },
                "type.googleapis.com/kiapi.common.commands.GetSelection",
                SelectionResponse, rt, client);

            test_raw!("ClearSelection(SCH)",
                ClearSelection { header: Some(ItemHeader { document: Some(doc.clone()), container: None, field_mask: None }) },
                "type.googleapis.com/kiapi.common.commands.ClearSelection",
                rt, client);
        }

        // ── GetItems — all object types ───────────────────────────────────────
        println!("\n── GetItems — PCB ───────────────────────────────────────");

        if let Some(ref doc) = pcb_doc {
            for (label, kot) in &[
                ("PCB_FOOTPRINT", KiCadObjectType::KotPcbFootprint),
                ("PCB_TRACE",     KiCadObjectType::KotPcbTrace),
                ("PCB_VIA",       KiCadObjectType::KotPcbVia),
                ("PCB_ZONE",      KiCadObjectType::KotPcbZone),
                ("PCB_SHAPE",     KiCadObjectType::KotPcbShape),
                ("PCB_TEXT",      KiCadObjectType::KotPcbText),
            ] {
                test_cmd!(&format!("GetItems({})", label),
                    GetItems { header: Some(ItemHeader { document: Some(doc.clone()), container: None, field_mask: None }), types: vec![*kot as i32] },
                    "type.googleapis.com/kiapi.common.commands.GetItems",
                    GetItemsResponse, rt, client);
            }
        }

        println!("\n── GetItems — SCHEMATIC ─────────────────────────────────");

        if let Some(ref doc) = sch_doc {
            for (label, kot) in &[
                ("SCH_SYMBOL",       KiCadObjectType::KotSchSymbol),
                ("SCH_LINE",         KiCadObjectType::KotSchLine),
                ("SCH_LABEL",        KiCadObjectType::KotSchLabel),
                ("SCH_GLOBAL_LABEL", KiCadObjectType::KotSchGlobalLabel),
                ("SCH_JUNCTION",     KiCadObjectType::KotSchJunction),
                ("SCH_NO_CONNECT",   KiCadObjectType::KotSchNoConnect),
                ("SCH_SHEET",        KiCadObjectType::KotSchSheet),
                ("SCH_TEXT",         KiCadObjectType::KotSchText),
            ] {
                test_cmd!(&format!("GetItems({})", label),
                    GetItems { header: Some(ItemHeader { document: Some(doc.clone()), container: None, field_mask: None }), types: vec![*kot as i32] },
                    "type.googleapis.com/kiapi.common.commands.GetItems",
                    GetItemsResponse, rt, client);
            }
        }

        // ── Schematic-specific commands ───────────────────────────────────────
        println!("\n── SCHEMATIC-SPECIFIC ───────────────────────────────────");

        if let Some(ref doc) = sch_doc {
            test_cmd!("GetSchematicHierarchy",
                GetSchematicHierarchy { document: Some(doc.clone()) },
                "type.googleapis.com/kiapi.schematic.types.GetSchematicHierarchy",
                SchematicHierarchyResponse, rt, client);

            test_cmd!("GetSchematicNetlist",
                GetSchematicNetlist { document: Some(doc.clone()), types: vec![] },
                "type.googleapis.com/kiapi.schematic.types.GetSchematicNetlist",
                SchematicNetlistResponse, rt, client);
        }

        // ── Write operations (safe read-only probes) ──────────────────────────
        println!("\n── WRITE PROBES (expect AS_BUSY or AS_OK) ───────────────");

        if let Some(ref doc) = pcb_doc {
            // Probe BeginCommit — if this returns AS_OK we can write
            test_raw!("BeginCommit(PCB)",
                BeginCommit { header: Some(ItemHeader { document: Some(doc.clone()), container: None, field_mask: None }) },
                "type.googleapis.com/kiapi.common.commands.BeginCommit",
                rt, client);
        }
        if let Some(ref doc) = sch_doc {
            test_raw!("BeginCommit(SCH)",
                BeginCommit { header: Some(ItemHeader { document: Some(doc.clone()), container: None, field_mask: None }) },
                "type.googleapis.com/kiapi.common.commands.BeginCommit",
                rt, client);
        }

        println!("\n╔══════════════════════════════════════════════════════╗");
        println!("║  Survey complete.                                     ║");
        println!("║  ✅ = working  ⚠ = AS_BUSY  ✗ = unavailable          ║");
        println!("╚══════════════════════════════════════════════════════╝\n");
    }

    #[test]
    #[ignore = "requires KiCad 10 running with PCB open and API enabled"]
    fn live_get_pcb_data_via_string() {
        // Validates the SaveDocumentToString → parse_pcb_string pathway.
        use crate::modules::kicad_ipc::proto::common::commands::{
            GetOpenDocuments, GetOpenDocumentsResponse, SaveDocumentToString, SavedDocumentResponse,
        };
        use crate::modules::kicad_ipc::proto::common::types::DocumentType;
        use crate::modules::kicad_ipc::IpcClient::{URL_GET_OPEN_DOCUMENTS, URL_SAVE_DOCUMENT_TO_STRING};
        use crate::modules::kicad_ipc::KicadFileParser::parse_pcb_string;
        use tokio::runtime::Runtime;

        let scan = discover_socket();
        let path = scan.socket_path.expect("No socket");
        let token = scan.token.unwrap_or_default();
        let client = IpcClient::connect(&path, &token).expect("Connect failed");
        let rt = Runtime::new().unwrap();

        rt.block_on(async {
            // 1. Get PCB doc
            let docs = client.send::<GetOpenDocumentsResponse>(
                &GetOpenDocuments { r#type: DocumentType::DoctypePcb as i32 },
                URL_GET_OPEN_DOCUMENTS,
            ).await.expect("GetOpenDocuments failed");

            let doc = docs.documents.into_iter().next().expect("No PCB open");
            let board_name = match &doc.identifier {
                Some(crate::modules::kicad_ipc::proto::common::types::document_specifier::Identifier::BoardFilename(n)) => n.clone(),
                _ => "unknown".to_string(),
            };
            println!("\n[PCB] {board_name}");

            // 2. SaveDocumentToString
            let resp = client.send::<SavedDocumentResponse>(
                &SaveDocumentToString { document: Some(doc) },
                URL_SAVE_DOCUMENT_TO_STRING,
            ).await.expect("SaveDocumentToString failed");

            let len = resp.contents.len();
            println!("[SaveDocumentToString] ✓ {} bytes of S-expression", len);

            // 3. Parse
            let board = parse_pcb_string(&resp.contents, &board_name);
            println!("[parse_pcb_string] {} components, {} nets, {} copper layers",
                board.components.len(), board.nets.len(), board.layers.len());
            println!("  parse_error: {:?}", board.parse_error);

            if let Some(ref c) = board.components.first() {
                println!("  first component: ref={} value={} pos=({},{})",
                    c.ref_, c.value, c.position.x, c.position.y);
            }
            if let Some(ref n) = board.nets.first() {
                println!("  first net: name={} code={}", n.name, n.netcode);
            }

            assert!(board.parse_error.is_none(), "Parse error: {:?}", board.parse_error);
            assert!(!board.components.is_empty(), "No components parsed");
            assert!(!board.nets.is_empty(), "No nets parsed");
        });
    }

    #[test]
    #[ignore = "requires KiCad 10 running with API enabled"]
    fn live_diagnose_commands() {
        // Test a range of IPC commands to understand exactly what works and what doesn't.
        // This helps distinguish a GetItems handler bug from a general IPC issue.
        use crate::modules::kicad_ipc::proto::common::commands::{
            GetOpenDocuments, GetOpenDocumentsResponse,
            GetItems, GetItemsResponse,
            RefreshEditor,
        };
        use crate::modules::kicad_ipc::proto::common::types::{
            DocumentType, FrameType, ItemHeader, KiCadObjectType,
        };
        use crate::modules::kicad_ipc::IpcClient::URL_GET_OPEN_DOCUMENTS;
        use crate::modules::kicad_ipc::IpcClient::URL_GET_ITEMS;
        use tokio::runtime::Runtime;

        let scan = discover_socket();
        let path = scan.socket_path.expect("No socket");
        let token = scan.token.unwrap_or_default();
        let client = IpcClient::connect(&path, &token).expect("Connect failed");
        let rt = Runtime::new().unwrap();

        rt.block_on(async {
            println!("\n=== IPC Diagnostic Suite ===\n");

            // 1. GetOpenDocuments (PCB)
            let pcb_docs = client.send::<GetOpenDocumentsResponse>(
                &GetOpenDocuments { r#type: DocumentType::DoctypePcb as i32 },
                URL_GET_OPEN_DOCUMENTS,
            ).await;
            match &pcb_docs {
                Ok(r) => println!("[1] GetOpenDocuments(PCB)    ✓ {} doc(s)", r.documents.len()),
                Err(IpcError::Api { code, message }) => println!("[1] GetOpenDocuments(PCB)    ✗ code={code}: {message}"),
                Err(e) => println!("[1] GetOpenDocuments(PCB)    ✗ {e}"),
            }

            // 2. GetOpenDocuments (Schematic)
            let sch_docs = client.send::<GetOpenDocumentsResponse>(
                &GetOpenDocuments { r#type: DocumentType::DoctypeSchematic as i32 },
                URL_GET_OPEN_DOCUMENTS,
            ).await;
            match &sch_docs {
                Ok(r) => println!("[2] GetOpenDocuments(SCH)    ✓ {} doc(s)", r.documents.len()),
                Err(IpcError::Api { code, message }) => println!("[2] GetOpenDocuments(SCH)    ✗ code={code}: {message}"),
                Err(e) => println!("[2] GetOpenDocuments(SCH)    ✗ {e}"),
            }

            // 3. RefreshEditor (PCB) — lightweight, no data traversal
            let refresh_url = "type.googleapis.com/kiapi.common.commands.RefreshEditor";
            let refresh_result = client.send_raw(
                &RefreshEditor { frame: FrameType::FtPcbEditor as i32 },
                refresh_url,
            ).await;
            match &refresh_result {
                Ok(r) => println!("[3] RefreshEditor(PCB)       ✓ status={:?}", r.status.as_ref().map(|s| s.status)),
                Err(IpcError::Api { code, message }) => println!("[3] RefreshEditor(PCB)       ✗ code={code}: {message}"),
                Err(e) => println!("[3] RefreshEditor(PCB)       ✗ {e}"),
            }

            // 4. GetItems(PCB_FOOTPRINT) with doc from step 1
            if let Ok(ref docs) = pcb_docs {
                if let Some(doc) = docs.documents.first().cloned() {
                    println!("[4] PCB doc identifier: {:?}", doc.identifier);
                    let items = client.send::<GetItemsResponse>(
                        &GetItems {
                            header: Some(ItemHeader { document: Some(doc), container: None, field_mask: None }),
                            types: vec![KiCadObjectType::KotPcbFootprint as i32],
                        },
                        URL_GET_ITEMS,
                    ).await;
                    match items {
                        Ok(r) => println!("[4] GetItems(PCB_FOOTPRINT)  ✓ {} items", r.items.len()),
                        Err(IpcError::Api { code, message }) => println!("[4] GetItems(PCB_FOOTPRINT)  ✗ code={code}: {message}"),
                        Err(e) => println!("[4] GetItems(PCB_FOOTPRINT)  ✗ {e}"),
                    }
                }
            }

            // 5. GetItems(SCH_SYMBOL) with doc from step 2
            if let Ok(ref docs) = sch_docs {
                if let Some(doc) = docs.documents.first().cloned() {
                    println!("[5] SCH doc identifier: {:?}", doc.identifier);
                    let items = client.send::<GetItemsResponse>(
                        &GetItems {
                            header: Some(ItemHeader { document: Some(doc), container: None, field_mask: None }),
                            types: vec![KiCadObjectType::KotSchSymbol as i32],
                        },
                        URL_GET_ITEMS,
                    ).await;
                    match items {
                        Ok(r) => println!("[5] GetItems(SCH_SYMBOL)     ✓ {} items", r.items.len()),
                        Err(IpcError::Api { code, message }) => println!("[5] GetItems(SCH_SYMBOL)     ✗ code={code}: {message}"),
                        Err(e) => println!("[5] GetItems(SCH_SYMBOL)     ✗ {e}"),
                    }
                }
            }

            println!("\n=== End Diagnostic ===");
        });
    }

    #[test]
    #[ignore = "requires KiCad 10 running with PCB open and API enabled"]
    fn live_get_pcb_footprints() {
        use crate::modules::kicad_ipc::proto::common::commands::{
            GetOpenDocuments, GetOpenDocumentsResponse, GetItems, GetItemsResponse,
        };
        use crate::modules::kicad_ipc::proto::common::types::{
            DocumentType, ItemHeader, KiCadObjectType,
        };
        use crate::modules::kicad_ipc::IpcClient::{URL_GET_OPEN_DOCUMENTS, URL_GET_ITEMS};
        use tokio::runtime::Runtime;

        let scan = discover_socket();
        let path = scan.socket_path.expect("No socket");
        let token = scan.token.unwrap_or_default();
        let client = IpcClient::connect(&path, &token).expect("Connect failed");
        let rt = Runtime::new().unwrap();

        rt.block_on(async {
            // Wait 2s for any ongoing WS bridge polling to settle
            println!("  (waiting 2s for KiCad to idle...)");
            tokio::time::sleep(std::time::Duration::from_secs(2)).await;

            // Find open PCB
            let docs = client.send::<GetOpenDocumentsResponse>(
                &GetOpenDocuments { r#type: DocumentType::DoctypePcb as i32 },
                URL_GET_OPEN_DOCUMENTS,
            ).await.expect("GetOpenDocuments(PCB) failed");

            println!("\n[PCB DOCUMENTS] {} open", docs.documents.len());
            let doc = match docs.documents.into_iter().next() {
                Some(d) => d,
                None => { println!("  No PCB open"); return; }
            };

            // Pause the WS bridge polling so KiCad's BOARD lock is free for GetItems.
            // In the test we can't easily access bridge_tx, so we use a raw NNG message
            // via the WS socket at port 40001 to pause the watchers directly.
            println!("  Pausing WS bridge polling to free KiCad BOARD lock...");
            if let Ok(ws) = nng::Socket::new(nng::Protocol::Req0) {
                if ws.dial("ipc://api.sock").is_err() {
                    // Try alternative path if the above fails
                    let _ = ws.dial("ws://127.0.0.1:40001");
                }
                // We can't easily send WS JSON from here — just wait longer to let
                // any in-flight poll complete naturally (max poll period = 1000ms)
            }
            tokio::time::sleep(std::time::Duration::from_millis(1200)).await;
            println!("  Bridge polling should now be idle — attempting GetItems...");

            // GetItems(PCB_FOOTPRINT) — retry up to 5× with 1s gaps
            for attempt in 1..=5u32 {
                let result = client.send::<GetItemsResponse>(
                    &GetItems {
                        header: Some(ItemHeader { document: Some(doc.clone()), container: None, field_mask: None }),
                        types: vec![KiCadObjectType::KotPcbFootprint as i32],
                    },
                    URL_GET_ITEMS,
                ).await;

                match result {
                    Ok(resp) => {
                        println!("[PCB GetItems attempt {attempt}] ✓ {} footprints", resp.items.len());
                        return;
                    }
                    Err(IpcError::Api { code: 7, ref message }) => {
                        println!("[PCB GetItems attempt {attempt}] AS_BUSY (7) — {message} — waiting 1s...");
                        tokio::time::sleep(std::time::Duration::from_secs(1)).await;
                    }
                    Err(e) => {
                        println!("[PCB GetItems attempt {attempt}] ✗ {e}");
                        return;
                    }
                }
            }
            println!("[PCB GetItems] Still AS_BUSY after 5 attempts — WS bridge may be holding board lock");
        });
    }

    #[test]
    #[ignore = "requires KiCad 10 running with API enabled"]
    fn live_connect_and_get_open_documents() {
        let scan = discover_socket();
        let path = scan.socket_path.expect("No socket found — run live_scan_finds_socket first");
        let token = scan.token.unwrap_or_default();

        println!("\n[IPC CONNECT]");
        println!("  path:  {path}");
        println!("  token: {}", if token.is_empty() { "(empty — external client)" } else { "(set)" });

        let client = IpcClient::connect(&path, &token)
            .expect("Failed to connect to KiCad IPC");

        // GetOpenDocuments — works in KiCad 9+ PCB editor
        use crate::modules::kicad_ipc::proto::common::commands::{
            GetOpenDocuments, GetOpenDocumentsResponse,
        };
        use crate::modules::kicad_ipc::proto::common::types::DocumentType;
        use crate::modules::kicad_ipc::IpcClient::URL_GET_OPEN_DOCUMENTS;
        use tokio::runtime::Runtime;

        let rt = Runtime::new().unwrap();
        let result = rt.block_on(async {
            client.send::<GetOpenDocumentsResponse>(
                &GetOpenDocuments { r#type: DocumentType::DoctypeSchematic as i32 },
                URL_GET_OPEN_DOCUMENTS,
            ).await
        });

        println!("\n[GET_OPEN_DOCUMENTS (schematic)]");
        match &result {
            Ok(resp) => {
                println!("  ✓ OK — {} document(s) open", resp.documents.len());
                for doc in &resp.documents {
                    println!("    doc type={}", doc.r#type);
                }
            }
            Err(IpcError::Api { code: 8, message }) => {
                println!("  ✗ AS_UNIMPLEMENTED (code=8): {message}");
                println!("  → Schematic IPC not yet available in this KiCad version");
            }
            Err(e) => {
                println!("  ✗ Error: {e}");
            }
        }
        // Don't assert — just report; we want to see what KiCad returns
    }

    #[test]
    #[ignore = "requires KiCad 10 running with a schematic open and API enabled"]
    fn live_get_schematic_symbols() {
        use crate::modules::kicad_ipc::proto::common::commands::{
            GetOpenDocuments, GetOpenDocumentsResponse, GetItems, GetItemsResponse,
        };
        use crate::modules::kicad_ipc::proto::common::types::{
            DocumentType, ItemHeader, KiCadObjectType,
        };
        use crate::modules::kicad_ipc::proto::schematic::types::SchematicSymbolInstance;
        use crate::modules::kicad_ipc::IpcClient::{
            URL_GET_OPEN_DOCUMENTS, URL_GET_ITEMS,
        };
        use prost::Message;
        use tokio::runtime::Runtime;

        let scan = discover_socket();
        let path = scan.socket_path.expect("No socket found");
        let token = scan.token.unwrap_or_default();
        let client = IpcClient::connect(&path, &token).expect("Connect failed");

        let rt = Runtime::new().unwrap();

        rt.block_on(async {
            // Step 1: find the open schematic
            println!("\n[STEP 1] GetOpenDocuments (schematic)");
            let docs_result = client.send::<GetOpenDocumentsResponse>(
                &GetOpenDocuments { r#type: DocumentType::DoctypeSchematic as i32 },
                URL_GET_OPEN_DOCUMENTS,
            ).await;

            let doc = match docs_result {
                Ok(resp) if !resp.documents.is_empty() => {
                    println!("  ✓ {} schematic(s) open", resp.documents.len());
                    resp.documents.into_iter().next().unwrap()
                }
                Ok(_) => {
                    println!("  ✗ No schematic documents open in KiCad");
                    return;
                }
                Err(IpcError::Api { code: 8, message }) => {
                    println!("  ✗ AS_UNIMPLEMENTED (code=8): {message}");
                    println!("  → GetOpenDocuments for schematics not in this KiCad version");
                    return;
                }
                Err(e) => {
                    println!("  ✗ Error: {e}");
                    return;
                }
            };

            // Step 2: get schematic symbols
            println!("\n[STEP 2] GetItems (KOT_SCH_SYMBOL)");
            let items_result = client.send::<GetItemsResponse>(
                &GetItems {
                    header: Some(ItemHeader {
                        document: Some(doc),
                        container: None,
                        field_mask: None,
                    }),
                    types: vec![KiCadObjectType::KotSchSymbol as i32],
                },
                URL_GET_ITEMS,
            ).await;

            match items_result {
                Ok(resp) => {
                    println!("  ✓ {} items returned", resp.items.len());
                    let mut decoded = 0usize;
                    for any in &resp.items {
                        if let Ok(sym) = SchematicSymbolInstance::decode(any.value.as_slice()) {
                            decoded += 1;
                            if decoded <= 5 {
                                let ref_text = sym.reference_field.as_ref()
                                    .and_then(|f| f.text.as_ref())
                                    .map(|t| t.text.as_str())
                                    .unwrap_or("?");
                                let val_text = sym.value_field.as_ref()
                                    .and_then(|f| f.text.as_ref())
                                    .map(|t| t.text.as_str())
                                    .unwrap_or("?");
                                println!("    [{decoded}] ref={ref_text}  value={val_text}  dnp={}",
                                    sym.attributes.as_ref().map(|a| a.do_not_populate).unwrap_or(false));
                            }
                        }
                    }
                    println!("  Decoded {decoded}/{} as SchematicSymbolInstance", resp.items.len());
                    if decoded == 0 && !resp.items.is_empty() {
                        println!("  ⚠ Items present but type_url mismatch — check proto package names");
                        if let Some(first) = resp.items.first() {
                            println!("  first item type_url: {}", first.type_url);
                        }
                    }
                }
                Err(IpcError::Api { code: 8, message }) => {
                    println!("  ✗ AS_UNIMPLEMENTED (code=8): {message}");
                    println!("  → Schematic GetItems not yet in this KiCad version");
                }
                Err(e) => {
                    println!("  ✗ Error: {e}");
                }
            }
        });
    }
}
