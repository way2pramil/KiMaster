//! KiModGenerator — generates KiCad `.kicad_mod` S-expression text from
//! a parsed `EeFootprint` + component metadata.
//!
//! Matches Python reference: export_kicad_footprint.py + parameters_kicad_footprint.py.
//! Output format: KiCad footprint file v20231120.

use super::EdaParser::{
    EeFootprint, EePad, EeSymbolInfo,
    PadType, PadShape,
};

const MOD_VERSION: u32 = 20231120;
const GENERATOR:   &str = "kimaster";
const LIB_NAME:    &str = "KiMaster";

/// Generate the full `.kicad_mod` text for a footprint.
/// `model_3d_path` is the filesystem path to the STEP file (used in the `(model ...)` block).
/// Pass `None` if no 3D model is available.
pub fn generate_footprint(info: &EeSymbolInfo, fp: &EeFootprint, model_3d_path: Option<&str>) -> String {
    let name = &info.lcsc_id;
    let mut s = String::with_capacity(16384);

    // ── Module header ────────────────────────────────────────────────────────
    s.push_str(&format!(
        "(footprint \"{LIB_NAME}:{name}\"\n\
         \x20 (version {MOD_VERSION})\n\
         \x20 (generator \"{GENERATOR}\")\n\
         \x20 (layer \"F.Cu\")\n"
    ));

    if !info.description.is_empty() {
        let esc = info.description.replace('"', "\\\"");
        s.push_str(&format!("  (descr \"{esc}\")\n"));
    }

    if !fp.fp_type.is_empty() {
        let attr = if fp.fp_type == "smd" { "smd" } else { "through_hole" };
        s.push_str(&format!("  (attr {attr})\n"));
    }

    // ── Compute text placement from pad bounding box ─────────────────────────
    let (y_low, y_high) = if fp.pads.is_empty() {
        (0.0_f64, 0.0_f64)
    } else {
        let lo = fp.pads.iter().map(|p| p.y_mm).fold(f64::INFINITY, f64::min);
        let hi = fp.pads.iter().map(|p| p.y_mm).fold(f64::NEG_INFINITY, f64::max);
        (lo, hi)
    };

    // Reference text on F.SilkS (above pads)
    s.push_str(&format!(
        "  (fp_text reference \"REF**\" (at 0 {:.3})\n\
         \x20   (layer \"F.SilkS\")\n\
         \x20   (effects (font (size 1 1) (thickness 0.15)))\n\
         \x20 )\n",
        y_low - 4.0,
    ));

    // Value text on F.Fab (below pads)
    let name_esc = name.replace('"', "\\\"");
    s.push_str(&format!(
        "  (fp_text value \"{name_esc}\" (at 0 {:.3})\n\
         \x20   (layer \"F.Fab\")\n\
         \x20   (effects (font (size 1 1) (thickness 0.15)))\n\
         \x20 )\n",
        y_high + 4.0,
    ));

    // User %R fab ref
    s.push_str(
        "  (fp_text user \"%R\" (at 0 0)\n\
         \x20   (layer \"F.Fab\")\n\
         \x20   (effects (font (size 1 1) (thickness 0.15)))\n\
         \x20 )\n"
    );

    // ── Custom properties ────────────────────────────────────────────────────
    if !info.lcsc_id.is_empty() {
        s.push_str(&format!("  (property \"LCSC Part\" \"{}\")\n", info.lcsc_id));
    }
    if !info.manufacturer.is_empty() {
        let esc = info.manufacturer.replace('"', "\\\"");
        s.push_str(&format!("  (property \"Manufacturer\" \"{esc}\")\n"));
    }
    if !info.mpn.is_empty() {
        let esc = info.mpn.replace('"', "\\\"");
        s.push_str(&format!("  (property \"MPN\" \"{esc}\")\n"));
    }

    // ── Tracks / lines ───────────────────────────────────────────────────────
    for t in &fp.tracks {
        s.push_str(&format!(
            "  (fp_line (start {:.2} {:.2}) (end {:.2} {:.2})\n\
             \x20   (stroke (width {:.2}) (type default))\n\
             \x20   (layer \"{}\"))\n",
            t.x1_mm, t.y1_mm, t.x2_mm, t.y2_mm,
            t.width_mm.max(0.01), t.layer,
        ));
    }

    // ── Pads ─────────────────────────────────────────────────────────────────
    for pad in &fp.pads {
        s.push_str(&generate_pad(pad));
    }

    // ── Holes ────────────────────────────────────────────────────────────────
    for hole in &fp.holes {
        let size = hole.r_mm * 2.0;
        s.push_str(&format!(
            "  (pad \"\" thru_hole circle (at {:.2} {:.2})\n\
             \x20   (size {size:.2} {size:.2}) (drill {size:.2})\n\
             \x20   (layers \"*.Cu\" \"*.Mask\"))\n",
            hole.x_mm, hole.y_mm,
        ));
    }

    // ── Vias ─────────────────────────────────────────────────────────────────
    for via in &fp.vias {
        let diameter = via.diam_mm;
        let drill = via.r_mm * 2.0;
        s.push_str(&format!(
            "  (pad \"\" thru_hole circle (at {:.2} {:.2})\n\
             \x20   (size {diameter:.2} {diameter:.2}) (drill {drill:.2})\n\
             \x20   (layers \"*.Cu\" \"*.Paste\" \"*.Mask\"))\n",
            via.x_mm, via.y_mm,
        ));
    }

    // ── Circles ──────────────────────────────────────────────────────────────
    for c in &fp.circles {
        let end_x = c.cx_mm + c.r_mm;
        s.push_str(&format!(
            "  (fp_circle (center {:.2} {:.2}) (end {end_x:.2} {:.2})\n\
             \x20   (stroke (width {:.2}) (type default))\n\
             \x20   (layer \"{}\"))\n",
            c.cx_mm, c.cy_mm, c.cy_mm,
            c.width_mm.max(0.01), c.layer,
        ));
    }

    // ── Arcs ─────────────────────────────────────────────────────────────────
    for a in &fp.arcs {
        s.push_str(&format!(
            "  (fp_arc (start {:.2} {:.2}) (end {:.2} {:.2})\n\
             \x20   (angle {:.2})\n\
             \x20   (stroke (width {:.2}) (type default))\n\
             \x20   (layer \"{}\"))\n",
            a.cx, a.cy, a.end_x, a.end_y,
            a.angle,
            a.width_mm.max(0.01), a.layer,
        ));
    }

    // ── Texts ────────────────────────────────────────────────────────────────
    for t in &fp.texts {
        let esc_text = t.text.replace('"', "\\\"");
        let display = if !t.is_displayed { " hide" } else { "" };
        let mirror = if t.mirror || t.layer.starts_with("B.") { " mirror" } else { "" };
        s.push_str(&format!(
            "  (fp_text user \"{esc_text}\" (at {:.2} {:.2} {:.2})\n\
             \x20   (layer \"{}\"){display}\n\
             \x20   (effects (font (size {:.2} {:.2}) (thickness {:.2})) (justify left{mirror}))\n\
             \x20 )\n",
            t.x_mm, t.y_mm, t.rotation,
            t.layer,
            t.font_size_mm.max(1.0), t.font_size_mm.max(1.0),
            t.font_size_mm.max(1.0) * 0.15,
        ));
    }

    // ── Solid regions ────────────────────────────────────────────────────────
    for region in &fp.regions {
        if region.layer == "F.CrtYd" || region.layer == "B.CrtYd" {
            // Courtyard: emit as outline lines
            let pts = &region.points;
            for i in 0..pts.len().saturating_sub(1) {
                s.push_str(&format!(
                    "  (fp_line (start {:.6} {:.6}) (end {:.6} {:.6})\n\
                     \x20   (stroke (width 0.05) (type default))\n\
                     \x20   (layer \"{}\"))\n",
                    pts[i].0, pts[i].1, pts[i + 1].0, pts[i + 1].1,
                    region.layer,
                ));
            }
        } else {
            // Filled polygon
            let pts_str: String = region.points.iter()
                .map(|(x, y)| format!("(xy {x:.6} {y:.6})"))
                .collect::<Vec<_>>()
                .join(" ");
            s.push_str(&format!(
                "  (fp_poly (pts {pts_str})\n\
                 \x20   (stroke (width 0) (type solid))\n\
                 \x20   (fill solid)\n\
                 \x20   (layer \"{}\"))\n",
                region.layer,
            ));
        }
    }

    // ── 3D Model ────────────────────────────────────────────────────────
    if let (Some(mp), Some(model)) = (model_3d_path, &fp.model_3d) {
        let esc_path = mp.replace('\\', "/"); // KiCad uses forward slashes
        s.push_str(&format!(
            "  (model \"{esc_path}\"\n\
             \x20   (offset (xyz {:.6} {:.6} {:.6}))\n\
             \x20   (scale (xyz 1 1 1))\n\
             \x20   (rotate (xyz {:.0} {:.0} {:.0}))\n\
             \x20 )\n",
            model.translation[0], model.translation[1], model.translation[2],
            model.rotation[0], model.rotation[1], model.rotation[2],
        ));
    }

    s.push_str(")\n");
    s
}

/// Generate a pad S-expression.
fn generate_pad(pad: &EePad) -> String {
    let num_esc = pad.number.replace('"', "\\\"");

    let pad_type_str = match pad.pad_type {
        PadType::Smd         => "smd",
        PadType::ThroughHole => "thru_hole",
    };

    let shape_str = match pad.pad_shape {
        PadShape::Circle => "circle",
        PadShape::Rect   => "rect",
        PadShape::Oval   => "oval",
        PadShape::Custom => "custom",
    };

    // Drill string
    let drill_str = generate_drill(pad);

    // Build layers list — each layer name in quotes
    let layers_str: String = pad.layers
        .split_whitespace()
        .map(|l| format!("\"{}\"", l))
        .collect::<Vec<_>>()
        .join(" ");

    let rot_str = if pad.rotation.abs() > 0.01 {
        format!(" {:.2}", pad.rotation)
    } else {
        String::new()
    };

    let polygon_str = &pad.polygon;

    format!(
        "  (pad \"{num_esc}\" {pad_type_str} {shape_str}\n\
         \x20   (at {:.3} {:.3}{rot_str})\n\
         \x20   (size {:.3} {:.3})\n\
         \x20   (layers {layers_str}){drill}{poly})\n",
        pad.x_mm, pad.y_mm,
        pad.w_mm, pad.h_mm,
        drill = if drill_str.is_empty() { String::new() } else { format!("\n  {drill_str}") },
        poly = if polygon_str.is_empty() { String::new() } else { polygon_str.to_string() },
    )
}

/// Generate drill S-expression for a pad.
/// Matches Python: `drill_to_ki()`.
fn generate_drill(pad: &EePad) -> String {
    let hole_radius = pad.drill_mm / 2.0;
    let hole_length = pad.slot_mm;

    if hole_radius > 0.0 && hole_length > 0.0 {
        let max_distance_hole = (hole_radius * 2.0).max(hole_length);
        let pos_0  = pad.h_mm - max_distance_hole;
        let pos_90 = pad.w_mm - max_distance_hole;

        if pos_0 >= pos_90 {
            format!("(drill oval {:.3} {:.3})", hole_radius * 2.0, hole_length)
        } else {
            format!("(drill oval {:.3} {:.3})", hole_length, hole_radius * 2.0)
        }
    } else if hole_radius > 0.0 {
        format!("(drill {:.3})", pad.drill_mm)
    } else {
        String::new()
    }
}
