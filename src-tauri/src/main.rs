#![cfg_attr(not(debug_assertions), windows_subsystem = "windows")]
#![allow(non_snake_case)]
#![allow(dead_code)]

mod AppConfig;
mod AppState;
mod core;
mod extensions;
mod ipc;
mod modules;

use AppState::KiMasterState;

// ── Phase 1 commands ─────────────────────────────────────────────────────────
use ipc::CliCommands::{
    cmd_get_app_info,
    cmd_get_kicad_cli_path,
    cmd_run_drc,
    cmd_run_erc,
    cmd_export_gerbers,
    cmd_export_drill,
    cmd_export_pos,
    cmd_export_svg,
    cmd_export_pdf,
    cmd_export_bom,
    cmd_export_sch_pdf,
    cmd_export_sch_svg,
    cmd_export_fab_pack,
    cmd_render_pcb,
    cmd_render_all_sides,
};
// ── Phase 7 git commands ──────────────────────────────────────────────────────
use ipc::GitCommands::{
    cmd_git_status,
    cmd_git_get_history,
    cmd_git_diff_drc,
    cmd_git_show_file,
};

// ── Phase 9B UCE commands ─────────────────────────────────────────────────────
use ipc::UceCommands::{
    cmd_uce_search,
    cmd_uce_preview_component,
    cmd_uce_add_to_vault,
    cmd_uce_get_vault,
    cmd_uce_remove_from_vault,
    cmd_get_vault_dir,
    cmd_set_vault_dir,
    // Sub-vault: Stackups
    cmd_vault_list_stackups,
    cmd_vault_save_stackup,
    cmd_vault_load_stackup,
    cmd_vault_remove_stackup,
    // Sub-vault: Templates
    cmd_vault_list_templates,
    cmd_vault_import_template,
    cmd_vault_instantiate_template,
    cmd_vault_remove_template,
    // Sub-vault: Blocks
    cmd_vault_list_blocks,
    cmd_vault_import_block,
    cmd_vault_remove_block,
};

// ── Phase 10 notes commands ───────────────────────────────────────────────────
use ipc::NotesCommands::{
    cmd_read_notes,
    cmd_save_notes,
    cmd_read_tasks,
    cmd_save_tasks,
};

// ── Phase 4A project commands ─────────────────────────────────────────────────
use ipc::ProjectCommands::{
    cmd_get_project_state,
    cmd_open_project,
    cmd_close_project,
    cmd_get_recent_projects,
    cmd_pick_and_open_project,
};

// ── Phase 3 bridge commands ───────────────────────────────────────────────────
use ipc::BridgeCommands::{
    cmd_get_bridge_status,
    cmd_bridge_connect,
    cmd_bridge_disconnect,
    cmd_bridge_send,
    cmd_bridge_request_board_state,
    cmd_bridge_get_board_state,
    cmd_bridge_highlight_component,
    cmd_bridge_highlight_net,
    cmd_bridge_request_net_info,
    cmd_bridge_regenerate_zones,
    cmd_bridge_purge_orphan_vias,
    cmd_bridge_clear_highlight,
    cmd_install_bridge_plugin,
    cmd_get_plugin_install_path,
    // Phase 5 write commands
    cmd_bridge_move_component,
    cmd_bridge_rotate_component,
    cmd_bridge_set_locked,
    cmd_bridge_set_dnp,
};

fn main() {
    tracing_subscriber::fmt()
        .with_env_filter(
            tracing_subscriber::EnvFilter::try_from_default_env()
                .unwrap_or_else(|_| "ki_master=debug,warn".into()),
        )
        .init();

    tauri::Builder::default()
        .manage(KiMasterState::new())
        .setup(|app| {
            use tauri::Manager;

            // Resolve the global vault directory.
            // Priority: persisted custom path → default (<app_data>/vault/)
            // Reject persisted paths that look like project-local .kimaster dirs.
            let default_vault = || {
                let app_data = app.path().app_data_dir()
                    .expect("Cannot resolve app_data_dir");
                app_data.join(AppConfig::VAULT_DIR_NAME)
            };
            let vault_dir = ipc::UceCommands::load_persisted_vault_path(&app.handle())
                .map(std::path::PathBuf::from)
                .filter(|p| {
                    // Reject if the saved path ends with .kimaster (project-local)
                    let name = p.file_name().and_then(|n| n.to_str()).unwrap_or("");
                    if name == ".kimaster" {
                        tracing::warn!("Ignoring stale project-local vault path: {:?}", p);
                        false
                    } else {
                        true
                    }
                })
                .unwrap_or_else(default_vault);

            if let Err(e) = std::fs::create_dir_all(&vault_dir) {
                tracing::error!("Failed to create global vault dir {:?}: {e}", vault_dir);
            }
            let vault_str = vault_dir.to_string_lossy().into_owned();
            tracing::info!("Global vault dir: {vault_str}");

            // Provision all sub-vaults (components, stackups, templates, blocks)
            if let Err(e) = modules::uce::VaultManager::provision_all_vaults(&vault_str) {
                tracing::error!("Failed to provision vaults: {e}");
            }

            let state = app.state::<KiMasterState>();
            state.0.lock().unwrap().global_vault_dir = Some(vault_str);
            Ok(())
        })
        .invoke_handler(tauri::generate_handler![
            // ── UCE (Phase 9B) — Components ──
            cmd_uce_search,
            cmd_uce_preview_component,
            cmd_uce_add_to_vault,
            cmd_uce_get_vault,
            cmd_uce_remove_from_vault,
            cmd_get_vault_dir,
            cmd_set_vault_dir,
            // ── Vault — Stackups ──
            cmd_vault_list_stackups,
            cmd_vault_save_stackup,
            cmd_vault_load_stackup,
            cmd_vault_remove_stackup,
            // ── Vault — Templates ──
            cmd_vault_list_templates,
            cmd_vault_import_template,
            cmd_vault_instantiate_template,
            cmd_vault_remove_template,
            // ── Vault — Blocks ──
            cmd_vault_list_blocks,
            cmd_vault_import_block,
            cmd_vault_remove_block,
            // ── Notes (Phase 10) ──
            cmd_read_notes,
            cmd_save_notes,
            cmd_read_tasks,
            cmd_save_tasks,
            // ── Git (Phase 7) ──
            cmd_git_status,
            cmd_git_get_history,
            cmd_git_diff_drc,
            cmd_git_show_file,
            // ── App info ──
            cmd_get_app_info,
            cmd_get_kicad_cli_path,
            // ── Project (Phase 4A) ──
            cmd_get_project_state,
            cmd_open_project,
            cmd_close_project,
            cmd_get_recent_projects,
            cmd_pick_and_open_project,
            // ── DRC / ERC ──
            cmd_run_drc,
            cmd_run_erc,
            // ── PCB exports ──
            cmd_export_gerbers,
            cmd_export_drill,
            cmd_export_pos,
            cmd_export_svg,
            cmd_export_pdf,
            // ── Schematic exports ──
            cmd_export_bom,
            cmd_export_sch_pdf,
            cmd_export_sch_svg,
            cmd_export_fab_pack,
            // ── 3D Render (Phase 11) ──
            cmd_render_pcb,
            cmd_render_all_sides,
            // ── Bridge (Phase 3) ──
            cmd_get_bridge_status,
            cmd_bridge_connect,
            cmd_bridge_disconnect,
            cmd_bridge_send,
            cmd_bridge_request_board_state,
            cmd_bridge_get_board_state,
            cmd_bridge_highlight_component,
            cmd_bridge_highlight_net,
            cmd_bridge_request_net_info,
            cmd_bridge_regenerate_zones,
            cmd_bridge_purge_orphan_vias,
            cmd_bridge_clear_highlight,
            cmd_install_bridge_plugin,
            cmd_get_plugin_install_path,
            // Phase 5 write commands
            cmd_bridge_move_component,
            cmd_bridge_rotate_component,
            cmd_bridge_set_locked,
            cmd_bridge_set_dnp,
        ])
        .run(tauri::generate_context!())
        .expect("error while running KiMaster");
}
