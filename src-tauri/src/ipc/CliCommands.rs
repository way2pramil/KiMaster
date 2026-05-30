//! IPC commands for KiCad CLI operations.
//! Thin layer — resolves CLI path from state, delegates to modules/cli/*.

use std::path::PathBuf;
use serde::{Deserialize, Serialize};
use tauri::State;

use crate::AppConfig;
use crate::AppState::KiMasterState;
use crate::modules::cli::resolve_kicad_cli;
use crate::modules::cli::CliRunner::{self, DrcResult, ErcResult, ExportResult};
use crate::modules::cli::ExportRunner;

// ── Shared helpers ─────────────────────────────────────────────────────────

/// Resolve kicad-cli path from Tauri state (checks state → env → filesystem).
fn resolve_cli(state: &KiMasterState) -> Result<PathBuf, String> {
    let inner = state.0.lock().map_err(|e| e.to_string())?;
    CliRunner::resolve_cli_path(&inner.kicad_cli_path)
}

// ── App info ───────────────────────────────────────────────────────────────

#[derive(Serialize)]
pub struct AppInfoResponse {
    pub name: &'static str,
    pub version: &'static str,
    pub kicad_cli_path: Option<String>,
}

#[derive(Serialize)]
pub struct KiCadCliPathResponse {
    pub found: bool,
    pub path: Option<String>,
    pub version: Option<String>,
}

#[tauri::command]
pub async fn cmd_get_app_info(
    state: State<'_, KiMasterState>,
) -> Result<AppInfoResponse, String> {
    let inner = state.0.lock().map_err(|e| e.to_string())?;
    Ok(AppInfoResponse {
        name: AppConfig::APP_NAME,
        version: AppConfig::APP_VERSION,
        kicad_cli_path: inner.kicad_cli_path.clone(),
    })
}

#[tauri::command]
pub async fn cmd_get_kicad_cli_path(
    state: State<'_, KiMasterState>,
) -> Result<KiCadCliPathResponse, String> {
    match resolve_kicad_cli() {
        Some(path) => {
            let path_str = path.to_string_lossy().into_owned();

            // Try to get version
            let version = CliRunner::get_version(&path).await.ok();

            let mut inner = state.0.lock().map_err(|e| e.to_string())?;
            inner.kicad_cli_path = Some(path_str.clone());
            tracing::info!("kicad-cli resolved: {path_str}");
            Ok(KiCadCliPathResponse { found: true, path: Some(path_str), version })
        }
        None => {
            tracing::warn!(
                "kicad-cli not found. Default path: {}",
                AppConfig::KICAD_CLI_DEFAULT_PATH
            );
            Ok(KiCadCliPathResponse { found: false, path: None, version: None })
        }
    }
}

// ── DRC ────────────────────────────────────────────────────────────────────

#[derive(Deserialize)]
pub struct RunDrcArgs {
    pub pcb_file: String,
    #[serde(default)]
    pub severity_error: Option<bool>,
    #[serde(default)]
    pub severity_warning: Option<bool>,
    #[serde(default)]
    pub severity_exclusion: Option<bool>,
}

#[tauri::command]
pub async fn cmd_run_drc(
    state: State<'_, KiMasterState>,
    args: RunDrcArgs,
) -> Result<DrcResult, String> {
    let cli_path = resolve_cli(&state)?;
    let pcb_path = PathBuf::from(&args.pcb_file);

    if !pcb_path.exists() {
        return Err(format!("PCB file not found: {}", args.pcb_file));
    }

    let opts = CliRunner::DrcOptions {
        severity_all: args.severity_error.is_none()
            && args.severity_warning.is_none()
            && args.severity_exclusion.is_none(),
        severity_error: args.severity_error.unwrap_or(true),
        severity_warning: args.severity_warning.unwrap_or(true),
        severity_exclusion: args.severity_exclusion.unwrap_or(true),
        exit_code_violations: false,
    };

    CliRunner::run_drc(&cli_path, &pcb_path, &opts).await
}

// ── ERC ────────────────────────────────────────────────────────────────────

#[derive(Deserialize)]
pub struct RunErcArgs {
    pub sch_file: String,
    #[serde(default)]
    pub severity_error: Option<bool>,
    #[serde(default)]
    pub severity_warning: Option<bool>,
    #[serde(default)]
    pub severity_exclusion: Option<bool>,
}

#[tauri::command]
pub async fn cmd_run_erc(
    state: State<'_, KiMasterState>,
    args: RunErcArgs,
) -> Result<ErcResult, String> {
    let cli_path = resolve_cli(&state)?;
    let sch_path = PathBuf::from(&args.sch_file);

    if !sch_path.exists() {
        return Err(format!("Schematic file not found: {}", args.sch_file));
    }

    let opts = CliRunner::ErcOptions {
        severity_all: args.severity_error.is_none()
            && args.severity_warning.is_none()
            && args.severity_exclusion.is_none(),
        severity_error: args.severity_error.unwrap_or(true),
        severity_warning: args.severity_warning.unwrap_or(true),
        severity_exclusion: args.severity_exclusion.unwrap_or(true),
        exit_code_violations: false,
    };

    CliRunner::run_erc(&cli_path, &sch_path, &opts).await
}

// ── Gerber export ──────────────────────────────────────────────────────────

#[derive(Deserialize)]
pub struct ExportGerbersArgs {
    pub pcb_file: String,
    pub output_dir: String,
    #[serde(default)]
    pub layers: Vec<String>,
    #[serde(default)]
    pub precision: Option<u8>,
    #[serde(default)]
    pub use_x2: Option<bool>,
    #[serde(default)]
    pub include_netlist: Option<bool>,
    #[serde(default)]
    pub subtract_soldermask: Option<bool>,
    #[serde(default)]
    pub use_drill_origin: Option<bool>,
}

#[tauri::command]
pub async fn cmd_export_gerbers(
    state: State<'_, KiMasterState>,
    args: ExportGerbersArgs,
) -> Result<ExportResult, String> {
    let cli_path = resolve_cli(&state)?;
    let pcb_path = PathBuf::from(&args.pcb_file);

    if !pcb_path.exists() {
        return Err(format!("PCB file not found: {}", args.pcb_file));
    }

    let opts = ExportRunner::GerberOptions {
        output_dir: PathBuf::from(&args.output_dir),
        layers: args.layers,
        precision: args.precision,
        use_x2: args.use_x2,
        include_netlist: args.include_netlist,
        subtract_soldermask: args.subtract_soldermask,
        use_drill_origin: args.use_drill_origin,
        no_aperture_macros: None,
    };

    ExportRunner::export_gerbers(&cli_path, &pcb_path, &opts).await
}

// ── Drill export ───────────────────────────────────────────────────────────

#[derive(Deserialize)]
pub struct ExportDrillArgs {
    pub pcb_file: String,
    pub output_dir: String,
    #[serde(default)]
    pub format: Option<String>,    // "excellon" | "gerber"
    #[serde(default)]
    pub units: Option<String>,     // "mm" | "in"
    #[serde(default)]
    pub use_drill_origin: Option<bool>,
    #[serde(default)]
    pub separate_th: Option<bool>,
    #[serde(default)]
    pub generate_map: Option<bool>,
    #[serde(default)]
    pub map_format: Option<String>,
}

#[tauri::command]
pub async fn cmd_export_drill(
    state: State<'_, KiMasterState>,
    args: ExportDrillArgs,
) -> Result<ExportResult, String> {
    let cli_path = resolve_cli(&state)?;
    let pcb_path = PathBuf::from(&args.pcb_file);

    if !pcb_path.exists() {
        return Err(format!("PCB file not found: {}", args.pcb_file));
    }

    let format = match args.format.as_deref() {
        Some("gerber") => ExportRunner::DrillFormat::Gerber,
        _ => ExportRunner::DrillFormat::Excellon,
    };
    let units = match args.units.as_deref() {
        Some("in") | Some("inches") => ExportRunner::DrillUnits::Inches,
        _ => ExportRunner::DrillUnits::Mm,
    };
    let origin = if args.use_drill_origin.unwrap_or(false) {
        ExportRunner::DrillOrigin::DrillFileOrigin
    } else {
        ExportRunner::DrillOrigin::Absolute
    };

    let opts = ExportRunner::DrillOptions {
        output_dir: PathBuf::from(&args.output_dir),
        format,
        units,
        origin,
        separate_th: args.separate_th,
        generate_map: args.generate_map,
        map_format: args.map_format,
    };

    ExportRunner::export_drill(&cli_path, &pcb_path, &opts).await
}

// ── Position file export ───────────────────────────────────────────────────

#[derive(Deserialize)]
pub struct ExportPosArgs {
    pub pcb_file: String,
    pub output_file: String,
    #[serde(default)]
    pub side: Option<String>,     // "both" | "front" | "back"
    #[serde(default)]
    pub format: Option<String>,   // "ascii" | "csv" | "gerber"
    #[serde(default)]
    pub units: Option<String>,    // "mm" | "in"
    #[serde(default)]
    pub exclude_dnp: Option<bool>,
}

#[tauri::command]
pub async fn cmd_export_pos(
    state: State<'_, KiMasterState>,
    args: ExportPosArgs,
) -> Result<ExportResult, String> {
    let cli_path = resolve_cli(&state)?;
    let pcb_path = PathBuf::from(&args.pcb_file);

    if !pcb_path.exists() {
        return Err(format!("PCB file not found: {}", args.pcb_file));
    }

    let side = match args.side.as_deref() {
        Some("front") => ExportRunner::PosSide::Front,
        Some("back")  => ExportRunner::PosSide::Back,
        _ => ExportRunner::PosSide::Both,
    };
    let format = match args.format.as_deref() {
        Some("ascii")  => ExportRunner::PosFormat::Ascii,
        Some("gerber") => ExportRunner::PosFormat::Gerber,
        _ => ExportRunner::PosFormat::Csv,
    };
    let units = match args.units.as_deref() {
        Some("in") | Some("inches") => ExportRunner::PosUnits::Inches,
        _ => ExportRunner::PosUnits::Mm,
    };

    let opts = ExportRunner::PosOptions {
        output_file: PathBuf::from(&args.output_file),
        side,
        format,
        units,
        use_drill_origin: None,
        exclude_board_only: None,
        exclude_dnp: args.exclude_dnp,
        negate_x: None,
    };

    ExportRunner::export_pos(&cli_path, &pcb_path, &opts).await
}

// ── SVG export ─────────────────────────────────────────────────────────────

#[derive(Deserialize)]
pub struct ExportSvgArgs {
    pub pcb_file: String,
    pub output_file: String,
    #[serde(default)]
    pub layers: Vec<String>,
    #[serde(default)]
    pub theme: Option<String>,
    #[serde(default)]
    pub mirror: Option<bool>,
    #[serde(default)]
    pub black_and_white: Option<bool>,
    #[serde(default)]
    pub board_area_only: Option<bool>,
}

#[tauri::command]
pub async fn cmd_export_svg(
    state: State<'_, KiMasterState>,
    args: ExportSvgArgs,
) -> Result<ExportResult, String> {
    let cli_path = resolve_cli(&state)?;
    let pcb_path = PathBuf::from(&args.pcb_file);

    if !pcb_path.exists() {
        return Err(format!("PCB file not found: {}", args.pcb_file));
    }

    let page_size_mode = if args.board_area_only.unwrap_or(false) {
        ExportRunner::PageSizeMode::BoardAreaOnly
    } else {
        ExportRunner::PageSizeMode::PageSizeFromBoard
    };

    let opts = ExportRunner::SvgOptions {
        output_file: PathBuf::from(&args.output_file),
        layers: args.layers,
        theme: args.theme,
        mirror: args.mirror,
        negative: None,
        page_size_mode,
        exclude_drawing_sheet: None,
        black_and_white: args.black_and_white,
    };

    ExportRunner::export_svg(&cli_path, &pcb_path, &opts).await
}

// ── PDF export ─────────────────────────────────────────────────────────────

#[derive(Deserialize)]
pub struct ExportPdfArgs {
    pub pcb_file: String,
    pub output_file: String,
    #[serde(default)]
    pub layers: Vec<String>,
    #[serde(default)]
    pub theme: Option<String>,
    #[serde(default)]
    pub mirror: Option<bool>,
    #[serde(default)]
    pub black_and_white: Option<bool>,
    #[serde(default)]
    pub board_area_only: Option<bool>,
    #[serde(default)]
    pub separate_files: Option<bool>,
}

#[tauri::command]
pub async fn cmd_export_pdf(
    state: State<'_, KiMasterState>,
    args: ExportPdfArgs,
) -> Result<ExportResult, String> {
    let cli_path = resolve_cli(&state)?;
    let pcb_path = PathBuf::from(&args.pcb_file);

    if !pcb_path.exists() {
        return Err(format!("PCB file not found: {}", args.pcb_file));
    }

    let page_size_mode = if args.board_area_only.unwrap_or(false) {
        ExportRunner::PageSizeMode::BoardAreaOnly
    } else {
        ExportRunner::PageSizeMode::PageSizeFromBoard
    };

    let opts = ExportRunner::PdfOptions {
        output_file: PathBuf::from(&args.output_file),
        layers: args.layers,
        theme: args.theme,
        mirror: args.mirror,
        negative: None,
        page_size_mode,
        exclude_drawing_sheet: None,
        black_and_white: args.black_and_white,
        separate_files: args.separate_files,
    };

    ExportRunner::export_pdf(&cli_path, &pcb_path, &opts).await
}

// ── BOM export ─────────────────────────────────────────────────────────────

#[derive(Deserialize)]
pub struct ExportBomArgs {
    pub sch_file: String,
    pub output_file: String,
    #[serde(default)]
    pub fields: Vec<String>,
    #[serde(default)]
    pub group_by: Vec<String>,
    #[serde(default)]
    pub sort_by: Vec<String>,
    #[serde(default)]
    pub exclude_dnp: Option<bool>,
}

#[tauri::command]
pub async fn cmd_export_bom(
    state: State<'_, KiMasterState>,
    args: ExportBomArgs,
) -> Result<ExportResult, String> {
    let cli_path = resolve_cli(&state)?;
    let sch_path = PathBuf::from(&args.sch_file);

    if !sch_path.exists() {
        return Err(format!("Schematic file not found: {}", args.sch_file));
    }

    let mut opts = ExportRunner::BomOptions::default();
    opts.output_file = PathBuf::from(&args.output_file);
    if !args.fields.is_empty()   { opts.fields = args.fields; }
    if !args.group_by.is_empty() { opts.group_by = args.group_by; }
    if !args.sort_by.is_empty()  { opts.sort_by = args.sort_by; }
    opts.exclude_dnp = args.exclude_dnp;

    ExportRunner::export_bom(&cli_path, &sch_path, &opts).await
}

// ── Schematic PDF/SVG export ───────────────────────────────────────────────

#[derive(Deserialize)]
pub struct ExportSchPdfArgs {
    pub sch_file: String,
    pub output_file: String,
    #[serde(default)]
    pub theme: Option<String>,
    #[serde(default)]
    pub black_and_white: Option<bool>,
}

#[tauri::command]
pub async fn cmd_export_sch_pdf(
    state: State<'_, KiMasterState>,
    args: ExportSchPdfArgs,
) -> Result<ExportResult, String> {
    let cli_path = resolve_cli(&state)?;
    let sch_path = PathBuf::from(&args.sch_file);

    if !sch_path.exists() {
        return Err(format!("Schematic file not found: {}", args.sch_file));
    }

    let opts = ExportRunner::SchPdfOptions {
        output_file: PathBuf::from(&args.output_file),
        theme: args.theme,
        black_and_white: args.black_and_white,
        exclude_drawing_sheet: None,
    };

    ExportRunner::export_sch_pdf(&cli_path, &sch_path, &opts).await
}

#[derive(Deserialize)]
pub struct ExportSchSvgArgs {
    pub sch_file: String,
    pub output_dir: String,
    #[serde(default)]
    pub theme: Option<String>,
    #[serde(default)]
    pub black_and_white: Option<bool>,
}

#[tauri::command]
pub async fn cmd_export_sch_svg(
    state: State<'_, KiMasterState>,
    args: ExportSchSvgArgs,
) -> Result<ExportResult, String> {
    let cli_path = resolve_cli(&state)?;
    let sch_path = PathBuf::from(&args.sch_file);

    if !sch_path.exists() {
        return Err(format!("Schematic file not found: {}", args.sch_file));
    }

    let opts = ExportRunner::SchSvgOptions {
        output_dir: PathBuf::from(&args.output_dir),
        theme: args.theme,
        black_and_white: args.black_and_white,
        exclude_drawing_sheet: None,
    };

    ExportRunner::export_sch_svg(&cli_path, &sch_path, &opts).await
}

// ── cmd_export_fab_pack ───────────────────────────────────────────────────────

#[derive(Serialize, Deserialize)]
pub struct FabPackArgs {
    /// Absolute path to the .kicad_pcb file.
    pub pcb_file:   String,
    /// Absolute path to the .kicad_sch file (needed for BOM).
    #[serde(default)]
    pub sch_file:   Option<String>,
    /// Output directory (a timestamped sub-folder will be created inside).
    pub output_dir: String,
    /// Fab preset ID (e.g. "jlcpcb_2layer", "oshpark_2layer").
    #[serde(default = "default_fab_id")]
    pub fab_id:     String,
}

fn default_fab_id() -> String { "jlcpcb_2layer".into() }

#[derive(Serialize, Deserialize)]
pub struct FabPackResult {
    pub success:    bool,
    pub output_dir: String,
    pub files:      Vec<String>,
    pub message:    String,
}

/// Bundle all files required for a specific fab into a timestamped directory.
/// Runs gerber + drill exports (always); BOM + pos exports (if sch_file provided).
#[tauri::command]
pub async fn cmd_export_fab_pack(
    state: State<'_, KiMasterState>,
    args: FabPackArgs,
) -> Result<FabPackResult, String> {
    use std::fs;
    use crate::modules::cli::ExportRunner::{
        GerberOptions, DrillOptions, BomOptions, PosOptions,
    };

    let cli_path = resolve_cli(&state)?;
    let pcb_path = PathBuf::from(&args.pcb_file);

    if !pcb_path.exists() {
        return Err(format!("PCB file not found: {}", args.pcb_file));
    }

    // Create timestamped output sub-directory
    let ts = {
        use std::time::{SystemTime, UNIX_EPOCH};
        SystemTime::now().duration_since(UNIX_EPOCH).unwrap_or_default().as_secs()
    };
    let out_root = PathBuf::from(&args.output_dir);
    let out_dir  = out_root.join(format!("fab_{}_{}", args.fab_id, ts));
    fs::create_dir_all(&out_dir).map_err(|e| format!("Cannot create output dir: {e}"))?;

    let mut files:   Vec<String> = Vec::new();
    let mut errors:  Vec<String> = Vec::new();

    // ── Gerbers ──
    let gerber_dir = out_dir.join("gerbers");
    fs::create_dir_all(&gerber_dir).ok();
    match ExportRunner::export_gerbers(&cli_path, &pcb_path, &GerberOptions {
        output_dir: gerber_dir.clone(), ..Default::default()
    }).await {
        Ok(_) => {
            if let Ok(entries) = fs::read_dir(&gerber_dir) {
                for e in entries.flatten() {
                    files.push(e.path().to_string_lossy().into_owned());
                }
            }
        }
        Err(e) => errors.push(format!("Gerbers: {e}")),
    }

    // ── Drill ──
    match ExportRunner::export_drill(&cli_path, &pcb_path, &DrillOptions {
        output_dir: out_dir.clone(), ..Default::default()
    }).await {
        Ok(r) => { if let Some(p) = r.output_path { files.push(p); } }
        Err(e) => errors.push(format!("Drill: {e}")),
    }

    // ── BOM + Pos (if schematic available and fab needs it) ──
    let needs_assembly = matches!(args.fab_id.as_str(), "jlcpcb_4layer" | "pcbway_standard");
    if needs_assembly {
        if let Some(sch) = &args.sch_file {
            let sch_path = PathBuf::from(sch);
            if sch_path.exists() {
                match ExportRunner::export_bom(&cli_path, &sch_path, &BomOptions {
                    output_file: out_dir.join("bom.csv"), ..Default::default()
                }).await {
                    Ok(r) => { if let Some(p) = r.output_path { files.push(p); } }
                    Err(e) => errors.push(format!("BOM: {e}")),
                }
            }
        }
        match ExportRunner::export_pos(&cli_path, &pcb_path, &PosOptions {
            output_file: out_dir.join("positions.csv"), ..Default::default()
        }).await {
            Ok(r) => { if let Some(p) = r.output_path { files.push(p); } }
            Err(e) => errors.push(format!("Pos: {e}")),
        }
    }

    let success = errors.is_empty();
    let message = if success {
        format!("{} files exported to {}", files.len(), out_dir.display())
    } else {
        format!("Partial export — errors: {}", errors.join("; "))
    };

    Ok(FabPackResult {
        success,
        output_dir: out_dir.to_string_lossy().into_owned(),
        files,
        message,
    })
}

// ══════════════════════════════════════════════════════════════════════════
//  3D RENDER (Phase 11 — D1)
// ══════════════════════════════════════════════════════════════════════════

#[derive(Deserialize)]
pub struct RenderPcbArgs {
    pub pcb_file:    String,
    pub output_file: String,
    /// One of: top, bottom, front, back, left, right, top_front, top_back, bottom_front, bottom_back
    #[serde(default)]
    pub side:        Option<String>,
    #[serde(default)]
    pub width_px:    Option<u32>,
    #[serde(default)]
    pub height_px:   Option<u32>,
    /// One of: default, transparent, opaque
    #[serde(default)]
    pub background:  Option<String>,
    /// One of: basic, high, user
    #[serde(default)]
    pub quality:     Option<String>,
    #[serde(default)]
    pub zoom:        Option<f32>,
    #[serde(default)]
    pub floor:       Option<bool>,
    #[serde(default)]
    pub perspective: Option<bool>,
    #[serde(default)]
    pub preset:      Option<String>,
}

fn parse_side(s: &str) -> ExportRunner::RenderSide {
    use ExportRunner::RenderSide as S;
    match s {
        "bottom"        => S::Bottom,
        "front"         => S::Front,
        "back"          => S::Back,
        "left"          => S::Left,
        "right"         => S::Right,
        "top_front"     => S::TopFront,
        "top_back"      => S::TopBack,
        "bottom_front"  => S::BottomFront,
        "bottom_back"   => S::BottomBack,
        _               => S::Top,
    }
}

fn parse_background(s: &str) -> ExportRunner::RenderBackground {
    use ExportRunner::RenderBackground as B;
    match s {
        "transparent" => B::Transparent,
        "opaque"      => B::Opaque,
        _             => B::Default,
    }
}

fn parse_quality(s: &str) -> ExportRunner::RenderQuality {
    use ExportRunner::RenderQuality as Q;
    match s {
        "basic" => Q::Basic,
        "user"  => Q::User,
        _       => Q::High,
    }
}

/// Render a single 3D view of a PCB to PNG/JPG.
#[tauri::command]
pub async fn cmd_render_pcb(
    state: State<'_, KiMasterState>,
    args:  RenderPcbArgs,
) -> Result<ExportResult, String> {
    let cli_path = resolve_cli(&state)?;
    let pcb_path = PathBuf::from(&args.pcb_file);

    if !pcb_path.exists() {
        return Err(format!("PCB file not found: {}", args.pcb_file));
    }

    let opts = ExportRunner::RenderOptions {
        output_file: PathBuf::from(&args.output_file),
        side:        args.side.as_deref().map(parse_side).unwrap_or(ExportRunner::RenderSide::Top),
        width_px:    args.width_px.or(Some(1280)),
        height_px:   args.height_px.or(Some(720)),
        background:  args.background.as_deref().map(parse_background).or(Some(ExportRunner::RenderBackground::Default)),
        quality:     args.quality.as_deref().map(parse_quality).or(Some(ExportRunner::RenderQuality::High)),
        zoom:        args.zoom,
        floor:       args.floor,
        perspective: args.perspective.or(Some(true)),
        preset:      args.preset.or(Some("follow_pcb_editor".into())),
    };

    ExportRunner::render_pcb(&cli_path, &pcb_path, &opts).await
}

// ── Render all 6 standard sides in one call ────────────────────────────────────

#[derive(Deserialize)]
pub struct RenderAllSidesArgs {
    pub pcb_file:   String,
    pub output_dir: String,
    /// One of: top, bottom, front, back, left, right, top_front, top_back, bottom_front, bottom_back
    /// If empty, defaults to [top, bottom, front, back, left, right].
    #[serde(default)]
    pub sides:      Vec<String>,
    #[serde(default)]
    pub width_px:   Option<u32>,
    #[serde(default)]
    pub height_px:  Option<u32>,
    #[serde(default)]
    pub quality:    Option<String>,
    #[serde(default)]
    pub background: Option<String>,
}

#[derive(Serialize)]
pub struct RenderAllSidesResult {
    pub success:    bool,
    pub output_dir: String,
    /// Paths of successfully rendered PNG files.
    pub files:      Vec<String>,
    /// Sides that failed, mapped to error message.
    pub failures:   Vec<String>,
    pub message:    String,
}

/// Render multiple standard views in parallel — fires N concurrent kicad-cli processes
/// and collects all output paths. Use for one-click "render all" galleries.
#[tauri::command]
pub async fn cmd_render_all_sides(
    state: State<'_, KiMasterState>,
    args:  RenderAllSidesArgs,
) -> Result<RenderAllSidesResult, String> {
    use std::fs;
    let cli_path = resolve_cli(&state)?;
    let pcb_path = PathBuf::from(&args.pcb_file);

    if !pcb_path.exists() {
        return Err(format!("PCB file not found: {}", args.pcb_file));
    }

    let out_dir = PathBuf::from(&args.output_dir);
    fs::create_dir_all(&out_dir).map_err(|e| format!("create_dir_all failed: {e}"))?;

    let sides = if args.sides.is_empty() {
        vec!["top".to_string(), "bottom".into(), "front".into(),
             "back".into(), "left".into(), "right".into()]
    } else {
        args.sides
    };

    let width_px   = args.width_px.or(Some(1280));
    let height_px  = args.height_px.or(Some(720));
    let quality    = args.quality.as_deref().map(parse_quality).or(Some(ExportRunner::RenderQuality::High));
    let background = args.background.as_deref().map(parse_background).or(Some(ExportRunner::RenderBackground::Default));

    // Run renders concurrently — each spawns its own kicad-cli child process.
    let mut handles = Vec::with_capacity(sides.len());
    for side_str in &sides {
        let side    = parse_side(side_str);
        let out_png = out_dir.join(format!("render_{}.png", side.slug()));
        let opts    = ExportRunner::RenderOptions {
            output_file: out_png.clone(),
            side,
            width_px,
            height_px,
            background:  background.clone(),
            quality:     quality.clone(),
            zoom:        Some(1.0),
            floor:       None,
            perspective: Some(true),
            preset:      Some("follow_pcb_editor".into()),
        };
        let cli   = cli_path.clone();
        let pcb   = pcb_path.clone();
        let label = side_str.clone();
        handles.push(tokio::spawn(async move {
            let r = ExportRunner::render_pcb(&cli, &pcb, &opts).await;
            (label, out_png, r)
        }));
    }

    let mut files    = Vec::new();
    let mut failures = Vec::new();
    for h in handles {
        match h.await {
            Ok((_label, out_png, Ok(_))) => files.push(out_png.to_string_lossy().into_owned()),
            Ok((label, _, Err(e)))       => failures.push(format!("{label}: {e}")),
            Err(e)                       => failures.push(format!("join: {e}")),
        }
    }

    let success = failures.is_empty();
    let message = if success {
        format!("Rendered {} views to {}", files.len(), out_dir.display())
    } else {
        format!("Rendered {}/{} views — failures: {}", files.len(), sides.len(), failures.join("; "))
    };

    let _ = AppConfig::APP_NAME; // suppress potential unused warning

    Ok(RenderAllSidesResult {
        success,
        output_dir: out_dir.to_string_lossy().into_owned(),
        files,
        failures,
        message,
    })
}
