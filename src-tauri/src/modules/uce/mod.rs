//! Unified Component Engine (UCE) — Phase 9B.
//!
//! Pulls EasyEDA/LCSC component data, parses it natively in Rust (zero Python),
//! runs the Brand Sanitizer rule engine, and writes `.kicad_sym` + `.kicad_mod`
//! files to the global `<app_data>/vault/library/` component vault.
//! The vault is project-independent — components can be shared across projects.
//!
//! Public modules (all pure Rust — no Tauri imports):
//!   LcscClient      — async HTTP fetcher (reqwest)
//!   EdaParser       — EasyEDA data parser (matching easyeda2kicad.py reference)
//!   KiSymGenerator  — .kicad_sym S-expression generator
//!   KiModGenerator  — .kicad_mod S-expression generator
//!   SanitizerRules  — design-standard enforcement
//!   LibraryVault    — vault filesystem + SQLite index

#![allow(non_snake_case)]

pub mod EdaParser;
pub mod KiModGenerator;
pub mod KiSymGenerator;
pub mod LcscClient;
pub mod LibraryVault;
pub mod SanitizerRules;
pub mod VaultManager;

// ── High-level pipeline ───────────────────────────────────────────────────────

use EdaParser::EeSymbolInfo;
use LcscClient::EdaRawComponent;
use LcscClient::LcscClient as Client;

/// Result of adding a component to the vault.
#[derive(Debug, serde::Serialize, serde::Deserialize)]
pub struct AddToVaultResult {
    pub success:      bool,
    pub lcsc_id:      String,
    pub sym_path:     String,
    pub mod_path:     String,
    pub message:      String,
}

/// Fetch a component from EasyEDA, parse, sanitize, and write it into one or
/// more vault directories in a single network round-trip.
///
/// `vault_dirs` is a deduplicated list of `.kimaster/` (or global vault) paths.
/// At minimum one directory must be provided. The first entry is treated as the
/// "primary" vault for the returned path strings.
pub async fn add_to_vaults(
    client:     &Client,
    vault_dirs: &[String],
    lcsc_id:    &str,
) -> anyhow::Result<AddToVaultResult> {
    if vault_dirs.is_empty() {
        anyhow::bail!("No vault directories specified");
    }

    // 1. Fetch raw component data from EasyEDA API (one request for all vaults)
    let raw: EdaRawComponent = client.fetch_component(lcsc_id).await?;

    // 2. Compute symbol origin
    let (sym_origin_x, sym_origin_y) = EdaParser::compute_symbol_origin(
        raw.sym_head_x, raw.sym_head_y,
        raw.sym_bbox.x, raw.sym_bbox.y,
        raw.sym_bbox.width, raw.sym_bbox.height,
    );

    // 3. Parse symbol
    let mut sym = EdaParser::parse_symbol(&raw.sym_shapes, sym_origin_x, sym_origin_y);
    if !raw.sub_symbols.is_empty() {
        let shared_origin = (raw.sub_symbols[0].head_x, raw.sub_symbols[0].head_y);
        for sub in &raw.sub_symbols {
            let sub_sym = EdaParser::parse_symbol(&sub.shapes, shared_origin.0, shared_origin.1);
            sym.sub_units.push(sub_sym);
        }
    }

    let info = EeSymbolInfo {
        lcsc_id:      raw.lcsc_id.clone(),
        title:        raw.title.clone(),
        package:      raw.package.clone(),
        datasheet:    raw.datasheet.clone(),
        manufacturer: raw.manufacturer.clone(),
        mpn:          raw.mpn.clone(),
        prefix:       raw.sym_prefix.clone(),
        description:  String::new(),
    };

    // 4. Parse footprint
    let mut fp = EdaParser::parse_footprint(
        &raw.fp_shapes, raw.fp_head_x, raw.fp_head_y, raw.fp_is_smd,
    );

    // 5. Sanitize
    SanitizerRules::sanitize_symbol(&mut sym);
    SanitizerRules::sanitize_footprint(&mut fp);

    // 6. Validate
    let sym_has_content = !sym.pins.is_empty()
        || !sym.rectangles.is_empty()
        || !sym.polylines.is_empty()
        || !sym.circles.is_empty()
        || sym.sub_units.iter().any(|u| {
            !u.pins.is_empty() || !u.rectangles.is_empty() || !u.polylines.is_empty()
        });
    let fp_has_content = !fp.pads.is_empty();

    if !sym_has_content && !fp_has_content {
        anyhow::bail!(
            "EasyEDA returned no symbol or footprint data for {}. \
             This component may only be available via EasyEDA Pro, \
             or the LCSC ID is invalid / unavailable in the standard API.",
            lcsc_id
        );
    }
    if !fp_has_content {
        tracing::warn!("No footprint pads for {lcsc_id} — symbol-only component");
    }
    if !sym_has_content {
        tracing::warn!("No symbol pins/geometry for {lcsc_id} — footprint-only component");
    }

    // 7. Fetch 3D STEP model bytes once (reused across all vault dirs)
    let step_bytes: Option<Vec<u8>> = if let Some(ref model_3d) = fp.model_3d {
        if !model_3d.uuid.is_empty() {
            match client.fetch_step_model(&model_3d.uuid).await {
                Ok(Some(bytes)) => Some(bytes),
                Ok(None) => { tracing::info!("No STEP model for {lcsc_id}"); None }
                Err(e)   => { tracing::warn!("STEP fetch failed: {e}"); None }
            }
        } else { None }
    } else { None };

    // 8. Symbol block is identical for all vaults
    let sym_block = KiSymGenerator::generate_symbol_block(&info, &sym);

    let vault_entry = LibraryVault::VaultEntry {
        lcsc_id:      raw.lcsc_id.clone(),
        name:         raw.title.clone(),
        package:      raw.package.clone(),
        manufacturer: raw.manufacturer.clone(),
        mpn:          raw.mpn.clone(),
        description:  String::new(),
        added_at:     String::new(),
    };

    // 9. Write to every requested vault directory
    for vault_dir in vault_dirs {
        // Ensure the vault structure exists
        if let Err(e) = LibraryVault::provision_vault(vault_dir) {
            tracing::warn!("Failed to provision vault {vault_dir}: {e}");
            continue;
        }

        // Write 3D model and get its absolute path for this vault
        let model_3d_path: Option<String> = step_bytes.as_deref()
            .and_then(|bytes| {
                let filename = format!("{lcsc_id}.step");
                LibraryVault::write_step_model(vault_dir, &filename, bytes)
                    .map(|p| p.to_string_lossy().into_owned())
                    .map_err(|e| { tracing::warn!("Failed to write STEP to {vault_dir}: {e}"); e })
                    .ok()
            });

        // Footprint content uses the vault-specific model path
        let mod_content = KiModGenerator::generate_footprint(&info, &fp, model_3d_path.as_deref());

        if let Err(e) = LibraryVault::upsert_symbol(vault_dir, lcsc_id, &sym_block) {
            tracing::warn!("Symbol write failed for {vault_dir}: {e}");
        }
        if let Err(e) = LibraryVault::write_footprint(vault_dir, lcsc_id, &mod_content) {
            tracing::warn!("Footprint write failed for {vault_dir}: {e}");
        }
        if let Err(e) = LibraryVault::upsert_vault_entry(vault_dir, &vault_entry) {
            tracing::warn!("DB write failed for {vault_dir}: {e}");
        }
    }

    // Return paths from the primary (first) vault
    let primary = &vault_dirs[0];
    let base = std::path::Path::new(primary);
    let sym_path = base.join("library").join("KiMaster.kicad_sym")
        .to_string_lossy().into_owned();
    let mod_path = base.join("library").join("KiMaster.pretty")
        .join(format!("{lcsc_id}.kicad_mod"))
        .to_string_lossy().into_owned();

    Ok(AddToVaultResult {
        success: true,
        lcsc_id: raw.lcsc_id,
        sym_path,
        mod_path,
        message: format!("Component {} added to vault successfully.", lcsc_id),
    })
}

/// Convenience wrapper: add to a single vault directory.
pub async fn add_to_vault(
    client:       &Client,
    kimaster_dir: &str,
    lcsc_id:      &str,
) -> anyhow::Result<AddToVaultResult> {
    add_to_vaults(client, &[kimaster_dir.to_string()], lcsc_id).await
}
