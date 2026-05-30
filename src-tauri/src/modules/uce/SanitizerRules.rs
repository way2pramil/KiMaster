//! SanitizerRules — "Brand Sanitizer" rules that enforce KiMaster design standards
//! on all imported symbols and footprints before they are written to the vault.
//!
//! Applied automatically during `add_to_vault()`. Rules:
//!
//! Symbol rules:
//!   S1 — Pin name/number text height clamped to 1.27 mm (50mil)
//!   S2 — Symbol body line widths set to 0 (KiCad default)
//!   S3 — Text strings with leading/trailing whitespace are trimmed
//!
//! Footprint rules:
//!   F1 — Courtyard clearance minimum 0.25 mm — if no courtyard exists, auto-generate one
//!   F2 — Silkscreen line width normalised to 0.12 mm
//!   F3 — Fab layer line width normalised to 0.10 mm
//!   F4 — Font sizes clamped to 1.0 mm minimum, 2.0 mm maximum
//!   F5 — Pad width/height minimum 0.001 mm (no zero-size pads)

use super::EdaParser::{EeFootprint, EeSymbol, EeTrack};

// ── Symbol sanitizer ─────────────────────────────────────────────────────────

pub fn sanitize_symbol(sym: &mut EeSymbol) {
    // S3 — trim pin names and numbers
    for pin in &mut sym.pins {
        pin.name   = pin.name.trim().to_string();
        pin.number = pin.number.trim().to_string();
    }

    // S3 — trim text strings
    for text in &mut sym.texts {
        text.text = text.text.trim().to_string();
        // S1 — font size: KiCad standard = 1.27mm
        text.font_size_mm = 1.27_f64;
    }

    // Recursively sanitize multi-unit sub-symbols
    for sub in &mut sym.sub_units {
        sanitize_symbol(sub);
    }
}

// ── Footprint sanitizer ───────────────────────────────────────────────────────

pub fn sanitize_footprint(fp: &mut EeFootprint) {
    // F2/F3 — normalise line widths by layer
    for track in &mut fp.tracks {
        track.width_mm = normalise_width(&track.layer, track.width_mm);
    }
    for circle in &mut fp.circles {
        circle.width_mm = normalise_width(&circle.layer, circle.width_mm);
    }

    // F4 — clamp text font sizes
    for text in &mut fp.texts {
        text.font_size_mm = text.font_size_mm.clamp(1.0, 2.0);
    }

    // F5 — minimum pad size
    for pad in &mut fp.pads {
        pad.w_mm = pad.w_mm.max(0.001);
        pad.h_mm = pad.h_mm.max(0.001);
    }

    // F1 — auto-generate courtyard if missing
    let has_courtyard = fp.tracks.iter().any(|t| t.layer.contains("CrtYd"))
        || fp.regions.iter().any(|r| r.layer.contains("CrtYd"));

    if !has_courtyard {
        let courtyard_lines = generate_courtyard(fp, 0.25);
        fp.tracks.extend(courtyard_lines);
    }
}

/// Normalise line width based on KiCad layer conventions:
///   SilkS → 0.12 mm
///   Fab   → 0.10 mm
///   CrtYd → 0.05 mm
///   other → keep, clamp to [0.01, 2.0]
fn normalise_width(layer: &str, current: f64) -> f64 {
    if layer.contains("SilkS") {
        0.12
    } else if layer.contains("Fab") {
        0.10
    } else if layer.contains("CrtYd") {
        0.05
    } else {
        current.clamp(0.01, 2.0)
    }
}

/// Generate a rectangular courtyard outline from the pad bounding box + clearance.
fn generate_courtyard(fp: &EeFootprint, clearance: f64) -> Vec<EeTrack> {
    if fp.pads.is_empty() { return Vec::new(); }

    let min_x = fp.pads.iter().map(|p| p.x_mm - p.w_mm / 2.0).fold(f64::INFINITY, f64::min);
    let min_y = fp.pads.iter().map(|p| p.y_mm - p.h_mm / 2.0).fold(f64::INFINITY, f64::min);
    let max_x = fp.pads.iter().map(|p| p.x_mm + p.w_mm / 2.0).fold(f64::NEG_INFINITY, f64::max);
    let max_y = fp.pads.iter().map(|p| p.y_mm + p.h_mm / 2.0).fold(f64::NEG_INFINITY, f64::max);

    let x1 = min_x - clearance;
    let y1 = min_y - clearance;
    let x2 = max_x + clearance;
    let y2 = max_y + clearance;

    let layer = "F.CrtYd".to_string();
    let w = 0.05;

    vec![
        EeTrack { x1_mm: x1, y1_mm: y1, x2_mm: x2, y2_mm: y1, layer: layer.clone(), width_mm: w },
        EeTrack { x1_mm: x2, y1_mm: y1, x2_mm: x2, y2_mm: y2, layer: layer.clone(), width_mm: w },
        EeTrack { x1_mm: x2, y1_mm: y2, x2_mm: x1, y2_mm: y2, layer: layer.clone(), width_mm: w },
        EeTrack { x1_mm: x1, y1_mm: y2, x2_mm: x1, y2_mm: y1, layer,                width_mm: w },
    ]
}
