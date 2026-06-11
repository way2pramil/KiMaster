//! Minimal KiCad S-expression tokenizer, parser, and serializer.
//! Handles quoted strings, line comments (`;`), and nested lists.
//! Designed to round-trip .kicad_mod files with structural preservation.

#[derive(Debug, Clone)]
pub enum Node {
    Atom(String),
    List(Vec<Node>),
}

impl Node {
    pub fn as_atom(&self) -> Option<&str> {
        match self { Node::Atom(s) => Some(s.as_str()), _ => None }
    }
    pub fn as_list(&self) -> Option<&[Node]> {
        match self { Node::List(v) => Some(v), _ => None }
    }
    pub fn as_list_mut(&mut self) -> Option<&mut Vec<Node>> {
        match self { Node::List(v) => Some(v), _ => None }
    }
    /// Returns the first atom of a list (the "tag"), e.g. "fp_line" for `(fp_line ...)`.
    pub fn tag(&self) -> Option<&str> {
        self.as_list()?.first()?.as_atom()
    }
    /// Find the first child list whose tag equals `tag`.
    pub fn child(&self, tag: &str) -> Option<&Node> {
        self.as_list()?.iter().find(|n| n.tag() == Some(tag))
    }
    pub fn child_mut(&mut self, tag: &str) -> Option<&mut Node> {
        self.as_list_mut()?.iter_mut().find(|n| n.tag() == Some(tag))
    }
    /// Atom at position `idx` inside this list.
    pub fn atom_at(&self, idx: usize) -> Option<&str> {
        self.as_list()?.get(idx)?.as_atom()
    }
    /// Parse atom at `idx` as f64.
    pub fn f64_at(&self, idx: usize) -> Option<f64> {
        self.atom_at(idx)?.parse().ok()
    }
    /// Atom at `idx` with quotes stripped.
    pub fn str_at(&self, idx: usize) -> Option<String> {
        Some(unquote(self.atom_at(idx)?))
    }
}

// ── Public API ────────────────────────────────────────────────────────────────

pub fn parse(input: &str) -> Result<Node, String> {
    let tokens = tokenize(input)?;
    let mut pos = 0usize;
    let node = parse_node(&tokens, &mut pos)?;
    if pos < tokens.len() {
        // Multiple top-level forms: wrap in a synthetic list
        let mut roots = vec![node];
        while pos < tokens.len() {
            roots.push(parse_node(&tokens, &mut pos)?);
        }
        Ok(Node::List(roots))
    } else {
        Ok(node)
    }
}

/// Serialize a node to KiCad S-expression string.
pub fn serialize(node: &Node) -> String {
    serialize_inner(node, 0)
}

// ── Tokenizer ─────────────────────────────────────────────────────────────────

fn tokenize(input: &str) -> Result<Vec<String>, String> {
    let mut tokens: Vec<String> = Vec::new();
    let chars: Vec<char> = input.chars().collect();
    let mut i = 0;

    while i < chars.len() {
        match chars[i] {
            '(' => { tokens.push("(".into()); i += 1; }
            ')' => { tokens.push(")".into()); i += 1; }
            '"' => {
                // Quoted string — store with surrounding quotes preserved
                let mut s = String::from('"');
                i += 1;
                while i < chars.len() && chars[i] != '"' {
                    if chars[i] == '\\' && i + 1 < chars.len() {
                        s.push('\\');
                        i += 1;
                        s.push(chars[i]);
                    } else {
                        s.push(chars[i]);
                    }
                    i += 1;
                }
                s.push('"');
                i += 1; // skip closing quote
                tokens.push(s);
            }
            ';' => {
                // Line comment — skip to end of line
                while i < chars.len() && chars[i] != '\n' { i += 1; }
            }
            c if c.is_whitespace() => { i += 1; }
            _ => {
                // Unquoted atom (symbol or number)
                let mut s = String::new();
                while i < chars.len()
                    && !chars[i].is_whitespace()
                    && chars[i] != '(' && chars[i] != ')'
                    && chars[i] != '"' && chars[i] != ';'
                {
                    s.push(chars[i]);
                    i += 1;
                }
                tokens.push(s);
            }
        }
    }
    Ok(tokens)
}

// ── Parser ────────────────────────────────────────────────────────────────────

fn parse_node(tokens: &[String], pos: &mut usize) -> Result<Node, String> {
    if *pos >= tokens.len() {
        return Err("Unexpected end of input".into());
    }
    match tokens[*pos].as_str() {
        "(" => {
            *pos += 1;
            let mut children = Vec::new();
            while *pos < tokens.len() && tokens[*pos] != ")" {
                children.push(parse_node(tokens, pos)?);
            }
            if *pos >= tokens.len() {
                return Err("Unclosed parenthesis".into());
            }
            *pos += 1;
            Ok(Node::List(children))
        }
        ")" => Err(format!("Unexpected ')' at token {}", *pos)),
        t => {
            let s = t.to_string();
            *pos += 1;
            Ok(Node::Atom(s))
        }
    }
}

// ── Serializer ────────────────────────────────────────────────────────────────

fn serialize_inner(node: &Node, depth: usize) -> String {
    match node {
        Node::Atom(s) => s.clone(),
        Node::List(children) => {
            if children.is_empty() {
                return "()".into();
            }
            let _tag = children.first().and_then(|n| n.as_atom()).unwrap_or("");

            // Compact single-line lists: short, all-atom, known metadata tags
            let all_atoms = children.iter().all(|c| matches!(c, Node::Atom(_)));
            if all_atoms && children.len() <= 5 {
                let parts: Vec<_> = children.iter().map(|c| serialize_inner(c, 0)).collect();
                return format!("({})", parts.join(" "));
            }

            // Top-level footprint and element lists: first child + indented rest
            let indent = "  ".repeat(depth + 1);
            let mut out = format!("({}", serialize_inner(&children[0], depth));
            for child in &children[1..] {
                match child {
                    Node::Atom(s) => out.push_str(&format!(" {}", s)),
                    Node::List(_) => {
                        // Some well-known inline sub-lists stay on the same line
                        let child_tag = child.tag().unwrap_or("");
                        if matches!(child_tag, "at" | "size" | "drill" | "layers" | "start" | "end" | "mid" | "center" | "width" | "type") {
                            out.push_str(&format!(" {}", serialize_inner(child, depth)));
                        } else {
                            out.push_str(&format!("\n{}{}", indent, serialize_inner(child, depth + 1)));
                        }
                    }
                }
            }
            out.push(')');
            out
        }
    }
}

// ── Helpers ───────────────────────────────────────────────────────────────────

/// Strip surrounding double-quotes from a quoted atom.
pub fn unquote(s: &str) -> String {
    if s.starts_with('"') && s.ends_with('"') && s.len() >= 2 {
        s[1..s.len() - 1].replace("\\\"", "\"").replace("\\\\", "\\")
    } else {
        s.to_string()
    }
}

/// Format a float for KiCad: up to 6 decimal places, trimmed.
pub fn fmt_f64(v: f64) -> String {
    let s = format!("{:.6}", v);
    let s = s.trim_end_matches('0');
    let s = s.trim_end_matches('.');
    if s.is_empty() { "0".into() } else { s.to_string() }
}

/// Set the atom at `idx` inside a list node.
pub fn set_atom_at(node: &mut Node, idx: usize, value: &str) -> bool {
    if let Node::List(children) = node {
        if let Some(slot) = children.get_mut(idx) {
            *slot = Node::Atom(value.to_string());
            return true;
        }
    }
    false
}

/// Set the f64 at `idx` inside a list node.
pub fn set_f64_at(node: &mut Node, idx: usize, value: f64) -> bool {
    set_atom_at(node, idx, &fmt_f64(value))
}
