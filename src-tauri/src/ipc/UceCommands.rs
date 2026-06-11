//! Phase 9B — Unified Component Engine IPC commands.
//! All commands are thin async wrappers over the pure `modules::uce` functions.

use std::path::PathBuf;
use tauri::{AppHandle, State};
use serde::{Deserialize, Serialize};

use crate::AppState::KiMasterState;
use crate::modules::uce::{
    self, AddToVaultResult,
    LcscClient::{LcscClient, SearchResponse},
    LibraryVault::{VaultEntry, get_vault_contents, remove_from_vault, is_in_vault},
    LibTableManager,
    PostProcessor::PostProcessConfig,
    VaultManager::{
        StackupEntry, StackupConfig,
        TemplateEntry,
        BlockEntry,
    },
};

// ── Helpers ───────────────────────────────────────────────────────────────────

/// Get the global vault directory from AppState. Fails if not initialised.
fn require_vault_dir(state: &State<'_, KiMasterState>) -> Result<String, String> {
    let inner = state.0.lock().map_err(|e| format!("State lock poisoned: {e}"))?;
    inner
        .global_vault_dir
        .clone()
        .ok_or_else(|| "Global vault directory not initialised".to_string())
}

/// Collect all active vault directories: global vault + project vault (if open).
/// Deduplicates so the same dir isn't written twice.
fn collect_vault_dirs(state: &State<'_, KiMasterState>) -> Result<Vec<String>, String> {
    let inner = state.0.lock().map_err(|e| format!("State lock poisoned: {e}"))?;
    let global = inner.global_vault_dir.clone()
        .ok_or_else(|| "Global vault directory not initialised".to_string())?;
    let mut dirs = vec![global.clone()];
    if let Some(proj) = &inner.project_vault_dir {
        if proj != &global {
            dirs.push(proj.clone());
        }
    }
    Ok(dirs)
}

/// Build a one-shot HTTP client (cheap, shares no connection pool).
fn make_client() -> Result<LcscClient, String> {
    LcscClient::new().map_err(|e| format!("Failed to create HTTP client: {e}"))
}

// ── Search ────────────────────────────────────────────────────────────────────

/// Response for component search — wraps SearchResponse with vault membership flags.
#[derive(Debug, Serialize, Deserialize)]
pub struct UceSearchResponse {
    pub total:    u64,
    pub results:  Vec<UceSearchItem>,
}

#[derive(Debug, Serialize, Deserialize)]
pub struct UceSearchItem {
    pub lcsc:         String,
    pub name:         String,
    pub mpn:          String,
    pub manufacturer: String,
    pub package:      String,
    pub description:  String,
    pub stock:        i64,
    pub price:        Option<f64>,
    pub part_type:    String,
    pub datasheet:    String,
    pub category:     String,
    /// True if this LCSC part is already in the active project vault.
    pub in_vault:     bool,
}

/// Search JLCPCB/LCSC parts catalogue by keyword.
/// Args: `keyword: string, page?: number`
#[tauri::command]
pub async fn cmd_uce_search(
    state:    State<'_, KiMasterState>,
    keyword:  String,
    page:     Option<u32>,
) -> Result<UceSearchResponse, String> {
    let client    = make_client()?;
    let page_no   = page.unwrap_or(1).max(1);
    let resp: SearchResponse = client
        .search(&keyword, page_no, 20)
        .await
        .map_err(|e| format!("Search failed: {e}"))?;

    // Check vault membership across all active vaults (best-effort)
    let vault_dirs = collect_vault_dirs(&state).unwrap_or_default();
    let items = resp.results.into_iter().map(|r| {
        let in_vault = vault_dirs.iter().any(|d| is_in_vault(d, &r.lcsc));
        UceSearchItem {
            lcsc:         r.lcsc,
            name:         r.name,
            mpn:          r.mpn,
            manufacturer: r.manufacturer,
            package:      r.package,
            description:  r.description,
            stock:        r.stock,
            price:        r.price,
            part_type:    r.part_type,
            datasheet:    r.datasheet,
            category:     r.category,
            in_vault,
        }
    }).collect();

    Ok(UceSearchResponse { total: resp.total, results: items })
}

// ── Preview ───────────────────────────────────────────────────────────────────

/// Component preview — fetch EasyEDA data and return parsed metadata without writing.
#[derive(Debug, Serialize, Deserialize)]
pub struct UceComponentPreview {
    pub lcsc_id:      String,
    pub title:        String,
    pub package:      String,
    pub manufacturer: String,
    pub mpn:          String,
    pub datasheet:    String,
    pub pin_count:    usize,
    pub pad_count:    usize,
    pub has_symbol:   bool,
    pub has_footprint: bool,
    pub in_vault:     bool,
}

/// Fetch EasyEDA data for one component and return a preview (no vault write).
/// Accepts either an LCSC part number (e.g. "C8734") or an MPN (e.g. "STM32F103C8T6").
/// MPNs are automatically resolved to LCSC part numbers via JLCPCB search.
/// Args: `lcsc_id: string`
#[tauri::command(rename_all = "snake_case")]
pub async fn cmd_uce_preview_component(
    state:   State<'_, KiMasterState>,
    lcsc_id: String,
) -> Result<UceComponentPreview, String> {
    let client = make_client()?;

    // Resolve MPN → LCSC if needed
    let resolved_id = client.resolve_to_lcsc(&lcsc_id)
        .await
        .map_err(|e| format!("Resolution failed: {e}"))?;

    let raw = client.fetch_component(&resolved_id)
        .await
        .map_err(|e| format!("Fetch failed: {e}"))?;

    // Compute symbol origin from bbox/head data
    let (sym_origin_x, sym_origin_y) = uce::EdaParser::compute_symbol_origin(
        raw.sym_head_x, raw.sym_head_y,
        raw.sym_bbox.x, raw.sym_bbox.y,
        raw.sym_bbox.width, raw.sym_bbox.height,
    );
    let sym = uce::EdaParser::parse_symbol(&raw.sym_shapes, sym_origin_x, sym_origin_y);

    // Parse footprint from shape array
    let fp = uce::EdaParser::parse_footprint(
        &raw.fp_shapes, raw.fp_head_x, raw.fp_head_y, raw.fp_is_smd,
    );

    let vault_dirs = collect_vault_dirs(&state).unwrap_or_default();
    let in_vault = vault_dirs.iter().any(|d| is_in_vault(d, &resolved_id));

    Ok(UceComponentPreview {
        lcsc_id:       raw.lcsc_id,
        title:         raw.title,
        package:       raw.package,
        manufacturer:  raw.manufacturer,
        mpn:           raw.mpn,
        datasheet:     raw.datasheet,
        pin_count:     sym.pins.len(),
        pad_count:     fp.pads.len(),
        has_symbol:    !sym.pins.is_empty() || !sym.rectangles.is_empty(),
        has_footprint: !fp.pads.is_empty(),
        in_vault,
    })
}

// ── Add to vault ──────────────────────────────────────────────────────────────

/// Fetch, parse, sanitize, and add a component to the active project vault.
/// Accepts either an LCSC part number (e.g. "C8734") or an MPN (e.g. "STM32F103C8T6").
/// MPNs are automatically resolved to LCSC part numbers via JLCPCB search.
/// Args: `lcsc_id: string`
#[tauri::command(rename_all = "snake_case")]
pub async fn cmd_uce_add_to_vault(
    state:    State<'_, KiMasterState>,
    lcsc_id:   String,
    pp_config: Option<serde_json::Value>,
) -> Result<AddToVaultResult, String> {
    let vault_dirs = collect_vault_dirs(&state)?;
    let client     = make_client()?;

    // Resolve MPN → LCSC if needed
    let resolved_id = client.resolve_to_lcsc(&lcsc_id)
        .await
        .map_err(|e| format!("Resolution failed: {e}"))?;

    // Deserialise post-process config (missing fields → defaults via #[serde(default)])
    let cfg: PostProcessConfig = pp_config
        .and_then(|v| serde_json::from_value(v).ok())
        .unwrap_or_default();

    // Write to global vault + project vault (if open) in one fetch
    let mut result = uce::add_to_vaults(&client, &vault_dirs, &resolved_id, &cfg)
        .await
        .map_err(|e| format!("Add to vault failed: {e}"))?;

    // Register KiMaster in project lib tables (sym-lib-table + fp-lib-table).
    // Only possible when a project is open; silently skipped otherwise.
    let (project_dir, primary_vault) = {
        let inner = state.0.lock().map_err(|e| format!("State lock: {e}"))?;
        let proj_dir = inner.active_project.as_ref()
            .and_then(|p| std::path::Path::new(&p.path).parent().map(|d| d.to_path_buf()));
        let vault    = vault_dirs.first().map(std::path::PathBuf::from);
        (proj_dir, vault)
    };

    if let (Some(proj_dir), Some(vault_dir)) = (project_dir, primary_vault) {
        match LibTableManager::ensure_kimaster_libraries(&proj_dir, &vault_dir) {
            Ok(reg) => {
                result.lib_registered            = true;
                result.lib_registered_first_time = reg.any_new();
            }
            Err(e) => tracing::warn!("[LibTable] Registration skipped: {e}"),
        }
    }

    Ok(result)
}

// ── Vault contents ────────────────────────────────────────────────────────────

/// List all components across all active vaults (global + project), deduplicated by LCSC ID.
/// Components present in the project vault are returned first.
#[tauri::command]
pub async fn cmd_uce_get_vault(
    state: State<'_, KiMasterState>,
) -> Result<Vec<VaultEntry>, String> {
    let vault_dirs = collect_vault_dirs(&state).unwrap_or_else(|_| vec![]);
    let mut seen = std::collections::HashSet::new();
    let mut combined: Vec<VaultEntry> = Vec::new();

    // Project vault (last in dirs, if different from global) goes first — more relevant
    for dir in vault_dirs.iter().rev() {
        match get_vault_contents(dir) {
            Ok(entries) => {
                for e in entries {
                    if seen.insert(e.lcsc_id.clone()) {
                        combined.push(e);
                    }
                }
            }
            Err(e) => tracing::warn!("get_vault_contents({dir}) failed: {e}"),
        }
    }
    Ok(combined)
}

/// Remove a component from the vault (deletes .kicad_mod + removes from .kicad_sym + DB).
/// Args: `lcsc_id: string`
#[tauri::command(rename_all = "snake_case")]
pub async fn cmd_uce_remove_from_vault(
    state:   State<'_, KiMasterState>,
    lcsc_id: String,
) -> Result<(), String> {
    let vault_dirs = collect_vault_dirs(&state).unwrap_or_else(|_| vec![]);
    for dir in &vault_dirs {
        if let Err(e) = remove_from_vault(dir, &lcsc_id) {
            tracing::warn!("Remove from vault {dir} failed: {e}");
        }
    }
    Ok(())
}

// ── Vault directory management ───────────────────────────────────────────────

/// Both vault paths returned together for UI display.
#[derive(Serialize, Deserialize)]
pub struct VaultDirsResponse {
    /// User-configured global vault (persisted across projects).
    pub global_vault:  String,
    /// Project-local vault (`.kimaster/` of the open project), if any.
    pub project_vault: Option<String>,
}

/// Return current global and project vault paths.
#[tauri::command]
pub async fn cmd_get_vault_dir(
    state: State<'_, KiMasterState>,
) -> Result<VaultDirsResponse, String> {
    let inner = state.0.lock().map_err(|e| format!("State lock: {e}"))?;
    let global_vault = inner.global_vault_dir.clone()
        .ok_or_else(|| "Global vault not initialised".to_string())?;
    let project_vault = inner.project_vault_dir.clone();
    Ok(VaultDirsResponse { global_vault, project_vault })
}

/// Set the global vault directory.
/// Opens a native folder picker if `vault_path` is omitted or empty.
/// Provisions the vault structure and persists the choice.
#[tauri::command(rename_all = "snake_case")]
pub async fn cmd_set_vault_dir(
    app:        AppHandle,
    state:      State<'_, KiMasterState>,
    vault_path: Option<String>,
) -> Result<VaultDirsResponse, String> {
    let chosen = match vault_path {
        Some(p) if !p.is_empty() => PathBuf::from(p),
        _ => {
            let picked = std::thread::spawn(|| {
                rfd::FileDialog::new()
                    .set_title("Choose Global Component Library Folder")
                    .pick_folder()
            })
            .join()
            .map_err(|_| "Folder picker thread panicked".to_string())?;
            match picked {
                Some(p) => p,
                None => return Err("No folder selected".into()),
            }
        }
    };

    if let Err(e) = std::fs::create_dir_all(&chosen) {
        return Err(format!("Cannot create directory: {e}"));
    }

    let vault_str = chosen.to_string_lossy().into_owned();

    uce::VaultManager::provision_all_vaults(&vault_str)
        .map_err(|e| format!("Cannot provision vault: {e}"))?;

    let project_vault = {
        let mut inner = state.0.lock().map_err(|e| e.to_string())?;
        inner.global_vault_dir = Some(vault_str.clone());
        inner.project_vault_dir.clone()
    };

    if let Err(e) = persist_vault_path(&app, &vault_str) {
        tracing::warn!("Could not persist vault path: {e}");
    }

    tracing::info!("Global vault changed to: {vault_str}");
    Ok(VaultDirsResponse { global_vault: vault_str, project_vault })
}

// ── Persistence helpers ──────────────────────────────────────────────────────

/// JSON config stored at `<app_data>/vault_config.json`.
#[derive(Serialize, Deserialize, Default)]
struct VaultConfig {
    vault_dir: Option<String>,
}

fn config_path(app: &AppHandle) -> Result<PathBuf, String> {
    use tauri::Manager;
    let app_data = app.path().app_data_dir()
        .map_err(|e| format!("Cannot resolve app_data_dir: {e}"))?;
    Ok(app_data.join("vault_config.json"))
}

fn persist_vault_path(app: &AppHandle, path: &str) -> Result<(), String> {
    let cfg_path = config_path(app)?;
    let cfg = VaultConfig { vault_dir: Some(path.to_string()) };
    let json = serde_json::to_string_pretty(&cfg)
        .map_err(|e| format!("JSON serialize: {e}"))?;
    std::fs::write(&cfg_path, json)
        .map_err(|e| format!("Write config: {e}"))
}

/// Read persisted vault path. Returns None if no config or no custom path.
pub fn load_persisted_vault_path(app: &AppHandle) -> Option<String> {
    let cfg_path = config_path(app).ok()?;
    let data = std::fs::read_to_string(&cfg_path).ok()?;
    let cfg: VaultConfig = serde_json::from_str(&data).ok()?;
    cfg.vault_dir.filter(|p| !p.is_empty())
}

// ═══════════════════════════════════════════════════════════════════════════════
// SUB-VAULT 2: Stackup commands
// ═══════════════════════════════════════════════════════════════════════════════

/// List all stackup configurations in the vault.
#[tauri::command]
pub async fn cmd_vault_list_stackups(
    state: State<'_, KiMasterState>,
) -> Result<Vec<StackupEntry>, String> {
    let vault_dir = require_vault_dir(&state)?;
    uce::VaultManager::list_stackups(&vault_dir).map_err(|e| e.to_string())
}

/// Save a stackup configuration to the vault.
#[tauri::command]
pub async fn cmd_vault_save_stackup(
    state:  State<'_, KiMasterState>,
    config: StackupConfig,
) -> Result<String, String> {
    let vault_dir = require_vault_dir(&state)?;
    uce::VaultManager::save_stackup(&vault_dir, &config).map_err(|e| e.to_string())
}

/// Load a stackup configuration by ID.
#[tauri::command]
pub async fn cmd_vault_load_stackup(
    state: State<'_, KiMasterState>,
    id:    String,
) -> Result<StackupConfig, String> {
    let vault_dir = require_vault_dir(&state)?;
    uce::VaultManager::load_stackup(&vault_dir, &id).map_err(|e| e.to_string())
}

/// Remove a stackup by ID.
#[tauri::command]
pub async fn cmd_vault_remove_stackup(
    state: State<'_, KiMasterState>,
    id:    String,
) -> Result<(), String> {
    let vault_dir = require_vault_dir(&state)?;
    uce::VaultManager::remove_stackup(&vault_dir, &id).map_err(|e| e.to_string())
}

// ═══════════════════════════════════════════════════════════════════════════════
// SUB-VAULT 3: Template commands
// ═══════════════════════════════════════════════════════════════════════════════

/// List all project templates in the vault.
#[tauri::command]
pub async fn cmd_vault_list_templates(
    state: State<'_, KiMasterState>,
) -> Result<Vec<TemplateEntry>, String> {
    let vault_dir = require_vault_dir(&state)?;
    uce::VaultManager::list_templates(&vault_dir).map_err(|e| e.to_string())
}

/// Import a KiCad project directory as a template.
/// The project's DRC rules, netclasses, track widths, and layer stackup are preserved.
#[tauri::command(rename_all = "snake_case")]
pub async fn cmd_vault_import_template(
    state:       State<'_, KiMasterState>,
    source_dir:  String,
    name:        String,
    description: Option<String>,
    tags:        Option<String>,
) -> Result<String, String> {
    let vault_dir = require_vault_dir(&state)?;
    uce::VaultManager::import_template(
        &vault_dir, &source_dir, &name,
        &description.unwrap_or_default(),
        &tags.unwrap_or_default(),
    ).map_err(|e| e.to_string())
}

/// Create a new KiCad project from a template.
/// Copies the template into dest_dir, renaming project files to project_name.
/// The new project inherits all DRC rules, netclasses, and layer setup.
#[tauri::command(rename_all = "snake_case")]
pub async fn cmd_vault_instantiate_template(
    state:        State<'_, KiMasterState>,
    template_id:  String,
    dest_dir:     String,
    project_name: String,
) -> Result<(), String> {
    let vault_dir = require_vault_dir(&state)?;
    uce::VaultManager::instantiate_template(
        &vault_dir, &template_id, &dest_dir, &project_name,
    ).map_err(|e| e.to_string())
}

/// Remove a template by ID.
#[tauri::command(rename_all = "snake_case")]
pub async fn cmd_vault_remove_template(
    state: State<'_, KiMasterState>,
    id:    String,
) -> Result<(), String> {
    let vault_dir = require_vault_dir(&state)?;
    uce::VaultManager::remove_template(&vault_dir, &id).map_err(|e| e.to_string())
}

// ═══════════════════════════════════════════════════════════════════════════════
// SUB-VAULT 4: Block commands
// ═══════════════════════════════════════════════════════════════════════════════

/// List all reusable design blocks in the vault.
#[tauri::command]
pub async fn cmd_vault_list_blocks(
    state: State<'_, KiMasterState>,
) -> Result<Vec<BlockEntry>, String> {
    let vault_dir = require_vault_dir(&state)?;
    uce::VaultManager::list_blocks(&vault_dir).map_err(|e| e.to_string())
}

/// Import a schematic (+optional layout) as a reusable design block.
#[tauri::command(rename_all = "snake_case")]
pub async fn cmd_vault_import_block(
    state:       State<'_, KiMasterState>,
    sch_path:    String,
    pcb_path:    Option<String>,
    name:        String,
    description: Option<String>,
    category:    Option<String>,
    tags:        Option<String>,
) -> Result<String, String> {
    let vault_dir = require_vault_dir(&state)?;
    uce::VaultManager::import_block(
        &vault_dir,
        &sch_path,
        pcb_path.as_deref(),
        &name,
        &description.unwrap_or_default(),
        &category.unwrap_or_default(),
        &tags.unwrap_or_default(),
    ).map_err(|e| e.to_string())
}

/// Remove a design block by ID.
#[tauri::command(rename_all = "snake_case")]
pub async fn cmd_vault_remove_block(
    state: State<'_, KiMasterState>,
    id:    String,
) -> Result<(), String> {
    let vault_dir = require_vault_dir(&state)?;
    uce::VaultManager::remove_block(&vault_dir, &id).map_err(|e| e.to_string())
}
