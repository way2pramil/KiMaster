//! KiCad CLI export command builders.
//! Typed option structs for every `kicad-cli pcb export` / `sch export` command.
//! Each builder converts its options into an argument vector and delegates
//! to `CliRunner::run_export()`.
//!
//! Verified against `kicad-cli 10.0.1` output from `--help` for each subcommand.

use std::path::{Path, PathBuf};
use serde::{Deserialize, Serialize};

use super::CliRunner::{self, ExportResult};

// ══════════════════════════════════════════════════════════════════════════
//  GERBER EXPORT
// ══════════════════════════════════════════════════════════════════════════

/// Options for `kicad-cli pcb export gerbers`.
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct GerberOptions {
    /// Output directory for gerber files.
    pub output_dir: PathBuf,
    /// Specific layers to export (e.g. "F.Cu", "B.Cu", "F.SilkS").
    /// Empty = all copper + mask + silk + edge cuts.
    #[serde(default)]
    pub layers: Vec<String>,
    /// Coordinate precision (4, 5, or 6 decimal places). Default: 6.
    pub precision: Option<u8>,
    /// Use Gerber X2 attributes. Default: true.
    pub use_x2: Option<bool>,
    /// Include netlist attributes in X2 output. Default: true.
    pub include_netlist: Option<bool>,
    /// Subtract soldermask from silkscreen.
    pub subtract_soldermask: Option<bool>,
    /// Use drill/place file origin.
    pub use_drill_origin: Option<bool>,
    /// Disable aperture macros.
    pub no_aperture_macros: Option<bool>,
}

impl Default for GerberOptions {
    fn default() -> Self {
        Self {
            output_dir: PathBuf::from("."),
            layers: Vec::new(),
            precision: Some(6),
            use_x2: Some(true),
            include_netlist: Some(true),
            subtract_soldermask: None,
            use_drill_origin: None,
            no_aperture_macros: None,
        }
    }
}

/// Export Gerber files from a `.kicad_pcb`.
pub async fn export_gerbers(
    cli_path: &Path,
    pcb_file: &Path,
    opts: &GerberOptions,
) -> Result<ExportResult, String> {
    let mut args: Vec<String> = vec![
        "pcb".into(),
        "export".into(),
        "gerbers".into(),
        "--output".into(),
        opts.output_dir.to_string_lossy().into_owned(),
    ];

    if !opts.layers.is_empty() {
        args.push("--layers".into());
        args.push(opts.layers.join(","));
    }

    if let Some(p) = opts.precision {
        args.push("--precision".into());
        args.push(p.to_string());
    }

    if let Some(false) = opts.use_x2 {
        args.push("--no-x2".into());
    }
    if let Some(false) = opts.include_netlist {
        args.push("--no-netlist".into());
    }
    if let Some(true) = opts.subtract_soldermask {
        args.push("--subtract-soldermask".into());
    }
    if let Some(true) = opts.use_drill_origin {
        args.push("--use-drill-file-origin".into());
    }
    if let Some(true) = opts.no_aperture_macros {
        args.push("--no-aperture-macros".into());
    }

    args.push(pcb_file.to_string_lossy().into_owned());

    CliRunner::run_export(cli_path, &args, &opts.output_dir).await
}

// ══════════════════════════════════════════════════════════════════════════
//  DRILL EXPORT
// ══════════════════════════════════════════════════════════════════════════

/// Drill file format.
#[derive(Debug, Clone, Copy, Serialize, Deserialize, Default)]
pub enum DrillFormat {
    #[default]
    Excellon,
    Gerber,
}

/// Drill file units.
#[derive(Debug, Clone, Copy, Serialize, Deserialize, Default)]
pub enum DrillUnits {
    #[default]
    Mm,
    Inches,
}

/// Drill origin mode.
#[derive(Debug, Clone, Copy, Serialize, Deserialize, Default)]
pub enum DrillOrigin {
    #[default]
    Absolute,
    DrillFileOrigin,
}

/// Options for `kicad-cli pcb export drill`.
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct DrillOptions {
    pub output_dir: PathBuf,
    pub format: DrillFormat,
    pub units: DrillUnits,
    pub origin: DrillOrigin,
    /// Generate separate files for PTH and NPTH.
    pub separate_th: Option<bool>,
    /// Generate a drill map file.
    pub generate_map: Option<bool>,
    /// Map format (e.g. "ps", "gerberx2", "svg", "pdf", "dxf").
    pub map_format: Option<String>,
}

impl Default for DrillOptions {
    fn default() -> Self {
        Self {
            output_dir: PathBuf::from("."),
            format: DrillFormat::Excellon,
            units: DrillUnits::Mm,
            origin: DrillOrigin::Absolute,
            separate_th: None,
            generate_map: None,
            map_format: None,
        }
    }
}

/// Export drill files from a `.kicad_pcb`.
pub async fn export_drill(
    cli_path: &Path,
    pcb_file: &Path,
    opts: &DrillOptions,
) -> Result<ExportResult, String> {
    let mut args: Vec<String> = vec![
        "pcb".into(),
        "export".into(),
        "drill".into(),
        "--output".into(),
        opts.output_dir.to_string_lossy().into_owned(),
    ];

    args.push("--format".into());
    match opts.format {
        DrillFormat::Excellon => args.push("excellon".into()),
        DrillFormat::Gerber   => args.push("gerber".into()),
    }

    args.push("--units".into());
    match opts.units {
        DrillUnits::Mm     => args.push("mm".into()),
        DrillUnits::Inches => args.push("in".into()),
    }

    if matches!(opts.origin, DrillOrigin::DrillFileOrigin) {
        args.push("--drill-origin".into());
    }

    if let Some(true) = opts.separate_th {
        args.push("--separate-th".into());
    }

    if let Some(true) = opts.generate_map {
        args.push("--generate-map".into());
        if let Some(ref fmt) = opts.map_format {
            args.push("--map-format".into());
            args.push(fmt.clone());
        }
    }

    args.push(pcb_file.to_string_lossy().into_owned());

    CliRunner::run_export(cli_path, &args, &opts.output_dir).await
}

// ══════════════════════════════════════════════════════════════════════════
//  POSITION FILE EXPORT
// ══════════════════════════════════════════════════════════════════════════

/// Which board side to include in position file.
#[derive(Debug, Clone, Copy, Serialize, Deserialize, Default)]
pub enum PosSide {
    #[default]
    Both,
    Front,
    Back,
}

/// Position file format.
#[derive(Debug, Clone, Copy, Serialize, Deserialize, Default)]
pub enum PosFormat {
    #[default]
    Ascii,
    Csv,
    Gerber,
}

/// Position file units.
#[derive(Debug, Clone, Copy, Serialize, Deserialize, Default)]
pub enum PosUnits {
    #[default]
    Mm,
    Inches,
}

/// Options for `kicad-cli pcb export pos`.
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct PosOptions {
    pub output_file: PathBuf,
    pub side: PosSide,
    pub format: PosFormat,
    pub units: PosUnits,
    /// Use drill/place file origin.
    pub use_drill_origin: Option<bool>,
    /// Exclude footprints with Board Only flag.
    pub exclude_board_only: Option<bool>,
    /// Exclude DNP (Do Not Populate) footprints.
    pub exclude_dnp: Option<bool>,
    /// Negate X coordinates for bottom side.
    pub negate_x: Option<bool>,
}

impl Default for PosOptions {
    fn default() -> Self {
        Self {
            output_file: PathBuf::from("positions.pos"),
            side: PosSide::Both,
            format: PosFormat::Csv,
            units: PosUnits::Mm,
            use_drill_origin: None,
            exclude_board_only: None,
            exclude_dnp: None,
            negate_x: None,
        }
    }
}

/// Export component position file from a `.kicad_pcb`.
pub async fn export_pos(
    cli_path: &Path,
    pcb_file: &Path,
    opts: &PosOptions,
) -> Result<ExportResult, String> {
    let mut args: Vec<String> = vec![
        "pcb".into(),
        "export".into(),
        "pos".into(),
        "--output".into(),
        opts.output_file.to_string_lossy().into_owned(),
    ];

    match opts.side {
        PosSide::Both  => { args.push("--side".into()); args.push("both".into()); }
        PosSide::Front => { args.push("--side".into()); args.push("front".into()); }
        PosSide::Back  => { args.push("--side".into()); args.push("back".into()); }
    }

    match opts.format {
        PosFormat::Ascii  => { args.push("--format".into()); args.push("ascii".into()); }
        PosFormat::Csv    => { args.push("--format".into()); args.push("csv".into()); }
        PosFormat::Gerber => { args.push("--format".into()); args.push("gerber".into()); }
    }

    match opts.units {
        PosUnits::Mm     => { args.push("--units".into()); args.push("mm".into()); }
        PosUnits::Inches => { args.push("--units".into()); args.push("in".into()); }
    }

    if let Some(true) = opts.use_drill_origin {
        args.push("--use-drill-file-origin".into());
    }
    if let Some(true) = opts.exclude_board_only {
        args.push("--exclude-board-only".into());
    }
    if let Some(true) = opts.exclude_dnp {
        args.push("--exclude-dnp".into());
    }
    if let Some(true) = opts.negate_x {
        args.push("--negate-x".into());
    }

    args.push(pcb_file.to_string_lossy().into_owned());

    let output_dir = opts.output_file.parent().unwrap_or(Path::new("."));
    CliRunner::run_export(cli_path, &args, output_dir).await
}

// ══════════════════════════════════════════════════════════════════════════
//  SVG EXPORT
// ══════════════════════════════════════════════════════════════════════════

/// Page size mode for SVG/PDF output.
#[derive(Debug, Clone, Copy, Serialize, Deserialize, Default)]
pub enum PageSizeMode {
    /// Use the page size from the board file.
    #[default]
    PageSizeFromBoard,
    /// Auto-fit the board outline.
    BoardAreaOnly,
}

/// Options for `kicad-cli pcb export svg`.
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct SvgOptions {
    pub output_file: PathBuf,
    #[serde(default)]
    pub layers: Vec<String>,
    pub theme: Option<String>,
    pub mirror: Option<bool>,
    pub negative: Option<bool>,
    pub page_size_mode: PageSizeMode,
    /// Exclude drawing sheet border.
    pub exclude_drawing_sheet: Option<bool>,
    /// Black-and-white output.
    pub black_and_white: Option<bool>,
}

impl Default for SvgOptions {
    fn default() -> Self {
        Self {
            output_file: PathBuf::from("board.svg"),
            layers: Vec::new(),
            theme: None,
            mirror: None,
            negative: None,
            page_size_mode: PageSizeMode::PageSizeFromBoard,
            exclude_drawing_sheet: None,
            black_and_white: None,
        }
    }
}

/// Export SVG from a `.kicad_pcb`.
pub async fn export_svg(
    cli_path: &Path,
    pcb_file: &Path,
    opts: &SvgOptions,
) -> Result<ExportResult, String> {
    let mut args: Vec<String> = vec![
        "pcb".into(),
        "export".into(),
        "svg".into(),
        "--output".into(),
        opts.output_file.to_string_lossy().into_owned(),
    ];

    if !opts.layers.is_empty() {
        args.push("--layers".into());
        args.push(opts.layers.join(","));
    }
    if let Some(ref theme) = opts.theme {
        args.push("--theme".into());
        args.push(theme.clone());
    }
    if let Some(true) = opts.mirror {
        args.push("--mirror".into());
    }
    if let Some(true) = opts.negative {
        args.push("--negative".into());
    }
    match opts.page_size_mode {
        PageSizeMode::PageSizeFromBoard => {}
        PageSizeMode::BoardAreaOnly => { args.push("--board-area-only".into()); }
    }
    if let Some(true) = opts.exclude_drawing_sheet {
        args.push("--exclude-drawing-sheet".into());
    }
    if let Some(true) = opts.black_and_white {
        args.push("--black-and-white".into());
    }

    args.push(pcb_file.to_string_lossy().into_owned());

    let output_dir = opts.output_file.parent().unwrap_or(Path::new("."));
    CliRunner::run_export(cli_path, &args, output_dir).await
}

// ══════════════════════════════════════════════════════════════════════════
//  PDF EXPORT
// ══════════════════════════════════════════════════════════════════════════

/// Options for `kicad-cli pcb export pdf`.
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct PdfOptions {
    pub output_file: PathBuf,
    #[serde(default)]
    pub layers: Vec<String>,
    pub theme: Option<String>,
    pub mirror: Option<bool>,
    pub negative: Option<bool>,
    pub page_size_mode: PageSizeMode,
    pub exclude_drawing_sheet: Option<bool>,
    pub black_and_white: Option<bool>,
    /// Separate file per layer.
    pub separate_files: Option<bool>,
}

impl Default for PdfOptions {
    fn default() -> Self {
        Self {
            output_file: PathBuf::from("board.pdf"),
            layers: Vec::new(),
            theme: None,
            mirror: None,
            negative: None,
            page_size_mode: PageSizeMode::PageSizeFromBoard,
            exclude_drawing_sheet: None,
            black_and_white: None,
            separate_files: None,
        }
    }
}

/// Export PDF from a `.kicad_pcb`.
pub async fn export_pdf(
    cli_path: &Path,
    pcb_file: &Path,
    opts: &PdfOptions,
) -> Result<ExportResult, String> {
    let mut args: Vec<String> = vec![
        "pcb".into(),
        "export".into(),
        "pdf".into(),
        "--output".into(),
        opts.output_file.to_string_lossy().into_owned(),
    ];

    if !opts.layers.is_empty() {
        args.push("--layers".into());
        args.push(opts.layers.join(","));
    }
    if let Some(ref theme) = opts.theme {
        args.push("--theme".into());
        args.push(theme.clone());
    }
    if let Some(true) = opts.mirror {
        args.push("--mirror".into());
    }
    if let Some(true) = opts.negative {
        args.push("--negative".into());
    }
    match opts.page_size_mode {
        PageSizeMode::PageSizeFromBoard => {}
        PageSizeMode::BoardAreaOnly => { args.push("--board-area-only".into()); }
    }
    if let Some(true) = opts.exclude_drawing_sheet {
        args.push("--exclude-drawing-sheet".into());
    }
    if let Some(true) = opts.black_and_white {
        args.push("--black-and-white".into());
    }
    if let Some(true) = opts.separate_files {
        args.push("--separate-files".into());
    }

    args.push(pcb_file.to_string_lossy().into_owned());

    let output_dir = opts.output_file.parent().unwrap_or(Path::new("."));
    CliRunner::run_export(cli_path, &args, output_dir).await
}

// ══════════════════════════════════════════════════════════════════════════
//  3D RENDER (Phase 11 — D1)
// ══════════════════════════════════════════════════════════════════════════

/// Camera side for `kicad-cli pcb render`.
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum RenderSide {
    Top,
    Bottom,
    Front,
    Back,
    Left,
    Right,
    TopFront,
    TopBack,
    BottomFront,
    BottomBack,
}

impl RenderSide {
    fn to_arg(&self) -> &'static str {
        match self {
            Self::Top         => "top",
            Self::Bottom      => "bottom",
            Self::Front       => "front",
            Self::Back        => "back",
            Self::Left        => "left",
            Self::Right       => "right",
            Self::TopFront    => "top_front",
            Self::TopBack    => "top_back",
            Self::BottomFront => "bottom_front",
            Self::BottomBack => "bottom_back",
        }
    }

    /// Default filename slug for this side.
    pub fn slug(&self) -> &'static str {
        match self {
            Self::Top         => "top",
            Self::Bottom      => "bottom",
            Self::Front       => "front",
            Self::Back        => "back",
            Self::Left        => "left",
            Self::Right       => "right",
            Self::TopFront    => "top_front",
            Self::TopBack    => "top_back",
            Self::BottomFront => "bottom_front",
            Self::BottomBack => "bottom_back",
        }
    }
}

/// Background style for the render.
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum RenderBackground {
    Default,
    Transparent,
    Opaque,
}

/// Quality preset for the render.
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum RenderQuality {
    Basic,
    High,
    User,
}

/// Options for `kicad-cli pcb render`.
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct RenderOptions {
    /// Output PNG/JPG file.
    pub output_file:  PathBuf,
    pub side:         RenderSide,
    /// Image width in pixels. Default: 1280.
    pub width_px:     Option<u32>,
    /// Image height in pixels. Default: 720.
    pub height_px:    Option<u32>,
    pub background:   Option<RenderBackground>,
    pub quality:      Option<RenderQuality>,
    /// Zoom multiplier (>0). Default: 1.0.
    pub zoom:         Option<f32>,
    /// Add reflective floor under board.
    pub floor:        Option<bool>,
    /// Use perspective camera (vs orthographic).
    pub perspective:  Option<bool>,
    /// Preset for board appearance: default | follow_pcb_editor | follow_plot_settings
    pub preset:       Option<String>,
}

impl Default for RenderOptions {
    fn default() -> Self {
        Self {
            output_file: PathBuf::from("render.png"),
            side:        RenderSide::Top,
            width_px:    Some(1280),
            height_px:   Some(720),
            background:  Some(RenderBackground::Default),
            quality:     Some(RenderQuality::High),
            zoom:        Some(1.0),
            floor:       None,
            perspective: Some(true),
            preset:      Some("follow_pcb_editor".into()),
        }
    }
}

/// Render a 3D PNG/JPG image of a `.kicad_pcb`.
pub async fn render_pcb(
    cli_path: &Path,
    pcb_file: &Path,
    opts:     &RenderOptions,
) -> Result<ExportResult, String> {
    let mut args: Vec<String> = vec![
        "pcb".into(),
        "render".into(),
        "--output".into(),
        opts.output_file.to_string_lossy().into_owned(),
        "--side".into(),
        opts.side.to_arg().into(),
    ];

    if let Some(w) = opts.width_px {
        args.push("--width".into());
        args.push(w.to_string());
    }
    if let Some(h) = opts.height_px {
        args.push("--height".into());
        args.push(h.to_string());
    }
    if let Some(ref bg) = opts.background {
        args.push("--background".into());
        args.push(match bg {
            RenderBackground::Default     => "default".into(),
            RenderBackground::Transparent => "transparent".into(),
            RenderBackground::Opaque      => "opaque".into(),
        });
    }
    if let Some(ref q) = opts.quality {
        args.push("--quality".into());
        args.push(match q {
            RenderQuality::Basic => "basic".into(),
            RenderQuality::High  => "high".into(),
            RenderQuality::User  => "user".into(),
        });
    }
    if let Some(z) = opts.zoom {
        if (z - 1.0).abs() > 0.001 {
            args.push("--zoom".into());
            args.push(format!("{z:.3}"));
        }
    }
    if let Some(true) = opts.floor {
        args.push("--floor".into());
    }
    if let Some(true) = opts.perspective {
        args.push("--perspective".into());
    }
    if let Some(ref p) = opts.preset {
        args.push("--preset".into());
        args.push(p.clone());
    }

    args.push(pcb_file.to_string_lossy().into_owned());

    let output_dir = opts.output_file.parent().unwrap_or(Path::new("."));
    CliRunner::run_export(cli_path, &args, output_dir).await
}

// ══════════════════════════════════════════════════════════════════════════
//  BOM EXPORT (schematic)
// ══════════════════════════════════════════════════════════════════════════

/// Options for `kicad-cli sch export bom`.
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct BomOptions {
    pub output_file: PathBuf,
    /// Field names to include (e.g. "Reference", "Value", "Footprint").
    #[serde(default)]
    pub fields: Vec<String>,
    /// Custom labels for field columns (must match fields count).
    #[serde(default)]
    pub labels: Vec<String>,
    /// Fields to group components by.
    #[serde(default)]
    pub group_by: Vec<String>,
    /// Fields to sort by.
    #[serde(default)]
    pub sort_by: Vec<String>,
    /// Field delimiter (default: comma).
    pub field_delimiter: Option<String>,
    /// String delimiter (default: double-quote).
    pub string_delimiter: Option<String>,
    /// Reference delimiter for grouped refs (default: comma).
    pub ref_delimiter: Option<String>,
    /// Reference range delimiter (e.g. "R1-R5" uses "-").
    pub ref_range_delimiter: Option<String>,
    /// Exclude DNP components.
    pub exclude_dnp: Option<bool>,
}

impl Default for BomOptions {
    fn default() -> Self {
        Self {
            output_file: PathBuf::from("bom.csv"),
            fields: vec![
                "Reference".into(),
                "Value".into(),
                "Footprint".into(),
                "Quantity".into(),
            ],
            labels: Vec::new(),
            group_by: vec!["Value".into(), "Footprint".into()],
            sort_by: vec!["Reference".into()],
            field_delimiter: None,
            string_delimiter: None,
            ref_delimiter: None,
            ref_range_delimiter: None,
            exclude_dnp: None,
        }
    }
}

/// Export BOM from a `.kicad_sch`.
pub async fn export_bom(
    cli_path: &Path,
    sch_file: &Path,
    opts: &BomOptions,
) -> Result<ExportResult, String> {
    let mut args: Vec<String> = vec![
        "sch".into(),
        "export".into(),
        "bom".into(),
        "--output".into(),
        opts.output_file.to_string_lossy().into_owned(),
    ];

    if !opts.fields.is_empty() {
        args.push("--fields".into());
        args.push(opts.fields.join(","));
    }
    if !opts.labels.is_empty() {
        args.push("--labels".into());
        args.push(opts.labels.join(","));
    }
    if !opts.group_by.is_empty() {
        args.push("--group-by".into());
        args.push(opts.group_by.join(","));
    }
    if !opts.sort_by.is_empty() {
        args.push("--sort-by".into());
        args.push(opts.sort_by.join(","));
    }
    if let Some(ref d) = opts.field_delimiter {
        args.push("--field-delimiter".into());
        args.push(d.clone());
    }
    if let Some(ref d) = opts.string_delimiter {
        args.push("--string-delimiter".into());
        args.push(d.clone());
    }
    if let Some(ref d) = opts.ref_delimiter {
        args.push("--ref-delimiter".into());
        args.push(d.clone());
    }
    if let Some(ref d) = opts.ref_range_delimiter {
        args.push("--ref-range-delimiter".into());
        args.push(d.clone());
    }
    if let Some(true) = opts.exclude_dnp {
        args.push("--exclude-dnp".into());
    }

    args.push(sch_file.to_string_lossy().into_owned());

    let output_dir = opts.output_file.parent().unwrap_or(Path::new("."));
    CliRunner::run_export(cli_path, &args, output_dir).await
}

// ══════════════════════════════════════════════════════════════════════════
//  SCHEMATIC PDF/SVG EXPORT
// ══════════════════════════════════════════════════════════════════════════

/// Options for `kicad-cli sch export pdf`.
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct SchPdfOptions {
    pub output_file: PathBuf,
    pub theme: Option<String>,
    pub black_and_white: Option<bool>,
    pub exclude_drawing_sheet: Option<bool>,
}

impl Default for SchPdfOptions {
    fn default() -> Self {
        Self {
            output_file: PathBuf::from("schematic.pdf"),
            theme: None,
            black_and_white: None,
            exclude_drawing_sheet: None,
        }
    }
}

/// Export schematic to PDF.
pub async fn export_sch_pdf(
    cli_path: &Path,
    sch_file: &Path,
    opts: &SchPdfOptions,
) -> Result<ExportResult, String> {
    let mut args: Vec<String> = vec![
        "sch".into(),
        "export".into(),
        "pdf".into(),
        "--output".into(),
        opts.output_file.to_string_lossy().into_owned(),
    ];

    if let Some(ref theme) = opts.theme {
        args.push("--theme".into());
        args.push(theme.clone());
    }
    if let Some(true) = opts.black_and_white {
        args.push("--black-and-white".into());
    }
    if let Some(true) = opts.exclude_drawing_sheet {
        args.push("--exclude-drawing-sheet".into());
    }

    args.push(sch_file.to_string_lossy().into_owned());

    let output_dir = opts.output_file.parent().unwrap_or(Path::new("."));
    CliRunner::run_export(cli_path, &args, output_dir).await
}

/// Options for `kicad-cli sch export svg`.
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct SchSvgOptions {
    pub output_dir: PathBuf,
    pub theme: Option<String>,
    pub black_and_white: Option<bool>,
    pub exclude_drawing_sheet: Option<bool>,
}

impl Default for SchSvgOptions {
    fn default() -> Self {
        Self {
            output_dir: PathBuf::from("."),
            theme: None,
            black_and_white: None,
            exclude_drawing_sheet: None,
        }
    }
}

/// Export schematic to SVG.
pub async fn export_sch_svg(
    cli_path: &Path,
    sch_file: &Path,
    opts: &SchSvgOptions,
) -> Result<ExportResult, String> {
    let mut args: Vec<String> = vec![
        "sch".into(),
        "export".into(),
        "svg".into(),
        "--output".into(),
        opts.output_dir.to_string_lossy().into_owned(),
    ];

    if let Some(ref theme) = opts.theme {
        args.push("--theme".into());
        args.push(theme.clone());
    }
    if let Some(true) = opts.black_and_white {
        args.push("--black-and-white".into());
    }
    if let Some(true) = opts.exclude_drawing_sheet {
        args.push("--exclude-drawing-sheet".into());
    }

    args.push(sch_file.to_string_lossy().into_owned());

    CliRunner::run_export(cli_path, &args, &opts.output_dir).await
}
