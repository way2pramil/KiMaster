//! Minimal recursive S-expression parser for KiCad file formats.
//!
//! Handles both `.kicad_pcb` and `.kicad_sch` (KiCad 7+ S-expression format).
//!
//! Token types: `(` `)` `"quoted string"` `unquoted-atom`
//! Quoted strings support `\"` and `\\` escapes.

// ── Types ────────────────────────────────────────────────────────────────────

/// A parsed S-expression node.
#[derive(Debug, Clone)]
pub enum Sexpr {
    Atom(String),
    List(Vec<Sexpr>),
}

// ── Public API ────────────────────────────────────────────────────────────────

/// Parse an S-expression string into a tree.
/// Returns the outermost node (usually a `List`).
pub fn parse(input: &str) -> Result<Sexpr, String> {
    let tokens = tokenize(input);
    if tokens.is_empty() {
        return Err("Empty input".to_string());
    }
    let mut pos = 0usize;
    let node = parse_tokens(&tokens, &mut pos);
    Ok(node)
}

// ── Navigation helpers ────────────────────────────────────────────────────────

impl Sexpr {
    /// Returns `Some(&str)` if this node is an `Atom`.
    pub fn as_str(&self) -> Option<&str> {
        match self { Sexpr::Atom(s) => Some(s), _ => None }
    }

    /// Returns `Some(&[Sexpr])` if this is a `List`.
    pub fn as_list(&self) -> Option<&[Sexpr]> {
        match self { Sexpr::List(v) => Some(v), _ => None }
    }

    /// First element of a `List` as `&str` (the "head" / keyword).
    pub fn head(&self) -> Option<&str> {
        match self {
            Sexpr::List(v) => v.first().and_then(|n| n.as_str()),
            _ => None,
        }
    }

    /// The `n`-th element of a `List` as `&str`.
    pub fn str_at(&self, idx: usize) -> Option<&str> {
        match self {
            Sexpr::List(v) => v.get(idx).and_then(|n| n.as_str()),
            _ => None,
        }
    }

    /// The `n`-th element of a `List` (any type).
    pub fn child(&self, idx: usize) -> Option<&Sexpr> {
        match self { Sexpr::List(v) => v.get(idx), _ => None }
    }

    /// All direct `List` children whose head == `key`.
    pub fn find_all<'a>(&'a self, key: &str) -> Vec<&'a Sexpr> {
        match self {
            Sexpr::List(v) => v.iter()
                .filter(|c| c.head().map(|h| h == key).unwrap_or(false))
                .collect(),
            _ => vec![],
        }
    }

    /// First direct `List` child whose head == `key`.
    pub fn find_first<'a>(&'a self, key: &str) -> Option<&'a Sexpr> {
        match self {
            Sexpr::List(v) => v.iter()
                .find(|c| c.head().map(|h| h == key).unwrap_or(false)),
            _ => None,
        }
    }

    /// Returns the second element (index 1) of the first child named `key`,
    /// as a `String`. Shorthand for `find_first(key)?.str_at(1)`.
    pub fn scalar(&self, key: &str) -> Option<String> {
        self.find_first(key)?.str_at(1).map(String::from)
    }

    /// True if this `List` contains an atom child equal to `key`
    /// (e.g. `(locked)` → `contains_atom("locked")`).
    pub fn contains_atom(&self, key: &str) -> bool {
        match self {
            Sexpr::List(v) => v.iter().any(|c| c.as_str() == Some(key)),
            _ => false,
        }
    }

    /// True if this node has a direct child list whose head == `key`
    /// (e.g. `(locked yes)` or bare `(locked)`).
    pub fn has_child(&self, key: &str) -> bool {
        self.find_first(key).is_some()
    }
}

// ── Tokeniser ─────────────────────────────────────────────────────────────────

fn tokenize(input: &str) -> Vec<String> {
    let bytes = input.as_bytes();
    let mut tokens = Vec::new();
    let mut i = 0usize;

    while i < bytes.len() {
        match bytes[i] {
            // Whitespace
            b' ' | b'\t' | b'\n' | b'\r' => i += 1,
            // Parens
            b'(' => { tokens.push("(".to_string()); i += 1; }
            b')' => { tokens.push(")".to_string()); i += 1; }
            // Quoted string
            b'"' => {
                let mut s = String::new();
                i += 1; // skip opening quote
                while i < bytes.len() {
                    if bytes[i] == b'\\' && i + 1 < bytes.len() {
                        i += 1;
                        match bytes[i] {
                            b'"'  => { s.push('"');  i += 1; }
                            b'\\' => { s.push('\\'); i += 1; }
                            b'n'  => { s.push('\n'); i += 1; }
                            b't'  => { s.push('\t'); i += 1; }
                            other => { s.push(other as char); i += 1; }
                        }
                    } else if bytes[i] == b'"' {
                        i += 1; // skip closing quote
                        break;
                    } else {
                        // SAFETY: we're iterating valid UTF-8 ranges
                        let ch = input[i..].chars().next().unwrap_or('\0');
                        s.push(ch);
                        i += ch.len_utf8();
                    }
                }
                tokens.push(s);
            }
            // Comment (KiCad uses # line comments in some places)
            b'#' => {
                while i < bytes.len() && bytes[i] != b'\n' { i += 1; }
            }
            // Unquoted atom
            _ => {
                let start = i;
                while i < bytes.len()
                    && !matches!(bytes[i], b' '|b'\t'|b'\n'|b'\r'|b'('|b')'|b'"')
                {
                    i += 1;
                }
                if i > start {
                    tokens.push(input[start..i].to_string());
                }
            }
        }
    }
    tokens
}

// ── Recursive parser ──────────────────────────────────────────────────────────

fn parse_tokens(tokens: &[String], pos: &mut usize) -> Sexpr {
    if *pos >= tokens.len() {
        return Sexpr::Atom(String::new());
    }

    if tokens[*pos] == "(" {
        *pos += 1; // consume "("
        let mut children = Vec::new();
        while *pos < tokens.len() && tokens[*pos] != ")" {
            children.push(parse_tokens(tokens, pos));
        }
        if *pos < tokens.len() { *pos += 1; } // consume ")"
        Sexpr::List(children)
    } else {
        let s = tokens[*pos].clone();
        *pos += 1;
        Sexpr::Atom(s)
    }
}

// ── Tests ─────────────────────────────────────────────────────────────────────

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn parse_simple_list() {
        let s = parse("(footprint \"Device:R\" (at 10 20 90) (locked))").unwrap();
        assert_eq!(s.head(), Some("footprint"));
        assert_eq!(s.str_at(1), Some("Device:R"));
        assert!(s.contains_atom("locked") || s.has_child("locked"));
        let at = s.find_first("at").unwrap();
        assert_eq!(at.str_at(1), Some("10"));
        assert_eq!(at.str_at(3), Some("90"));
    }

    #[test]
    fn scalar_helper() {
        let s = parse("(node (version 20230101) (title \"My Board\"))").unwrap();
        assert_eq!(s.scalar("version"), Some("20230101".to_string()));
        assert_eq!(s.scalar("title"), Some("My Board".to_string()));
    }

    #[test]
    fn nested_properties() {
        let s = parse("(fp (property \"Reference\" \"U1\") (property \"Value\" \"MCU\"))").unwrap();
        let props: Vec<_> = s.find_all("property");
        assert_eq!(props.len(), 2);
        assert_eq!(props[0].str_at(2), Some("U1"));
        assert_eq!(props[1].str_at(2), Some("MCU"));
    }

    #[test]
    fn escaped_string() {
        let s = parse("(text \"say \\\"hello\\\"\")").unwrap();
        assert_eq!(s.str_at(1), Some("say \"hello\""));
    }
}
