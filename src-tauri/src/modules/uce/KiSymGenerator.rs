//! KiSymGenerator — generates KiCad `.kicad_sym` S-expression text from
//! a parsed `EeSymbol` + component metadata.
//!
//! Matches Python reference: export_kicad_symbol.py + parameters_kicad_symbol.py.
//! Output format: KiCad symbol library v20231120.

use super::EdaParser::{EeSymbol, EeSymbolInfo};

const SYM_VERSION: u32 = 20231120;
const GENERATOR:   &str = "kimaster";

// ── KiCad symbol defaults (mm) ───────────────────────────────────────────────
const PIN_NUM_SIZE:    f64 = 1.27;
const PIN_NAME_SIZE:   f64 = 1.27;
const PROP_FONT_SIZE:  f64 = 1.27;
const FIELD_OFFSET_START: f64 = 5.08;
const FIELD_OFFSET_INCR:  f64 = 2.54;

/// Generate the full `.kicad_sym` library text containing one component.
/// If appending to an existing library, use `generate_symbol_block` instead.
pub fn generate_library(info: &EeSymbolInfo, sym: &EeSymbol) -> String {
    let block = generate_symbol_block(info, sym);
    format!(
        "(kicad_symbol_lib\n  (version {SYM_VERSION})\n  (generator \"{GENERATOR}\")\n{block}\n)"
    )
}

/// Generate just the `(symbol "NAME" ...)` block — suitable for inserting into
/// an existing library file.
pub fn generate_symbol_block(info: &EeSymbolInfo, sym: &EeSymbol) -> String {
    let name = sanitize_name(&info.lcsc_id);
    let mut s = String::with_capacity(8192);

    s.push_str(&format!("  (symbol \"{name}\"\n"));
    s.push_str("    (in_bom yes)\n");
    s.push_str("    (on_board yes)\n");

    // ── Properties ──────────────────────────────────────────────────────────
    // Compute y_low / y_high from pin positions (matching Python)
    let (y_low, y_high) = if sym.pins.is_empty() {
        (0.0_f64, 0.0_f64)
    } else {
        let lo = sym.pins.iter().map(|p| p.y_mm).fold(f64::INFINITY, f64::min);
        let hi = sym.pins.iter().map(|p| p.y_mm).fold(f64::NEG_INFINITY, f64::max);
        (lo, hi)
    };

    let mut field_y = FIELD_OFFSET_START;

    // Reference — above the highest pin
    s.push_str(&make_prop("Reference", &info.prefix.replace('?', ""), y_high + field_y, false));

    // Value — below the lowest pin (use sanitized component title if available)
    let value_name = if !info.title.is_empty() {
        sanitize_component_name(&info.title)
    } else {
        name.clone()
    };
    s.push_str(&make_prop("Value", &value_name, y_low - field_y, false));

    // Footprint
    if !info.package.is_empty() {
        field_y += FIELD_OFFSET_INCR;
        s.push_str(&make_prop("Footprint", &format!("KiMaster:{name}"), y_low - field_y, true));
    }

    // Datasheet
    if !info.datasheet.is_empty() {
        field_y += FIELD_OFFSET_INCR;
        s.push_str(&make_prop("Datasheet", &info.datasheet, y_low - field_y, true));
    }

    // Manufacturer
    if !info.manufacturer.is_empty() {
        field_y += FIELD_OFFSET_INCR;
        s.push_str(&make_prop("Manufacturer", &info.manufacturer, y_low - field_y, true));
    }

    // MPN
    if !info.mpn.is_empty() {
        field_y += FIELD_OFFSET_INCR;
        s.push_str(&make_prop("MPN", &info.mpn, y_low - field_y, true));
    }

    // LCSC Part
    if !info.lcsc_id.is_empty() {
        field_y += FIELD_OFFSET_INCR;
        s.push_str(&make_prop("LCSC Part", &info.lcsc_id, y_low - field_y, true));
    }

    // Description
    if !info.description.is_empty() {
        field_y += FIELD_OFFSET_INCR;
        s.push_str(&make_prop("Description", &info.description, y_low - field_y, true));
    }

    // ki_keywords
    let keywords = build_keywords(info);
    if !keywords.is_empty() {
        field_y += FIELD_OFFSET_INCR;
        s.push_str(&make_prop("ki_keywords", &keywords, y_low - field_y, true));
    }

    // ── Sub-symbol blocks ────────────────────────────────────────────────────
    // Single-unit: one _0_1 block with geometry + pins (matches Python export).
    // Multi-unit:  per-unit _{N}_1 blocks (N=1,2,...), each sub-unit has its own
    //              geometry + pins. Matches Python integrate_sub_units().
    if sym.sub_units.is_empty() {
        // ── Single-unit: _0_1 with geometry + pins ──────────────────────────
        s.push_str(&format!("    (symbol \"{name}_0_1\"\n"));
        emit_geometry(&mut s, sym);
        emit_pins(&mut s, sym);
        s.push_str("    )\n"); // end _0_1
    } else {
        // ── Multi-unit: _{N}_1 per sub-unit ─────────────────────────────────
        for (i, sub) in sym.sub_units.iter().enumerate() {
            let unit_num = i + 1;
            s.push_str(&format!("    (symbol \"{name}_{unit_num}_1\"\n"));
            emit_geometry(&mut s, sub);
            emit_pins(&mut s, sub);
            s.push_str("    )\n"); // end _{N}_1
        }
    }

    s.push_str("  )\n"); // end symbol
    s
}

/// Emit all geometry (rectangles, circles, arcs, polylines, beziers, texts)
/// for a symbol unit into the output buffer.
fn emit_geometry(s: &mut String, sym: &EeSymbol) {
    // Rectangles
    for r in &sym.rectangles {
        s.push_str(&format!(
            "      (rectangle\n\
             \x20       (start {:.2} {:.2})\n\
             \x20       (end {:.2} {:.2})\n\
             \x20       (stroke (width 0) (type default))\n\
             \x20       (fill (type background))\n\
             \x20     )\n",
            r.x0_mm, r.y0_mm, r.x1_mm, r.y1_mm,
        ));
    }

    // Circles
    for c in &sym.circles {
        let fill = if c.filled { "background" } else { "none" };
        s.push_str(&format!(
            "      (circle\n\
             \x20       (center {:.2} {:.2})\n\
             \x20       (radius {:.2})\n\
             \x20       (stroke (width 0) (type default))\n\
             \x20       (fill (type {fill}))\n\
             \x20     )\n",
            c.cx_mm, c.cy_mm, c.r_mm,
        ));
    }

    // Arcs (start/mid/end format — KiCad 6+)
    for a in &sym.arcs {
        s.push_str(&format!(
            "      (arc\n\
             \x20       (start {:.2} {:.2})\n\
             \x20       (mid {:.2} {:.2})\n\
             \x20       (end {:.2} {:.2})\n\
             \x20       (stroke (width 0) (type default))\n\
             \x20       (fill (type none))\n\
             \x20     )\n",
            a.start_x, a.start_y,
            a.mid_x, a.mid_y,
            a.end_x, a.end_y,
        ));
    }

    // Polylines / Polygons
    for pl in &sym.polylines {
        if pl.points.len() < 2 { continue; }
        let fill = if pl.is_closed { "background" } else { "none" };
        s.push_str("      (polyline\n        (pts\n");
        for pt in &pl.points {
            s.push_str(&format!("          (xy {:.2} {:.2})\n", pt[0], pt[1]));
        }
        s.push_str("        )\n");
        s.push_str(&format!(
            "        (stroke (width 0) (type default))\n\
             \x20       (fill (type {fill}))\n\
             \x20     )\n"
        ));
    }

    // Bezier curves (KiCad 7+ format)
    for bz in &sym.beziers {
        if bz.points.len() < 2 { continue; }
        let fill = if bz.is_closed { "background" } else { "none" };
        let pts_str: String = bz.points.iter()
            .map(|p| format!("(xy {:.2} {:.2})", p[0], p[1]))
            .collect::<Vec<_>>()
            .join(" ");
        s.push_str(&format!(
            "      (bezier\n\
             \x20       (pts {pts_str})\n\
             \x20       (stroke (width 0) (type default))\n\
             \x20       (fill (type {fill}))\n\
             \x20     )\n"
        ));
    }

    // Texts
    for t in &sym.texts {
        let esc = t.text.replace('"', "\\\"");
        s.push_str(&format!(
            "      (text \"{esc}\"\n\
             \x20       (at {:.2} {:.2} {:.0})\n\
             \x20       (effects (font (size {:.2} {:.2})))\n\
             \x20     )\n",
            t.x_mm, t.y_mm, t.rotation,
            t.font_size_mm, t.font_size_mm,
        ));
    }
}

/// Emit all pins for a symbol unit into the output buffer.
fn emit_pins(s: &mut String, sym: &EeSymbol) {
    for pin in &sym.pins {
        s.push_str(&generate_pin(pin));
    }
}

/// Generate a property S-expression.
fn make_prop(key: &str, value: &str, y: f64, hide: bool) -> String {
    let esc_val = value.replace('\\', "\\\\").replace('"', "\\\"");
    let hide_str = if hide { " hide" } else { "" };
    format!(
        "    (property \"{key}\" \"{esc_val}\"\n\
         \x20     (at 0 {y:.2} 0)\n\
         \x20     (effects (font (size {PROP_FONT_SIZE} {PROP_FONT_SIZE})){hide_str})\n\
         \x20   )\n"
    )
}

/// Generate a pin S-expression.
/// Matches Python: KiSymbolPin.export() — pin orientation offset by 180°.
fn generate_pin(pin: &super::EdaParser::EePin) -> String {
    let pin_type   = pin.pin_type.to_kicad();
    let pin_style  = pin.pin_style.to_kicad();
    let esc_name   = apply_pin_name_style(&pin.name);
    let esc_number = pin.number.replace('"', "\\\"");

    // KiCad pin orientation is offset by 180° from EasyEDA's convention
    let rot = ((180.0 + pin.rotation) % 360.0) as i32;

    format!(
        "      (pin {pin_type} {pin_style}\n\
         \x20       (at {:.2} {:.2} {rot})\n\
         \x20       (length {:.2})\n\
         \x20       (name \"{esc_name}\" (effects (font (size {PIN_NAME_SIZE} {PIN_NAME_SIZE}))))\n\
         \x20       (number \"{esc_number}\" (effects (font (size {PIN_NUM_SIZE} {PIN_NUM_SIZE}))))\n\
         \x20     )\n",
        pin.x_mm, pin.y_mm, pin.length_mm,
    )
}

/// Apply pin name text style: names ending with "#" become KiCad overbar notation.
/// Split by "/" to handle multi-function pins (e.g. "GPIO/SDA#").
fn apply_pin_name_style(name: &str) -> String {
    name.split('/')
        .map(|part| {
            if part.ends_with('#') {
                format!("~{{{}}}", &part[..part.len() - 1])
            } else {
                part.to_string()
            }
        })
        .collect::<Vec<_>>()
        .join("/")
        .replace('"', "\\\"")
}

/// Sanitize a component name for use as a KiCad symbol identifier.
fn sanitize_name(name: &str) -> String {
    name.replace(' ', "").replace('/', "_").replace(':', "_")
}

/// Strip parenthesized or bracketed suffixes from a component title.
/// Matches Python: `_sanitize_component_name()` in easyeda_importer.py.
/// e.g. "LM358 (SOIC-8)" → "LM358", "ATmega328P[QFP-32]" → "ATmega328P"
fn sanitize_component_name(name: &str) -> String {
    let name = name.trim();
    let name = if let Some(idx) = name.find('(') {
        name[..idx].trim()
    } else {
        name
    };
    let name = if let Some(idx) = name.find('[') {
        name[..idx].trim()
    } else {
        name
    };
    name.to_string()
}

/// Build ki_keywords string from component metadata.
/// Matches Python: EeSymbolInfo.keywords generation.
fn build_keywords(info: &EeSymbolInfo) -> String {
    let mut parts = Vec::new();
    if !info.lcsc_id.is_empty()      { parts.push(info.lcsc_id.clone()); }
    if !info.manufacturer.is_empty() { parts.push(info.manufacturer.clone()); }
    if !info.mpn.is_empty()          { parts.push(info.mpn.clone()); }
    if !info.package.is_empty()      { parts.push(info.package.clone()); }
    parts.join(" ")
}
