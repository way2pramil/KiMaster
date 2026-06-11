//! IPC commands for the KiCad IPC API (NNG + protobuf).
//! Thin layer — logic lives in modules/kicad_ipc/.

use std::sync::Arc;

use serde::Serialize;
use tauri::{AppHandle, Emitter, State};

use crate::AppState::KiMasterState;
use crate::modules::kicad_ipc::{
    IpcError, IpcScanResult,
    proto::common::types::{DocumentSpecifier, DocumentType},
    KicadFileParser::{ParsedBoardData, NetlistGraphData},
};
use crate::modules::kicad_ipc::IpcClient::IpcClient;
use crate::modules::kicad_ipc::SchematicApi::SchematicApi;

// ── Response types ────────────────────────────────────────────────────────────

#[derive(Serialize)]
pub struct IpcConnectResponse {
    pub success:     bool,
    pub message:     String,
    pub socket_path: Option<String>,
}

#[derive(Serialize, Clone)]
pub struct IpcStatusResponse {
    pub connected:     bool,
    pub socket_path:   Option<String>,
    pub kicad_version: Option<String>,
}

#[derive(Serialize)]
pub struct IpcSymbolsResponse {
    /// true = KiCad responded; false = not connected or AS_UNIMPLEMENTED
    pub success:  bool,
    pub message:  String,
    pub symbols:  Vec<IpcSymbolSummary>,
}

#[derive(Serialize)]
pub struct IpcSymbolSummary {
    pub id:               String,
    pub reference:        String,
    pub value:            String,
    pub footprint:        String,
    pub datasheet:        String,
    pub lib_id:           String,
    pub dnp:              bool,
    pub exclude_from_bom: bool,
}

// ── cmd_ipc_scan ──────────────────────────────────────────────────────────────

/// Scan for a running KiCad IPC server (env vars + temp directory).
///
/// Also performs drift detection: if KiCad was restarted (socket path or token
/// changed), the stale AppState client is dropped so the caller must reconnect.
#[tauri::command]
pub async fn cmd_ipc_scan(
    state: State<'_, KiMasterState>,
) -> Result<IpcScanResult, String> {
    let result = crate::modules::kicad_ipc::IpcClient::discover_socket();

    // Drift detection — clear stale client if path or token changed
    let mut inner = state.0.lock().map_err(|e| e.to_string())?;
    let cached_path  = inner.kicad_ipc_status.socket_path.as_deref().unwrap_or("");
    let cached_token = inner.kicad_ipc_status.token.as_deref().unwrap_or("");
    let new_path     = result.socket_path.as_deref().unwrap_or("");
    let new_token    = result.token.as_deref().unwrap_or("");

    if (!cached_path.is_empty() && cached_path != new_path)
        || (!cached_token.is_empty() && cached_token != new_token)
    {
        tracing::warn!("KiCad IPC: drift detected (KiCad restarted?) — clearing stale client");
        inner.kicad_ipc_client = None;
        inner.kicad_ipc_status = Default::default();
    }

    Ok(result)
}

// ── cmd_ipc_connect ───────────────────────────────────────────────────────────

/// Connect to the KiCad IPC server.
/// If `socket_path` / `token` are omitted, auto-scan first.
#[tauri::command]
pub async fn cmd_ipc_connect(
    app:         AppHandle,
    state:       State<'_, KiMasterState>,
    socket_path: Option<String>,
    token:       Option<String>,
) -> Result<IpcConnectResponse, String> {
    // Resolve socket + token: explicit args → env var scan
    let (path, tok) = match (socket_path, token) {
        (Some(p), Some(t)) => (p, t),
        _ => {
            let scan = crate::modules::kicad_ipc::IpcClient::discover_socket();
            match scan.socket_path {
                Some(p) => (p, scan.token.unwrap_or_default()),
                None    => return Ok(IpcConnectResponse {
                    success: false,
                    message: "KiCad IPC socket not found. Is KiCad 9+ running?".into(),
                    socket_path: None,
                }),
            }
        }
    };

    // Drop any existing client
    {
        let mut inner = state.0.lock().map_err(|e| e.to_string())?;
        inner.kicad_ipc_client = None;
        inner.kicad_ipc_status = Default::default();
    }

    match IpcClient::connect(&path, &tok) {
        Ok(client) => {
            {
                let mut inner = state.0.lock().map_err(|e| e.to_string())?;
                inner.kicad_ipc_status = crate::AppState::KiCadIpcStatus {
                    connected:     true,
                    socket_path:   Some(path.clone()),
                    token:         Some(tok),
                    kicad_version: None,
                };
                inner.kicad_ipc_client = Some(client);
            }
            tracing::info!("KiCad IPC: connected to {path}");
            let _ = app.emit("ipc:connected", serde_json::json!({ "socket_path": &path }));
            Ok(IpcConnectResponse { success: true, message: format!("Connected to {path}"), socket_path: Some(path) })
        }
        Err(e) => {
            let msg = format!("KiCad IPC connect failed: {e}");
            tracing::warn!("{msg}");
            let _ = app.emit("ipc:error", serde_json::json!({ "message": &msg }));
            Ok(IpcConnectResponse { success: false, message: msg, socket_path: None })
        }
    }
}

// ── cmd_ipc_disconnect ────────────────────────────────────────────────────────

#[tauri::command]
pub async fn cmd_ipc_disconnect(
    app:   AppHandle,
    state: State<'_, KiMasterState>,
) -> Result<(), String> {
    let mut inner = state.0.lock().map_err(|e| e.to_string())?;
    inner.kicad_ipc_client = None;
    inner.kicad_ipc_status = Default::default();
    let _ = app.emit("ipc:disconnected", serde_json::json!({}));
    Ok(())
}

// ── cmd_ipc_get_status ────────────────────────────────────────────────────────

#[tauri::command]
pub async fn cmd_ipc_get_status(
    state: State<'_, KiMasterState>,
) -> Result<IpcStatusResponse, String> {
    let inner = state.0.lock().map_err(|e| e.to_string())?;
    Ok(IpcStatusResponse {
        connected:     inner.kicad_ipc_status.connected,
        socket_path:   inner.kicad_ipc_status.socket_path.clone(),
        kicad_version: inner.kicad_ipc_status.kicad_version.clone(),
    })
}

// ── cmd_ipc_get_schematic_symbols ─────────────────────────────────────────────

/// Retrieve live schematic symbols via the KiCad IPC API.
///
/// Returns `success=false` with an explanatory message if:
/// - Not connected to IPC
/// - KiCad returns AS_UNIMPLEMENTED (schematic IPC not in this KiCad version)
/// - No schematic is open in KiCad
#[tauri::command]
pub async fn cmd_ipc_get_schematic_symbols(
    state:    State<'_, KiMasterState>,
    doc_path: Option<String>,
) -> Result<IpcSymbolsResponse, String> {
    let client = get_client(&state)?;

    // Resolve document specifier
    let doc = if let Some(path) = doc_path {
        DocumentSpecifier {
            r#type: DocumentType::DoctypeSchematic as i32,
            identifier: Some(
                crate::modules::kicad_ipc::proto::common::types::document_specifier::Identifier::BoardFilename(path)
            ),
            project: None,
        }
    } else {
        match SchematicApi::get_open_schematic(&client).await {
            Ok(d) => d,
            Err(e) => {
                let msg = format!("No open schematic: {e}");
                return Ok(IpcSymbolsResponse { success: false, message: msg, symbols: vec![] });
            }
        }
    };

    let bridge_tx = {
        let inner = state.0.lock().map_err(|e| e.to_string())?;
        inner.bridge_cmd_tx.clone()
    };

    match SchematicApi::get_symbols(&client, doc, bridge_tx.as_ref()).await {
        Ok(symbols) => {
            let summaries: Vec<IpcSymbolSummary> = symbols.iter().map(symbol_to_summary).collect();
            tracing::info!("IPC: {} schematic symbols via KiCad IPC", summaries.len());
            Ok(IpcSymbolsResponse {
                success: true,
                message: format!("{} symbols (live IPC)", summaries.len()),
                symbols: summaries,
            })
        }
        Err(IpcError::Api { code: 7, .. }) | Err(IpcError::Api { code: 8, .. }) => {
            // AS_BUSY (7): KiCad 10 GetItems unavailable for external clients.
            // AS_UNIMPLEMENTED (8): handler missing in this version.
            // Fall back: parse the .kicad_sch file directly using our Rust parser.
            // We know the exact path from GetOpenDocuments(SCH) above.
            tracing::info!("IPC: GetItems AS_BUSY/AS_UNIMPLEMENTED — falling back to file parser");
            fallback_parse_sch_file(&state, &client).await
        }
        Err(e) => {
            let msg = format!("IPC get_symbols error: {e}");
            tracing::warn!("{msg}");
            Ok(IpcSymbolsResponse { success: false, message: msg, symbols: vec![] })
        }
    }
}

// ── cmd_ipc_get_pcb_data ──────────────────────────────────────────────────────

/// Get full PCB board data: footprints, nets, copper layers.
///
/// Uses `SaveDocumentToString(PCB)` (confirmed working in KiCad 10) + Rust
/// S-expression parser — does NOT require `GetItems` (which returns AS_BUSY).
///
/// Returns data in the same shape as the WS bridge `board_state` so existing
/// JS code can use either source transparently.
#[tauri::command]
pub async fn cmd_ipc_get_pcb_data(
    state: State<'_, KiMasterState>,
) -> Result<ParsedBoardData, String> {
    let client = get_client(&state)?;

    use crate::modules::kicad_ipc::proto::common::commands::{
        GetOpenDocuments, GetOpenDocumentsResponse,
    };
    use crate::modules::kicad_ipc::IpcClient::URL_GET_OPEN_DOCUMENTS;

    // Find open PCB
    let docs: GetOpenDocumentsResponse = client
        .send(
            &GetOpenDocuments { r#type: DocumentType::DoctypePcb as i32 },
            URL_GET_OPEN_DOCUMENTS,
        )
        .await
        .map_err(|e| e.to_string())?;

    let doc = docs.documents.into_iter().next()
        .ok_or_else(|| "No PCB document open in KiCad".to_string())?;

    let board_name = match &doc.identifier {
        Some(crate::modules::kicad_ipc::proto::common::types::document_specifier::Identifier::BoardFilename(n)) => n.clone(),
        _ => "unknown.kicad_pcb".to_string(),
    };

    SchematicApi::get_pcb_data(&client, doc, &board_name)
        .await
        .map_err(|e| format!("IPC get_pcb_data error: {e}"))
}

// ── cmd_ipc_get_schematic_netlist ─────────────────────────────────────────────

#[tauri::command]
pub async fn cmd_ipc_get_schematic_netlist(
    state: State<'_, KiMasterState>,
) -> Result<serde_json::Value, String> {
    let client = get_client(&state)?;
    let bridge_tx = {
        let inner = state.0.lock().map_err(|e| e.to_string())?;
        inner.bridge_cmd_tx.clone()
    };
    let doc = SchematicApi::get_open_schematic(&client).await.map_err(|e| e.to_string())?;
    let netlist = SchematicApi::get_netlist(&client, doc, bridge_tx.as_ref()).await.map_err(|e| e.to_string())?;
    let nets: Vec<serde_json::Value> = netlist.nets.iter()
        .map(|n| serde_json::json!({ "name": n.name }))
        .collect();
    Ok(serde_json::json!({ "success": true, "nets": nets }))
}

// ── cmd_get_netlist_graph ─────────────────────────────────────────────────────

/// Get the PCB netlist as a bipartite component↔net graph for force-directed
/// visualization.
///
/// Priority:
/// 1. KiCad IPC (SaveDocumentToString) — live data, works in KiCad 10.
/// 2. Direct .kicad_pcb file parse — uses locked_board_path from the WS bridge.
///    Works whenever the bridge is connected even if IPC is not.
#[tauri::command]
pub async fn cmd_get_netlist_graph(
    state: State<'_, KiMasterState>,
) -> Result<NetlistGraphData, String> {
    use crate::modules::kicad_ipc::proto::common::commands::{
        GetOpenDocuments, GetOpenDocumentsResponse,
    };
    use crate::modules::kicad_ipc::IpcClient::URL_GET_OPEN_DOCUMENTS;
    use crate::modules::kicad_ipc::KicadFileParser::build_netlist_graph;

    // ── Path 1: IPC ───────────────────────────────────────────────────────────
    if let Ok(client) = get_client(&state) {
        if let Ok(docs) = client
            .send::<GetOpenDocumentsResponse>(
                &GetOpenDocuments { r#type: DocumentType::DoctypePcb as i32 },
                URL_GET_OPEN_DOCUMENTS,
            )
            .await
        {
            if let Some(doc) = docs.documents.into_iter().next() {
                match SchematicApi::get_netlist_graph(&client, doc).await {
                    Ok(g) => {
                        tracing::info!("netlist_graph: {} nodes via IPC", g.nodes.len());
                        return Ok(g);
                    }
                    Err(e) => tracing::warn!("netlist_graph IPC failed, trying file: {e}"),
                }
            }
        }
    }

    // ── Path 2: .kicad_pcb file (bridge locked_board_path) ───────────────────
    let board_path = {
        let inner = state.0.lock().map_err(|e| e.to_string())?;
        inner.locked_board_path.clone()
    };

    let path = board_path.ok_or_else(|| {
        "No PCB path available — connect the KiCad bridge or the IPC API".to_string()
    })?;

    let content = std::fs::read_to_string(&path)
        .map_err(|e| format!("Cannot read {path}: {e}"))?;

    let graph = build_netlist_graph(&content);
    tracing::info!("netlist_graph: {} nodes from file {path}", graph.nodes.len());
    Ok(graph)
}

// ── Helpers ───────────────────────────────────────────────────────────────────

/// Fallback when IPC GetItems(SCH) returns AS_BUSY or AS_UNIMPLEMENTED.
///
/// Priority:
/// 1. Parse the .kicad_sch file directly — we know the path from IPC GetOpenDocuments(SCH).
/// 2. Fall back to WS bridge cached schematic state.
/// 3. Return a helpful error with a clear explanation.
async fn fallback_parse_sch_file(
    state:  &State<'_, KiMasterState>,
    client: &std::sync::Arc<IpcClient>,
) -> Result<IpcSymbolsResponse, String> {
    use crate::modules::kicad_ipc::proto::common::commands::{
        GetOpenDocuments, GetOpenDocumentsResponse,
    };
    use crate::modules::kicad_ipc::IpcClient::URL_GET_OPEN_DOCUMENTS;
    use crate::modules::kicad_ipc::SchematicApi::SchematicApi;

    // Step 1: Get the .kicad_sch file path via IPC (GetOpenDocuments works in KiCad 10)
    if let Ok(docs) = client
        .send::<GetOpenDocumentsResponse>(
            &GetOpenDocuments { r#type: DocumentType::DoctypeSchematic as i32 },
            URL_GET_OPEN_DOCUMENTS,
        )
        .await
    {
        if let Some(doc) = docs.documents.into_iter().next() {
            if let Some(
                crate::modules::kicad_ipc::proto::common::types::document_specifier::Identifier::BoardFilename(sch_path)
            ) = doc.identifier {
                tracing::info!("IPC fallback: parsing .kicad_sch from disk: {sch_path}");
                let parsed = SchematicApi::get_schematic_data_from_file(&sch_path);

                if parsed.parse_error.is_none() && !parsed.components.is_empty() {
                    let symbols: Vec<IpcSymbolSummary> = parsed.components.iter().map(|c| {
                        IpcSymbolSummary {
                            id:               String::new(),
                            reference:        c.ref_.clone(),
                            value:            c.value.clone(),
                            footprint:        c.footprint.clone(),
                            datasheet:        c.properties.get("Datasheet").cloned().unwrap_or_default(),
                            lib_id:           c.lib_id.clone(),
                            dnp:              false,
                            exclude_from_bom: false,
                        }
                    }).collect();
                    tracing::info!("IPC fallback: {} symbols from .kicad_sch file", symbols.len());
                    return Ok(IpcSymbolsResponse {
                        success: true,
                        message: format!("{} symbols (file parser — IPC AS_BUSY in KiCad 10)", symbols.len()),
                        symbols,
                    });
                }

                if let Some(err) = parsed.parse_error {
                    tracing::warn!("IPC fallback: .kicad_sch parse error: {err}");
                    // fall through to WS bridge cache
                }
            }
        }
    }

    // Step 2: WS bridge cached schematic state
    let inner = state.0.lock().map_err(|e| e.to_string())?;
    if let Some(raw) = &inner.bridge_schematic_state.raw {
        let comps = raw["components"].as_array().cloned().unwrap_or_default();
        if !comps.is_empty() {
            let symbols: Vec<IpcSymbolSummary> = comps.iter().map(|c| {
                let props = c.get("properties").cloned().unwrap_or_default();
                IpcSymbolSummary {
                    id:               String::new(),
                    reference:        c["ref"].as_str().unwrap_or("").to_string(),
                    value:            c["value"].as_str().unwrap_or("").to_string(),
                    footprint:        c["footprint"].as_str().unwrap_or("").to_string(),
                    datasheet:        props.get("Datasheet").and_then(|v| v.as_str()).unwrap_or("").to_string(),
                    lib_id:           c["lib_id"].as_str().unwrap_or("").to_string(),
                    dnp:              false,
                    exclude_from_bom: false,
                }
            }).collect();
            tracing::info!("IPC fallback: {} symbols from WS bridge cache", symbols.len());
            return Ok(IpcSymbolsResponse {
                success: true,
                message: format!("{} symbols (WS bridge cache — IPC AS_BUSY in KiCad 10)", symbols.len()),
                symbols,
            });
        }
    }

    // Step 3: nothing worked
    Ok(IpcSymbolsResponse {
        success: false,
        message: "KiCad 10 IPC AS_BUSY for schematic GetItems. \
                  Neither .kicad_sch file parse nor WS bridge cache produced data. \
                  Ensure KiCad has a schematic open, or connect the WS bridge plugin.".to_string(),
        symbols: vec![],
    })
}

fn get_client(state: &State<'_, KiMasterState>) -> Result<Arc<IpcClient>, String> {
    let inner = state.0.lock().map_err(|e| e.to_string())?;
    inner.kicad_ipc_client.clone()
        .ok_or_else(|| "Not connected to KiCad IPC — call cmd_ipc_connect first".to_string())
}

fn field_text(
    f: &Option<crate::modules::kicad_ipc::proto::schematic::types::SchematicField>,
) -> String {
    f.as_ref().and_then(|f| f.text.as_ref()).map(|t| t.text.clone()).unwrap_or_default()
}

fn symbol_to_summary(
    s: &crate::modules::kicad_ipc::proto::schematic::types::SchematicSymbolInstance,
) -> IpcSymbolSummary {
    let attrs = s.attributes.as_ref();
    IpcSymbolSummary {
        id:               s.id.as_ref().map(|k| k.value.clone()).unwrap_or_default(),
        reference:        field_text(&s.reference_field),
        value:            field_text(&s.value_field),
        footprint:        field_text(&s.footprint_field),
        datasheet:        field_text(&s.datasheet_field),
        lib_id:           s.definition.as_ref()
                            .and_then(|d| d.id.as_ref())
                            .map(|id| format!("{}:{}", id.library_nickname, id.entry_name))
                            .unwrap_or_default(),
        dnp:              attrs.map(|a| a.do_not_populate).unwrap_or(false),
        exclude_from_bom: attrs.map(|a| a.exclude_from_bill_of_materials).unwrap_or(false),
    }
}
