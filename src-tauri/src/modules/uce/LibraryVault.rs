//! LibraryVault — manages the global component vault.
//!
//! Directory layout (base_dir = `<app_data>/vault/`):
//!   vault/
//!     library/
//!       KiMaster.kicad_sym          ← all symbols (one growing file)
//!       KiMaster.pretty/            ← footprint library dir
//!         C49678.kicad_mod
//!         C1234567.kicad_mod
//!       vault.db                    ← SQLite index of imported components
//!
//! The vault is project-independent. Components stored here can be linked into
//! any KiCad project via `fp-lib-table` and `sym-lib-table`.

use std::fs;
use std::path::{Path, PathBuf};
use serde::{Deserialize, Serialize};
use rusqlite::Connection;

// ── Constants ──────────────────────────────────────────────────────────────────

const VAULT_SUBDIR:   &str = "library";
const SYM_FILE:       &str = "KiMaster.kicad_sym";
const PRETTY_DIR:     &str = "KiMaster.pretty";
const MODELS_DIR:     &str = "3dmodels";
const DB_FILE:        &str = "vault.db";
const SYM_VERSION:    u32  = 20231120;

// ── Types ──────────────────────────────────────────────────────────────────────

/// A component entry stored in the vault SQLite index.
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct VaultEntry {
    pub lcsc_id:      String,
    pub name:         String,
    pub package:      String,
    pub manufacturer: String,
    pub mpn:          String,
    pub description:  String,
    pub added_at:     String,
}

// ── Paths ──────────────────────────────────────────────────────────────────────

fn vault_dir(kimaster_dir: &str) -> PathBuf {
    Path::new(kimaster_dir).join(VAULT_SUBDIR)
}

fn sym_lib_path(kimaster_dir: &str) -> PathBuf {
    vault_dir(kimaster_dir).join(SYM_FILE)
}

fn pretty_dir(kimaster_dir: &str) -> PathBuf {
    vault_dir(kimaster_dir).join(PRETTY_DIR)
}

fn db_path(kimaster_dir: &str) -> PathBuf {
    vault_dir(kimaster_dir).join(DB_FILE)
}

fn models_dir(kimaster_dir: &str) -> PathBuf {
    vault_dir(kimaster_dir).join(MODELS_DIR)
}

fn mod_path(kimaster_dir: &str, lcsc_id: &str) -> PathBuf {
    pretty_dir(kimaster_dir).join(format!("{lcsc_id}.kicad_mod"))
}

// ── Provisioning ──────────────────────────────────────────────────────────────

/// Create `library/` and `KiMaster.pretty/` directories if they don't exist.
/// Initialise the vault SQLite database.
pub fn provision_vault(kimaster_dir: &str) -> anyhow::Result<()> {
    fs::create_dir_all(pretty_dir(kimaster_dir))?;
    fs::create_dir_all(models_dir(kimaster_dir))?;

    // Ensure the symbol lib file exists with a valid header.
    let sym_path = sym_lib_path(kimaster_dir);
    if !sym_path.exists() {
        fs::write(
            &sym_path,
            format!(
                "(kicad_symbol_lib\n  (version {SYM_VERSION})\n  (generator \"kimaster\")\n)\n"
            ),
        )?;
    }

    // SQLite vault index
    let conn = open_db(kimaster_dir)?;
    conn.execute_batch(
        "CREATE TABLE IF NOT EXISTS vault (
            lcsc_id      TEXT PRIMARY KEY,
            name         TEXT NOT NULL,
            package      TEXT NOT NULL DEFAULT '',
            manufacturer TEXT NOT NULL DEFAULT '',
            mpn          TEXT NOT NULL DEFAULT '',
            description  TEXT NOT NULL DEFAULT '',
            added_at     TEXT NOT NULL DEFAULT (datetime('now'))
         );",
    )?;
    Ok(())
}

// ── Symbol file management ────────────────────────────────────────────────────

/// Insert or replace a symbol block in `KiMaster.kicad_sym`.
/// `symbol_content` is the raw `(symbol "NAME" ...)` block (no outer lib wrapper).
pub fn upsert_symbol(kimaster_dir: &str, lcsc_id: &str, symbol_content: &str) -> anyhow::Result<()> {
    let path = sym_lib_path(kimaster_dir);
    let current = fs::read_to_string(&path)?;

    // Remove existing entry if present
    let cleaned = remove_symbol_block(&current, lcsc_id);

    // Insert new block before the final closing paren
    let last = cleaned.rfind(')').ok_or_else(|| anyhow::anyhow!("Malformed KiMaster.kicad_sym"))?;
    let mut new_lib = cleaned[..last].to_string();
    new_lib.push_str(symbol_content);
    if !symbol_content.ends_with('\n') { new_lib.push('\n'); }
    new_lib.push(')');
    new_lib.push('\n');

    fs::write(&path, new_lib)?;
    Ok(())
}

/// Remove a named symbol block from library text (used before re-inserting).
fn remove_symbol_block(lib: &str, lcsc_id: &str) -> String {
    // Match:  \n  (symbol "LCSC_ID"\n    ...\n  )
    // Using a simple depth-counting parser to handle nested parens correctly.
    let target = format!("(symbol \"{}\"", lcsc_id);
    let mut result = String::with_capacity(lib.len());
    let chars: Vec<char> = lib.chars().collect();
    let mut i = 0;

    while i < chars.len() {
        // Check if we're at the start of the target symbol block
        let remaining: String = chars[i..].iter().collect();
        if remaining.starts_with(&target) {
            // Skip past matching closing paren
            let mut depth = 0;
            let mut j = i;
            while j < chars.len() {
                match chars[j] {
                    '(' => depth += 1,
                    ')' => {
                        depth -= 1;
                        if depth == 0 {
                            i = j + 1;
                            // also skip trailing newline
                            if i < chars.len() && chars[i] == '\n' { i += 1; }
                            break;
                        }
                    }
                    _ => {}
                }
                j += 1;
            }
        } else {
            result.push(chars[i]);
            i += 1;
        }
    }
    result
}

// ── Footprint file management ──────────────────────────────────────────────────

/// Write a `.kicad_mod` footprint file to the `KiMaster.pretty/` directory.
pub fn write_footprint(kimaster_dir: &str, lcsc_id: &str, content: &str) -> anyhow::Result<()> {
    let path = mod_path(kimaster_dir, lcsc_id);
    fs::write(&path, content)?;
    Ok(())
}

/// Write a 3D STEP model file to the `3dmodels/` directory.
/// Returns the absolute path of the written file.
pub fn write_step_model(kimaster_dir: &str, filename: &str, data: &[u8]) -> anyhow::Result<PathBuf> {
    let dir = models_dir(kimaster_dir);
    let file_path = dir.join(filename);
    fs::write(&file_path, data)?;
    Ok(file_path)
}

/// Return the absolute path to the 3dmodels/ directory.
pub fn get_models_dir(kimaster_dir: &str) -> PathBuf {
    models_dir(kimaster_dir)
}

// ── Vault index ────────────────────────────────────────────────────────────────

fn open_db(kimaster_dir: &str) -> anyhow::Result<Connection> {
    let conn = Connection::open(db_path(kimaster_dir))?;
    Ok(conn)
}

/// Insert or update a component entry in the vault index.
pub fn upsert_vault_entry(kimaster_dir: &str, entry: &VaultEntry) -> anyhow::Result<()> {
    let conn = open_db(kimaster_dir)?;
    conn.execute(
        "INSERT INTO vault (lcsc_id, name, package, manufacturer, mpn, description, added_at)
         VALUES (?1, ?2, ?3, ?4, ?5, ?6, datetime('now'))
         ON CONFLICT(lcsc_id) DO UPDATE SET
           name=excluded.name, package=excluded.package,
           manufacturer=excluded.manufacturer, mpn=excluded.mpn,
           description=excluded.description, added_at=excluded.added_at",
        rusqlite::params![
            entry.lcsc_id, entry.name, entry.package,
            entry.manufacturer, entry.mpn, entry.description,
        ],
    )?;
    Ok(())
}

/// Read all vault entries.
pub fn get_vault_contents(kimaster_dir: &str) -> anyhow::Result<Vec<VaultEntry>> {
    let db = db_path(kimaster_dir);
    if !db.exists() { return Ok(Vec::new()); }
    let conn = open_db(kimaster_dir)?;
    let mut stmt = conn.prepare(
        "SELECT lcsc_id, name, package, manufacturer, mpn, description, added_at
         FROM vault ORDER BY added_at DESC"
    )?;
    let entries = stmt.query_map([], |row| {
        Ok(VaultEntry {
            lcsc_id:      row.get(0)?,
            name:         row.get(1)?,
            package:      row.get(2)?,
            manufacturer: row.get(3)?,
            mpn:          row.get(4)?,
            description:  row.get(5)?,
            added_at:     row.get(6)?,
        })
    })?
    .filter_map(|r| r.ok())
    .collect();
    Ok(entries)
}

/// Remove a component from the vault (symbol + footprint + DB entry).
pub fn remove_from_vault(kimaster_dir: &str, lcsc_id: &str) -> anyhow::Result<()> {
    // Remove footprint file
    let mod_f = mod_path(kimaster_dir, lcsc_id);
    if mod_f.exists() { fs::remove_file(&mod_f)?; }

    // Remove symbol from lib file
    let sym_path = sym_lib_path(kimaster_dir);
    if sym_path.exists() {
        let lib = fs::read_to_string(&sym_path)?;
        let cleaned = remove_symbol_block(&lib, lcsc_id);
        fs::write(&sym_path, cleaned)?;
    }

    // Remove DB entry
    let conn = open_db(kimaster_dir)?;
    conn.execute("DELETE FROM vault WHERE lcsc_id = ?1", rusqlite::params![lcsc_id])?;
    Ok(())
}

/// Check whether a component is already in the vault.
pub fn is_in_vault(kimaster_dir: &str, lcsc_id: &str) -> bool {
    let db = db_path(kimaster_dir);
    if !db.exists() { return false; }
    let Ok(conn) = open_db(kimaster_dir) else { return false; };
    let found = conn.query_row(
        "SELECT 1 FROM vault WHERE lcsc_id = ?1",
        rusqlite::params![lcsc_id],
        |_| Ok(()),
    );
    match found {
        Ok(_) => mod_path(kimaster_dir, lcsc_id).exists(),
        Err(_) => false,
    }
}
