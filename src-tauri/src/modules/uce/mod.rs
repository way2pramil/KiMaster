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

/// Fetch a component from EasyEDA, parse it, sanitize it,
/// write it into the vault library, and update the vault index.
pub async fn add_to_vault(
    client:       &Client,
    kimaster_dir: &str,
    lcsc_id:      &str,
) -> anyhow::Result<AddToVaultResult> {
    // 1. Fetch raw component data from EasyEDA API
    let raw: EdaRawComponent = client.fetch_component(lcsc_id).await?;

    // 2. Provision vault directory (no-op if already exists)
    LibraryVault::provision_vault(kimaster_dir)?;

    // 3. Compute symbol origin from bbox/head data
    let (sym_origin_x, sym_origin_y) = EdaParser::compute_symbol_origin(
        raw.sym_head_x, raw.sym_head_y,
        raw.sym_bbox.x, raw.sym_bbox.y,
        raw.sym_bbox.width, raw.sym_bbox.height,
    );

    // 4. Parse symbol from shape array
    let mut sym = EdaParser::parse_symbol(&raw.sym_shapes, sym_origin_x, sym_origin_y);

    // 4b. Parse multi-unit sub-symbols if present
    if !raw.sub_symbols.is_empty() {
        // Shared origin: use the first subpart's head coordinates
        // (matching Python _shared_origin())
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

    // 5. Parse footprint from shape array
    let mut fp = EdaParser::parse_footprint(
        &raw.fp_shapes, raw.fp_head_x, raw.fp_head_y, raw.fp_is_smd,
    );

    // 6. Sanitize (Brand Sanitizer rule engine)
    SanitizerRules::sanitize_symbol(&mut sym);
    SanitizerRules::sanitize_footprint(&mut fp);

    // 6b. Validate parsed data has usable content BEFORE writing anything.
    //     If both symbol and footprint are empty, the EasyEDA API returned no
    //     shape data — this component requires EasyEDA Pro login or the LCSC
    //     ID points to a Pro-only/unavailable part.  Bail cleanly so the user
    //     sees an actionable error and no orphan DB row is created.
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
        tracing::warn!("No symbol geometry/pins for {lcsc_id} — footprint-only component");
    }

    // 7. Download 3D STEP model if available
    let model_3d_path = if let Some(ref model_3d) = fp.model_3d {
        if !model_3d.uuid.is_empty() {
            match client.fetch_step_model(&model_3d.uuid).await {
                Ok(Some(step_bytes)) => {
                    // Use LCSC ID as filename to avoid collisions
                    let step_filename = format!("{lcsc_id}.step");
                    match LibraryVault::write_step_model(kimaster_dir, &step_filename, &step_bytes) {
                        Ok(abs_path) => Some(abs_path.to_string_lossy().into_owned()),
                        Err(e) => {
                            tracing::warn!("Failed to write STEP model: {e}");
                            None
                        }
                    }
                }
                Ok(None) => {
                    tracing::info!("No STEP model available for {lcsc_id}");
                    None
                }
                Err(e) => {
                    tracing::warn!("Failed to fetch STEP model: {e}");
                    None
                }
            }
        } else {
            None
        }
    } else {
        None
    };

    // 8. Generate S-expressions
    let sym_block   = KiSymGenerator::generate_symbol_block(&info, &sym);
    let mod_content = KiModGenerator::generate_footprint(
        &info,
        &fp,
        model_3d_path.as_deref(),
    );

    // 9. Write to vault
    LibraryVault::upsert_symbol(kimaster_dir, lcsc_id, &sym_block)?;
    LibraryVault::write_footprint(kimaster_dir, lcsc_id, &mod_content)?;
    LibraryVault::upsert_vault_entry(kimaster_dir, &LibraryVault::VaultEntry {
        lcsc_id:      raw.lcsc_id.clone(),
        name:         raw.title.clone(),
        package:      raw.package.clone(),
        manufacturer: raw.manufacturer.clone(),
        mpn:          raw.mpn.clone(),
        description:  String::new(),
        added_at:     String::new(), // set by SQL DEFAULT
    })?;

    let base = std::path::Path::new(kimaster_dir);
    let sym_path = base.join("library").join("KiMaster.kicad_sym")
        .to_string_lossy().into_owned();
    let mod_path = base.join("library").join("KiMaster.pretty").join(format!("{lcsc_id}.kicad_mod"))
        .to_string_lossy().into_owned();

    Ok(AddToVaultResult {
        success: true,
        lcsc_id: raw.lcsc_id,
        sym_path,
        mod_path,
        message: format!("Component {} added to vault successfully.", lcsc_id),
    })
}
