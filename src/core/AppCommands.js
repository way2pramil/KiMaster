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
/** Open a directory in the OS file explorer. Args: { path: string } */
export const OPEN_DIRECTORY           = 'cmd_open_directory';
/** No args. Shows native file picker → Returns OpenProjectResult */
export const PICK_AND_OPEN_PROJECT    = 'cmd_pick_and_open_project';

// ── Export directory preparation ─────────────────────────────────────────────
/**
 * Safely prepare an output directory before export.
 * Args: { path: string, mode: 'clean' | 'keep' | 'version' }
 * Returns: { resolved_path: string, existed: bool }
 *   keep:    create if absent; leave existing files untouched
 *   clean:   delete dir if present, recreate empty
 *   version: if dir is non-empty, append _v2/_v3/… until a fresh dir is found
 */
export const EXPORT_PREPARE_DIR = 'cmd_export_prepare_dir';

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
/**
 * Export a 3D STEP model from a .kicad_pcb.
 * Args: { pcb_file, output_file, use_drill_origin?, use_grid_origin?,
 *         no_unspecified?, no_dnp?, board_only?, subst_models?, min_distance? }
 * Returns ExportResult
 */
export const EXPORT_STEP           = 'cmd_export_step';

// ── Export Profiles ───────────────────────────────────────────────────────────
/** No args. Returns ProfileMeta[] — built-ins first, then user profiles. */
export const EXPORT_PROFILE_LIST   = 'cmd_list_export_profiles';
/** Args: { id: string }  Returns full profile JSON object */
export const EXPORT_PROFILE_LOAD   = 'cmd_load_export_profile';
/** Args: { profile: object }  Returns { id: string } */
export const EXPORT_PROFILE_SAVE   = 'cmd_save_export_profile';
/** Args: { id: string }  Returns void */
export const EXPORT_PROFILE_DELETE = 'cmd_delete_export_profile';
/** Args: { builtin_id: string, name: string }  Returns cloned profile object */
export const EXPORT_PROFILE_CLONE  = 'cmd_clone_builtin_profile';

// ── KiCad IPC API ─────────────────────────────────────────────────────────────
/**
 * Scan temp dir + env vars for a running KiCad IPC socket.
 * Returns { found, socket_path, token }
 * Also detects token drift (KiCad restart) and clears stale AppState client.
 */
export const IPC_SCAN                       = 'cmd_ipc_scan';
/**
 * Connect to KiCad IPC server.
 * Args: { socket_path?: string, token?: string }  (auto-scan if omitted)
 * Returns { success, message, socket_path }
 */
export const IPC_CONNECT                    = 'cmd_ipc_connect';
/** No args. Returns void. Drops client, emits ipc:disconnected. */
export const IPC_DISCONNECT                 = 'cmd_ipc_disconnect';
/** No args. Returns { connected, socket_path, kicad_version } */
export const IPC_GET_STATUS                 = 'cmd_ipc_get_status';
/**
 * Get full PCB board data via SaveDocumentToString + Rust S-expression parser.
 * Works in KiCad 10 (bypasses GetItems AS_BUSY).
 * No args. Returns { board_name, components[], nets[], layers[], source, parse_error }
 */
export const IPC_GET_PCB_DATA               = 'cmd_ipc_get_pcb_data';
/**
 * Retrieve live schematic symbols via KiCad IPC.
 * Falls back to .kicad_sch file parser when IPC GetItems returns AS_BUSY.
 * Args: { doc_path?: string }  (auto-detects open schematic if omitted)
 * Returns { success, message, symbols: IpcSymbolSummary[] }
 */
export const IPC_GET_SCHEMATIC_SYMBOLS      = 'cmd_ipc_get_schematic_symbols';
/**
 * Retrieve schematic netlist via KiCad IPC.
 * No args (uses open schematic). Returns { success, nets: { name }[] }
 */
export const IPC_GET_SCHEMATIC_NETLIST      = 'cmd_ipc_get_schematic_netlist';

/**
 * Get PCB netlist as bipartite component↔net graph for force-directed visualization.
 * No args (uses open PCB via IPC). Returns NetlistGraphData.
 */
export const GET_NETLIST_GRAPH = 'cmd_get_netlist_graph';

// ── Bridge — Stackup extraction ───────────────────────────────────────────────
/**
 * Ask the Python plugin to read the live board stackup via pcbnew API.
 * Result arrives asynchronously via `bridge:stackup_data` event → `store.bridgeStackup`.
 * No args. Returns null.
 */
export const BRIDGE_REQUEST_STACKUP  = 'cmd_bridge_request_stackup';

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
/**
 * Ask the plugin to parse .kicad_sch and push schematic state.
 * Result arrives asynchronously via `bridge:schematic_state` event.
 * No args. Returns null.
 */
export const BRIDGE_REQUEST_SCHEMATIC_STATE   = 'cmd_bridge_request_schematic_state';
/** No args. Returns cached schematic state or null */
export const BRIDGE_GET_SCHEMATIC_STATE       = 'cmd_bridge_get_schematic_state';
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

// ── Board-ops ─────────────────────────────────────────────────────────────────
/**
 * Place stitching vias inside a copper zone or board outline.
 * dry_run=true → preview only (no write). Result via `bridge:op_result` op='via_stitch'.
 * Args: { net, via_size_mm, drill_mm, pitch_mm, layer_from, layer_to,
 *          zone_name?, dry_run? }
 */
export const BRIDGE_VIA_STITCH           = 'cmd_bridge_via_stitch';
/**
 * Apply teardrops to pads/vias. dry_run=true → preview count, no write.
 * Result via `bridge:op_result` op='apply_teardrops'.
 * Args: { targets?, size_ratio?, curve_points?, prefer_zone_fills?, dry_run? }
 */
export const BRIDGE_APPLY_TEARDROPS      = 'cmd_bridge_apply_teardrops';
/**
 * Remove all teardrops from the board.
 * Result via `bridge:op_result` op='remove_teardrops'.
 */
export const BRIDGE_REMOVE_TEARDROPS     = 'cmd_bridge_remove_teardrops';
/**
 * Duplicate board into an N×M panel. dry_run=true → preview outline only.
 * Result via `bridge:op_result` op='panelize_board'.
 * Args: { cols, rows, gap_mm, rail_mm, mouse_bites?, mouse_bite_dia_mm?,
 *          mouse_bite_spacing_mm?, v_score?, output_path?, dry_run? }
 */
export const BRIDGE_PANELIZE_BOARD       = 'cmd_bridge_panelize_board';
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
/**
 * Check if the bridge plugin is currently installed.
 * No args. Returns { installed: bool, install_path: string }
 */
export const CHECK_PLUGIN_INSTALLED           = 'cmd_check_plugin_installed';
/**
 * Clean reinstall: wipe existing plugin, copy fresh files, clear Python bytecode caches.
 * No args. Returns { success, install_path, message }
 */
export const REINSTALL_BRIDGE_PLUGIN          = 'cmd_reinstall_bridge_plugin';
/** No args. Returns path string */
export const GET_PLUGIN_INSTALL_PATH          = 'cmd_get_plugin_install_path';
/**
 * Scan ports 40001–40010 for active KiMaster bridge WebSocket servers.
 * No args. Returns KiCadInstance[] — { port, board_name?, kicad_version? }
 * One entry = single KiCad instance. Multiple = user must pick one.
 */
export const SCAN_KICAD_INSTANCES             = 'cmd_scan_kicad_instances';

// ── Live 3D viewer ────────────────────────────────────────────────────────────
/**
 * Read a .kicad_pcb file's raw text for client-side Three.js parsing.
 * Args: { path: string }  Returns: string (file contents)
 */
export const READ_PCB_FILE = 'cmd_read_pcb_file';
/** Check if a file exists. Args: { path: string }  Returns: boolean */
export const FILE_EXISTS   = 'cmd_file_exists';

// ── PCB 3D pipeline ───────────────────────────────────────────────────────────
/**
 * Export board + component VRML models.
 * Args: { pcb_file: string, output_dir: string }
 * Returns: { pcb_wrl, components_dir, success, message }
 */
export const PCB3D_EXPORT_LAYERS        = 'cmd_pcb3d_export_layers';
/** Args: { pcb_file: string, output_dir: string }  Returns VrmlExportResult */
export const PCB3D_EXPORT_VRML          = 'cmd_pcb3d_export_vrml';
/**
 * Export full photorealistic GLB (KiCad 10+). Slow — user-triggered only.
 * Args: { pcb_file, output_file, subst_models?, no_dnp? }
 * Returns: { output_file, success, message, file_size_kb }
 */
export const PCB3D_EXPORT_MARKETING_GLB = 'cmd_pcb3d_export_marketing_glb';
/** Args: { path: string }  Returns: boolean */
export const PCB3D_FILE_EXISTS          = 'cmd_pcb3d_file_exists';
/** Args: { path: string }  Returns: string */
export const PCB3D_READ_FILE            = 'cmd_pcb3d_read_file';
/** Args: { dir: string, ext?: string }  Returns: string[] */
export const PCB3D_LIST_DIR             = 'cmd_pcb3d_list_dir';

/**
 * Export .kicad_pcb as binary GLTF (.glb) via kicad-cli pcb export glb.
 * Requires KiCad 10+. Returns real component 3D models, copper, mask, silkscreen.
 * Args: { pcb_file, output_file, include_tracks?, include_pads?, include_zones?,
 *         include_silkscreen?, include_soldermask?, cut_vias_in_body?,
 *         subst_models?, no_dnp? }
 * Returns: ExportResult { raw, output_path }
 */
export const EXPORT_GLB = 'cmd_export_glb';

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

// ── Canvas commands (Footprint + Symbol editor) ───────────────────────────────
/**
 * Load a .kicad_mod file into the footprint editor (Rust makes a temp copy).
 * Args: { path: string }
 * Returns: { elements: EDAElement[], temp_path: string, original_hash: string }
 */
export const CANVAS_LOAD_FOOTPRINT = 'cmd_canvas_load_footprint';
/**
 * Save mutations back to the .kicad_mod original file.
 * Args: { temp_path, original_path, mutations: Mutation[], original_hash: string }
 * Returns: { new_hash: string }
 */
export const CANVAS_SAVE_FOOTPRINT = 'cmd_canvas_save_footprint';
/**
 * Load a symbol from a .kicad_sym library.
 * Args: { lib_path: string, symbol_name: string }
 * Returns: { elements: EDAElement[], original_hash: string }
 */
export const CANVAS_LOAD_SYMBOL    = 'cmd_canvas_load_symbol';
/**
 * Save symbol mutations back to the library.
 * Args: { lib_path, symbol_name, mutations: Mutation[], original_hash: string }
 * Returns: { new_hash: string }
 */
export const CANVAS_SAVE_SYMBOL    = 'cmd_canvas_save_symbol';
/** Drop the active symbol library handle and clean up the temp file. No args. */
export const CANVAS_CLOSE          = 'cmd_canvas_close';
/**
 * Show a native file picker filtered to .kicad_mod files.
 * No args. Returns string path or null if cancelled.
 */
export const CANVAS_PICK_FOOTPRINT = 'cmd_canvas_pick_footprint';

// ── Git commands (Phase 7) ────────────────────────────────────────────────────
/** No args. Returns { available, is_repo, git_version, repo_root } */
export const GIT_STATUS      = 'cmd_git_status';
/** Args: { limit?: number }. Returns { commits: GitCommit[], error? } */
export const GIT_GET_HISTORY = 'cmd_git_get_history';
/** Args: { commit_hash: string }. Returns { diff, commit_short, error? } */
export const GIT_DIFF_DRC    = 'cmd_git_diff_drc';
/** Args: { commit_hash: string, file_rel: string }. Returns string */
export const GIT_SHOW_FILE   = 'cmd_git_show_file';
