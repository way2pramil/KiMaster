//! KiSymGenerator — generates KiCad `.kicad_sym` S-expression text.
//!
//! Accepts a `PostProcessConfig` to control:
//!   - Symbol name (MPN vs LCSC ID)
//!   - Which fields to emit
//!   - Pin text sizes
//!   - Field placement

use super::EdaParser::{EeSymbol, EeSymbolInfo};
use super::PostProcessor::{PostProcessConfig, mil_to_mm};

// ── Defaults ──────────────────────────────────────────────────────────────────

const PROP_FONT_SIZE: f64 = 1.27;   // 50 mil
const FIELD_Y_ABOVE: f64  = 5.08;   // distance above symbol for Reference
const FIELD_Y_STEP:  f64  = 2.54;   // vertical gap between hidden fields below symbol

/// Extra component data that post-processing adds beyond the core EeSymbolInfo.
#[derive(Debug, Default)]
pub struct SymbolExtras {
    pub description: String,
    pub price:       f64,
    pub stock:       i64,
}

/// Generate just the `(symbol "NAME" ...)` block for inserting into an existing library.
///
/// `sym_name` — the KiCad symbol identifier (MPN or LCSC, pre-computed by PostProcessor).
/// `fp_stem`  — the .kicad_mod filename stem used in the Footprint property.
pub fn generate_symbol_block(
    info:     &EeSymbolInfo,
    sym:      &EeSymbol,
    extras:   &SymbolExtras,
    cfg:      &PostProcessConfig,
    sym_name: &str,
    fp_stem:  &str,
) -> String {
    let sym_id = sym_name;

    // Text sizes from config
    let num_sz  = mil_to_mm(cfg.pin_number_size_mil);
    let name_sz = mil_to_mm(cfg.pin_name_size_mil);

    // Bounding box from pins (used for field placement)
    let (pin_y_min, pin_y_max) = pin_y_range(sym);

    let mut s = String::with_capacity(16384);

    s.push_str(&format!("  (symbol \"{sym_id}\"\n"));
    s.push_str("    (in_bom yes)\n");
    s.push_str("    (on_board yes)\n");

    // ── Properties ───────────────────────────────────────────────────────────
    emit_fields(&mut s, info, extras, cfg, sym_id, fp_stem, pin_y_min, pin_y_max);

    // ── Sub-symbol bodies ─────────────────────────────────────────────────────
    if sym.sub_units.is_empty() {
        // Single unit: _0_1
        s.push_str(&format!("    (symbol \"{sym_id}_0_1\"\n"));
        emit_geometry(&mut s, sym);
        emit_pins(&mut s, sym, num_sz, name_sz);
        s.push_str("    )\n");
    } else {
        // Multi-unit: _{N}_1 per sub-unit
        for (i, sub) in sym.sub_units.iter().enumerate() {
            let unit_num = i + 1;
            s.push_str(&format!("    (symbol \"{sym_id}_{unit_num}_1\"\n"));
            emit_geometry(&mut s, sub);
            emit_pins(&mut s, sub, num_sz, name_sz);
            s.push_str("    )\n");
        }
    }

    s.push_str("  )\n");
    s
}

/// Compatibility wrapper — uses default PostProcessConfig.
pub fn generate_symbol_block_default(info: &EeSymbolInfo, sym: &EeSymbol) -> String {
    let sym_name = super::PostProcessor::symbol_name(&info.mpn, &info.lcsc_id, &PostProcessConfig::default());
    let fp_stem  = info.lcsc_id.clone();
    generate_symbol_block(info, sym, &SymbolExtras::default(), &PostProcessConfig::default(), &sym_name, &fp_stem)
}

// ── Field emitter ─────────────────────────────────────────────────────────────

fn emit_fields(
    s:         &mut String,
    info:      &EeSymbolInfo,   // carries REAL lcsc_id, mpn, package, etc.
    extras:    &SymbolExtras,
    cfg:       &PostProcessConfig,
    sym_id:    &str,            // KiCad symbol identifier (MPN or LCSC)
    fp_stem:   &str,            // .kicad_mod filename stem
    pin_y_min: f64,
    pin_y_max: f64,
) {
    // Reference — above the symbol body
    prop(s, "Reference", &info.prefix.trim_end_matches('?'), pin_y_max + FIELD_Y_ABOVE, false);

    // Value — uses sanitised component title
    let value_str = if !info.title.is_empty() {
        sanitize_component_name(&info.title)
    } else {
        sym_id.to_string()
    };
    prop(s, "Value", &value_str, pin_y_min - FIELD_Y_ABOVE, false);

    // Hidden fields below the symbol — equally spaced
    // We build a list first, then emit, to avoid closure borrow issues.
    let mut hidden: Vec<(&str, String)> = Vec::with_capacity(16);

    // Footprint — uses fp_stem so it matches the actual .kicad_mod filename
    hidden.push(("Footprint", format!("KiMaster:{fp_stem}")));

    if cfg.field_datasheet    { hidden.push(("Datasheet",    info.datasheet.clone())); }
    if cfg.field_description  { hidden.push(("Description",  extras.description.clone())); }
    if cfg.field_manufacturer { hidden.push(("Manufacturer", info.manufacturer.clone())); }
    if cfg.field_mpn          { hidden.push(("MPN",          info.mpn.clone())); }
    if cfg.field_package      { hidden.push(("Package",      info.package.clone())); }

    // LCSC Part # always uses the REAL lcsc_id (never sym_id / MPN)
    if cfg.field_lcsc_part { hidden.push(("LCSC Part #", info.lcsc_id.clone())); }

    // Price / Stock — emit even if zero so the field exists for manual editing
    if cfg.field_price {
        let v = if extras.price > 0.0 { format!("{:.4}", extras.price) } else { String::new() };
        hidden.push(("Price", v));
    }
    if cfg.field_stock {
        let v = if extras.stock > 0 { extras.stock.to_string() } else { String::new() };
        hidden.push(("Stock", v));
    }

    // DNP Status / Note(s) — blank placeholder field
    if cfg.field_dnp_status { hidden.push(("DNP Status", String::new())); }
    if cfg.field_notes      { hidden.push(("Note(s)",    String::new())); }

    // ki_keywords
    let keywords = build_keywords(info);
    if !keywords.is_empty() { hidden.push(("ki_keywords", keywords)); }

    // Emit all hidden fields with equal vertical spacing
    let mut field_y = pin_y_min - FIELD_Y_ABOVE - FIELD_Y_STEP;
    for (key, val) in &hidden {
        prop(s, key, val, field_y, true);
        field_y -= FIELD_Y_STEP;
    }
}

// ── Geometry emitter ──────────────────────────────────────────────────────────

fn emit_geometry(s: &mut String, sym: &EeSymbol) {
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

    for a in &sym.arcs {
        s.push_str(&format!(
            "      (arc\n\
             \x20       (start {:.2} {:.2})\n\
             \x20       (mid {:.2} {:.2})\n\
             \x20       (end {:.2} {:.2})\n\
             \x20       (stroke (width 0) (type default))\n\
             \x20       (fill (type none))\n\
             \x20     )\n",
            a.start_x, a.start_y, a.mid_x, a.mid_y, a.end_x, a.end_y,
        ));
    }

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

    for bz in &sym.beziers {
        if bz.points.len() < 2 { continue; }
        let fill = if bz.is_closed { "background" } else { "none" };
        let pts: String = bz.points.iter()
            .map(|p| format!("(xy {:.2} {:.2})", p[0], p[1]))
            .collect::<Vec<_>>().join(" ");
        s.push_str(&format!(
            "      (bezier\n\
             \x20       (pts {pts})\n\
             \x20       (stroke (width 0) (type default))\n\
             \x20       (fill (type {fill}))\n\
             \x20     )\n"
        ));
    }

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

fn emit_pins(s: &mut String, sym: &EeSymbol, num_sz: f64, name_sz: f64) {
    for pin in &sym.pins {
        let pin_type  = pin.pin_type.to_kicad();
        let pin_style = pin.pin_style.to_kicad();
        let esc_name  = apply_overbar(&pin.name).replace('"', "\\\"");
        let esc_num   = pin.number.replace('"', "\\\"");
        let rot       = ((180.0 + pin.rotation) % 360.0) as i32;

        s.push_str(&format!(
            "      (pin {pin_type} {pin_style}\n\
             \x20       (at {:.2} {:.2} {rot})\n\
             \x20       (length {:.2})\n\
             \x20       (name \"{esc_name}\" (effects (font (size {name_sz:.2} {name_sz:.2}))))\n\
             \x20       (number \"{esc_num}\" (effects (font (size {num_sz:.2} {num_sz:.2}))))\n\
             \x20     )\n",
            pin.x_mm, pin.y_mm, pin.length_mm,
        ));
    }
}

// ── Helpers ───────────────────────────────────────────────────────────────────

fn prop(s: &mut String, key: &str, value: &str, y: f64, hide: bool) {
    let esc = value.replace('\\', "\\\\").replace('"', "\\\"");
    let hide_str = if hide { " hide" } else { "" };
    // Hidden fields use left-justify so long values extend rightward from the anchor
    // rather than overlapping the symbol body on the left side.
    let justify = if hide { "\n       (justify left)" } else { "" };
    s.push_str(&format!(
        "    (property \"{key}\" \"{esc}\"\n\
         \x20     (at 0 {y:.4} 0)\n\
         \x20     (effects (font (size {PROP_FONT_SIZE} {PROP_FONT_SIZE})){justify}{hide_str})\n\
         \x20   )\n"
    ));
}

/// Return (y_min, y_max) across all pins in the symbol (including sub-units).
fn pin_y_range(sym: &EeSymbol) -> (f64, f64) {
    let mut all_y: Vec<f64> = sym.pins.iter().map(|p| p.y_mm).collect();
    for sub in &sym.sub_units {
        all_y.extend(sub.pins.iter().map(|p| p.y_mm));
    }
    if all_y.is_empty() {
        (-2.54, 2.54)
    } else {
        let lo = all_y.iter().cloned().fold(f64::INFINITY, f64::min);
        let hi = all_y.iter().cloned().fold(f64::NEG_INFINITY, f64::max);
        (lo, hi)
    }
}

fn apply_overbar(name: &str) -> String {
    name.split('/').map(|part| {
        if part.ends_with('#') {
            format!("~{{{}}}", &part[..part.len() - 1])
        } else {
            part.to_string()
        }
    }).collect::<Vec<_>>().join("/")
}

fn sanitize_component_name(name: &str) -> String {
    let name = if let Some(i) = name.find('(') { name[..i].trim() } else { name.trim() };
    let name = if let Some(i) = name.find('[') { name[..i].trim() } else { name };
    name.to_string()
}

fn build_keywords(info: &EeSymbolInfo) -> String {
    let mut parts = Vec::new();
    if !info.lcsc_id.is_empty()      { parts.push(info.lcsc_id.clone()); }
    if !info.manufacturer.is_empty() { parts.push(info.manufacturer.clone()); }
    if !info.mpn.is_empty()          { parts.push(info.mpn.clone()); }
    if !info.package.is_empty()      { parts.push(info.package.clone()); }
    parts.join(" ")
}
