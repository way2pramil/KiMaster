/**
 * AppEvents — single source of truth for ALL event name strings.
 *
 * Rules:
 *  - No raw string literals elsewhere in the codebase.
 *  - Tauri backend event names live under BRIDGE_*.
 *  - Custom DOM CustomEvent names live under KM_*.
 *
 * @module AppEvents
 */

// ── Tauri events (emitted by Rust → listened in JS) ──────────────────────────
export const BRIDGE_CONNECTED    = 'bridge:connected';
export const BRIDGE_DISCONNECTED = 'bridge:disconnected';
export const BRIDGE_BOARD_STATE      = 'bridge:board_state';
export const BRIDGE_SCHEMATIC_STATE  = 'bridge:schematic_state';
export const BRIDGE_BOARD_CHANGED    = 'bridge:board_changed';
export const BRIDGE_SELECTION    = 'bridge:selection';
export const BRIDGE_NET_INFO     = 'bridge:net_info';
/** Forwarded write-op result: { type:'op_result', op:string, success, message, ...extras } */
export const BRIDGE_OP_RESULT    = 'bridge:op_result';
export const BRIDGE_ERROR        = 'bridge:error';
/** Poll interval settings from bridge: { selection_poll_ms, board_poll_ms } */
export const BRIDGE_POLL_INTERVALS = 'bridge:poll_intervals';
/** Emitted after a pcbnew write op completes: { reference, op, success } */
export const BRIDGE_COMPONENT_MODIFIED = 'bridge:component_modified';
/**
 * Emitted when the project lock is established on bridge connect.
 * { board_path: string, port: number }
 */
export const BRIDGE_PROJECT_LOCKED   = 'bridge:project_locked';
/**
 * Emitted when a board_state update reports a board_name different from the locked board.
 * { expected: string, actual: string, port: number }
 * Write ops must be blocked until user reconnects or confirms the switch.
 */
export const BRIDGE_PROJECT_MISMATCH = 'bridge:project_mismatch';
/**
 * Emitted when the KiCad plugin is deliberately stopped by the user in KiCad
 * (Stop Server option). Different from a disconnect — the user explicitly
 * closed the port. UI should show a clear "stopped" banner, NOT "reconnecting".
 * { message: string }
 */
export const BRIDGE_SERVER_STOPPED   = 'bridge:server_stopped';
/**
 * Emitted when the Python plugin returns live board stackup data.
 * { board_name, layers: StackupLayer[], source: 'pcbnew_api'|'file_parse', error? }
 */
export const BRIDGE_STACKUP_DATA     = 'bridge:stackup_data';

// ── KiCad IPC API events ──────────────────────────────────────────────────────
/** Emitted when IPC connects: { socket_path } */
export const IPC_CONNECTED    = 'ipc:connected';
/** Emitted when IPC disconnects: {} */
export const IPC_DISCONNECTED = 'ipc:disconnected';
/** Emitted on IPC error: { message } */
export const IPC_ERROR        = 'ipc:error';

// ── Project events (emitted by Rust → listened in JS) ────────────────────────
export const PROJECT_OPENED        = 'project:opened';
export const PROJECT_CLOSED        = 'project:closed';
export const PROJECT_FILE_CHANGED  = 'project:file_changed';
/** Emitted when bridge connects and project dir is auto-detected from PCB path. */
export const PROJECT_AUTO_DETECTED = 'project:auto_detected';

// ── Custom DOM events (dispatched by Web Components) ─────────────────────────
export const KM_NAV              = 'km-nav';
export const KM_CLICK            = 'km-click';
export const KM_VIOLATION_CLICK  = 'km-violation-click';
export const KM_EXPORT_DONE      = 'km-export-done';
export const KM_EXPORT_ERROR     = 'km-export-error';

// ── UCE events (Phase 9B) ─────────────────────────────────────────────────────
/** Fired by ComponentVault when a component is added: { lcsc_id, name } */
export const KM_UCE_VAULT_ADDED   = 'km-uce-vault-added';
/** Fired by ComponentVault when a component is removed: { lcsc_id } */
export const KM_UCE_VAULT_REMOVED = 'km-uce-vault-removed';
/** Fired by ComponentVault when a search is run: { keyword, total } */
export const KM_UCE_SEARCH_DONE   = 'km-uce-search-done';

// ── Vault sub-vault events ───────────────────────────────────────────────────
/** Stackup saved/updated: { id, name } */
export const KM_VAULT_STACKUP_SAVED    = 'km-vault-stackup-saved';
/** Template imported: { id, name } */
export const KM_VAULT_TEMPLATE_ADDED   = 'km-vault-template-added';
/** Template instantiated: { template_id, project_name, dest_dir } */
export const KM_VAULT_TEMPLATE_USED    = 'km-vault-template-used';
/** Block imported: { id, name, category } */
export const KM_VAULT_BLOCK_ADDED      = 'km-vault-block-added';
/** Block removed: { id } */
export const KM_VAULT_BLOCK_REMOVED    = 'km-vault-block-removed';

// ── Notes events (Phase 10) ───────────────────────────────────────────────────
/** Fired by NotesEditor when auto-save completes: { timestamp } */
export const KM_NOTES_SAVED      = 'km-notes-saved';
/** Fired when a smart-link ref is clicked in the notes preview: { ref, type } */
export const KM_NOTES_LINK_CLICK = 'km-notes-link-click';
