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
pub mod LibTableManager;
pub mod PostProcessor;
pub mod SanitizerRules;
pub mod VaultManager;

// ── High-level pipeline ───────────────────────────────────────────────────────

use EdaParser::EeSymbolInfo;
use LcscClient::EdaRawComponent;
use LcscClient::LcscClient as Client;
pub use PostProcessor::PostProcessConfig;

/// Result of adding a component to the vault.
#[derive(Debug, serde::Serialize, serde::Deserialize)]
pub struct AddToVaultResult {
    pub success:       bool,
    pub lcsc_id:       String,
    pub sym_path:      String,
    pub mod_path:      String,
    pub message:       String,
    /// What was actually generated (drives UI status badges).
    pub has_symbol:    bool,
    pub has_footprint: bool,
    pub has_3d_model:  bool,
    /// True if KiMaster libraries were registered in the project lib tables this call.
    pub lib_registered: bool,
    /// True if this was the first registration (sym or fp table was modified).
    pub lib_registered_first_time: bool,
    /// Pipeline timing breakdown in milliseconds for dev-tools display.
    pub timings:       PipelineTimings,
}

/// Per-stage timing breakdown (all values in milliseconds).
#[derive(Debug, Default, Clone, serde::Serialize, serde::Deserialize)]
pub struct PipelineTimings {
    pub fetch_ms:     u64,   // parallel EasyEDA + JLCPCB fetch
    pub parse_ms:     u64,   // symbol + footprint parse + post-process
    pub model_ms:     u64,   // 3D STEP download (0 if cached)
    pub model_cached: bool,
    pub generate_ms:  u64,   // S-expression generation
    pub write_ms:     u64,   // disk writes (all vault dirs)
    pub total_ms:     u64,
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
    cfg:        &PostProcessConfig,
) -> anyhow::Result<AddToVaultResult> {
    if vault_dirs.is_empty() {
        anyhow::bail!("No vault directories specified");
    }

    let total_start = std::time::Instant::now();
    let mut timings  = PipelineTimings::default();

    // 1. Fetch EasyEDA component data AND JLCPCB metadata in parallel to minimise latency.
    //    JLCPCB fills in description/price/stock when EasyEDA returns empty values.
    let t_fetch = std::time::Instant::now();
    let (raw_result, (jlc_desc, jlc_price, jlc_stock)) = tokio::join!(
        client.fetch_component(lcsc_id),
        client.fetch_jlcpcb_meta(lcsc_id),
    );
    let mut raw: EdaRawComponent = raw_result?;
    timings.fetch_ms = t_fetch.elapsed().as_millis() as u64;

    // Apply JLCPCB fallbacks
    if raw.description.is_empty() && !jlc_desc.is_empty() {
        raw.description = jlc_desc;
    }
    if raw.price == 0.0 && jlc_price > 0.0 {
        raw.price = jlc_price;
    }
    if raw.stock == 0 && jlc_stock > 0 {
        raw.stock = jlc_stock;
    }

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
        description:  raw.description.clone(),   // ← was always empty before
    };

    // 4. Parse footprint
    let mut fp = EdaParser::parse_footprint(
        &raw.fp_shapes, raw.fp_head_x, raw.fp_head_y, raw.fp_is_smd,
    );

    // 5. Sanitize + post-process
    let t_parse = std::time::Instant::now();
    SanitizerRules::sanitize_symbol(&mut sym);
    SanitizerRules::sanitize_footprint(&mut fp);
    PostProcessor::apply_to_symbol(&mut sym, cfg);

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

    // 8-pre. Derive naming from config — needed before 3D cache check
    let sym_name = PostProcessor::symbol_name(&raw.mpn, &raw.lcsc_id, cfg);
    let fp_stem  = PostProcessor::footprint_stem(&raw.package, &raw.lcsc_id, cfg);
    timings.parse_ms = t_parse.elapsed().as_millis() as u64;

    // 7. Fetch 3D STEP model — skip download if already cached in any vault directory.
    let step_cached = vault_dirs.iter().any(|dir| {
        LibraryVault::get_models_dir(dir)
            .join(format!("{fp_stem}.step"))
            .exists()
    });

    timings.model_cached = step_cached;
    let t_model = std::time::Instant::now();
    let step_bytes: Option<Vec<u8>> = if step_cached {
        tracing::debug!("3D model already cached for {fp_stem} — skipping download");
        None
    } else if let Some(ref model_3d) = fp.model_3d {
        if !model_3d.uuid.is_empty() {
            match client.fetch_step_model(&model_3d.uuid).await {
                Ok(Some(bytes)) => Some(bytes),
                Ok(None) => { tracing::info!("No STEP model for {lcsc_id}"); None }
                Err(e)   => { tracing::warn!("STEP fetch failed: {e}"); None }
            }
        } else { None }
    } else { None };
    timings.model_ms = t_model.elapsed().as_millis() as u64;

    // Extra API fields for the symbol generator
    let extras = KiSymGenerator::SymbolExtras {
        description: raw.description.clone(),
        price:       raw.price,
        stock:       raw.stock,
    };

    // Symbol block is identical for all vaults; info keeps original lcsc_id
    let t_gen = std::time::Instant::now();
    let sym_block = KiSymGenerator::generate_symbol_block(
        &info, &sym, &extras, cfg, &sym_name, &fp_stem,
    );

    let vault_entry = LibraryVault::VaultEntry {
        lcsc_id:      raw.lcsc_id.clone(),
        name:         raw.title.clone(),
        package:      raw.package.clone(),
        manufacturer: raw.manufacturer.clone(),
        mpn:          raw.mpn.clone(),
        description:  raw.description.clone(),
        fp_stem:      fp_stem.clone(),
        added_at:     String::new(),
    };

    timings.generate_ms = t_gen.elapsed().as_millis() as u64;

    // 9. Write to every requested vault directory
    let t_write = std::time::Instant::now();
    for vault_dir in vault_dirs {
        // Ensure the vault structure exists
        if let Err(e) = LibraryVault::provision_vault(vault_dir) {
            tracing::warn!("Failed to provision vault {vault_dir}: {e}");
            continue;
        }

        // Write 3D model (new download) or point to cached file if it already existed
        let step_filename = format!("{fp_stem}.step");
        let model_3d_path: Option<String> = if let Some(bytes) = step_bytes.as_deref() {
            // Fresh download — write to this vault
            LibraryVault::write_step_model(vault_dir, &step_filename, bytes)
                .map(|p| p.to_string_lossy().into_owned())
                .map_err(|e| { tracing::warn!("Failed to write STEP to {vault_dir}: {e}"); e })
                .ok()
        } else {
            // Cache hit — return path if the file exists here
            let cached = LibraryVault::get_models_dir(vault_dir).join(&step_filename);
            if cached.exists() { Some(cached.to_string_lossy().into_owned()) } else { None }
        };

        // Footprint content uses vault-specific model path and derived fp_stem
        let mod_content = KiModGenerator::generate_footprint(
            &info, &fp, &fp_stem, model_3d_path.as_deref(),
        );

        // Symbol is indexed by derived sym_name (MPN or LCSC)
        if let Err(e) = LibraryVault::upsert_symbol(vault_dir, &sym_name, &sym_block) {
            tracing::warn!("Symbol write failed for {vault_dir}: {e}");
        }
        if let Err(e) = LibraryVault::write_footprint(vault_dir, &fp_stem, &mod_content) {
            tracing::warn!("Footprint write failed for {vault_dir}: {e}");
        }
        if let Err(e) = LibraryVault::upsert_vault_entry(vault_dir, &vault_entry) {
            tracing::warn!("DB write failed for {vault_dir}: {e}");
        }
    }

    timings.write_ms = t_write.elapsed().as_millis() as u64;
    timings.total_ms = total_start.elapsed().as_millis() as u64;

    tracing::info!(
        "[UCE] {} done | fetch={}ms parse={}ms model={}ms{} gen={}ms write={}ms | total={}ms",
        lcsc_id,
        timings.fetch_ms,
        timings.parse_ms,
        timings.model_ms,
        if timings.model_cached { "(cached)" } else { "" },
        timings.generate_ms,
        timings.write_ms,
        timings.total_ms,
    );

    // Return paths from the primary (first) vault
    let primary = &vault_dirs[0];
    let base = std::path::Path::new(primary);
    let sym_path = base.join("library").join("KiMaster.kicad_sym")
        .to_string_lossy().into_owned();
    let mod_path = base.join("library").join("KiMaster.pretty")
        .join(format!("{fp_stem}.kicad_mod"))
        .to_string_lossy().into_owned();

    let has_3d_model = step_bytes.is_some() || timings.model_cached
        || vault_dirs.iter().any(|d| {
            LibraryVault::get_models_dir(d).join(format!("{fp_stem}.step")).exists()
        });

    Ok(AddToVaultResult {
        success:       true,
        lcsc_id:       raw.lcsc_id,
        sym_path,
        mod_path,
        has_symbol:    sym_has_content,
        has_footprint: fp_has_content,
        has_3d_model,
        lib_registered:            false,
        lib_registered_first_time: false,
        message: format!(
            "Added {} in {}ms (fetch {}ms, model {}ms{})",
            lcsc_id, timings.total_ms, timings.fetch_ms,
            timings.model_ms,
            if timings.model_cached { " cached" } else { "" },
        ),
        timings,
    })
}

/// Convenience wrapper: add to a single vault directory with default post-processing.
pub async fn add_to_vault(
    client:       &Client,
    kimaster_dir: &str,
    lcsc_id:      &str,
) -> anyhow::Result<AddToVaultResult> {
    add_to_vaults(client, &[kimaster_dir.to_string()], lcsc_id, &PostProcessConfig::default()).await
}
