//! EdaParser — pure Rust parser for EasyEDA component data.
//!
//! Matches the reference Python implementation at easyeda2kicad.py one-to-one.
//!
//! EasyEDA data comes as an array of tilde-delimited record strings (the `shape` array
//! inside the `dataStr` JSON object from the API).
//!
//! Symbol record types: P (pin), R (rect), PL (polyline), PG (polygon),
//!   PT (path), C (circle), E (ellipse), A (arc), T (text)
//!
//! Footprint record types: PAD, TRACK, ARC, CIRCLE, HOLE, VIA, RECT,
//!   SOLIDREGION, TEXT, SVGNODE
//!
//! Coordinate conversion: EasyEDA pixels → KiCad mm
//!   `mm = px × 10 × 0.0254`
//! Symbol grid snap: snap to 1.27mm (= 50mil = 5px) grid for KiCad pin alignment.

use std::f64::consts::PI;

// ── Coordinate conversion ─────────────────────────────────────────────────────

/// Convert EasyEDA pixel value to KiCad millimetres (symbol space).
/// Matches Python: `px_to_mm(dim) = 10.0 * float(dim) * 0.0254`
#[inline]
pub fn px_to_mm(px: f64) -> f64 {
    10.0 * px * 0.0254
}

/// Convert a pixel value and snap it to the nearest KiCad 50-mil (1.27mm) grid.
/// Matches Python: `px_to_mm_grid(dim, grid=1.27)`
#[inline]
pub fn px_to_mm_grid(px: f64) -> f64 {
    let mm = px_to_mm(px);
    let grid = 1.27_f64;
    (mm / grid).round() * grid
}

/// Convert EasyEDA footprint pixel to KiCad mm.
/// Matches Python: `convert_to_mm(dim) = round(float(dim) * 10 * 0.0254, 6)`
#[inline]
pub fn fp_to_mm(px: f64) -> f64 {
    (px * 10.0 * 0.0254 * 1e6).round() / 1e6
}

/// Parse a field as f64, returning 0.0 on error.
#[inline]
fn pf(s: &str) -> f64 {
    s.trim().parse::<f64>().unwrap_or(0.0)
}

/// Parse a field as i32, returning 0 on error.
#[inline]
fn pi(s: &str) -> i32 {
    s.trim().parse::<f64>().map(|v| v as i32).unwrap_or(0)
}

/// Parse a bool field (EasyEDA uses "0"/"1"/"true"/"false"/"show").
#[inline]
fn pb(s: &str) -> bool {
    let s = s.trim().to_lowercase();
    matches!(s.as_str(), "1" | "true" | "yes" | "on" | "show")
}

// ── Symbol types ──────────────────────────────────────────────────────────────

#[derive(Debug, Clone)]
pub struct EeSymbolInfo {
    pub lcsc_id:      String,
    pub title:        String,
    pub package:      String,
    pub datasheet:    String,
    pub manufacturer: String,
    pub mpn:          String,
    pub prefix:       String,
    pub description:  String,
}

/// EasyEDA pin type → KiCad pin electrical type.
/// Matches Python: EasyedaPinType enum (0..4).
#[derive(Debug, Clone, Copy, PartialEq)]
pub enum PinType {
    Unspecified,
    Input,
    Output,
    Bidirectional,
    Power,
}

impl PinType {
    pub fn from_code(code: i32) -> Self {
        match code {
            1 => Self::Input,
            2 => Self::Output,
            3 => Self::Bidirectional,
            4 => Self::Power,
            _ => Self::Unspecified,
        }
    }

    pub fn to_kicad(&self) -> &'static str {
        match self {
            Self::Input         => "input",
            Self::Output        => "output",
            Self::Bidirectional => "bidirectional",
            Self::Power         => "power_in",
            Self::Unspecified   => "unspecified",
        }
    }
}

/// KiCad pin graphical style.
/// Matches Python: KiPinStyle enum.
#[derive(Debug, Clone, Copy, PartialEq)]
pub enum PinStyle {
    Line,
    Inverted,
    Clock,
    InvertedClock,
}

impl PinStyle {
    pub fn to_kicad(&self) -> &'static str {
        match self {
            Self::Line          => "line",
            Self::Inverted      => "inverted",
            Self::Clock         => "clock",
            Self::InvertedClock => "inverted_clock",
        }
    }
}

#[derive(Debug, Clone)]
pub struct EePin {
    /// Pin number label (KiCad electrical number — from segment 4, field 4).
    pub number:    String,
    /// Pin name label (from segment 3, field 4).
    pub name:      String,
    pub pin_type:  PinType,
    pub pin_style: PinStyle,
    /// Position in KiCad mm (origin subtracted, Y negated).
    pub x_mm:      f64,
    pub y_mm:      f64,
    /// Rotation in degrees (0=right, 90=up, 180=left, 270=down).
    pub rotation:  f64,
    /// Pin stub length in mm.
    pub length_mm: f64,
}

#[derive(Debug, Clone)]
pub struct EeRectangle {
    pub x0_mm: f64,
    pub y0_mm: f64,
    pub x1_mm: f64,
    pub y1_mm: f64,
}

#[derive(Debug, Clone)]
pub struct EePolyline {
    /// List of (x_mm, y_mm) pairs.
    pub points:    Vec<[f64; 2]>,
    pub is_closed: bool,
}

#[derive(Debug, Clone)]
pub struct EeCircle {
    pub cx_mm:  f64,
    pub cy_mm:  f64,
    pub r_mm:   f64,
    pub filled: bool,
}

/// SVG arc parsed into KiCad start/mid/end representation.
/// Matches Python: KiSymbolArc with start/middle/end.
#[derive(Debug, Clone)]
pub struct EeArc {
    pub start_x:  f64,
    pub start_y:  f64,
    pub mid_x:    f64,
    pub mid_y:    f64,
    pub end_x:    f64,
    pub end_y:    f64,
}

/// Bezier curve — 4 control points [start, cp1, cp2, end].
/// Matches Python: KiSymbolBezier.
#[derive(Debug, Clone)]
pub struct EeBezier {
    pub points:    Vec<[f64; 2]>,
    pub is_closed: bool,
}

#[derive(Debug, Clone)]
pub struct EeText {
    pub x_mm:         f64,
    pub y_mm:         f64,
    pub text:         String,
    pub font_size_mm: f64,
    pub rotation:     f64,
}

/// Parsed EasyEDA symbol — all geometry in KiCad mm, origin at (0,0).
#[derive(Debug, Clone, Default)]
pub struct EeSymbol {
    pub pins:       Vec<EePin>,
    pub rectangles: Vec<EeRectangle>,
    pub polylines:  Vec<EePolyline>,
    pub circles:    Vec<EeCircle>,
    pub arcs:       Vec<EeArc>,
    pub beziers:    Vec<EeBezier>,
    pub texts:      Vec<EeText>,
    /// Sub-units for multi-unit symbols (e.g. dual op-amp).
    /// Empty for single-unit components.
    pub sub_units:  Vec<EeSymbol>,
}

// ── Footprint types ───────────────────────────────────────────────────────────

/// Pad type.
#[derive(Debug, Clone, PartialEq)]
pub enum PadType { Smd, ThroughHole }

/// Pad shape.
#[derive(Debug, Clone, PartialEq)]
pub enum PadShape { Circle, Rect, Oval, Custom }

#[derive(Debug, Clone)]
pub struct EePad {
    pub number:      String,
    pub pad_type:    PadType,
    pub pad_shape:   PadShape,
    /// Position in KiCad mm (origin subtracted).
    pub x_mm:        f64,
    pub y_mm:        f64,
    pub w_mm:        f64,
    pub h_mm:        f64,
    /// Drill diameter (0 for SMD).
    pub drill_mm:    f64,
    /// Drill slot length (0 for circular drill).
    pub slot_mm:     f64,
    pub rotation:    f64,
    /// KiCad layer string (e.g. "F.Cu F.Paste F.Mask").
    pub layers:      String,
    /// Custom polygon points (relative to pad centre) as "(xy x y)(xy x y)..." string.
    pub polygon:     String,
}

#[derive(Debug, Clone)]
pub struct EeTrack {
    pub x1_mm:     f64,
    pub y1_mm:     f64,
    pub x2_mm:     f64,
    pub y2_mm:     f64,
    pub layer:     String,
    pub width_mm:  f64,
}

#[derive(Debug, Clone)]
pub struct EeHole {
    pub x_mm:  f64,
    pub y_mm:  f64,
    pub r_mm:  f64,
}

#[derive(Debug, Clone)]
pub struct EeVia {
    pub x_mm:      f64,
    pub y_mm:      f64,
    pub r_mm:      f64,
    pub diam_mm:   f64,
}

#[derive(Debug, Clone)]
pub struct EeFpCircle {
    pub cx_mm:    f64,
    pub cy_mm:    f64,
    pub r_mm:     f64,
    pub layer:    String,
    pub width_mm: f64,
}

#[derive(Debug, Clone)]
pub struct EeFpArc {
    pub cx:         f64,
    pub cy:         f64,
    pub end_x:      f64,
    pub end_y:      f64,
    pub angle:      f64,
    pub layer:      String,
    pub width_mm:   f64,
}

#[derive(Debug, Clone)]
pub struct EeFpText {
    pub x_mm:         f64,
    pub y_mm:         f64,
    pub text:         String,
    pub layer:        String,
    pub font_size_mm: f64,
    pub rotation:     f64,
    pub is_displayed: bool,
    pub mirror:       bool,
    pub text_type:    String,
}

#[derive(Debug, Clone)]
pub struct EeFpSolidRegion {
    pub points: Vec<(f64, f64)>,
    pub layer:  String,
}

/// 3D model metadata parsed from a footprint SVGNODE record.
/// Matches Python: `Ee3dModel` / `Easyeda3dModelImporter`.
#[derive(Debug, Clone)]
pub struct Ee3dModel {
    /// Display name of the 3D model (used as filename stem).
    pub name: String,
    /// UUID used to fetch the STEP file from the EasyEDA CDN.
    pub uuid: String,
    /// Translation offset in mm [x, y, z].
    pub translation: [f64; 3],
    /// Rotation in degrees [x, y, z] — already converted: (360-orig)%360.
    pub rotation: [f64; 3],
}

/// Parsed EasyEDA footprint — all geometry in KiCad mm, centred on head origin.
#[derive(Debug, Clone, Default)]
pub struct EeFootprint {
    pub pads:     Vec<EePad>,
    pub tracks:   Vec<EeTrack>,
    pub holes:    Vec<EeHole>,
    pub vias:     Vec<EeVia>,
    pub circles:  Vec<EeFpCircle>,
    pub arcs:     Vec<EeFpArc>,
    pub texts:    Vec<EeFpText>,
    pub regions:  Vec<EeFpSolidRegion>,
    /// "smd" | "through_hole"
    pub fp_type:  String,
    /// 3D model info from SVGNODE. None if no 3D model available.
    pub model_3d: Option<Ee3dModel>,
}

// ── Layer mapping (matches Python KI_LAYERS / KI_PAD_LAYER) ──────────────────

fn layer_id_to_kicad(id: i32) -> &'static str {
    match id {
        1  => "F.Cu",
        2  => "B.Cu",
        3  => "F.SilkS",
        4  => "B.SilkS",
        5  => "F.Paste",
        6  => "B.Paste",
        7  => "F.Mask",
        8  => "B.Mask",
        10 => "Edge.Cuts",
        12 => "Cmts.User",
        13 => "F.Fab",
        14 => "B.Fab",
        15 => "Dwgs.User",
        99 => "F.CrtYd",
        100=> "F.Fab",
        101=> "F.SilkS",
        _  => "F.Fab",
    }
}

/// SMD pad layers by EasyEDA layer_id.
fn smd_layers(layer_id: i32) -> &'static str {
    match layer_id {
        1  => "F.Cu F.Paste F.Mask",
        2  => "B.Cu B.Paste B.Mask",
        3  => "F.SilkS",
        11 => "*.Cu *.Paste *.Mask",
        13 => "F.Fab",
        15 => "Dwgs.User",
        _  => "F.Cu F.Paste F.Mask",
    }
}

/// Through-hole pad layers by EasyEDA layer_id (no paste).
fn tht_layers(layer_id: i32) -> &'static str {
    match layer_id {
        1  => "F.Cu F.Mask",
        2  => "B.Cu B.Mask",
        3  => "F.SilkS",
        11 => "*.Cu *.Mask",
        13 => "F.Fab",
        15 => "Dwgs.User",
        _  => "*.Cu *.Mask",
    }
}

/// Solid region layers that should be imported (matches Python _SOLID_REGION_LAYERS).
fn is_solid_region_layer(id: i32) -> bool {
    matches!(id, 3 | 4 | 13 | 14 | 99)
}

// ══════════════════════════════════════════════════════════════════════════════
//  SYMBOL PARSER
// ══════════════════════════════════════════════════════════════════════════════

/// Snap bbox origin to the nearest 5px boundary (= 1.27mm = 50mil grid).
/// Matches Python: `snap_bbox()` in export_kicad_symbol.py.
fn snap_bbox(x: f64, y: f64) -> (f64, f64) {
    let grid = 5.0_f64;
    ((x / grid).round() * grid, (y / grid).round() * grid)
}

/// Compute the symbol origin from bbox/head data.
/// Matches Python: `EasyedaSymbolImporter._extract_unit()` origin logic.
pub fn compute_symbol_origin(
    head_x: f64, head_y: f64,
    bbox_x: f64, bbox_y: f64,
    bbox_w: f64, bbox_h: f64,
) -> (f64, f64) {
    if bbox_w > 0.0 || bbox_h > 0.0 {
        // BBox present with dimensions → use center
        (bbox_x + bbox_w / 2.0, bbox_y + bbox_h / 2.0)
    } else if bbox_x != 0.0 || bbox_y != 0.0 {
        // BBox present but no width/height → use BBox x/y directly
        (bbox_x, bbox_y)
    } else {
        // No BBox → use head origin
        (head_x, head_y)
    }
}

/// Parse an EasyEDA symbol from a shape array.
///
/// `origin_x/y` are the raw pixel origin (from `compute_symbol_origin`).
/// They are snapped to 5px grid before use (matching Python `snap_bbox`).
/// All coordinates are converted to KiCad mm with Y-axis negated.
pub fn parse_symbol(shapes: &[String], origin_x: f64, origin_y: f64) -> EeSymbol {
    let (ox, oy) = snap_bbox(origin_x, origin_y);
    let mut sym = EeSymbol::default();

    for line in shapes {
        let line = line.trim();
        if line.is_empty() { continue; }

        let designator = line.split('~').next().unwrap_or("");
        match designator {
            "P"  => parse_sym_pin(line, &mut sym, ox, oy),
            "R"  => parse_sym_rect(line, &mut sym, ox, oy),
            "PL" => parse_sym_polyline(line, &mut sym, ox, oy, false),
            "PG" => parse_sym_polygon(line, &mut sym, ox, oy),
            "PT" => parse_sym_path(line, &mut sym, ox, oy),
            "C"  => parse_sym_circle(line, &mut sym, ox, oy),
            "E"  => parse_sym_ellipse(line, &mut sym, ox, oy),
            "A"  => parse_sym_arc(line, &mut sym, ox, oy),
            "T"  => parse_sym_text(line, &mut sym, ox, oy),
            _    => {} // SVGNODE, etc — not relevant for symbol
        }
    }
    sym
}

// ── Symbol: Pin ──────────────────────────────────────────────────────────────

fn parse_sym_pin(line: &str, sym: &mut EeSymbol, ox: f64, oy: f64) {
    // Format: P~settings^^dot^^path^^name^^num^^dot_bis^^clock
    // Split off the "P~" prefix, then split by "^^"
    let after_p = match line.find('~') {
        Some(i) => &line[i + 1..],
        None => return,
    };
    let segments: Vec<Vec<&str>> = after_p
        .split("^^")
        .map(|seg| seg.split('~').collect())
        .collect();

    // settings: [visibility, type, spice_pin_number, pos_x, pos_y, rotation, id, is_locked]
    let settings = segments.first().cloned().unwrap_or_default();
    // name segment [3]: [is_displayed, pos_x, pos_y, rotation, text, ...]
    let name_seg = segments.get(3).cloned().unwrap_or_default();
    // num segment [4]: [show, x, y, rotation, number, ...]
    let num_seg  = segments.get(4).cloned().unwrap_or_default();
    // dot_bis segment [5]: [is_displayed, circle_x, circle_y]
    let dot_bis  = segments.get(5).cloned().unwrap_or_default();
    // clock segment [6]: [is_displayed, path]
    let clock_seg = segments.get(6).cloned().unwrap_or_default();

    // Pin electrical type from settings[1]
    let pin_type_code = settings.get(1).map(|s| pf(s) as i32).unwrap_or(0);
    let pin_type = PinType::from_code(pin_type_code);

    // Position from settings[3], settings[4] — grid-snapped
    let pos_x = settings.get(3).map(|s| px_to_mm_grid(pf(s) - ox)).unwrap_or(0.0);
    let pos_y = settings.get(4).map(|s| -px_to_mm_grid(pf(s) - oy)).unwrap_or(0.0);
    let rotation = settings.get(5).map(|s| pf(s)).unwrap_or(0.0);

    // Pin name from name_seg[4]
    let name = name_seg.get(4).map(|s| s.replace(' ', "")).unwrap_or_default();

    // Pin number from num_seg[4] — the correct KiCad pin number
    // Fallback to settings[2] (spice_pin_number) if not available.
    let number = num_seg.get(4)
        .filter(|s| !s.is_empty())
        .map(|s| s.replace(' ', ""))
        .unwrap_or_else(|| {
            settings.get(2).map(|s| s.to_string()).unwrap_or_default()
        });

    // Pin length: extract from path segment (segment[2], field[0])
    // Path format: "M x y h ±length" — length is the h value
    let path_seg = segments.get(2).cloned().unwrap_or_default();
    let path_str = path_seg.first().copied().unwrap_or("");
    let length_mm = extract_pin_length(path_str);

    // Pin style: inverted (dot_bis displayed), clock (clock displayed), or both
    let dot_displayed = dot_bis.first().map(|s| pb(s)).unwrap_or(false);
    let clock_displayed = clock_seg.first().map(|s| pb(s)).unwrap_or(false);
    let pin_style = match (dot_displayed, clock_displayed) {
        (true, true)   => PinStyle::InvertedClock,
        (true, false)  => PinStyle::Inverted,
        (false, true)  => PinStyle::Clock,
        (false, false) => PinStyle::Line,
    };

    sym.pins.push(EePin {
        number,
        name,
        pin_type,
        pin_style,
        x_mm: pos_x,
        y_mm: pos_y,
        rotation,
        length_mm,
    });
}

/// Extract pin stub length from the SVG path "M x y h ±length".
/// Matches Python: `abs(int(float(ee_pin.pin_path.path.split("h")[-1].split()[0])))`
fn extract_pin_length(path: &str) -> f64 {
    // The pin path might use "v" in some EasyEDA versions, Python normalises: path.replace("v","h")
    let path = path.replace('v', "h");
    if let Some(h_part) = path.split('h').last() {
        let first_num = h_part.split_whitespace().next().unwrap_or("0");
        let val = pf(first_num).abs();
        if val > 0.0 {
            return px_to_mm_grid(val);
        }
    }
    2.54 // default 100mil
}

// ── Symbol: Rectangle ────────────────────────────────────────────────────────

fn parse_sym_rect(line: &str, sym: &mut EeSymbol, ox: f64, oy: f64) {
    // Two formats:
    //   Format 1: R~x~y~~width~height~stroke_color~stroke_width~stroke_style~fill_color~id~locked
    //             (empty fields at positions 2,3 = no rounded corners)
    //   Format 2: R~x~y~rx~ry~width~height~stroke_color~...
    let parts: Vec<&str> = line.split('~').collect();
    if parts.len() < 6 { return; }

    // parts[0] = "R", parts[1] = x, parts[2] = y, ...
    let raw_x = pf(parts[1]);
    let raw_y = pf(parts[2]);

    let (width_px, height_px) = if parts.len() >= 6 && (parts[3].is_empty() && parts[4].is_empty()) {
        // Format 1: R~x~y~~width~height~...
        (pf(parts[5]), pf(parts[6]))
    } else if parts.len() >= 8 {
        // Format 2: R~x~y~rx~ry~width~height~...
        (pf(parts[5]), pf(parts[6]))
    } else {
        return;
    };

    let x0 = px_to_mm(raw_x - ox);
    let y0 = -px_to_mm(raw_y - oy);
    let x1 = x0 + px_to_mm(width_px);
    let y1 = y0 - px_to_mm(height_px); // Y negation: height goes downward in EE

    sym.rectangles.push(EeRectangle { x0_mm: x0, y0_mm: y0, x1_mm: x1, y1_mm: y1 });
}

// ── Symbol: Polyline / Polygon ───────────────────────────────────────────────

fn parse_sym_polyline(line: &str, sym: &mut EeSymbol, ox: f64, oy: f64, force_closed: bool) {
    // Format: PL~points~stroke_color~stroke_width~stroke_style~fill_color~id~locked
    let parts: Vec<&str> = line.split('~').collect();
    if parts.len() < 2 { return; }

    let raw_pts = parts[1]; // space-separated point pairs
    let nums: Vec<f64> = raw_pts.split_whitespace()
        .filter_map(|s| s.parse::<f64>().ok())
        .collect();

    let mut points: Vec<[f64; 2]> = Vec::new();
    for chunk in nums.chunks(2) {
        if chunk.len() == 2 {
            points.push([
                px_to_mm(chunk[0] - ox),
                -px_to_mm(chunk[1] - oy),
            ]);
        }
    }

    if points.len() < 2 { return; }

    // Check fill color (parts[5]) — if filled or polygon, close the shape
    let fill_color = parts.get(5).copied().unwrap_or("");
    let is_filled = !fill_color.is_empty() && fill_color.to_lowercase() != "none";

    if (force_closed || is_filled) && points.len() >= 3 {
        if points.first() != points.last() {
            let first = points[0];
            points.push(first);
        }
    }

    let is_closed = points.first() == points.last();
    sym.polylines.push(EePolyline { points, is_closed });
}

fn parse_sym_polygon(line: &str, sym: &mut EeSymbol, ox: f64, oy: f64) {
    // PG format is same as PL but always closed
    parse_sym_polyline(line, sym, ox, oy, true);
}

// ── Symbol: Path (SVG M/L/C/Q/Z) ────────────────────────────────────────────

fn parse_sym_path(line: &str, sym: &mut EeSymbol, ox: f64, oy: f64) {
    // Format: PT~path~stroke_color~stroke_width~stroke_style~fill_color~id~locked
    let parts: Vec<&str> = line.split('~').collect();
    if parts.len() < 2 { return; }

    let raw_path = parts[1];
    let tokens: Vec<&str> = raw_path.split_whitespace().collect();

    let ki = |ex: f64, ey: f64| -> [f64; 2] {
        [px_to_mm(ex - ox), -px_to_mm(ey - oy)]
    };

    let mut poly_pts: Vec<[f64; 2]> = Vec::new();
    let mut cur_x = 0.0_f64;
    let mut cur_y = 0.0_f64;
    let mut first_pt: Option<[f64; 2]> = None;

    let flush_poly = |pts: &mut Vec<[f64; 2]>, polylines: &mut Vec<EePolyline>| {
        if pts.len() >= 2 {
            let closed = pts.first() == pts.last();
            polylines.push(EePolyline {
                points: pts.clone(),
                is_closed: closed,
            });
        }
        pts.clear();
    };

    let mut idx = 0;
    while idx < tokens.len() {
        let cmd = tokens[idx];
        match cmd {
            "M" | "L" => {
                if idx + 2 >= tokens.len() { break; }
                cur_x = pf(tokens[idx + 1]);
                cur_y = pf(tokens[idx + 2]);
                let pt = ki(cur_x, cur_y);
                poly_pts.push(pt);
                if cmd == "M" { first_pt = Some(pt); }
                idx += 3;
            }
            "Z" => {
                if let Some(fp) = first_pt {
                    if !poly_pts.is_empty() {
                        poly_pts.push(fp);
                    }
                }
                idx += 1;
            }
            "C" => {
                // Cubic bezier: C x1 y1 x2 y2 x y
                if idx + 6 >= tokens.len() { break; }
                let x1 = pf(tokens[idx + 1]);
                let y1 = pf(tokens[idx + 2]);
                let x2 = pf(tokens[idx + 3]);
                let y2 = pf(tokens[idx + 4]);
                let x  = pf(tokens[idx + 5]);
                let y  = pf(tokens[idx + 6]);

                flush_poly(&mut poly_pts, &mut sym.polylines);

                sym.beziers.push(EeBezier {
                    points: vec![ki(cur_x, cur_y), ki(x1, y1), ki(x2, y2), ki(x, y)],
                    is_closed: false,
                });

                cur_x = x;
                cur_y = y;
                poly_pts.push(ki(cur_x, cur_y));
                idx += 7;
            }
            "Q" => {
                // Quadratic bezier → elevate to cubic
                if idx + 4 >= tokens.len() { break; }
                let qx1 = pf(tokens[idx + 1]);
                let qy1 = pf(tokens[idx + 2]);
                let qx  = pf(tokens[idx + 3]);
                let qy  = pf(tokens[idx + 4]);

                // Degree elevation: quadratic → cubic control points
                let cx1 = cur_x + 2.0 / 3.0 * (qx1 - cur_x);
                let cy1 = cur_y + 2.0 / 3.0 * (qy1 - cur_y);
                let cx2 = qx + 2.0 / 3.0 * (qx1 - qx);
                let cy2 = qy + 2.0 / 3.0 * (qy1 - qy);

                flush_poly(&mut poly_pts, &mut sym.polylines);

                sym.beziers.push(EeBezier {
                    points: vec![ki(cur_x, cur_y), ki(cx1, cy1), ki(cx2, cy2), ki(qx, qy)],
                    is_closed: false,
                });

                cur_x = qx;
                cur_y = qy;
                poly_pts.push(ki(cur_x, cur_y));
                idx += 5;
            }
            _ => {
                idx += 1; // skip unknown tokens
            }
        }
    }

    // Flush remaining polygon points
    if poly_pts.len() >= 2 {
        let closed = poly_pts.first() == poly_pts.last();
        sym.polylines.push(EePolyline {
            points: poly_pts,
            is_closed: closed,
        });
    }
}

// ── Symbol: Circle ───────────────────────────────────────────────────────────

fn parse_sym_circle(line: &str, sym: &mut EeSymbol, ox: f64, oy: f64) {
    // Format: C~center_x~center_y~radius~stroke_color~stroke_width~stroke_style~fill_color~id~locked
    let parts: Vec<&str> = line.split('~').collect();
    if parts.len() < 4 { return; }

    let cx = px_to_mm(pf(parts[1]) - ox);
    let cy = -px_to_mm(pf(parts[2]) - oy);
    let r  = px_to_mm(pf(parts[3]));

    let fill_str = parts.get(7).copied().unwrap_or("");
    let filled = !fill_str.is_empty() && fill_str.to_lowercase() != "none";

    if r > 0.0 {
        sym.circles.push(EeCircle { cx_mm: cx, cy_mm: cy, r_mm: r, filled });
    }
}

// ── Symbol: Ellipse ──────────────────────────────────────────────────────────

fn parse_sym_ellipse(line: &str, sym: &mut EeSymbol, ox: f64, oy: f64) {
    // Format: E~center_x~center_y~radius_x~radius_y~stroke_color~stroke_width~stroke_style~fill_color~id~locked
    // Only import if radius_x == radius_y (KiCad doesn't support true ellipses in symbols).
    let parts: Vec<&str> = line.split('~').collect();
    if parts.len() < 5 { return; }

    let cx = pf(parts[1]);
    let cy = pf(parts[2]);
    let rx = pf(parts[3]);
    let ry = pf(parts[4]);

    if (rx - ry).abs() < 0.001 && rx > 0.0 {
        sym.circles.push(EeCircle {
            cx_mm: px_to_mm(cx - ox),
            cy_mm: -px_to_mm(cy - oy),
            r_mm:  px_to_mm(rx),
            filled: false,
        });
    }
}

// ── Symbol: Arc ──────────────────────────────────────────────────────────────

fn parse_sym_arc(line: &str, sym: &mut EeSymbol, ox: f64, oy: f64) {
    // Format: A~path~helper_dots~stroke_color~stroke_width~stroke_style~fill_color~id~locked
    // path is an SVG arc string: "M sx sy A rx ry x_rot large_arc sweep ex ey"
    let parts: Vec<&str> = line.split('~').collect();
    if parts.len() < 2 { return; }

    let svg_path = parts[1].replace(',', " ");
    let parsed = parse_svg_arc_path(&svg_path);
    if parsed.is_empty() { return; }

    // We expect M (start) followed by A (arc)
    let (start, arc_cmd) = match (&parsed[0], parsed.get(1)) {
        (SvgCmd::MoveTo(sx, sy), Some(SvgCmd::Arc { rx, ry, x_rot, large_arc, sweep, ex, ey })) => {
            ((*sx, *sy), (*rx, *ry, *x_rot, *large_arc, *sweep, *ex, *ey))
        }
        _ => return,
    };

    let (sx, sy) = start;
    let (rx, ry, x_rot, large_arc, sweep, ex, ey) = arc_cmd;

    if rx == 0.0 || ry == 0.0 { return; }

    // Compute SVG arc mid-point (matching Python _svg_arc_mid_point)
    let (mid_x, mid_y) = svg_arc_mid_point(sx, sy, ex, ey, rx, ry, x_rot, large_arc, sweep);

    // Convert to KiCad mm with Y negation.
    // Start/end are SWAPPED because Y-flip reverses arc winding direction
    // (matching Python: start ↔ end swap).
    let ki_start_x = px_to_mm(ex - ox);
    let ki_start_y = -px_to_mm(ey - oy);
    let ki_mid_x   = px_to_mm(mid_x - ox);
    let ki_mid_y   = -px_to_mm(mid_y - oy);
    let ki_end_x   = px_to_mm(sx - ox);
    let ki_end_y   = -px_to_mm(sy - oy);

    sym.arcs.push(EeArc {
        start_x: ki_start_x,
        start_y: ki_start_y,
        mid_x:   ki_mid_x,
        mid_y:   ki_mid_y,
        end_x:   ki_end_x,
        end_y:   ki_end_y,
    });
}

// ── Symbol: Text ─────────────────────────────────────────────────────────────

fn parse_sym_text(line: &str, sym: &mut EeSymbol, ox: f64, oy: f64) {
    // Format: T~type~x~y~rotation~color~font~font_size~stroke_width~baseline~text_anchor~role~text~display~...
    let parts: Vec<&str> = line.split('~').collect();
    if parts.len() < 13 { return; }

    let text = parts[12].to_string();
    if text.is_empty() { return; }

    let x = px_to_mm(pf(parts[2]) - ox);
    let y = -px_to_mm(pf(parts[3]) - oy);
    let rotation = pf(parts[4]);

    // Font size: EasyEDA uses "Xpt" or just a number in points
    // Python: float(font_size_str.replace("pt","")) * 0.3528
    let font_raw = parts[7].replace("pt", "");
    let font_pts = pf(&font_raw);
    let font_size_mm = if font_pts > 0.0 { font_pts * 0.3528 } else { 1.27 };

    sym.texts.push(EeText {
        x_mm: x,
        y_mm: y,
        text,
        font_size_mm,
        rotation,
    });
}

// ══════════════════════════════════════════════════════════════════════════════
//  FOOTPRINT PARSER
// ══════════════════════════════════════════════════════════════════════════════

/// Parse an EasyEDA footprint from a shape array.
///
/// `head_x/y` are from the footprint dataStr.head (raw EasyEDA pixels).
/// Coordinates are normalised by subtracting the head origin (converted to mm)
/// so that the component centre is at (0,0).
pub fn parse_footprint(shapes: &[String], head_x: f64, head_y: f64, is_smd: bool) -> EeFootprint {
    let bbox_x = fp_to_mm(head_x);
    let bbox_y = fp_to_mm(head_y);
    let mut fp = EeFootprint::default();
    let mut has_tht = false;

    for line in shapes {
        let line = line.trim();
        if line.is_empty() { continue; }

        let designator = line.split('~').next().unwrap_or("");
        let fields: Vec<&str> = line.splitn(2, '~')
            .nth(1)
            .unwrap_or("")
            .split('~')
            .collect();

        match designator {
            "PAD" => {
                if let Some(pad) = parse_fp_pad(&fields, bbox_x, bbox_y) {
                    if pad.pad_type == PadType::ThroughHole { has_tht = true; }
                    fp.pads.push(pad);
                }
            }
            "TRACK" => {
                let tracks = parse_fp_track(&fields, bbox_x, bbox_y);
                fp.tracks.extend(tracks);
            }
            "HOLE" => {
                if let Some(hole) = parse_fp_hole(&fields, bbox_x, bbox_y) {
                    fp.holes.push(hole);
                }
            }
            "VIA" => {
                if let Some(via) = parse_fp_via(&fields, bbox_x, bbox_y) {
                    fp.vias.push(via);
                }
            }
            "CIRCLE" => {
                if let Some(circle) = parse_fp_circle(&fields, bbox_x, bbox_y) {
                    fp.circles.push(circle);
                }
            }
            "ARC" => {
                if let Some(arc) = parse_fp_arc(&fields, bbox_x, bbox_y) {
                    fp.arcs.push(arc);
                }
            }
            "RECT" => {
                let tracks = parse_fp_rect(&fields, bbox_x, bbox_y);
                fp.tracks.extend(tracks);
            }
            "TEXT" => {
                if let Some(text) = parse_fp_text(&fields, bbox_x, bbox_y) {
                    fp.texts.push(text);
                }
            }
            "SOLIDREGION" => {
                if let Some(region) = parse_fp_solid_region(&fields, head_x, head_y) {
                    fp.regions.push(region);
                }
            }
            "SVGNODE" => {
                // Parse 3D model from SVGNODE — only first one
                if fp.model_3d.is_none() {
                    fp.model_3d = parse_fp_svgnode(&fields, head_x, head_y);
                }
            }
            _ => {} // COPPERAREA, etc.
        }
    }

    // Footprint type: use API-provided is_smd, OR detect from pads
    fp.fp_type = if is_smd && !has_tht {
        "smd".to_string()
    } else if has_tht {
        "through_hole".to_string()
    } else if is_smd {
        "smd".to_string()
    } else {
        "smd".to_string() // default
    };

    // Post-processing: apply outline-centre correction to 3D model translation
    if let Some(ref mut model) = fp.model_3d {
        correct_3d_model_translation(model, &fp.pads);
    }

    fp
}

// ── Footprint: PAD ───────────────────────────────────────────────────────────

fn parse_fp_pad(fields: &[&str], bx: f64, by: f64) -> Option<EePad> {
    // Python field order (EeFootprintPad):
    // [0]shape [1]center_x [2]center_y [3]width [4]height [5]layer_id
    // [6]net [7]number [8]hole_radius [9]points [10]rotation [11]id
    // [12]hole_length [13]slot_outline [14]is_plated [15]is_locked
    if fields.len() < 9 { return None; }

    let shape_str   = fields[0];
    let center_x    = fp_to_mm(pf(fields[1])) - bx;
    let center_y    = fp_to_mm(pf(fields[2])) - by;
    let width       = fp_to_mm(pf(fields[3]));
    let height      = fp_to_mm(pf(fields[4]));
    let layer_id    = pi(fields[5]);
    let number      = fields.get(7).copied().unwrap_or("").to_string();
    let hole_radius = fp_to_mm(pf(fields.get(8).copied().unwrap_or("0")));
    let points_str  = fields.get(9).copied().unwrap_or("");
    let rotation    = pf(fields.get(10).copied().unwrap_or("0"));
    let hole_length = fp_to_mm(pf(fields.get(12).copied().unwrap_or("0")));

    let pad_type = if hole_radius > 0.0 { PadType::ThroughHole } else { PadType::Smd };

    let pad_shape = match shape_str {
        "ELLIPSE" => PadShape::Circle,
        "RECT"    => PadShape::Rect,
        "OVAL"    => PadShape::Oval,
        "POLYGON" => PadShape::Custom,
        _         => PadShape::Custom,
    };

    let layers = if pad_type == PadType::Smd {
        smd_layers(layer_id).to_string()
    } else {
        tht_layers(layer_id).to_string()
    };

    // Drill string
    let drill_mm = hole_radius * 2.0;
    let slot_mm = if hole_length > 0.0 { hole_length } else { 0.0 };

    // Angle conversion: matches Python angle_to_ki
    let rotation_ki = angle_to_ki(rotation);

    // Normalize pad number: extract from "A(1)" → "1"
    let mut pad_number = number.clone();
    if pad_number.contains('(') && pad_number.contains(')') {
        if let Some(inner) = pad_number.split('(').nth(1).and_then(|s| s.split(')').next()) {
            pad_number = inner.to_string();
        }
    }

    // Custom polygon handling
    let mut polygon_str = String::new();
    let mut final_width = width.max(0.01);
    let mut final_height = height.max(0.01);
    let mut final_rotation = rotation_ki;

    if pad_shape == PadShape::Custom && !points_str.is_empty() {
        let point_list: Vec<f64> = points_str.split_whitespace()
            .filter_map(|s| {
                let v = pf(s);
                Some(fp_to_mm(v))
            })
            .collect();

        if point_list.len() >= 4 {
            // For custom polygons, set minimum pad size and zero rotation
            // (polygon points already include baked-in rotation)
            final_width = 0.005;
            final_height = 0.005;
            final_rotation = 0.0;

            // Generate polygon with coordinates relative to pad position
            let mut path_parts = Vec::new();
            for i in (0..point_list.len()).step_by(2) {
                if i + 1 < point_list.len() {
                    let px = point_list[i] - bx - center_x;
                    let py = point_list[i + 1] - by - center_y;
                    path_parts.push(format!("(xy {px:.6} {py:.6})"));
                }
            }
            if !path_parts.is_empty() {
                let path = path_parts.join(" ");
                polygon_str = format!(
                    "\n\t\t(primitives \n\t\t\t(gr_poly \n\t\t\t\t(pts {path}\n\t\t\t\t) \n\t\t\t\t(width 0.1) \n\t\t\t)\n\t\t)\n\t"
                );
            }
        }
    }

    Some(EePad {
        number: pad_number,
        pad_type,
        pad_shape,
        x_mm: center_x,
        y_mm: center_y,
        w_mm: final_width,
        h_mm: final_height,
        drill_mm,
        slot_mm,
        rotation: final_rotation,
        layers,
        polygon: polygon_str,
    })
}

/// Convert EasyEDA rotation angle to KiCad.
/// Matches Python: `angle_to_ki(rotation)`
fn angle_to_ki(rot: f64) -> f64 {
    if rot.is_nan() { return 0.0; }
    if rot > 180.0 { -(360.0 - rot) } else { rot }
}

// ── Footprint: TRACK ─────────────────────────────────────────────────────────

fn parse_fp_track(fields: &[&str], bx: f64, by: f64) -> Vec<EeTrack> {
    // Python field order (EeFootprintTrack):
    // [0]stroke_width [1]layer_id [2]net [3]points [4]id [5]is_locked
    let mut tracks = Vec::new();
    if fields.len() < 4 { return tracks; }

    let stroke_width = fp_to_mm(pf(fields[0]));
    let layer_id     = pi(fields[1]);
    let pts_str      = fields[3];
    let layer        = layer_id_to_kicad(layer_id).to_string();

    let point_list: Vec<f64> = pts_str.split_whitespace()
        .filter_map(|s| s.parse::<f64>().ok())
        .map(|v| fp_to_mm(v))
        .collect();

    // Generate line segments between consecutive pairs
    for i in (0..point_list.len().saturating_sub(2)).step_by(2) {
        if i + 3 < point_list.len() {
            tracks.push(EeTrack {
                x1_mm: point_list[i]     - bx,
                y1_mm: point_list[i + 1] - by,
                x2_mm: point_list[i + 2] - bx,
                y2_mm: point_list[i + 3] - by,
                layer: layer.clone(),
                width_mm: stroke_width.max(0.01),
            });
        }
    }

    tracks
}

// ── Footprint: HOLE ──────────────────────────────────────────────────────────

fn parse_fp_hole(fields: &[&str], bx: f64, by: f64) -> Option<EeHole> {
    // Python field order (EeFootprintHole):
    // [0]center_x [1]center_y [2]radius [3]id [4]is_locked
    if fields.len() < 3 { return None; }
    Some(EeHole {
        x_mm: fp_to_mm(pf(fields[0])) - bx,
        y_mm: fp_to_mm(pf(fields[1])) - by,
        r_mm: fp_to_mm(pf(fields[2])),
    })
}

// ── Footprint: VIA ───────────────────────────────────────────────────────────

fn parse_fp_via(fields: &[&str], bx: f64, by: f64) -> Option<EeVia> {
    // Python field order (EeFootprintVia):
    // [0]center_x [1]center_y [2]diameter [3]net [4]radius [5]id [6]is_locked
    if fields.len() < 5 { return None; }
    Some(EeVia {
        x_mm:    fp_to_mm(pf(fields[0])) - bx,
        y_mm:    fp_to_mm(pf(fields[1])) - by,
        diam_mm: fp_to_mm(pf(fields[2])),
        r_mm:    fp_to_mm(pf(fields[4])),
    })
}

// ── Footprint: CIRCLE ────────────────────────────────────────────────────────

fn parse_fp_circle(fields: &[&str], bx: f64, by: f64) -> Option<EeFpCircle> {
    // Python field order (EeFootprintCircle):
    // [0]cx [1]cy [2]radius [3]stroke_width [4]layer_id [5]id [6]is_locked
    if fields.len() < 5 { return None; }
    let cx = fp_to_mm(pf(fields[0])) - bx;
    let cy = fp_to_mm(pf(fields[1])) - by;
    let r  = fp_to_mm(pf(fields[2]));
    let sw = fp_to_mm(pf(fields[3]));
    let lid = pi(fields[4]);
    if r <= 0.0 { return None; }
    Some(EeFpCircle {
        cx_mm: cx, cy_mm: cy, r_mm: r,
        layer: layer_id_to_kicad(lid).to_string(),
        width_mm: sw.max(0.01),
    })
}

// ── Footprint: ARC ───────────────────────────────────────────────────────────

fn parse_fp_arc(fields: &[&str], bx: f64, by: f64) -> Option<EeFpArc> {
    // Python field order (EeFootprintArc):
    // [0]stroke_width [1]layer_id [2]net [3]path [4]helper_dots [5]id [6]is_locked
    if fields.len() < 4 { return None; }

    let stroke_width = fp_to_mm(pf(fields[0]));
    let layer_id     = pi(fields[1]);
    let arc_path_raw = fields[3];

    // Parse SVG arc path: "M sx,sy A rx,ry x_rot large_arc sweep ex,ey"
    let arc_path = arc_path_raw.replace(',', " ");
    let arc_path = arc_path.replace("M ", "M").replace("A ", "A");

    let m_a_split: Vec<&str> = arc_path.split('A').collect();
    if m_a_split.len() < 2 { return None; }

    // Start point from M part
    let start_str = m_a_split[0].trim_start_matches('M');
    let start_parts: Vec<&str> = start_str.split_whitespace().collect();
    if start_parts.len() < 2 { return None; }
    let start_x = fp_to_mm(pf(start_parts[0])) - bx;
    let start_y = fp_to_mm(pf(start_parts[1])) - by;

    // Arc parameters
    let arc_params: Vec<&str> = m_a_split[1].trim().split_whitespace().collect();
    if arc_params.len() < 7 { return None; }

    let svg_rx    = fp_to_mm(pf(arc_params[0]));
    let svg_ry    = fp_to_mm(pf(arc_params[1]));
    let x_rot     = pf(arc_params[2]);
    let large_arc = arc_params[3] == "1";
    let sweep     = arc_params[4] == "1";
    let end_x     = fp_to_mm(pf(arc_params[5])) - bx;
    let end_y     = fp_to_mm(pf(arc_params[6])) - by;

    if svg_ry == 0.0 { return None; }

    // Compute arc using SVG endpoint-to-center conversion
    let (cx, cy, extent) = compute_fp_arc(
        start_x, start_y, svg_rx, svg_ry, x_rot,
        large_arc, sweep, end_x, end_y,
    );

    Some(EeFpArc {
        cx, cy,
        end_x, end_y,
        angle: extent,
        layer: layer_id_to_kicad(layer_id).to_string(),
        width_mm: stroke_width.max(0.01),
    })
}

// ── Footprint: RECT ──────────────────────────────────────────────────────────

fn parse_fp_rect(fields: &[&str], bx: f64, by: f64) -> Vec<EeTrack> {
    // Python field order (EeFootprintRectangle):
    // [0]x [1]y [2]width [3]height [4]layer_id [5]id [6]is_locked [7]stroke_width
    let mut tracks = Vec::new();
    if fields.len() < 5 { return tracks; }

    let x      = fp_to_mm(pf(fields[0])) - bx;
    let y      = fp_to_mm(pf(fields[1])) - by;
    let width  = fp_to_mm(pf(fields[2]));
    let height = fp_to_mm(pf(fields[3]));
    let lid    = pi(fields[4]);
    let sw     = if fields.len() > 7 { fp_to_mm(pf(fields[7])) } else { 0.12 };

    let layer = layer_id_to_kicad(lid).to_string();
    let sw = sw.max(0.01);

    // Four sides of the rectangle
    tracks.push(EeTrack { x1_mm: x, y1_mm: y, x2_mm: x + width, y2_mm: y,          layer: layer.clone(), width_mm: sw });
    tracks.push(EeTrack { x1_mm: x + width, y1_mm: y, x2_mm: x + width, y2_mm: y + height, layer: layer.clone(), width_mm: sw });
    tracks.push(EeTrack { x1_mm: x + width, y1_mm: y + height, x2_mm: x, y2_mm: y + height, layer: layer.clone(), width_mm: sw });
    tracks.push(EeTrack { x1_mm: x, y1_mm: y + height, x2_mm: x, y2_mm: y,                  layer,                width_mm: sw });

    tracks
}

// ── Footprint: TEXT ──────────────────────────────────────────────────────────

fn parse_fp_text(fields: &[&str], bx: f64, by: f64) -> Option<EeFpText> {
    // Python field order (EeFootprintText):
    // [0]type [1]center_x [2]center_y [3]stroke_width [4]rotation
    // [5]mirror [6]layer_id [7]net [8]font_size [9]text [10]text_path
    // [11]is_displayed [12]id [13]is_locked
    if fields.len() < 10 { return None; }

    let text_type    = fields[0].to_string();
    let x            = fp_to_mm(pf(fields[1])) - bx;
    let y            = fp_to_mm(pf(fields[2])) - by;
    let rotation     = angle_to_ki(pf(fields[4]));
    let mirror       = fields.get(5).map(|s| !s.is_empty() && *s != "0").unwrap_or(false);
    let lid          = pi(fields[6]);
    let font_size    = fp_to_mm(pf(fields.get(8).copied().unwrap_or("7")));
    let text         = fields.get(9).copied().unwrap_or("").to_string();
    let is_displayed = fields.get(11).map(|s| pb(s)).unwrap_or(true);

    if text.is_empty() { return None; }

    let mut layer = layer_id_to_kicad(lid).to_string();
    // N-type texts go on Fab layer instead of SilkS
    if text_type == "N" {
        layer = layer.replace(".SilkS", ".Fab");
    }

    Some(EeFpText {
        x_mm: x, y_mm: y,
        text,
        layer,
        font_size_mm: font_size.max(1.0),
        rotation,
        is_displayed,
        mirror,
        text_type,
    })
}

// ── Footprint: SVGNODE (3D model) ────────────────────────────────────────────

/// Parse 3D model metadata from SVGNODE shape record.
/// Matches Python: `Easyeda3dModelImporter.parse_3d_model_info()`.
///
/// SVGNODE format: `SVGNODE~json_blob~...`
/// The JSON blob contains `attrs` with `uuid`, `title`, `c_origin` ("x,y"),
/// `z`, and `c_rotation` ("rx,ry,rz").
fn parse_fp_svgnode(fields: &[&str], canvas_origin_x: f64, canvas_origin_y: f64) -> Option<Ee3dModel> {
    // The SVGNODE JSON blob is typically field[0] (after the SVGNODE~ prefix split)
    let json_str = fields.first().copied().unwrap_or("");
    if json_str.is_empty() || !json_str.contains('{') { return None; }

    let parsed: serde_json::Value = serde_json::from_str(json_str).ok()?;
    let attrs = &parsed["attrs"];
    if attrs.is_null() { return None; }

    let uuid = attrs["uuid"].as_str().unwrap_or("").to_string();
    let name = attrs["title"].as_str()
        .or_else(|| attrs["name"].as_str())
        .unwrap_or("").to_string();

    if uuid.is_empty() { return None; }

    // Canvas scale: 1 canvas-unit = 10 * 0.0254 mm = 0.254mm
    let scale = 0.254_f64;

    // c_origin: comma-separated "x,y" in EasyEDA canvas units
    let c_origin_str = attrs["c_origin"].as_str().unwrap_or("0,0");
    let co_parts: Vec<&str> = c_origin_str.split(',').collect();
    let co_x = co_parts.first().and_then(|s| s.trim().parse::<f64>().ok()).unwrap_or(0.0);
    let co_y = co_parts.get(1).and_then(|s| s.trim().parse::<f64>().ok()).unwrap_or(0.0);

    // Translation: (c_origin - canvas_origin) * scale, Y negated
    let tx = (co_x - canvas_origin_x) * scale;
    let ty = -(co_y - canvas_origin_y) * scale;

    // Z offset
    let tz_raw = attrs["z"].as_str()
        .and_then(|s| s.parse::<f64>().ok())
        .or_else(|| attrs["z"].as_f64())
        .unwrap_or(0.0);
    let tz = tz_raw * scale;

    // Rotation: "rx,ry,rz" → (360 - r) % 360 for each axis
    let rot_str = attrs["c_rotation"].as_str().unwrap_or("0,0,0");
    let rot_parts: Vec<f64> = rot_str.split(',')
        .filter_map(|s| s.trim().parse::<f64>().ok())
        .collect();
    let rot_x = (360.0 - rot_parts.first().copied().unwrap_or(0.0)) % 360.0;
    let rot_y = (360.0 - rot_parts.get(1).copied().unwrap_or(0.0)) % 360.0;
    let rot_z = (360.0 - rot_parts.get(2).copied().unwrap_or(0.0)) % 360.0;

    Some(Ee3dModel {
        name,
        uuid,
        translation: [tx, ty, tz],
        rotation: [rot_x, rot_y, rot_z],
    })
}

/// Apply outline-centre correction to 3D model translation.
/// Matches Python: `Easyeda3dModelImporter._outline_centre_mm()`.
/// If the pad bounding box centre differs from the 3D model translation by
/// more than 0.1mm, use the pad centre instead.
fn correct_3d_model_translation(model: &mut Ee3dModel, pads: &[EePad]) {
    if pads.is_empty() { return; }

    let min_x = pads.iter().map(|p| p.x_mm - p.w_mm / 2.0).fold(f64::INFINITY, f64::min);
    let max_x = pads.iter().map(|p| p.x_mm + p.w_mm / 2.0).fold(f64::NEG_INFINITY, f64::max);
    let min_y = pads.iter().map(|p| p.y_mm - p.h_mm / 2.0).fold(f64::INFINITY, f64::min);
    let max_y = pads.iter().map(|p| p.y_mm + p.h_mm / 2.0).fold(f64::NEG_INFINITY, f64::max);

    let out_x = (min_x + max_x) / 2.0;
    let out_y = (min_y + max_y) / 2.0;

    let threshold = 0.1;
    if (out_x - model.translation[0]).abs() > threshold
        || (out_y - model.translation[1]).abs() > threshold
    {
        model.translation[0] = out_x;
        model.translation[1] = out_y;
    }
}

// ── Footprint: SOLIDREGION ───────────────────────────────────────────────────

fn parse_fp_solid_region(fields: &[&str], head_x_px: f64, head_y_px: f64) -> Option<EeFpSolidRegion> {
    // Python: SOLIDREGION~layer_id~net~path~region_type~id~~[is_locked]
    // fields: [0]layer_id [1]net [2]path [3]region_type [4]id ...
    if fields.len() < 4 { return None; }

    let lid         = pi(fields[0]);
    let raw_path    = fields[2];
    let region_type = fields[3];

    // Only import certain layers and types
    if !is_solid_region_layer(lid) { return None; }
    if region_type != "solid" && region_type != "npth" { return None; }

    let points = parse_solid_region_path(raw_path, head_x_px, head_y_px);
    if points.len() < 3 { return None; }

    Some(EeFpSolidRegion {
        points,
        layer: layer_id_to_kicad(lid).to_string(),
    })
}

/// Parse a SOLIDREGION SVG path string to (x_mm, y_mm) points.
/// Matches Python: `_parse_solid_region_path()`.
/// Subtracts bbox in pixel space before converting to mm.
fn parse_solid_region_path(path: &str, bbox_x_px: f64, bbox_y_px: f64) -> Vec<(f64, f64)> {
    let mut points = Vec::new();
    let mut cur_x = 0.0_f64;
    let mut cur_y = 0.0_f64;

    // Split path by command letters
    for token in split_svg_commands(path) {
        let token = token.trim();
        if token.is_empty() { continue; }

        let cmd = token.chars().next().unwrap_or(' ');
        let args_str = &token[1..];
        let args: Vec<f64> = args_str.split(|c: char| c == ',' || c.is_whitespace())
            .filter(|s| !s.is_empty())
            .filter_map(|s| s.parse::<f64>().ok())
            .collect();

        match cmd {
            'M' if args.len() >= 2 => {
                cur_x = args[0]; cur_y = args[1];
                points.push((fp_to_mm(cur_x - bbox_x_px), fp_to_mm(cur_y - bbox_y_px)));
            }
            'L' if args.len() >= 2 => {
                cur_x = args[0]; cur_y = args[1];
                points.push((fp_to_mm(cur_x - bbox_x_px), fp_to_mm(cur_y - bbox_y_px)));
            }
            'H' if args.len() >= 1 => {
                cur_x = args[0];
                points.push((fp_to_mm(cur_x - bbox_x_px), fp_to_mm(cur_y - bbox_y_px)));
            }
            'V' if args.len() >= 1 => {
                cur_y = args[0];
                points.push((fp_to_mm(cur_x - bbox_x_px), fp_to_mm(cur_y - bbox_y_px)));
            }
            'A' if args.len() >= 7 => {
                // Approximate arc by endpoint only
                cur_x = args[5]; cur_y = args[6];
                points.push((fp_to_mm(cur_x - bbox_x_px), fp_to_mm(cur_y - bbox_y_px)));
            }
            'Z' => {
                if let Some(&first) = points.first() {
                    if points.last() != Some(&first) {
                        points.push(first);
                    }
                }
            }
            _ => {}
        }
    }

    points
}

/// Split an SVG path string into individual command tokens.
fn split_svg_commands(path: &str) -> Vec<String> {
    let mut result = Vec::new();
    let mut current = String::new();

    for ch in path.trim().chars() {
        if ch.is_ascii_alphabetic() && ch != 'e' && ch != 'E' {
            if !current.is_empty() {
                result.push(current.clone());
                current.clear();
            }
            current.push(ch);
        } else {
            current.push(ch);
        }
    }
    if !current.is_empty() {
        result.push(current);
    }

    result
}

// ══════════════════════════════════════════════════════════════════════════════
//  SVG ARC MATHEMATICS
// ══════════════════════════════════════════════════════════════════════════════

/// Simple SVG path command types for arc parsing.
#[derive(Debug)]
enum SvgCmd {
    MoveTo(f64, f64),
    Arc { rx: f64, ry: f64, x_rot: f64, large_arc: bool, sweep: bool, ex: f64, ey: f64 },
    LineTo(f64, f64),
    Close,
}

/// Parse an SVG path string into SvgCmd list.
/// Handles M, A, L, Z commands (matching Python svg_path_parser.py).
fn parse_svg_arc_path(svg_path: &str) -> Vec<SvgCmd> {
    let svg_path = svg_path.replace(',', " ");
    let mut result = Vec::new();

    // Regex-like splitting: find command letter + arguments
    let re_parts = split_svg_path_commands(&svg_path);

    for (cmd, args) in re_parts {
        match cmd {
            'M' if args.len() >= 2 => {
                result.push(SvgCmd::MoveTo(args[0], args[1]));
            }
            'A' if args.len() >= 7 => {
                // Process multiple arcs if args has multiple groups of 7
                for chunk in args.chunks(7) {
                    if chunk.len() >= 7 {
                        result.push(SvgCmd::Arc {
                            rx: chunk[0], ry: chunk[1],
                            x_rot: chunk[2],
                            large_arc: chunk[3] as i32 == 1,
                            sweep: chunk[4] as i32 == 1,
                            ex: chunk[5], ey: chunk[6],
                        });
                    }
                }
            }
            'L' if args.len() >= 2 => {
                result.push(SvgCmd::LineTo(args[0], args[1]));
            }
            'Z' => {
                result.push(SvgCmd::Close);
            }
            _ => {}
        }
    }

    result
}

/// Split SVG path string by command letters, returning (cmd_char, Vec<f64> args).
fn split_svg_path_commands(path: &str) -> Vec<(char, Vec<f64>)> {
    let mut result = Vec::new();
    let path = path.trim();
    if path.is_empty() { return result; }

    let mut current_cmd = ' ';
    let mut current_args = String::new();

    let flush = |cmd: char, args: &str, result: &mut Vec<(char, Vec<f64>)>| {
        if cmd == ' ' { return; }
        let nums: Vec<f64> = args.split_whitespace()
            .filter_map(|s| s.parse::<f64>().ok())
            .collect();
        result.push((cmd, nums));
    };

    for ch in path.chars() {
        if ch.is_ascii_alphabetic() && ch != 'e' && ch != 'E' {
            flush(current_cmd, &current_args, &mut result);
            current_cmd = ch;
            current_args.clear();
        } else {
            current_args.push(ch);
        }
    }
    flush(current_cmd, &current_args, &mut result);

    result
}

/// Compute the parametric mid-point on an SVG elliptical arc.
///
/// Matches Python: `_svg_arc_mid_point()` in export_kicad_symbol.py.
/// Implements SVG spec endpoint-to-center conversion.
fn svg_arc_mid_point(
    sx: f64, sy: f64, ex: f64, ey: f64,
    rx: f64, ry: f64,
    x_rot_deg: f64,
    large_arc: bool, sweep: bool,
) -> (f64, f64) {
    let phi = (x_rot_deg % 360.0).to_radians();
    let cos_phi = phi.cos();
    let sin_phi = phi.sin();

    // Step 1: rotate midpoint of chord into ellipse-local frame
    let dx2 = (sx - ex) / 2.0;
    let dy2 = (sy - ey) / 2.0;
    let x1 = cos_phi * dx2 + sin_phi * dy2;
    let y1 = -sin_phi * dx2 + cos_phi * dy2;

    // Ensure radii are large enough
    let mut rx = rx.abs();
    let mut ry = ry.abs();
    let mut rx_sq = rx * rx;
    let mut ry_sq = ry * ry;
    let x1_sq = x1 * x1;
    let y1_sq = y1 * y1;

    let radii_scale = if rx_sq > 0.0 && ry_sq > 0.0 {
        x1_sq / rx_sq + y1_sq / ry_sq
    } else {
        0.0
    };
    if radii_scale > 1.0 {
        let scale = radii_scale.sqrt();
        rx *= scale;
        ry *= scale;
        rx_sq = rx * rx;
        ry_sq = ry * ry;
    }

    // Step 2: compute center in ellipse-local frame
    let sign = if large_arc == sweep { -1.0 } else { 1.0 };
    let num = (rx_sq * ry_sq - rx_sq * y1_sq - ry_sq * x1_sq).max(0.0);
    let den = rx_sq * y1_sq + ry_sq * x1_sq;
    let coef = if den > 0.0 { sign * (num / den).sqrt() } else { 0.0 };
    let cx1 = coef * (rx * y1 / ry);
    let cy1 = if rx != 0.0 { coef * -(ry * x1 / rx) } else { 0.0 };

    // Step 3: center in original frame
    let cx = cos_phi * cx1 - sin_phi * cy1 + (sx + ex) / 2.0;
    let cy = sin_phi * cx1 + cos_phi * cy1 + (sy + ey) / 2.0;

    // Step 4: start angle and angular extent
    let angle_between = |ux: f64, uy: f64, vx: f64, vy: f64| -> f64 {
        let n = (ux * ux + uy * uy).sqrt() * (vx * vx + vy * vy).sqrt();
        if n == 0.0 { return 0.0; }
        let cos_val = ((ux * vx + uy * vy) / n).clamp(-1.0, 1.0);
        let mut a = cos_val.acos();
        if ux * vy - uy * vx < 0.0 { a = -a; }
        a
    };

    let ux = if rx != 0.0 { (x1 - cx1) / rx } else { 0.0 };
    let uy = if ry != 0.0 { (y1 - cy1) / ry } else { 0.0 };
    let vx = if rx != 0.0 { (-x1 - cx1) / rx } else { 0.0 };
    let vy = if ry != 0.0 { (-y1 - cy1) / ry } else { 0.0 };

    let theta1 = angle_between(1.0, 0.0, ux, uy);
    let mut d_theta = angle_between(ux, uy, vx, vy);

    if !sweep && d_theta > 0.0 { d_theta -= 2.0 * PI; }
    else if sweep && d_theta < 0.0 { d_theta += 2.0 * PI; }

    let theta_mid = theta1 + d_theta / 2.0;

    // Evaluate ellipse at theta_mid (with rotation phi)
    let lx = rx * theta_mid.cos();
    let ly = ry * theta_mid.sin();
    let mid_x = cos_phi * lx - sin_phi * ly + cx;
    let mid_y = sin_phi * lx + cos_phi * ly + cy;

    (mid_x, mid_y)
}

/// Compute footprint arc center and angle extent from SVG arc parameters.
/// Matches Python: `compute_arc()` in export_kicad_footprint.py.
fn compute_fp_arc(
    sx: f64, sy: f64,
    rx: f64, ry: f64,
    angle_deg: f64,
    large_arc: bool, sweep: bool,
    ex: f64, ey: f64,
) -> (f64, f64, f64) {
    let dx2 = (sx - ex) / 2.0;
    let dy2 = (sy - ey) / 2.0;
    let angle = (angle_deg % 360.0).to_radians();
    let cos_a = angle.cos();
    let sin_a = angle.sin();

    let x1 = cos_a * dx2 + sin_a * dy2;
    let y1 = -sin_a * dx2 + cos_a * dy2;

    let mut rx = rx.abs();
    let mut ry = ry.abs();
    let mut rx_sq = rx * rx;
    let mut ry_sq = ry * ry;
    let x1_sq = x1 * x1;
    let y1_sq = y1 * y1;

    let radii_check = if rx_sq != 0.0 && ry_sq != 0.0 {
        x1_sq / rx_sq + y1_sq / ry_sq
    } else { 0.0 };
    if radii_check > 1.0 {
        let s = radii_check.sqrt();
        rx *= s; ry *= s;
        rx_sq = rx * rx; ry_sq = ry * ry;
    }

    let sign = if large_arc == sweep { -1.0 } else { 1.0 };
    let denom = rx_sq * y1_sq + ry_sq * x1_sq;
    let sq = if denom > 0.0 {
        ((rx_sq * ry_sq - rx_sq * y1_sq - ry_sq * x1_sq) / denom).max(0.0)
    } else { 0.0 };
    let coef = sign * sq.sqrt();
    let cx1 = coef * ((rx * y1) / ry);
    let cy1 = if rx != 0.0 { coef * -((ry * x1) / rx) } else { 0.0 };

    let sx2 = (sx + ex) / 2.0;
    let sy2 = (sy + ey) / 2.0;
    let cx = sx2 + (cos_a * cx1 - sin_a * cy1);
    let cy = sy2 + (sin_a * cx1 + cos_a * cy1);

    let ux = if rx != 0.0 { (x1 - cx1) / rx } else { 0.0 };
    let uy = if ry != 0.0 { (y1 - cy1) / ry } else { 0.0 };
    let vx = if rx != 0.0 { (-x1 - cx1) / rx } else { 0.0 };
    let vy = if ry != 0.0 { (-y1 - cy1) / ry } else { 0.0 };

    let n = ((ux * ux + uy * uy) * (vx * vx + vy * vy)).sqrt();
    let p = ux * vx + uy * vy;
    let sign = if (ux * vy - uy * vx) < 0.0 { -1.0 } else { 1.0 };
    let mut extent = if n != 0.0 {
        (sign * (p / n).clamp(-1.0, 1.0).acos()).to_degrees()
    } else {
        719.0
    };

    if !sweep && extent > 0.0 { extent -= 360.0; }
    else if sweep && extent < 0.0 { extent += 360.0; }

    let extent_sign = if extent < 0.0 { 1.0 } else { -1.0 };
    extent = (extent.abs() % 360.0) * extent_sign;

    (cx, cy, extent)
}
