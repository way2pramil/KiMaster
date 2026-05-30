/**
 * AppCommands — single source of truth for ALL Tauri IPC command strings.
 *
 * Rules:
 *  - Never pass a raw string to invoke() / invokeNow() in feature code.
 *  - Always import a constant from here so typos are caught at import time.
 *  - Argument shapes are documented as @param JSDoc on each constant.
 *
 * @module AppCommands
 */

// ── App info ──────────────────────────────────────────────────────────────────
/** Returns { name, version, kicad_cli_path } */
export const GET_APP_INFO          = 'cmd_get_app_info';
/** Returns { found, path, version } */
export const GET_KICAD_CLI_PATH    = 'cmd_get_kicad_cli_path';

// ── Project ───────────────────────────────────────────────────────────────────
/** Returns { active_project: ProjectInfo | null } */
export const GET_PROJECT_STATE        = 'cmd_get_project_state';
/** Args: { pro_path: string }  Returns OpenProjectResult */
export const OPEN_PROJECT             = 'cmd_open_project';
/** No args.  Returns void */
export const CLOSE_PROJECT            = 'cmd_close_project';
/** No args.  Returns RecentProject[] */
export const GET_RECENT_PROJECTS      = 'cmd_get_recent_projects';
/** No args. Shows native file picker → Returns OpenProjectResult */
export const PICK_AND_OPEN_PROJECT    = 'cmd_pick_and_open_project';

// ── Manufacturing (Phase 8) ───────────────────────────────────────────────────
/**
 * Export all fab-required files to a timestamped directory.
 * Args: { pcb_file, sch_file?, output_dir, fab_id? }
 * Returns: { success, output_dir, files, message }
 */
export const EXPORT_FAB_PACK          = 'cmd_export_fab_pack';

// ── DRC / ERC ─────────────────────────────────────────────────────────────────
/** Args: { pcb_path: string }  Returns DrcResult */
export const RUN_DRC               = 'cmd_run_drc';
/** Args: { sch_path: string }  Returns ErcResult */
export const RUN_ERC               = 'cmd_run_erc';

// ── Exports ───────────────────────────────────────────────────────────────────
/** Args: { pcb_path, output_dir, options? }  Returns ExportResult */
export const EXPORT_GERBERS        = 'cmd_export_gerbers';
/** Args: { pcb_path, output_dir, options? }  Returns ExportResult */
export const EXPORT_DRILL          = 'cmd_export_drill';
/** Args: { pcb_path, output_dir, options? }  Returns ExportResult */
export const EXPORT_POS            = 'cmd_export_pos';
/** Args: { pcb_path, output_dir, options? }  Returns ExportResult */
export const EXPORT_SVG            = 'cmd_export_svg';
/** Args: { pcb_path, output_dir, options? }  Returns ExportResult */
export const EXPORT_PDF            = 'cmd_export_pdf';
/** Args: { pcb_path, output_dir, options? }  Returns ExportResult */
export const EXPORT_BOM            = 'cmd_export_bom';
/** Args: { sch_path, output_dir, options? }  Returns ExportResult */
export const EXPORT_SCH_PDF        = 'cmd_export_sch_pdf';
/** Args: { sch_path, output_dir, options? }  Returns ExportResult */
export const EXPORT_SCH_SVG        = 'cmd_export_sch_svg';

// ── Bridge ────────────────────────────────────────────────────────────────────
/** Returns { connected, port, ws_url } */
export const GET_BRIDGE_STATUS                = 'cmd_get_bridge_status';
/** Args: { port: number }  Returns { success, message, port } */
export const BRIDGE_CONNECT                   = 'cmd_bridge_connect';
/** No args. Returns null */
export const BRIDGE_DISCONNECT                = 'cmd_bridge_disconnect';
/** Args: { message: string }  Returns null */
export const BRIDGE_SEND                      = 'cmd_bridge_send';
/** No args. Returns null */
export const BRIDGE_REQUEST_BOARD_STATE       = 'cmd_bridge_request_board_state';
/** No args. Returns cached board state or null */
export const BRIDGE_GET_BOARD_STATE           = 'cmd_bridge_get_board_state';
/** Args: { reference: string }  Returns null */
export const BRIDGE_HIGHLIGHT_COMPONENT       = 'cmd_bridge_highlight_component';
/** Args: { net: string }  Returns null */
export const BRIDGE_HIGHLIGHT_NET             = 'cmd_bridge_highlight_net';
/**
 * Request net analytics. Result arrives asynchronously via `bridge:net_info` event.
 * Args: { net: string }  Returns null
 */
export const BRIDGE_REQUEST_NET_INFO          = 'cmd_bridge_request_net_info';
/**
 * Re-fill all matching copper zones via pcbnew.ZONE_FILLER.
 * Result lands asynchronously via `bridge:op_result` event with op='regenerate_zones'.
 * Args: { filter_layer?: string, filter_net?: string, check_fill?: boolean }
 */
export const BRIDGE_REGENERATE_ZONES          = 'cmd_bridge_regenerate_zones';
/**
 * Find and (optionally) remove orphan vias — vias with no connecting track or pad
 * on either layer side. Result lands via `bridge:op_result` op='purge_orphan_vias'.
 * Args: { filter_net?: string, dry_run?: boolean }
 */
export const BRIDGE_PURGE_ORPHAN_VIAS         = 'cmd_bridge_purge_orphan_vias';
/** No args. Returns null */
export const BRIDGE_CLEAR_HIGHLIGHT           = 'cmd_bridge_clear_highlight';

// ── Bridge write commands (Phase 5 — human-in-the-loop modifications) ─────────
/**
 * Move a footprint to a new position.
 * Args: { reference: string, x_mm: number, y_mm: number }
 * Returns: { success: bool, message: string }
 */
export const BRIDGE_MOVE_COMPONENT     = 'cmd_bridge_move_component';
/**
 * Rotate a footprint.
 * Args: { reference: string, angle_deg: number }
 * Returns: { success: bool, message: string }
 */
export const BRIDGE_ROTATE_COMPONENT   = 'cmd_bridge_rotate_component';
/**
 * Lock or unlock a footprint.
 * Args: { reference: string, locked: bool }
 * Returns: { success: bool, message: string }
 */
export const BRIDGE_SET_LOCKED         = 'cmd_bridge_set_locked';
/**
 * Set or clear the DNP (Do Not Place) flag.
 * Args: { reference: string, dnp: bool }
 * Returns: { success: bool, message: string }
 */
export const BRIDGE_SET_DNP            = 'cmd_bridge_set_dnp';
/** No args. Returns { success, install_path, message } */
export const INSTALL_BRIDGE_PLUGIN            = 'cmd_install_bridge_plugin';
/** No args. Returns path string */
export const GET_PLUGIN_INSTALL_PATH          = 'cmd_get_plugin_install_path';

// ── 3D Render (Phase 11 — D1) ─────────────────────────────────────────────────
/**
 * Render one 3D view of a PCB to PNG/JPG.
 * Args: { pcb_file, output_file, side?, width_px?, height_px?, background?, quality?,
 *         zoom?, floor?, perspective?, preset? }
 * Returns: ExportResult { raw, output_path }
 */
export const RENDER_PCB        = 'cmd_render_pcb';
/**
 * Render multiple standard views in parallel (top, bottom, front, back, left, right).
 * Args: { pcb_file, output_dir, sides?, width_px?, height_px?, quality?, background? }
 * Returns: { success, output_dir, files[], failures[], message }
 */
export const RENDER_ALL_SIDES  = 'cmd_render_all_sides';

// ── UCE — Unified Component Engine (Phase 9B) ────────────────────────────────
/**
 * Search JLCPCB/LCSC parts catalogue by keyword, MPN, or LCSC number.
 * Args: { keyword: string, page?: number }
 * Returns: { total, results: UceSearchItem[] }
 */
export const UCE_SEARCH             = 'cmd_uce_search';
/**
 * Fetch & parse an EasyEDA component preview (no vault write).
 * Accepts LCSC part number (e.g. "C8734") or MPN (e.g. "STM32F103C8T6").
 * MPNs are automatically resolved to LCSC numbers via JLCPCB search.
 * Args: { lcsc_id: string }
 * Returns: UceComponentPreview
 */
export const UCE_PREVIEW_COMPONENT  = 'cmd_uce_preview_component';
/**
 * Fetch, sanitize, and add a component to the active project vault.
 * Accepts LCSC part number (e.g. "C8734") or MPN (e.g. "STM32F103C8T6").
 * MPNs are automatically resolved to LCSC numbers via JLCPCB search.
 * Args: { lcsc_id: string }
 * Returns: AddToVaultResult
 */
export const UCE_ADD_TO_VAULT       = 'cmd_uce_add_to_vault';
/**
 * List all components in the project vault.
 * No args. Returns VaultEntry[]
 */
export const UCE_GET_VAULT          = 'cmd_uce_get_vault';
/**
 * Remove a component from the vault.
 * Args: { lcsc_id: string }
 */
export const UCE_REMOVE_FROM_VAULT  = 'cmd_uce_remove_from_vault';
/**
 * Get the current global vault directory path.
 * No args. Returns { path: string }
 */
export const GET_VAULT_DIR          = 'cmd_get_vault_dir';
/**
 * Set a new vault directory (opens folder picker if vault_path not provided).
 * Args: { vault_path?: string }
 * Returns: { path: string }
 */
export const SET_VAULT_DIR          = 'cmd_set_vault_dir';

// ── Vault — Stackup sub-vault ────────────────────────────────────────────────
/** List all stackup configurations. Returns StackupEntry[] */
export const VAULT_LIST_STACKUPS         = 'cmd_vault_list_stackups';
/** Save a stackup config. Args: { config: StackupConfig } Returns: id string */
export const VAULT_SAVE_STACKUP          = 'cmd_vault_save_stackup';
/** Load a stackup config by ID. Args: { id: string } Returns: StackupConfig */
export const VAULT_LOAD_STACKUP          = 'cmd_vault_load_stackup';
/** Remove a stackup by ID. Args: { id: string } */
export const VAULT_REMOVE_STACKUP        = 'cmd_vault_remove_stackup';

// ── Vault — Template sub-vault ───────────────────────────────────────────────
/**
 * List all project templates. Returns TemplateEntry[]
 * Templates are full KiCad projects with pre-configured DRC rules,
 * netclasses, track widths, clearances, and layer stackups.
 */
export const VAULT_LIST_TEMPLATES         = 'cmd_vault_list_templates';
/**
 * Import a KiCad project directory as a template.
 * Args: { source_dir: string, name: string, description?: string, tags?: string }
 * Returns: template id string
 */
export const VAULT_IMPORT_TEMPLATE        = 'cmd_vault_import_template';
/**
 * Create a new KiCad project from a template.
 * Copies template into dest_dir with all DRC rules, netclasses, etc.
 * Args: { template_id: string, dest_dir: string, project_name: string }
 */
export const VAULT_INSTANTIATE_TEMPLATE   = 'cmd_vault_instantiate_template';
/** Remove a template by ID. Args: { id: string } */
export const VAULT_REMOVE_TEMPLATE        = 'cmd_vault_remove_template';

// ── Vault — Block sub-vault ──────────────────────────────────────────────────
/**
 * List all reusable design blocks. Returns BlockEntry[]
 * Blocks are schematic+layout pairs (buck converter, USB-C, Ethernet, etc.)
 */
export const VAULT_LIST_BLOCKS            = 'cmd_vault_list_blocks';
/**
 * Import a schematic (+optional layout) as a reusable design block.
 * Args: { sch_path: string, pcb_path?: string, name: string,
 *          description?: string, category?: string, tags?: string }
 * Returns: block id string
 */
export const VAULT_IMPORT_BLOCK           = 'cmd_vault_import_block';
/** Remove a design block by ID. Args: { id: string } */
export const VAULT_REMOVE_BLOCK           = 'cmd_vault_remove_block';

// ── Notes commands (Phase 10) ─────────────────────────────────────────────────
/**
 * Read engineering notes from `.kimaster/notes.md`.
 * No args. Returns markdown string (empty if no file yet).
 */
export const READ_NOTES  = 'cmd_read_notes';
/**
 * Save engineering notes to `.kimaster/notes.md`.
 * Args: { content: string }
 */
export const SAVE_NOTES  = 'cmd_save_notes';
/**
 * Read task list from `.kimaster/tasks.json`.
 * No args. Returns Task[].
 */
export const READ_TASKS  = 'cmd_read_tasks';
/**
 * Save task list to `.kimaster/tasks.json`.
 * Args: { tasks: Task[] }
 */
export const SAVE_TASKS  = 'cmd_save_tasks';

// ── Git commands (Phase 7) ────────────────────────────────────────────────────
/** No args. Returns { available, is_repo, git_version, repo_root } */
export const GIT_STATUS      = 'cmd_git_status';
/** Args: { limit?: number }. Returns { commits: GitCommit[], error? } */
export const GIT_GET_HISTORY = 'cmd_git_get_history';
/** Args: { commit_hash: string }. Returns { diff, commit_short, error? } */
export const GIT_DIFF_DRC    = 'cmd_git_diff_drc';
/** Args: { commit_hash: string, file_rel: string }. Returns string */
export const GIT_SHOW_FILE   = 'cmd_git_show_file';
