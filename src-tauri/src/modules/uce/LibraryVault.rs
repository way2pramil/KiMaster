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
    /// Stem of the .kicad_mod file (LCSC ID or package name depending on config).
    #[serde(default)]
    pub fp_stem:      String,
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

fn mod_path(kimaster_dir: &str, fp_stem: &str) -> PathBuf {
    pretty_dir(kimaster_dir).join(format!("{fp_stem}.kicad_mod"))
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
            fp_stem      TEXT NOT NULL DEFAULT '',
            added_at     TEXT NOT NULL DEFAULT (datetime('now'))
         );
         -- Add fp_stem column to existing databases that predate this schema
         CREATE TABLE IF NOT EXISTS _schema_meta (key TEXT PRIMARY KEY, val TEXT);
         INSERT OR IGNORE INTO _schema_meta VALUES ('fp_stem_added', '0');",
    )?;
    // Best-effort migration: add fp_stem column if missing
    let _ = conn.execute_batch("ALTER TABLE vault ADD COLUMN fp_stem TEXT NOT NULL DEFAULT '';");
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
///
/// O(n) implementation: uses `str::find` for the marker, then counts parens
/// byte-by-byte to find the matching close without any heap allocation per step.
fn remove_symbol_block(lib: &str, sym_id: &str) -> String {
    let target = format!("(symbol \"{}\"", sym_id);
    let mut result = String::with_capacity(lib.len());
    let mut rest = lib;

    while let Some(pos) = rest.find(&target) {
        // Append everything before the block
        result.push_str(&rest[..pos]);

        // Depth-count through bytes to find the matching closing paren
        let block = &rest[pos..];
        let mut depth: i32 = 0;
        let mut end = 0;
        for (i, b) in block.bytes().enumerate() {
            match b {
                b'(' => depth += 1,
                b')' => {
                    depth -= 1;
                    if depth == 0 {
                        end = i + 1; // one past the ')'
                        break;
                    }
                }
                _ => {}
            }
        }

        // Advance past the block; skip one trailing newline if present
        let skip = if block.as_bytes().get(end) == Some(&b'\n') { end + 1 } else { end };
        rest = &rest[pos + skip..];
    }

    result.push_str(rest);
    result
}

// ── Footprint file management ──────────────────────────────────────────────────

/// Write a `.kicad_mod` footprint file to the `KiMaster.pretty/` directory.
/// `fp_stem` is the filename stem (without extension) — either the LCSC ID or the package name.
pub fn write_footprint(kimaster_dir: &str, fp_stem: &str, content: &str) -> anyhow::Result<()> {
    let path = mod_path(kimaster_dir, fp_stem);
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
        "INSERT INTO vault (lcsc_id, name, package, manufacturer, mpn, description, fp_stem, added_at)
         VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, datetime('now'))
         ON CONFLICT(lcsc_id) DO UPDATE SET
           name=excluded.name, package=excluded.package,
           manufacturer=excluded.manufacturer, mpn=excluded.mpn,
           description=excluded.description, fp_stem=excluded.fp_stem,
           added_at=excluded.added_at",
        rusqlite::params![
            entry.lcsc_id, entry.name, entry.package,
            entry.manufacturer, entry.mpn, entry.description, entry.fp_stem,
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
        "SELECT lcsc_id, name, package, manufacturer, mpn, description, added_at,
                COALESCE(fp_stem, lcsc_id)
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
            fp_stem:      row.get(7)?,
        })
    })?
    .filter_map(|r| r.ok())
    .collect();
    Ok(entries)
}

/// Remove a component from the vault (symbol + footprint + DB entry).
pub fn remove_from_vault(kimaster_dir: &str, lcsc_id: &str) -> anyhow::Result<()> {
    // Look up the fp_stem stored in the DB so we delete the correct file
    let fp_stem = {
        let db = db_path(kimaster_dir);
        if db.exists() {
            let conn = open_db(kimaster_dir)?;
            conn.query_row(
                "SELECT COALESCE(NULLIF(fp_stem,''), lcsc_id) FROM vault WHERE lcsc_id = ?1",
                rusqlite::params![lcsc_id],
                |row| row.get::<_, String>(0),
            ).unwrap_or_else(|_| lcsc_id.to_string())
        } else {
            lcsc_id.to_string()
        }
    };

    // Remove footprint file
    let mod_f = mod_path(kimaster_dir, &fp_stem);
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

/// Check whether a component is already in the vault (by LCSC ID in the DB).
pub fn is_in_vault(kimaster_dir: &str, lcsc_id: &str) -> bool {
    let db = db_path(kimaster_dir);
    if !db.exists() { return false; }
    let Ok(conn) = open_db(kimaster_dir) else { return false; };
    conn.query_row(
        "SELECT 1 FROM vault WHERE lcsc_id = ?1",
        rusqlite::params![lcsc_id],
        |_| Ok(()),
    ).is_ok()
}
