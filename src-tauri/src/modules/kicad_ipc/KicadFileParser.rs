//! KiCad file parsers using the S-expression parser.
//!
//! `parse_pcb_string(content)` — extract board components, nets, layers
//!   from the text output of IPC `SaveDocumentToString(PCB)`.
//!
//! `parse_sch_file(path)` — extract schematic symbols and net labels
//!   from a `.kicad_sch` file on disk (used when KiCad IPC returns AS_BUSY).
//!
//! Both return types mirror the WS bridge board/schematic state so existing
//! frontend code doesn't need changes.

use std::collections::HashMap;
use serde::{Deserialize, Serialize};

use super::SexprParser::{parse, Sexpr};

// ── Result types ──────────────────────────────────────────────────────────────

#[derive(Debug, Default, Clone, Serialize, Deserialize)]
pub struct ParsedComponent {
    pub ref_:      String,
    pub value:     String,
    pub footprint: String,
    pub position:  ComponentPosition,
    pub rotation:  f64,
    pub on_back:   bool,
    pub locked:    bool,
    pub dnp:       bool,
    pub fields:    HashMap<String, String>,
}

#[derive(Debug, Default, Clone, Serialize, Deserialize)]
pub struct ComponentPosition { pub x: f64, pub y: f64 }

#[derive(Debug, Default, Clone, Serialize, Deserialize)]
pub struct ParsedNet {
    pub name:    String,
    pub netcode: i32,
}

#[derive(Debug, Default, Clone, Serialize, Deserialize)]
pub struct ParsedBoardData {
    pub board_name:  String,
    pub components:  Vec<ParsedComponent>,
    pub nets:        Vec<ParsedNet>,
    pub layers:      Vec<String>,    // copper layer names
    pub source:      String,         // "ipc_string" or "file"
    pub parse_error: Option<String>,
}

#[derive(Debug, Default, Clone, Serialize, Deserialize)]
pub struct ParsedSymbol {
    pub ref_:       String,
    pub value:      String,
    pub footprint:  String,
    pub lib_id:     String,
    pub properties: HashMap<String, String>,
}

#[derive(Debug, Default, Clone, Serialize, Deserialize)]
pub struct ParsedNetLabel {
    pub label_type: String,  // "label" | "global_label" | "power"
    pub name:       String,
}

#[derive(Debug, Default, Clone, Serialize, Deserialize)]
pub struct ParsedSchematicData {
    pub sch_path:        Option<String>,
    pub components:      Vec<ParsedSymbol>,
    pub net_labels:      Vec<ParsedNetLabel>,
    pub sheet_count:     usize,
    pub no_connect_count: usize,
    pub source:          String,   // "file" | "cache"
    pub parse_error:     Option<String>,
}

// ── PCB parser ────────────────────────────────────────────────────────────────

/// Parse the text output of `SaveDocumentToString(PCB)`.
///
/// KiCad 7+ format. Extracts footprints, nets, and copper layer names.
pub fn parse_pcb_string(content: &str, board_name: &str) -> ParsedBoardData {
    let root = match parse(content) {
        Ok(r) => r,
        Err(e) => return ParsedBoardData {
            board_name: board_name.to_string(),
            parse_error: Some(format!("S-expression parse error: {e}")),
            source: "ipc_string".to_string(),
            ..Default::default()
        },
    };

    let components = extract_footprints(&root);
    let nets       = extract_nets(&root);
    let layers     = extract_copper_layers(&root);

    tracing::info!(
        "KicadFileParser: PCB '{}' → {} footprints, {} nets, {} copper layers",
        board_name, components.len(), nets.len(), layers.len()
    );

    ParsedBoardData {
        board_name: board_name.to_string(),
        components,
        nets,
        layers,
        source: "ipc_string".to_string(),
        parse_error: None,
    }
}

fn extract_footprints(root: &Sexpr) -> Vec<ParsedComponent> {
    root.find_all("footprint")
        .iter()
        .filter_map(|fp| parse_footprint(fp))
        .collect()
}

fn parse_footprint(fp: &Sexpr) -> Option<ParsedComponent> {
    // Footprint lib_id is the second atom: (footprint "Lib:Name" ...)
    let fp_lib_id = fp.str_at(1).unwrap_or("").to_string();

    // Position: (at X Y [angle])
    let (x, y, rotation, on_back) = parse_at_and_layer(fp);

    // Locked: presence of (locked) child or `locked` atom
    let locked = fp.has_child("locked") || fp.contains_atom("locked");

    // DNP: (attr dnp ...) or bare (dnp)
    let dnp = fp.find_first("attr")
        .map(|a| {
            a.as_list()
             .map(|v| v.iter().any(|n| n.as_str() == Some("dnp")))
             .unwrap_or(false)
        })
        .unwrap_or(false)
        || fp.has_child("dnp");

    // Properties: (property "Key" "Value" ...)
    let mut fields: HashMap<String, String> = HashMap::new();
    for prop in fp.find_all("property") {
        if let (Some(k), Some(v)) = (prop.str_at(1), prop.str_at(2)) {
            fields.insert(k.to_string(), v.to_string());
        }
    }

    let ref_ = fields.get("Reference")
        .cloned()
        .or_else(|| fp.scalar("fp_text").or_else(|| fp.scalar("reference")))
        .unwrap_or_default();
    let value = fields.get("Value").cloned().unwrap_or_default();
    let footprint = fields.get("Footprint").cloned().unwrap_or(fp_lib_id);

    if ref_.is_empty() { return None; } // skip power symbols etc.

    Some(ParsedComponent {
        ref_,
        value,
        footprint,
        position: ComponentPosition { x, y },
        rotation,
        on_back,
        locked,
        dnp,
        fields,
    })
}

/// Returns (x, y, angle_deg, on_back).
fn parse_at_and_layer(node: &Sexpr) -> (f64, f64, f64, bool) {
    let at = node.find_first("at");
    let x  = at.and_then(|n| n.str_at(1)).and_then(|s| s.parse().ok()).unwrap_or(0.0);
    let y  = at.and_then(|n| n.str_at(2)).and_then(|s| s.parse().ok()).unwrap_or(0.0);
    let a  = at.and_then(|n| n.str_at(3)).and_then(|s| s.parse().ok()).unwrap_or(0.0);

    // on_back = footprint is placed on the back copper layer
    let on_back = node.find_first("layer")
        .and_then(|l| l.str_at(1))
        .map(|l| l.starts_with('B') || l.contains("B.Cu"))
        .unwrap_or(false);

    (x, y, a, on_back)
}

fn extract_nets(root: &Sexpr) -> Vec<ParsedNet> {
    // KiCad 7 format: standalone (net NETCODE "NAME") at board level
    // KiCad 9+ format: (net "NAME") inside pads, no standalone declarations
    // We collect nets from both sources and deduplicate.

    let mut seen: std::collections::HashSet<String> = std::collections::HashSet::new();
    let mut nets: Vec<ParsedNet> = Vec::new();
    let mut netcode = 1i32;

    // Old format: top-level (net NETCODE "NAME")
    for n in root.find_all("net") {
        // Try old format: 3-element list (net CODE "NAME")
        if let (Some(code_str), Some(name)) = (n.str_at(1), n.str_at(2)) {
            if let Ok(code) = code_str.parse::<i32>() {
                if !name.is_empty() && seen.insert(name.to_string()) {
                    nets.push(ParsedNet { name: name.to_string(), netcode: code });
                }
                continue;
            }
        }
        // New format: 2-element list (net "NAME")
        if let Some(name) = n.str_at(1) {
            if !name.is_empty() && seen.insert(name.to_string()) {
                nets.push(ParsedNet { name: name.to_string(), netcode: netcode });
                netcode += 1;
            }
        }
    }

    // New format: scan pads inside footprints for (net "NAME")
    if nets.is_empty() {
        for fp in root.find_all("footprint") {
            for pad in fp.find_all("pad") {
                if let Some(net_node) = pad.find_first("net") {
                    if let Some(name) = net_node.str_at(1) {
                        if !name.is_empty() && seen.insert(name.to_string()) {
                            nets.push(ParsedNet { name: name.to_string(), netcode: netcode });
                            netcode += 1;
                        }
                    }
                }
            }
        }
    }

    nets.sort_by(|a, b| a.name.cmp(&b.name));
    nets
}

fn extract_copper_layers(root: &Sexpr) -> Vec<String> {
    let layers_node = match root.find_first("layers") {
        Some(n) => n,
        None    => return vec![],
    };
    // Each child: (LAYER_ID "Name" signal [hide])
    layers_node.as_list()
        .unwrap_or(&[])
        .iter()
        .filter_map(|child| {
            let name = child.str_at(1)?;
            let kind = child.str_at(2).unwrap_or("");
            // copper layers have type "signal" or "power"
            if matches!(kind, "signal" | "power" | "mixed") {
                Some(name.to_string())
            } else {
                None
            }
        })
        .collect()
}

// ── Schematic parser ──────────────────────────────────────────────────────────

/// Parse a `.kicad_sch` file from disk.
///
/// Used when KiCad IPC `GetItems(SCH_SYMBOL)` returns AS_BUSY.
/// We know the file path from `GetOpenDocuments(SCH).identifier.board_filename`.
pub fn parse_sch_file(sch_path: &str) -> ParsedSchematicData {
    match std::fs::read_to_string(sch_path) {
        Ok(content) => parse_sch_string(&content, sch_path),
        Err(e) => ParsedSchematicData {
            sch_path: Some(sch_path.to_string()),
            parse_error: Some(format!("Cannot read {sch_path}: {e}")),
            source: "file".to_string(),
            ..Default::default()
        },
    }
}

/// Parse `.kicad_sch` content (used by both file and string paths).
pub fn parse_sch_string(content: &str, sch_path: &str) -> ParsedSchematicData {
    let root = match parse(content) {
        Ok(r) => r,
        Err(e) => return ParsedSchematicData {
            sch_path: Some(sch_path.to_string()),
            parse_error: Some(format!("S-expression parse error: {e}")),
            source: "file".to_string(),
            ..Default::default()
        },
    };

    let raw_symbols = extract_sch_symbols(&root);
    let components  = merge_symbol_units(raw_symbols);
    let net_labels  = extract_net_labels(&root);
    let sheet_count = root.find_all("sheet").len() + 1; // +1 for root sheet
    let nc_count    = root.find_all("no_connect").len();

    tracing::info!(
        "KicadFileParser: SCH '{}' → {} components, {} labels",
        sch_path, components.len(), net_labels.len()
    );

    ParsedSchematicData {
        sch_path: Some(sch_path.to_string()),
        components,
        net_labels,
        sheet_count,
        no_connect_count: nc_count,
        source: "file".to_string(),
        parse_error: None,
    }
}

fn extract_sch_symbols(root: &Sexpr) -> Vec<ParsedSymbol> {
    root.find_all("symbol")
        .iter()
        .filter_map(|sym| parse_sch_symbol(sym))
        .collect()
}

fn parse_sch_symbol(sym: &Sexpr) -> Option<ParsedSymbol> {
    let lib_id = sym.scalar("lib_id").unwrap_or_default();

    let mut properties: HashMap<String, String> = HashMap::new();
    for prop in sym.find_all("property") {
        if let (Some(k), Some(v)) = (prop.str_at(1), prop.str_at(2)) {
            properties.insert(k.to_string(), v.to_string());
        }
    }

    let ref_      = properties.get("Reference").cloned().unwrap_or_default();
    let value     = properties.get("Value").cloned().unwrap_or_default();
    let footprint = properties.get("Footprint").cloned().unwrap_or_default();

    // Skip power symbols (#PWR, #FLG) and anonymous symbols
    if ref_.is_empty() || ref_.starts_with('#') { return None; }

    Some(ParsedSymbol { ref_, value, footprint, lib_id, properties })
}

/// Merge multi-unit symbols (U1A, U1B → one U1 entry).
/// Properties from all units are merged; first non-empty value wins per key.
fn merge_symbol_units(symbols: Vec<ParsedSymbol>) -> Vec<ParsedSymbol> {
    let mut seen: HashMap<String, ParsedSymbol> = HashMap::new();
    for sym in symbols {
        let entry = seen.entry(sym.ref_.clone()).or_insert_with(|| sym.clone());
        // Merge properties
        for (k, v) in &sym.properties {
            if !v.is_empty() {
                entry.properties.entry(k.clone()).or_insert_with(|| v.clone());
            }
        }
        if entry.footprint.is_empty() && !sym.footprint.is_empty() {
            entry.footprint = sym.footprint.clone();
        }
    }
    let mut result: Vec<ParsedSymbol> = seen.into_values().collect();
    result.sort_by(|a, b| a.ref_.cmp(&b.ref_));
    result
}

fn extract_net_labels(root: &Sexpr) -> Vec<ParsedNetLabel> {
    let mut labels = Vec::new();

    for kind in ["label", "global_label", "hierarchical_label"] {
        for node in root.find_all(kind) {
            let name = node.str_at(1).unwrap_or("").to_string();
            if !name.is_empty() {
                labels.push(ParsedNetLabel { label_type: kind.to_string(), name });
            }
        }
    }

    // Power symbols (lib_id starts with "power:")
    for sym in root.find_all("symbol") {
        let lib_id = sym.scalar("lib_id").unwrap_or_default();
        if lib_id.starts_with("power:") {
            let mut props = HashMap::new();
            for p in sym.find_all("property") {
                if let (Some(k), Some(v)) = (p.str_at(1), p.str_at(2)) {
                    props.insert(k.to_string(), v.to_string());
                }
            }
            let name = props.get("Value").cloned()
                .unwrap_or_else(|| lib_id.split(':').nth(1).unwrap_or("").to_string());
            if !name.is_empty() {
                labels.push(ParsedNetLabel { label_type: "power".to_string(), name });
            }
        }
    }

    labels
}

// ── Netlist graph ─────────────────────────────────────────────────────────────

#[derive(Debug, Default, Clone, Serialize, Deserialize)]
pub struct GraphNode {
    pub id:        String,
    pub label:     String,
    pub sub:       String,       // component value; empty for net nodes
    pub node_type: String,       // "ic"|"passive"|"connector"|"power_net"|"signal_net"
    pub degree:    usize,
}

#[derive(Debug, Default, Clone, Serialize, Deserialize)]
pub struct GraphLink {
    pub source: String,
    pub target: String,
    pub pin:    String,
}

#[derive(Debug, Default, Clone, Serialize, Deserialize)]
pub struct GraphStats {
    pub component_count:    usize,
    pub net_count:          usize,
    pub link_count:         usize,
    pub floating_net_count: usize,
}

#[derive(Debug, Default, Clone, Serialize, Deserialize)]
pub struct NetlistGraphData {
    pub nodes:               Vec<GraphNode>,
    pub links:               Vec<GraphLink>,
    pub floating_nets:       Vec<String>,
    pub isolated_components: Vec<String>,
    pub stats:               GraphStats,
}

/// Build a bipartite component↔net graph from PCB S-expression content.
///
/// Nodes are either component nodes ("comp:{ref}") or net nodes ("net:{name}").
/// Links represent pad connections: each pad that carries a net becomes one edge.
pub fn build_netlist_graph(content: &str) -> NetlistGraphData {
    let root = match parse(content) {
        Ok(r) => r,
        Err(e) => {
            tracing::warn!("build_netlist_graph: parse error: {e}");
            return NetlistGraphData::default();
        }
    };

    let mut links: Vec<GraphLink> = Vec::new();
    let mut comp_values: std::collections::HashMap<String, String> = HashMap::new();

    for fp in root.find_all("footprint") {
        // Extract reference designator from (property "Reference" "R1")
        let mut ref_ = String::new();
        let mut value = String::new();
        for prop in fp.find_all("property") {
            match (prop.str_at(1), prop.str_at(2)) {
                (Some("Reference"), Some(v)) => ref_  = v.to_string(),
                (Some("Value"),     Some(v)) => value = v.to_string(),
                _ => {}
            }
        }
        if ref_.is_empty() || ref_.starts_with('#') { continue; }

        comp_values.insert(ref_.clone(), value);
        let comp_id = format!("comp:{ref_}");

        for pad in fp.find_all("pad") {
            let pin = pad.str_at(1).unwrap_or("").to_string();

            // KiCad 7 old format: (net CODE "NAME")
            // KiCad 9+ new format: (net "NAME")
            let net_name: Option<String> = pad.find_first("net").and_then(|n| {
                if let (Some(code_str), Some(name)) = (n.str_at(1), n.str_at(2)) {
                    let _ = code_str; // old format, name at index 2
                    if !name.is_empty() { return Some(name.to_string()); }
                }
                // new format: name at index 1
                n.str_at(1).filter(|s| !s.is_empty()).map(|s| s.to_string())
            });

            if let Some(name) = net_name {
                links.push(GraphLink {
                    source: comp_id.clone(),
                    target: format!("net:{name}"),
                    pin,
                });
            }
        }
    }

    // Compute degree per node id
    let mut degree_map: HashMap<String, usize> = HashMap::new();
    for link in &links {
        *degree_map.entry(link.source.clone()).or_default() += 1;
        *degree_map.entry(link.target.clone()).or_default() += 1;
    }

    // Collect unique net names from links
    let mut net_names: std::collections::HashSet<String> = std::collections::HashSet::new();
    for link in &links {
        if let Some(n) = link.target.strip_prefix("net:") {
            net_names.insert(n.to_string());
        }
    }

    // Build nodes
    let mut nodes: Vec<GraphNode> = Vec::new();

    for (ref_, value) in &comp_values {
        let comp_id = format!("comp:{ref_}");
        nodes.push(GraphNode {
            id:        comp_id.clone(),
            label:     ref_.clone(),
            sub:       value.clone(),
            node_type: classify_component(ref_),
            degree:    *degree_map.get(&comp_id).unwrap_or(&0),
        });
    }

    let mut floating_nets: Vec<String> = Vec::new();
    for name in &net_names {
        let net_id = format!("net:{name}");
        let deg = *degree_map.get(&net_id).unwrap_or(&0);
        let node_type = classify_net(name);
        if deg < 2 { floating_nets.push(name.clone()); }
        nodes.push(GraphNode {
            id: net_id,
            label: name.clone(),
            sub: String::new(),
            node_type,
            degree: deg,
        });
    }

    // Isolated components: in comp_values but zero links
    let linked_comps: std::collections::HashSet<String> =
        links.iter().map(|l| l.source.clone()).collect();
    let isolated_components: Vec<String> = comp_values.keys()
        .filter(|r| !linked_comps.contains(&format!("comp:{r}")))
        .cloned()
        .collect();

    nodes.sort_by(|a, b| a.id.cmp(&b.id));
    floating_nets.sort();

    let stats = GraphStats {
        component_count:    comp_values.len(),
        net_count:          net_names.len(),
        link_count:         links.len(),
        floating_net_count: floating_nets.len(),
    };

    tracing::info!(
        "build_netlist_graph: {} components, {} nets, {} links, {} floating",
        stats.component_count, stats.net_count, stats.link_count, stats.floating_net_count
    );

    NetlistGraphData { nodes, links, floating_nets, isolated_components, stats }
}

fn classify_component(ref_: &str) -> String {
    let prefix: String = ref_.chars().take_while(|c| c.is_ascii_alphabetic()).collect();
    match prefix.to_uppercase().as_str() {
        "R" | "RN" | "RV"       => "passive",
        "C" | "CP"               => "passive",
        "L" | "FL"               => "passive",
        "J" | "P" | "CN" | "CON"=> "connector",
        "TP" | "MP"              => "testpoint",
        _                        => "ic",
    }.to_string()
}

fn classify_net(name: &str) -> String {
    let upper = name.to_uppercase();
    if upper == "GND"
        || upper.starts_with("VCC") || upper.starts_with("VDD") || upper.starts_with("DVDD")
        || upper.starts_with("AVDD") || upper.starts_with("PVDD")
        || upper.starts_with("+") || upper.ends_with('V')
        || upper == "3V3" || upper == "5V" || upper == "1V8" || upper == "VBAT" || upper == "VBUS"
    {
        "power_net".to_string()
    } else {
        "signal_net".to_string()
    }
}

// ── Tests ─────────────────────────────────────────────────────────────────────

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn parse_minimal_pcb() {
        let pcb = r#"(kicad_pcb (version 20230101)
          (net 1 "GND") (net 2 "VCC")
          (layers (0 "F.Cu" signal) (31 "B.Cu" signal) (44 "B.SilkS" user))
          (footprint "Device:R" (layer "F.Cu") (at 10.0 20.0 90.0)
            (property "Reference" "R1") (property "Value" "10k"))
          (footprint "Device:C" (layer "B.Cu") (at 30.0 40.0 0.0) (locked)
            (property "Reference" "C1") (property "Value" "100nF"))
        )"#;

        let board = parse_pcb_string(pcb, "test.kicad_pcb");
        assert_eq!(board.components.len(), 2);
        assert_eq!(board.nets.len(), 2);
        assert_eq!(board.layers.len(), 2); // F.Cu and B.Cu only (user layer excluded)

        let r1 = &board.components[0];
        assert_eq!(r1.ref_, "R1");
        assert_eq!(r1.value, "10k");
        assert!(!r1.on_back);
        assert!((r1.rotation - 90.0).abs() < 0.01);

        let c1 = &board.components[1];
        assert!(c1.on_back);
        assert!(c1.locked);
    }

    #[test]
    fn parse_minimal_sch() {
        let sch = r#"(kicad_sch (version 20230101)
          (symbol (lib_id "Device:R") (at 100 50 0) (unit 1)
            (property "Reference" "R1") (property "Value" "10k")
            (property "Footprint" "Resistor_SMD:R_0402"))
          (symbol (lib_id "Device:R") (at 120 50 0) (unit 2)
            (property "Reference" "R1") (property "Value" "10k"))
          (symbol (lib_id "MCU:STM32") (at 50 100 0) (unit 1)
            (property "Reference" "U1") (property "Value" "STM32F405")
            (property "LCSC" "C128592"))
          (global_label "GND" (at 10 10 0))
          (global_label "VCC" (at 20 10 0))
        )"#;

        let data = parse_sch_string(sch, "test.kicad_sch");
        // R1 has 2 units but should be merged into 1 component
        assert_eq!(data.components.len(), 2, "R1 + U1");
        assert_eq!(data.net_labels.len(), 2);

        let u1 = data.components.iter().find(|c| c.ref_ == "U1").unwrap();
        assert_eq!(u1.properties.get("LCSC").unwrap(), "C128592");
    }
}
