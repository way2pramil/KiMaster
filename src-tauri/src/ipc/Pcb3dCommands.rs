//! PCB 3D pipeline commands — fresh parallel pipeline.
//!
//! Pipeline A: SVG layer export → JS rasterizer → GLSL shader (board)
//! Pipeline B: VRML component export → VRMLLoader → model cache (components)
//! Pipeline C: Full GLB export → photorealistic marketing render (user-triggered)

use std::path::PathBuf;
use serde::{Deserialize, Serialize};
use tauri::State;

use crate::AppState::KiMasterState;
use crate::modules::cli::CliRunner::{self, ExportResult};
use crate::modules::cli::resolve_kicad_cli;

fn resolve_cli(state: &KiMasterState) -> Result<PathBuf, String> {
    let inner = state.0.lock().map_err(|e| e.to_string())?;
    CliRunner::resolve_cli_path(&inner.kicad_cli_path)
}

// ── Pipeline A: SVG layer export ──────────────────────────────────────────────

#[derive(Serialize)]
pub struct LayerExportResult {
    pub output_dir:   String,
    /// Layer file stems actually written, e.g. ["F_Cu", "B_Cu", "F_Mask", ...]
    pub layers:       Vec<String>,
    pub success:      bool,
    pub message:      String,
}

/// Export PCB copper, mask and silkscreen layers as individual SVG files.
/// Uses `kicad-cli pcb export svg` with exact board-fit page mode.
/// Returns paths so the JS rasterizer can load them via the asset protocol.
///
/// Args: { pcb_file: string, output_dir: string }
#[tauri::command]
pub async fn cmd_pcb3d_export_layers(
    state: State<'_, KiMasterState>,
    pcb_file:   String,
    output_dir: String,
) -> Result<LayerExportResult, String> {
    let cli   = resolve_cli(&state)?;
    let pcb   = PathBuf::from(&pcb_file);
    let out   = PathBuf::from(&output_dir);

    if !pcb.exists() {
        return Err(format!("PCB file not found: {pcb_file}"));
    }

    std::fs::create_dir_all(&out)
        .map_err(|e| format!("Cannot create output dir: {e}"))?;

    // Use canonical path so kicad-cli gets clean Windows backslash paths
    let out_canonical = out.canonicalize()
        .unwrap_or_else(|_| out.clone());

    // Export each layer individually with explicit filenames.
    // Boards often use custom layer names (TOPSIG, "Top Solder", etc.) so we
    // cannot rely on kicad-cli's auto-generated filenames.
    // --mode-single + explicit -o path gives us exact control.
    let layer_defs: &[(&str, &str)] = &[
        ("F.Cu",   "F_Cu.svg"),
        ("B.Cu",   "B_Cu.svg"),
        ("F.Mask", "F_Mask.svg"),
        ("B.Mask", "B_Mask.svg"),
        ("F.SilkS","F_SilkS.svg"),
        ("B.SilkS","B_SilkS.svg"),
    ];

    let mut written: Vec<String> = Vec::new();
    let mut any_ok = false;

    for (layer, filename) in layer_defs {
        let dest = out_canonical.join(filename);
        let dest_str = dest.to_string_lossy().into_owned();
        let mut args_vec: Vec<&str> = vec![
            "pcb", "export", "svg",
            "--mode-single",
            "--layers", layer,
            "--output", dest_str.as_str(),
            "--page-size-mode", "2",
            "--exclude-drawing-sheet",
            "--black-and-white",
            "--drill-shape-opt", "0",
            pcb_file.as_str(),
        ];
        let res = CliRunner::spawn_kicad_cli(&cli, &args_vec).await;

        match res {
            Ok(raw) if raw.exit_code == 0 || dest.exists() => {
                written.push(dest.to_string_lossy().into_owned());
                any_ok = true;
            }
            Ok(raw) => {
                tracing::warn!("PCB3D layer {} export failed: {}", layer, raw.stderr.lines().next().unwrap_or(""));
            }
            Err(e) => {
                tracing::warn!("PCB3D layer {} spawn error: {}", layer, e);
            }
        }
    }

    let success = any_ok;

    Ok(LayerExportResult {
        output_dir,
        layers: written.clone(),
        success,
        message: if success {
            format!("Exported {} layer SVGs", written.len())
        } else {
            "All layer exports failed — check KiCad layer names".to_string()
        },
    })
}

// ── Pipeline B: VRML component export ────────────────────────────────────────

#[derive(Serialize)]
pub struct VrmlExportResult {
    pub pcb_wrl:        String,   // path to pcb.wrl (full board + components)
    pub components_dir: String,   // dir containing {ref}.wrl per component
    pub success:        bool,
    pub message:        String,
}

/// Export board and per-component VRML models.
/// Uses `kicad-cli pcb export vrml` — fast, includes all component models.
/// The resulting pcb.wrl + components/*.wrl are loaded by VRMLLoader in Three.js.
///
/// Args: { pcb_file: string, output_dir: string }
#[tauri::command]
pub async fn cmd_pcb3d_export_vrml(
    state: State<'_, KiMasterState>,
    pcb_file:   String,
    output_dir: String,
) -> Result<VrmlExportResult, String> {
    let cli  = resolve_cli(&state)?;
    let pcb  = PathBuf::from(&pcb_file);
    let out  = PathBuf::from(&output_dir);

    if !pcb.exists() {
        return Err(format!("PCB file not found: {pcb_file}"));
    }
    std::fs::create_dir_all(&out)
        .map_err(|e| format!("Cannot create output dir: {e}"))?;

    let out_c        = out.canonicalize().unwrap_or_else(|_| out.clone());
    let pcb_wrl_path = out_c.join("pcb.wrl");
    let comp_dir     = out_c.join("components");
    std::fs::create_dir_all(&comp_dir)
        .map_err(|e| format!("Cannot create components dir: {e}"))?;

    let comp_dir_c = comp_dir.canonicalize().unwrap_or_else(|_| comp_dir.clone());

    let raw = CliRunner::spawn_kicad_cli(&cli, &[
        "pcb", "export", "vrml",
        "--output",          pcb_wrl_path.to_str().unwrap_or("pcb.wrl"),
        "--units",           "mm",
        "--models-dir",      comp_dir_c.to_str().unwrap_or("components"),
        "--models-relative",
        pcb_file.as_str(),
    ]).await?;

    let success = raw.exit_code == 0 && pcb_wrl_path.exists();

    Ok(VrmlExportResult {
        pcb_wrl:        pcb_wrl_path.to_string_lossy().into_owned(),
        components_dir: comp_dir.to_string_lossy().into_owned(),
        success,
        message: if success {
            "VRML export complete".into()
        } else {
            raw.stderr.lines().next().unwrap_or("VRML export failed").to_string()
        },
    })
}

// ── Pipeline C: Full marketing GLB ──────────────────────────────────────────

#[derive(Deserialize)]
pub struct MarketingGlbArgs {
    pub pcb_file:    String,
    pub output_file: String,
    #[serde(default = "bool_true")]
    pub subst_models: bool,
    #[serde(default)]
    pub no_dnp: bool,
}

fn bool_true() -> bool { true }

#[derive(Serialize)]
pub struct MarketingGlbResult {
    pub output_file: String,
    pub success:     bool,
    pub message:     String,
    pub file_size_kb: u64,
}

/// Export full photorealistic GLB with real component models.
/// Slow (30s – 5min depending on board complexity) — user-triggered only.
///
/// Args: MarketingGlbArgs
#[tauri::command]
pub async fn cmd_pcb3d_export_marketing_glb(
    state: State<'_, KiMasterState>,
    args: MarketingGlbArgs,
) -> Result<MarketingGlbResult, String> {
    let cli = resolve_cli(&state)?;
    let pcb = PathBuf::from(&args.pcb_file);
    let out = PathBuf::from(&args.output_file);

    if !pcb.exists() {
        return Err(format!("PCB file not found: {}", args.pcb_file));
    }
    if let Some(p) = out.parent() {
        std::fs::create_dir_all(p).map_err(|e| format!("Cannot create dir: {e}"))?;
    }

    let mut cmd: Vec<&str> = vec![
        "pcb", "export", "glb",
        "-f",
        "-o",               out.to_str().unwrap_or(""),
        "--include-tracks",
        "--include-pads",
        "--include-zones",
        "--include-silkscreen",
        "--include-soldermask",
        "--cut-vias-in-body",
    ];
    if args.subst_models { cmd.push("--subst-models"); }
    if args.no_dnp       { cmd.push("--no-dnp"); }
    cmd.push(args.pcb_file.as_str());

    let raw = CliRunner::spawn_kicad_cli(&cli, &cmd).await?;

    let exists    = out.exists();
    let file_size = out.metadata().map(|m| m.len() / 1024).unwrap_or(0);

    Ok(MarketingGlbResult {
        output_file: args.output_file,
        success: raw.exit_code == 0 || exists,
        message: if exists {
            format!("GLB exported ({file_size} KB)")
        } else {
            raw.stderr.lines().next().unwrap_or("Export failed").to_string()
        },
        file_size_kb: file_size,
    })
}

// ── Utility: check file exists ────────────────────────────────────────────────

/// Check if a file exists on disk (used to verify exports completed).
#[tauri::command]
pub async fn cmd_pcb3d_file_exists(path: String) -> bool {
    std::path::Path::new(&path).exists()
}

/// Read a text file — used to load SVG content for the rasterizer.
#[tauri::command]
pub async fn cmd_pcb3d_read_file(path: String) -> Result<String, String> {
    std::fs::read_to_string(&path)
        .map_err(|e| format!("Cannot read '{}': {}", path, e))
}

/// List files in a directory matching an optional extension filter.
/// Returns absolute file paths.
#[tauri::command]
pub async fn cmd_pcb3d_list_dir(
    dir: String,
    ext: Option<String>,
) -> Result<Vec<String>, String> {
    let entries = std::fs::read_dir(&dir)
        .map_err(|e| format!("Cannot read dir '{}': {}", dir, e))?;

    let mut paths = Vec::new();
    for entry in entries.flatten() {
        let path = entry.path();
        if let Some(ref filter) = ext {
            if path.extension().and_then(|e| e.to_str()) != Some(filter.as_str()) {
                continue;
            }
        }
        if let Some(s) = path.to_str() {
            paths.push(s.to_owned());
        }
    }
    Ok(paths)
}
