//! KiCad .kicad_mod parser: extract EDA elements and apply mutations.
//!
//! Element IDs use the scheme "el-{list_index}" where list_index is the
//! position of the element node inside the footprint List children.
//! This allows the mutation applier to locate elements by index without
//! a separate map.

use serde_json::{json, Value};
use super::sexpr::{self, Node, unquote, set_atom_at, set_f64_at};

// ── Public API ────────────────────────────────────────────────────────────────

/// Parse a .kicad_mod string, returning (root_node, elements_json).
pub fn parse_footprint(content: &str) -> Result<(Node, Vec<Value>), String> {
    let root = sexpr::parse(content)?;
    let elements = extract_elements(&root);
    Ok((root, elements))
}

/// Extract EDA elements from a parsed footprint node.
pub fn extract_elements(root: &Node) -> Vec<Value> {
    let children = match root.as_list() {
        Some(c) => c,
        None => return vec![],
    };

    let mut elements = Vec::new();

    for (list_idx, child) in children.iter().enumerate() {
        let tag = match child.tag() {
            Some(t) => t,
            None => continue,
        };
        let id = format!("el-{}", list_idx);
        let el = match tag {
            "fp_line"   => extract_fp_line(child, &id),
            "fp_arc"    => extract_fp_arc(child, &id),
            "fp_circle" => extract_fp_circle(child, &id),
            "fp_rect"   => extract_fp_rect(child, &id),
            "fp_poly"   => extract_fp_poly(child, &id),
            "pad"       => extract_pad(child, &id),
            "fp_text" | "fp_text_box" => extract_fp_text(child, &id),
            _ => None,
        };
        if let Some(el) = el {
            elements.push(el);
        }
    }
    elements
}

/// Apply a list of mutations to a parsed footprint node in-place.
/// Mutations are the same JSON objects accumulated in store.canvasMutations.
pub fn apply_mutations(root: &mut Node, mutations: &[Value]) -> Result<(), String> {
    // Collect delete indices first; apply non-delete mutations immediately.
    let mut delete_indices: Vec<usize> = Vec::new();

    for m in mutations {
        let op = m["op"].as_str().unwrap_or("");
        let id = m["id"].as_str().unwrap_or("");

        if op == "delete_element" {
            if let Some(idx) = parse_el_idx(id) {
                delete_indices.push(idx);
            }
            continue;
        }

        let list_idx = parse_el_idx(id)
            .ok_or_else(|| format!("Invalid element id: {id}"))?;

        let children = root.as_list_mut().ok_or("Root is not a list")?;
        let target = children.get_mut(list_idx)
            .ok_or_else(|| format!("No element at index {list_idx}"))?;

        match op {
            "move_element" => {
                let dx = m["dx"].as_f64().unwrap_or(0.0);
                let dy = m["dy"].as_f64().unwrap_or(0.0);
                apply_move(target, dx, dy);
            }
            "resize_pad" => {
                if let Some(size) = target.child_mut("size") {
                    if let Some(w) = m["w"].as_f64() { set_f64_at(size, 1, w); }
                    if let Some(h) = m["h"].as_f64() { set_f64_at(size, 2, h); }
                }
            }
            "set_pad_number" => {
                let num = m["num"].as_str().unwrap_or("");
                set_atom_at(target, 1, &format!("\"{num}\""));
            }
            "set_pad_shape" => {
                let shape = m["shape"].as_str().unwrap_or("");
                set_atom_at(target, 3, shape);
            }
            "set_pad_net" => {
                // Update or insert (net N "name") child.
                let net_name = m["net"].as_str().unwrap_or("");
                if let Some(net_node) = target.child_mut("net") {
                    set_atom_at(net_node, 2, &format!("\"{net_name}\""));
                }
                // If no net child exists, leave as-is for Phase 2.
            }
            _ => {}
        }
    }

    // Remove deleted elements in reverse order to preserve indices.
    delete_indices.sort_unstable();
    delete_indices.dedup();
    if let Some(children) = root.as_list_mut() {
        for idx in delete_indices.into_iter().rev() {
            if idx < children.len() {
                children.remove(idx);
            }
        }
    }

    Ok(())
}

// ── Element extractors ────────────────────────────────────────────────────────

fn extract_fp_line(node: &Node, id: &str) -> Option<Value> {
    let layer = get_layer(node)?;
    let (x, y)   = get_xy(node, "start")?;
    let (x2, y2) = get_xy(node, "end")?;
    let sw = get_stroke_width(node);
    Some(json!({
        "type": "line", "id": id, "layer": layer,
        "x": x, "y": y, "x2": x2, "y2": y2,
        "stroke_width": sw,
    }))
}

fn extract_fp_arc(node: &Node, id: &str) -> Option<Value> {
    let layer = get_layer(node)?;
    let (x,  y)   = get_xy(node, "start")?;
    let (mx, my)  = get_xy(node, "mid")?;
    let (x2, y2)  = get_xy(node, "end")?;
    let sw = get_stroke_width(node);
    Some(json!({
        "type": "arc", "id": id, "layer": layer,
        "x": x, "y": y, "mid_x": mx, "mid_y": my, "x2": x2, "y2": y2,
        "stroke_width": sw,
    }))
}

fn extract_fp_circle(node: &Node, id: &str) -> Option<Value> {
    let layer = get_layer(node)?;
    let (cx, cy) = get_xy(node, "center")?;
    let (ex, ey) = get_xy(node, "end")?;
    let sw = get_stroke_width(node);
    Some(json!({
        "type": "circle", "id": id, "layer": layer,
        "x": cx, "y": cy, "x2": ex, "y2": ey,
        "stroke_width": sw,
    }))
}

fn extract_fp_rect(node: &Node, id: &str) -> Option<Value> {
    let layer = get_layer(node)?;
    let (x, y)   = get_xy(node, "start")?;
    let (x2, y2) = get_xy(node, "end")?;
    let sw = get_stroke_width(node);
    Some(json!({
        "type": "rect", "id": id, "layer": layer,
        "x": x, "y": y, "x2": x2, "y2": y2,
        "stroke_width": sw,
    }))
}

fn extract_fp_poly(node: &Node, id: &str) -> Option<Value> {
    let layer = get_layer(node)?;
    let sw = get_stroke_width(node);
    let pts_node = node.child("pts")?;
    let pts_children = pts_node.as_list()?;
    let mut points: Vec<f64> = Vec::new();
    for child in pts_children.iter().skip(1) {
        if child.tag() == Some("xy") {
            let x = child.f64_at(1)?;
            let y = child.f64_at(2)?;
            points.push(x);
            points.push(y);
        }
    }
    if points.len() < 4 {
        return None;
    }

    let fill = node.child("fill")
        .and_then(|f| f.str_at(1))
        .unwrap_or_else(|| "solid".into());

    Some(json!({
        "type": "polygon", "id": id, "layer": layer,
        "points": points,
        "stroke_width": sw,
        "fill": fill,
    }))
}

fn extract_pad(node: &Node, id: &str) -> Option<Value> {
    let children = node.as_list()?;
    // (pad "number" type shape (at x y [angle]) (size w h) (layers ...) [(drill d)])
    let number = children.get(1)?.as_atom().map(unquote)?;
    let shape  = children.get(3)?.as_atom()?.to_string();

    let at_node = node.child("at")?;
    let x     = at_node.f64_at(1)?;
    let y     = at_node.f64_at(2)?;
    let angle = at_node.f64_at(3).unwrap_or(0.0);

    let size_node = node.child("size")?;
    let w = size_node.f64_at(1)?;
    let h = size_node.f64_at(2)?;

    // Primary layer: first entry of (layers ...) without wildcards
    let layer = node.child("layers")
        .and_then(|l| l.as_list())
        .and_then(|ls| ls.iter().skip(1).find_map(|n| {
            let s = n.as_atom().map(unquote)?;
            if !s.contains('*') { Some(s) } else { None }
        }))
        .unwrap_or_else(|| "F.Cu".into());

    let drill = node.child("drill")
        .and_then(|d| d.f64_at(1))
        .unwrap_or(0.0);

    // Net name from (net N "name")
    let net = node.child("net")
        .and_then(|n| n.str_at(2))
        .unwrap_or_default();

    Some(json!({
        "type": "pad", "id": id, "layer": layer,
        "x": x, "y": y,
        "width": w, "height": h, "angle": angle,
        "shape": shape, "number": number, "net": net, "drill": drill,
    }))
}

fn extract_fp_text(node: &Node, id: &str) -> Option<Value> {
    // (fp_text reference "U1" (at x y) (layer "F.SilkS") ...)
    // or (fp_text "U1" ...)  — older format
    let children = node.as_list()?;

    let (text, _at_idx) = if children.get(1)?.as_atom()
        .map(|s| matches!(s, "reference" | "value" | "user"))
        .unwrap_or(false)
    {
        // fp_text reference "U1" ...
        (children.get(2)?.as_atom().map(unquote)?, 3usize)
    } else {
        (children.get(1)?.as_atom().map(unquote)?, 2usize)
    };

    // Find (at ...) — may be at a variable position
    let at_node = node.child("at")?;
    let x = at_node.f64_at(1)?;
    let y = at_node.f64_at(2)?;

    let layer = get_layer(node)?;

    let font_size = node.child("effects")
        .and_then(|e| e.child("font"))
        .and_then(|f| f.child("size"))
        .and_then(|s| s.f64_at(1))
        .unwrap_or(1.27);

    let bold = node.child("effects")
        .and_then(|e| e.child("font"))
        .and_then(|f| f.child("bold"))
        .is_some();

    Some(json!({
        "type": "text", "id": id, "layer": layer,
        "x": x, "y": y, "text": text,
        "font_size": font_size, "bold": bold,
    }))
}

// ── Mutation helpers ──────────────────────────────────────────────────────────

fn apply_move(node: &mut Node, dx: f64, dy: f64) {
    let tag = node.tag().unwrap_or("").to_string();
    match tag.as_str() {
        "pad" | "fp_text" => {
            if let Some(at) = node.child_mut("at") {
                if let Some(x) = at.f64_at(1) { set_f64_at(at, 1, x + dx); }
                if let Some(y) = at.f64_at(2) { set_f64_at(at, 2, y + dy); }
            }
        }
        "fp_line" | "fp_rect" => {
            if let Some(s) = node.child_mut("start") {
                if let Some(x) = s.f64_at(1) { set_f64_at(s, 1, x + dx); }
                if let Some(y) = s.f64_at(2) { set_f64_at(s, 2, y + dy); }
            }
            if let Some(e) = node.child_mut("end") {
                if let Some(x) = e.f64_at(1) { set_f64_at(e, 1, x + dx); }
                if let Some(y) = e.f64_at(2) { set_f64_at(e, 2, y + dy); }
            }
        }
        "fp_arc" => {
            for sub in &["start", "mid", "end"] {
                if let Some(n) = node.child_mut(sub) {
                    if let Some(x) = n.f64_at(1) { set_f64_at(n, 1, x + dx); }
                    if let Some(y) = n.f64_at(2) { set_f64_at(n, 2, y + dy); }
                }
            }
        }
        "fp_circle" => {
            for sub in &["center", "end"] {
                if let Some(n) = node.child_mut(sub) {
                    if let Some(x) = n.f64_at(1) { set_f64_at(n, 1, x + dx); }
                    if let Some(y) = n.f64_at(2) { set_f64_at(n, 2, y + dy); }
                }
            }
        }
        "fp_poly" => {
            if let Some(pts) = node.child_mut("pts") {
                if let Some(pts_list) = pts.as_list_mut() {
                    for xy in pts_list.iter_mut().skip(1) {
                        if xy.tag() == Some("xy") {
                            if let Some(x) = xy.f64_at(1) { set_f64_at(xy, 1, x + dx); }
                            if let Some(y) = xy.f64_at(2) { set_f64_at(xy, 2, y + dy); }
                        }
                    }
                }
            }
        }
        _ => {}
    }
}

fn parse_el_idx(id: &str) -> Option<usize> {
    id.strip_prefix("el-")?.parse().ok()
}

// ── S-expression query helpers ────────────────────────────────────────────────

fn get_xy(node: &Node, tag: &str) -> Option<(f64, f64)> {
    let child = node.child(tag)?;
    Some((child.f64_at(1)?, child.f64_at(2)?))
}

fn get_layer(node: &Node) -> Option<String> {
    node.child("layer")?.str_at(1)
}

fn get_stroke_width(node: &Node) -> f64 {
    node.child("stroke")
        .and_then(|s| s.child("width"))
        .and_then(|w| w.f64_at(1))
        .or_else(|| node.child("width").and_then(|w| w.f64_at(1)))
        .unwrap_or(0.12)
}
