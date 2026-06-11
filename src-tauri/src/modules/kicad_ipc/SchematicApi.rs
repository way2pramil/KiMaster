//! High-level schematic read/write operations built on IpcClient.
//!
//! Phase 2: read (get_symbols, get_netlist, get_hierarchy).
//! Phase 3: write (update_field, set_dnp, bulk_update_fields).
//!
//! All write operations use a SINGLE BeginCommit/EndCommit transaction so
//! the entire batch appears as one undo entry in KiCad.
//!
//! ## WS bridge / IPC lock coordination
//!
//! KiCad's IPC `GetItems` handler needs the BOARD lock to traverse the data
//! model. Our WS bridge polls `board.GetFootprints()` and `board.GetSelection()`
//! via SWIG background threads every 500–1000ms — those polls also hold the
//! BOARD lock. KiCad returns AS_BUSY (code 7) when it sees the lock contended.
//!
//! The fix: before calling `GetItems`, pause the WS bridge watchers via the
//! `set_poll_intervals` WS command (setting them to 60 000ms), wait 1.5s for
//! the current poll to drain, call `GetItems`, then restore normal intervals.
//! `with_bridge_paused()` encapsulates this pattern.

use std::sync::Arc;

use prost::Message;
use serde_json::json;
use tokio::sync::mpsc::UnboundedSender;

use super::IpcClient::{IpcClient, IpcError,
    URL_GET_OPEN_DOCUMENTS,
    URL_GET_ITEMS,
    URL_BEGIN_COMMIT,
    URL_END_COMMIT,
    URL_GET_SCHEMATIC_HIERARCHY,
    URL_GET_SCHEMATIC_NETLIST,
    URL_UPDATE_ITEMS, URL_SCH_SYMBOL_INSTANCE,
    URL_SAVE_DOCUMENT_TO_STRING,
};
use super::KicadFileParser::{ParsedBoardData, ParsedSchematicData, NetlistGraphData, parse_pcb_string, parse_sch_file, build_netlist_graph};

use super::proto::common::{
    commands::{
        GetOpenDocuments, GetOpenDocumentsResponse,
        GetItems, GetItemsResponse,
        BeginCommit, BeginCommitResponse, EndCommit, CommitAction,
        UpdateItems,
    },
    types::{DocumentType, DocumentSpecifier, ItemHeader, KiCadObjectType},
};
use super::proto::schematic::types::{
    GetSchematicHierarchy, SchematicHierarchyResponse,
    GetSchematicNetlist, SchematicNetlistResponse,
    SchematicSymbolInstance, SchematicField,
};
use super::proto::common::types::Text;

// ── SchematicApi ──────────────────────────────────────────────────────────────

pub struct SchematicApi;

impl SchematicApi {
    // ── Read operations ───────────────────────────────────────────────────────

    /// Return the first open schematic document, or an error if none is open.
    pub async fn get_open_schematic(client: &Arc<IpcClient>) -> Result<DocumentSpecifier, IpcError> {
        let resp: GetOpenDocumentsResponse = client.send(
            &GetOpenDocuments { r#type: DocumentType::DoctypeSchematic as i32 },
            URL_GET_OPEN_DOCUMENTS,
        ).await?;

        resp.documents.into_iter().next().ok_or_else(|| IpcError::Api {
            code: -1,
            message: "No schematic document is currently open in KiCad".to_string(),
        })
    }

    /// Retrieve all symbol instances from the given schematic document.
    ///
    /// `bridge_tx`: optional WS bridge command channel. When provided, the
    /// bridge watchers are paused for the duration of the IPC call so KiCad's
    /// BOARD lock is free for the IPC `GetItems` handler.
    ///
    /// Returns `Err(IpcError::Api { code: 8 })` (AS_UNIMPLEMENTED) if this
    /// KiCad version does not yet expose schematic symbols via IPC.
    pub async fn get_symbols(
        client: &Arc<IpcClient>,
        doc: DocumentSpecifier,
        bridge_tx: Option<&UnboundedSender<crate::modules::bridge::WsClient::BridgeCmd>>,
    ) -> Result<Vec<SchematicSymbolInstance>, IpcError> {
        let resp: GetItemsResponse = with_bridge_paused(bridge_tx, async {
            client.send(
                &GetItems {
                    header: Some(ItemHeader {
                        document: Some(doc),
                        container: None,
                        field_mask: None,
                    }),
                    types: vec![KiCadObjectType::KotSchSymbol as i32],
                },
                URL_GET_ITEMS,
            ).await
        }).await?;

        // Each item is a google.protobuf.Any wrapping a SchematicSymbolInstance.
        // Decode each one; skip items that fail to decode (unknown types).
        let mut symbols = Vec::with_capacity(resp.items.len());
        for any in &resp.items {
            match SchematicSymbolInstance::decode(any.value.as_slice()) {
                Ok(sym) => symbols.push(sym),
                Err(e)  => tracing::debug!("SchematicApi: skip item decode error: {e}"),
            }
        }
        tracing::info!("SchematicApi: {} symbols from IPC", symbols.len());
        Ok(symbols)
    }

    /// Retrieve the schematic netlist (all net names with sheet membership).
    pub async fn get_netlist(
        client: &Arc<IpcClient>,
        doc: DocumentSpecifier,
        bridge_tx: Option<&UnboundedSender<crate::modules::bridge::WsClient::BridgeCmd>>,
    ) -> Result<SchematicNetlistResponse, IpcError> {
        with_bridge_paused(bridge_tx, async {
            client.send(
                &GetSchematicNetlist { document: Some(doc), types: vec![] },
                URL_GET_SCHEMATIC_NETLIST,
            ).await
        }).await
    }

    /// Retrieve the hierarchical sheet tree.
    pub async fn get_hierarchy(
        client: &Arc<IpcClient>,
        doc: DocumentSpecifier,
    ) -> Result<SchematicHierarchyResponse, IpcError> {
        client.send(
            &GetSchematicHierarchy { document: Some(doc) },
            URL_GET_SCHEMATIC_HIERARCHY,
        ).await
    }

    // ── Fallback read paths (used when GetItems returns AS_BUSY) ─────────────

    /// Get full PCB data via `SaveDocumentToString` (works in KiCad 10).
    ///
    /// This is the working bypass for `GetItems(AS_BUSY)`.
    /// Returns footprints, nets, and copper layers parsed from the
    /// PCB S-expression text.
    pub async fn get_pcb_data(
        client: &Arc<IpcClient>,
        doc: DocumentSpecifier,
        board_name: &str,
    ) -> Result<ParsedBoardData, IpcError> {
        use super::proto::common::commands::{SaveDocumentToString, SavedDocumentResponse};

        let resp: SavedDocumentResponse = client.send(
            &SaveDocumentToString { document: Some(doc) },
            URL_SAVE_DOCUMENT_TO_STRING,
        ).await?;

        Ok(parse_pcb_string(&resp.contents, board_name))
    }

    /// Get netlist as a bipartite component↔net graph for force-directed visualization.
    ///
    /// Same IPC path as `get_pcb_data` (SaveDocumentToString works in KiCad 10)
    /// but calls `build_netlist_graph` which additionally extracts pad→net edges.
    pub async fn get_netlist_graph(
        client: &Arc<IpcClient>,
        doc: DocumentSpecifier,
    ) -> Result<NetlistGraphData, IpcError> {
        use super::proto::common::commands::{SaveDocumentToString, SavedDocumentResponse};

        let resp: SavedDocumentResponse = client.send(
            &SaveDocumentToString { document: Some(doc) },
            URL_SAVE_DOCUMENT_TO_STRING,
        ).await?;

        Ok(build_netlist_graph(&resp.contents))
    }

    /// Get schematic symbol data by parsing the `.kicad_sch` file on disk.
    ///
    /// `sch_path` comes from `GetOpenDocuments(SCH).identifier.board_filename`.
    /// This is the working bypass for `GetItems(SCH_SYMBOL, AS_BUSY)`.
    pub fn get_schematic_data_from_file(sch_path: &str) -> ParsedSchematicData {
        parse_sch_file(sch_path)
    }

    // ── Write operations (Phase 3) ────────────────────────────────────────────

    /// Set the DNP (Do Not Place) flag on a symbol.
    ///
    /// Single BeginCommit/EndCommit → appears as one undo entry in KiCad.
    pub async fn set_dnp(
        client: &Arc<IpcClient>,
        doc: DocumentSpecifier,
        mut symbol: SchematicSymbolInstance,
        dnp: bool,
    ) -> Result<(), IpcError> {
        let mut attrs = symbol.attributes.unwrap_or_default();
        attrs.do_not_populate = dnp;
        symbol.attributes = Some(attrs);
        Self::commit_symbols(client, doc, vec![symbol], &format!("KiMaster: set DNP={dnp}")).await
    }

    /// Update a single field on a symbol.
    pub async fn update_field(
        client: &Arc<IpcClient>,
        doc: DocumentSpecifier,
        symbol: SchematicSymbolInstance,
        field: &str,
        value: &str,
    ) -> Result<(), IpcError> {
        Self::bulk_update_fields(client, doc, vec![(symbol, field.to_string(), value.to_string())]).await
    }

    /// Batch-update fields on multiple symbols — **single commit** = one undo entry.
    ///
    /// All changes are wrapped in one BeginCommit/EndCommit block.
    /// Never call this in a loop with separate commits — that pollutes KiCad's undo stack.
    pub async fn bulk_update_fields(
        client: &Arc<IpcClient>,
        doc: DocumentSpecifier,
        updates: Vec<(SchematicSymbolInstance, String, String)>,
    ) -> Result<(), IpcError> {
        if updates.is_empty() { return Ok(()); }

        let symbols: Vec<SchematicSymbolInstance> = updates
            .into_iter()
            .map(|(mut sym, field, value)| {
                apply_field(&mut sym, &field, &value);
                sym
            })
            .collect();

        Self::commit_symbols(client, doc, symbols, "KiMaster: bulk field sync").await
    }

    // ── Internal ──────────────────────────────────────────────────────────────

    /// Open one commit, update all symbols, close commit.
    async fn commit_symbols(
        client: &Arc<IpcClient>,
        doc: DocumentSpecifier,
        symbols: Vec<SchematicSymbolInstance>,
        message: &str,
    ) -> Result<(), IpcError> {
        let header = ItemHeader { document: Some(doc.clone()), container: None, field_mask: None };

        // 1. Begin commit
        let begin_resp = client.send_raw(
            &BeginCommit { header: Some(header.clone()) },
            URL_BEGIN_COMMIT,
        ).await?;

        let commit_id = extract_commit_id(&begin_resp)?;

        // 2. Update items — pack each SchematicSymbolInstance into Any
        let items: Vec<prost_types::Any> = symbols.iter().map(|sym| prost_types::Any {
            type_url: URL_SCH_SYMBOL_INSTANCE.to_string(),
            value:    sym.encode_to_vec(),
        }).collect();

        client.send_raw(
            &UpdateItems { header: Some(header), items },
            URL_UPDATE_ITEMS,
        ).await?;

        // 3. End commit — all changes land as ONE undo entry in KiCad
        client.send_raw(
            &EndCommit {
                id:     Some(commit_id),
                action: CommitAction::CmaCommit as i32,
                message: message.to_string(),
                header: Some(ItemHeader { document: Some(doc), container: None, field_mask: None }),
            },
            URL_END_COMMIT,
        ).await?;

        Ok(())
    }
}

// ── Helpers ───────────────────────────────────────────────────────────────────

/// Apply a field change to a SchematicSymbolInstance.
/// Routes standard fields (Reference, Value, Footprint, Datasheet) to the
/// dedicated proto fields; custom fields are noted as TODO.
fn apply_field(symbol: &mut SchematicSymbolInstance, name: &str, value: &str) {
    let field = make_field(name, value);
    match name {
        "Reference" => symbol.reference_field = Some(field),
        "Value"     => symbol.value_field     = Some(field),
        "Footprint" => symbol.footprint_field = Some(field),
        "Datasheet" => symbol.datasheet_field = Some(field),
        _ => {
            // Custom fields (LCSC, MPN, etc.) are inside the symbol definition's
            // items list in the KiCad API — not yet directly writable on the
            // instance level in KiCad 9/10. Will be added once the schematic API
            // stabilises in KiCad 11.
            tracing::warn!(
                "apply_field: custom field '{name}' not yet writable via IPC on KiCad 9/10"
            );
        }
    }
}

fn make_field(name: &str, value: &str) -> SchematicField {
    SchematicField {
        name: name.to_string(),
        text: Some(Text { text: value.to_string(), ..Default::default() }),
        ..Default::default()
    }
}

fn extract_commit_id(
    response: &super::proto::common::ApiResponse,
) -> Result<super::proto::common::types::Kiid, IpcError> {
    let payload = response.message.as_ref().ok_or(IpcError::EmptyPayload)?;
    let resp = BeginCommitResponse::decode(payload.value.as_slice())?;
    resp.id.ok_or_else(|| IpcError::Api {
        code: -1,
        message: "BeginCommit returned no commit ID".to_string(),
    })
}

// ── Bridge pause coordination ─────────────────────────────────────────────────

/// Run an async IPC operation with WS bridge polling suspended.
///
/// KiCad's IPC `GetItems` handler needs exclusive access to the BOARD/SCHEMATIC
/// data model. Our WS bridge's SelectionWatcher (500ms) and BoardChangeWatcher
/// (1000ms) poll `pcbnew.GetBoard()` via SWIG, which holds the same lock.
/// KiCad returns AS_BUSY if it sees the lock contended.
///
/// This function:
///   1. Sends `set_poll_intervals { selection: 60000ms, board: 60000ms }` over WS
///   2. Waits 1500ms for the current poll cycle to drain
///   3. Runs the IPC operation
///   4. Sends `set_poll_intervals { selection: 500ms, board: 1000ms }` to restore
///
/// If `bridge_tx` is None (WS not connected), the operation runs directly.
pub async fn with_bridge_paused<F, T>(
    bridge_tx: Option<&UnboundedSender<crate::modules::bridge::WsClient::BridgeCmd>>,
    op: F,
) -> Result<T, IpcError>
where
    F: std::future::Future<Output = Result<T, IpcError>>,
{
    use crate::modules::bridge::WsClient::BridgeCmd;

    const PAUSE_MS:   u64 = 60_000;  // poll interval while paused (effectively stopped)
    const RESUME_SEL: u64 = 500;
    const RESUME_BRD: u64 = 1_000;
    const DRAIN_MS:   u64 = 1_500;   // wait for any in-flight poll to complete

    let pause_payload = json!({
        "type": "set_poll_intervals",
        "data": { "selection_poll_ms": PAUSE_MS, "board_poll_ms": PAUSE_MS }
    });
    let resume_payload = json!({
        "type": "set_poll_intervals",
        "data": { "selection_poll_ms": RESUME_SEL, "board_poll_ms": RESUME_BRD }
    });

    // Pause the watchers
    if let Some(tx) = bridge_tx {
        let _ = tx.send(BridgeCmd::Send(pause_payload));
        tracing::debug!("IPC: bridge polling paused for GetItems");
    }

    // Drain any in-flight poll cycle
    if bridge_tx.is_some() {
        tokio::time::sleep(std::time::Duration::from_millis(DRAIN_MS)).await;
    }

    // Run the IPC operation
    let result = op.await;

    // Restore normal polling regardless of success/failure
    if let Some(tx) = bridge_tx {
        let _ = tx.send(BridgeCmd::Send(resume_payload));
        tracing::debug!("IPC: bridge polling resumed");
    }

    result
}
