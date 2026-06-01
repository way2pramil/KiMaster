//! PostProcessor — user-configurable transformations applied to parsed EDA data
//! before KiCad file generation.
//!
//! Config is serialised as JSON and passed from the frontend per add-to-vault call.

use serde::{Deserialize, Serialize};
use super::EdaParser::{EeSymbol, PinType};

// ── Config ────────────────────────────────────────────────────────────────────

/// Complete post-processing configuration.
/// All fields have defaults matching KiMaster's recommended settings.
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(default)]
pub struct PostProcessConfig {
    // ── Pin geometry ──────────────────────────────────────────────────────────
    /// Override every pin electrical type. "passive" | "unspecified" | "keep"
    pub pin_type:             String,
    /// Pin stub length in mils (100 | 150 | 200 | 250 | 300).
    pub pin_length_mil:       u32,
    /// Pin number label font size in mils (30 | 40 | 50).
    pub pin_number_size_mil:  u32,
    /// Pin name label font size in mils (30 | 40 | 50).
    pub pin_name_size_mil:    u32,

    // ── Symbol identity ───────────────────────────────────────────────────────
    /// KiCad symbol name source. "mpn" | "lcsc"
    pub symbol_name_source:   String,
    /// How to name the footprint file/reference. "package" | "lcsc"
    pub footprint_naming:     String,

    // ── Fields to include ─────────────────────────────────────────────────────
    pub field_description:    bool,
    pub field_datasheet:      bool,
    pub field_manufacturer:   bool,
    pub field_mpn:            bool,
    pub field_package:        bool,
    pub field_lcsc_part:      bool,
    pub field_price:          bool,
    pub field_stock:          bool,
    pub field_dnp_status:     bool,
    pub field_notes:          bool,
}

impl Default for PostProcessConfig {
    fn default() -> Self {
        Self {
            pin_type:             "passive".to_string(),
            pin_length_mil:       200,
            pin_number_size_mil:  50,
            pin_name_size_mil:    50,
            symbol_name_source:   "mpn".to_string(),
            footprint_naming:     "lcsc".to_string(),
            field_description:    true,
            field_datasheet:      true,
            field_manufacturer:   true,
            field_mpn:            true,
            field_package:        true,
            field_lcsc_part:      true,
            field_price:          true,
            field_stock:          true,
            field_dnp_status:     false,
            field_notes:          false,
        }
    }
}

// ── Helpers ───────────────────────────────────────────────────────────────────

/// Convert mils to KiCad millimetres.
pub fn mil_to_mm(mil: u32) -> f64 {
    f64::from(mil.clamp(10, 1000)) * 0.0254
}

// ── Apply ─────────────────────────────────────────────────────────────────────

/// Apply pin-level post-processing to a symbol (and all sub-units recursively).
///
/// When pin length changes, the external connection point is moved outward so that
/// the body-edge end of the stub stays at its original position.  This prevents
/// the stub from overlapping or leaving a gap with the symbol body rectangle.
pub fn apply_to_symbol(sym: &mut EeSymbol, cfg: &PostProcessConfig) {
    let new_length = mil_to_mm(cfg.pin_length_mil);
    let override_type = match cfg.pin_type.as_str() {
        "passive"     => Some(PinType::Passive),
        "unspecified" => Some(PinType::Unspecified),
        _             => None, // "keep" — no override
    };

    const GRID: f64 = 1.27;

    for pin in &mut sym.pins {
        if let Some(t) = override_type {
            pin.pin_type = t;
        }

        // Adjust connection-point position so the body edge stays fixed.
        //
        // KiCad pin convention (after the +180° rotation offset applied in emit_pins):
        //   - rotation=0°  : stub goes in +x direction from connection point
        //   - rotation=90° : stub goes in +y direction
        //   - rotation=180°: stub goes in -x direction
        //   - rotation=270°: stub goes in -y direction
        //
        // body_edge = connection + KiCad_direction × old_length
        // new_connection = body_edge − KiCad_direction × new_length
        //                = connection + KiCad_direction × (old_length − new_length)
        if (pin.length_mm - new_length).abs() > 1e-6 {
            let delta = pin.length_mm - new_length;
            // KiCad rotation = EasyEDA rotation + 180° (as applied in emit_pins)
            let kicad_rot_rad = ((pin.rotation + 180.0) % 360.0).to_radians();
            pin.x_mm += kicad_rot_rad.cos() * delta;
            pin.y_mm += kicad_rot_rad.sin() * delta;
            // Snap back to 1.27 mm (50-mil) grid
            pin.x_mm = (pin.x_mm / GRID).round() * GRID;
            pin.y_mm = (pin.y_mm / GRID).round() * GRID;
        }

        pin.length_mm = new_length;
    }

    for sub in &mut sym.sub_units {
        apply_to_symbol(sub, cfg);
    }
}

/// Derive the KiCad symbol name from component data + config.
pub fn symbol_name(mpn: &str, lcsc_id: &str, cfg: &PostProcessConfig) -> String {
    let raw = match cfg.symbol_name_source.as_str() {
        "mpn" if !mpn.is_empty() => mpn,
        _                         => lcsc_id,
    };
    sanitize_name(raw)
}

/// Derive the footprint stem (used for both the .kicad_mod filename and the
/// symbol's Footprint property).
pub fn footprint_stem(package: &str, lcsc_id: &str, cfg: &PostProcessConfig) -> String {
    match cfg.footprint_naming.as_str() {
        "package" if !package.is_empty() => sanitize_fp_name(package),
        _                                 => lcsc_id.to_string(),
    }
}

/// Sanitise a string for use as a KiCad symbol identifier.
pub fn sanitize_name(s: &str) -> String {
    s.trim()
        .replace(' ', "_")
        .replace('/', "_")
        .replace(':', "_")
        .replace('\\', "_")
}

/// Sanitise a package name for use as a footprint filename stem.
/// Keeps hyphens and dots (common in package names like SOT-23-6).
pub fn sanitize_fp_name(s: &str) -> String {
    s.trim()
        .chars()
        .map(|c| if c.is_alphanumeric() || "-_.".contains(c) { c } else { '_' })
        .collect()
}
