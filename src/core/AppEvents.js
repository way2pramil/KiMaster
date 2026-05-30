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
export const BRIDGE_BOARD_STATE  = 'bridge:board_state';
export const BRIDGE_BOARD_CHANGED= 'bridge:board_changed';
export const BRIDGE_SELECTION    = 'bridge:selection';
export const BRIDGE_NET_INFO     = 'bridge:net_info';
/** Forwarded write-op result: { type:'op_result', op:string, success, message, ...extras } */
export const BRIDGE_OP_RESULT    = 'bridge:op_result';
export const BRIDGE_ERROR        = 'bridge:error';
/** Poll interval settings from bridge: { selection_poll_ms, board_poll_ms } */
export const BRIDGE_POLL_INTERVALS = 'bridge:poll_intervals';
/** Emitted after a pcbnew write op completes: { reference, op, success } */
export const BRIDGE_COMPONENT_MODIFIED = 'bridge:component_modified';

// ── Project events (emitted by Rust → listened in JS) ────────────────────────
export const PROJECT_OPENED       = 'project:opened';
export const PROJECT_CLOSED       = 'project:closed';
export const PROJECT_FILE_CHANGED = 'project:file_changed';

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
