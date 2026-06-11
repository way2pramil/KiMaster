//! Canvas IPC commands — footprint/symbol editor file I/O.
//!
//! cmd_canvas_load_footprint:  hash → temp copy → parse → return elements
//! cmd_canvas_save_footprint:  re-parse original → apply mutations → write
//! cmd_canvas_pick_footprint:  native rfd file dialog (.kicad_mod filter)
//! cmd_canvas_load_symbol:     stub (Phase 3)
//! cmd_canvas_save_symbol:     stub (Phase 3)
//! cmd_canvas_close:           cleanup temp files

use serde::{Deserialize, Serialize};
use serde_json::Value;
use std::collections::hash_map::DefaultHasher;
use std::hash::{Hash, Hasher};

use crate::modules::canvas::footprint;

// ── Response types ────────────────────────────────────────────────────────────

#[derive(Serialize)]
pub struct LoadFootprintResult {
    pub elements: Vec<Value>,
    pub temp_path: String,
    pub original_hash: String,
}

#[derive(Serialize)]
pub struct LoadSymbolResult {
    pub elements: Vec<Value>,
    pub original_hash: String,
}

#[derive(Serialize)]
pub struct SaveResult {
    pub new_hash: String,
}

// ── Load footprint ────────────────────────────────────────────────────────────

#[tauri::command]
pub async fn cmd_canvas_load_footprint(path: String) -> Result<LoadFootprintResult, String> {
    tracing::info!("cmd_canvas_load_footprint: {path}");

    if path.starts_with("mock://") {
        return Ok(mock_soic8());
    }

    let content = std::fs::read_to_string(&path)
        .map_err(|e| format!("Cannot read {path}: {e}"))?;

    let hash = hash_str(&content);

    // Create temp copy in OS temp dir
    let temp_path = {
        let stem = std::path::Path::new(&path)
            .file_name()
            .and_then(|s| s.to_str())
            .unwrap_or("footprint.kicad_mod");
        let dir = std::env::temp_dir().join("ki-master-canvas");
        std::fs::create_dir_all(&dir)
            .map_err(|e| format!("Cannot create temp dir: {e}"))?;
        let tmp = dir.join(format!("{hash:.8}_{stem}"));
        std::fs::write(&tmp, &content)
            .map_err(|e| format!("Cannot write temp: {e}"))?;
        tmp.to_string_lossy().into_owned()
    };

    let (_root, elements) = footprint::parse_footprint(&content)
        .map_err(|e| format!("Parse error: {e}"))?;

    tracing::info!("Loaded {} elements from {path}", elements.len());

    Ok(LoadFootprintResult { elements, temp_path, original_hash: hash })
}

// ── Save footprint ────────────────────────────────────────────────────────────

#[derive(Deserialize)]
pub struct SaveFootprintArgs {
    pub original_path: String,
    pub mutations: Vec<Value>,
    pub original_hash: String,
    #[allow(dead_code)]
    pub temp_path: String,
}

#[tauri::command]
pub async fn cmd_canvas_save_footprint(args: SaveFootprintArgs) -> Result<SaveResult, String> {
    tracing::info!("cmd_canvas_save_footprint: {}", args.original_path);

    // Mock save — just return a stub hash
    if args.original_path.starts_with("mock://") {
        return Ok(SaveResult {
            new_hash: "deadbeef00112233445566778899aabbccddeeff00112233445566778899aabb".into(),
        });
    }

    // Read current content and verify hash (conflict detection)
    let content = std::fs::read_to_string(&args.original_path)
        .map_err(|e| format!("Cannot read {}: {e}", args.original_path))?;

    let current_hash = hash_str(&content);
    if current_hash != args.original_hash {
        return Err(format!(
            "File was modified externally since last load (hash mismatch). \
             Please re-open the file to get the latest version."
        ));
    }

    // Parse original, apply mutations, re-serialize
    let (mut root, _) = footprint::parse_footprint(&content)
        .map_err(|e| format!("Parse error on save: {e}"))?;

    footprint::apply_mutations(&mut root, &args.mutations)
        .map_err(|e| format!("Mutation error: {e}"))?;

    let new_content = crate::modules::canvas::sexpr::serialize(&root);
    std::fs::write(&args.original_path, &new_content)
        .map_err(|e| format!("Write failed: {e}"))?;

    let new_hash = hash_str(&new_content);
    tracing::info!("Saved {} ({} mutations)", args.original_path, args.mutations.len());

    Ok(SaveResult { new_hash })
}

// ── Pick footprint (native file dialog) ───────────────────────────────────────

#[tauri::command]
pub async fn cmd_canvas_pick_footprint() -> Result<Option<String>, String> {
    let handle = rfd::AsyncFileDialog::new()
        .set_title("Open KiCad Footprint")
        .add_filter("KiCad Footprint", &["kicad_mod"])
        .pick_file()
        .await;
    Ok(handle.map(|f| f.path().to_string_lossy().into_owned()))
}

// ── Symbol stubs (Phase 3) ────────────────────────────────────────────────────

#[tauri::command]
pub async fn cmd_canvas_load_symbol(name: String) -> Result<LoadSymbolResult, String> {
    tracing::info!("cmd_canvas_load_symbol: {name} (stub)");
    Ok(LoadSymbolResult { elements: vec![], original_hash: String::new() })
}

#[derive(Deserialize)]
pub struct SaveSymbolArgs {
    pub name: String,
    pub mutations: Vec<Value>,
    pub original_hash: String,
}

#[tauri::command]
pub async fn cmd_canvas_save_symbol(args: SaveSymbolArgs) -> Result<SaveResult, String> {
    tracing::info!("cmd_canvas_save_symbol: {} (stub)", args.name);
    Ok(SaveResult { new_hash: String::new() })
}

#[tauri::command]
pub async fn cmd_canvas_close() -> Result<(), String> {
    tracing::info!("cmd_canvas_close");
    Ok(())
}

// ── Helpers ───────────────────────────────────────────────────────────────────

fn hash_str(s: &str) -> String {
    let mut h = DefaultHasher::new();
    s.hash(&mut h);
    format!("{:016x}", h.finish())
}

fn mock_soic8() -> LoadFootprintResult {
    let elements = serde_json::json!([
        { "type": "pad", "id": "pad-1",   "layer": "F.Cu", "x": -3.0, "y": -1.905, "shape": "oval", "width": 1.6, "height": 0.6, "angle": 0, "number": "1",  "net": "VCC", "drill": 0 },
        { "type": "pad", "id": "pad-2",   "layer": "F.Cu", "x": -3.0, "y": -0.635, "shape": "oval", "width": 1.6, "height": 0.6, "angle": 0, "number": "2",  "net": "",    "drill": 0 },
        { "type": "pad", "id": "pad-3",   "layer": "F.Cu", "x": -3.0, "y":  0.635, "shape": "oval", "width": 1.6, "height": 0.6, "angle": 0, "number": "3",  "net": "",    "drill": 0 },
        { "type": "pad", "id": "pad-4",   "layer": "F.Cu", "x": -3.0, "y":  1.905, "shape": "oval", "width": 1.6, "height": 0.6, "angle": 0, "number": "4",  "net": "GND", "drill": 0 },
        { "type": "pad", "id": "pad-5",   "layer": "F.Cu", "x":  3.0, "y":  1.905, "shape": "oval", "width": 1.6, "height": 0.6, "angle": 0, "number": "5",  "net": "GND", "drill": 0 },
        { "type": "pad", "id": "pad-6",   "layer": "F.Cu", "x":  3.0, "y":  0.635, "shape": "oval", "width": 1.6, "height": 0.6, "angle": 0, "number": "6",  "net": "",    "drill": 0 },
        { "type": "pad", "id": "pad-7",   "layer": "F.Cu", "x":  3.0, "y": -0.635, "shape": "oval", "width": 1.6, "height": 0.6, "angle": 0, "number": "7",  "net": "",    "drill": 0 },
        { "type": "pad", "id": "pad-8",   "layer": "F.Cu", "x":  3.0, "y": -1.905, "shape": "oval", "width": 1.6, "height": 0.6, "angle": 0, "number": "8",  "net": "VCC", "drill": 0 },
        { "type": "pad", "id": "pad-th1", "layer": "F.Cu", "x":  0.0, "y":  3.5,   "shape": "rect", "width": 1.2, "height": 1.2, "angle": 45, "number": "TP", "net": "",   "drill": 0.8 },
        { "type": "line", "id": "cyd-t",  "layer": "F.Courtyard", "x": -4.5, "y": -2.5, "x2":  4.5, "y2": -2.5, "stroke_width": 0.05 },
        { "type": "line", "id": "cyd-r",  "layer": "F.Courtyard", "x":  4.5, "y": -2.5, "x2":  4.5, "y2":  2.5, "stroke_width": 0.05 },
        { "type": "line", "id": "cyd-b",  "layer": "F.Courtyard", "x":  4.5, "y":  2.5, "x2": -4.5, "y2":  2.5, "stroke_width": 0.05 },
        { "type": "line", "id": "cyd-l",  "layer": "F.Courtyard", "x": -4.5, "y":  2.5, "x2": -4.5, "y2": -2.5, "stroke_width": 0.05 },
        { "type": "line", "id": "silk-t", "layer": "F.SilkS", "x": -1.0, "y": -2.2, "x2":  3.8, "y2": -2.2, "stroke_width": 0.12 },
        { "type": "line", "id": "silk-r", "layer": "F.SilkS", "x":  3.8, "y": -2.2, "x2":  3.8, "y2":  2.2, "stroke_width": 0.12 },
        { "type": "line", "id": "silk-b", "layer": "F.SilkS", "x":  3.8, "y":  2.2, "x2": -3.8, "y2":  2.2, "stroke_width": 0.12 },
        { "type": "line", "id": "silk-l", "layer": "F.SilkS", "x": -3.8, "y":  2.2, "x2": -3.8, "y2": -2.2, "stroke_width": 0.12 },
        { "type": "arc",  "id": "silk-arc", "layer": "F.SilkS", "x": -1.0, "y": -2.2, "x2": 1.0, "y2": -2.2, "mid_x": 0.0, "mid_y": -2.8, "stroke_width": 0.12 },
        { "type": "line", "id": "fab-t",  "layer": "F.Fab", "x": -3.5, "y": -2.0, "x2":  3.5, "y2": -2.0, "stroke_width": 0.1 },
        { "type": "line", "id": "fab-r",  "layer": "F.Fab", "x":  3.5, "y": -2.0, "x2":  3.5, "y2":  2.0, "stroke_width": 0.1 },
        { "type": "line", "id": "fab-b",  "layer": "F.Fab", "x":  3.5, "y":  2.0, "x2": -3.5, "y2":  2.0, "stroke_width": 0.1 },
        { "type": "line", "id": "fab-l",  "layer": "F.Fab", "x": -3.5, "y":  2.0, "x2": -3.5, "y2": -2.0, "stroke_width": 0.1 },
        { "type": "polygon", "id": "fab-pin1", "layer": "F.Fab", "points": [-3.5, -2.0, -2.5, -2.0, -3.5, -1.0], "stroke_width": 0.1, "fill": "solid" },
        { "type": "line", "id": "cmts-x1", "layer": "Cmts.User", "x": -3.0, "y": -1.905, "x2": -3.3, "y2": -1.6, "stroke_width": 0.05 },
        { "type": "line", "id": "cmts-x2", "layer": "Cmts.User", "x": -3.3, "y": -1.905, "x2": -3.0, "y2": -1.6, "stroke_width": 0.05 },
        { "type": "text", "id": "ref",    "layer": "F.SilkS", "x": 0.0, "y": -3.5, "text": "U1",     "font_size": 1.27, "bold": false },
        { "type": "text", "id": "val",    "layer": "F.Fab",   "x": 0.0, "y":  3.5, "text": "NE555P", "font_size": 1.27, "bold": false }
    ]);
    LoadFootprintResult {
        elements: elements.as_array().cloned().unwrap_or_default(),
        temp_path: "mock://temp/NE555.kicad_mod".into(),
        original_hash: "aabbccddeeff00112233445566778899aabbccddeeff00112233445566778899".into(),
    }
}
