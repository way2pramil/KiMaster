//! VaultManager — manages the multi-vault global directory.
//!
//! The vault root contains 4 sub-vaults, each serving a distinct purpose:
//!
//! ```text
//! <vault_root>/
//!   vault.db                         ← single SQLite DB, all tables
//!
//!   library/                         ← SUB-VAULT 1: Components (existing)
//!     KiMaster.kicad_sym
//!     KiMaster.pretty/
//!       C8734.kicad_mod
//!     3dmodels/
//!       C8734.step
//!
//!   stackups/                        ← SUB-VAULT 2: PCB Stackup configs
//!     4-layer-standard.json
//!     6-layer-hdi.json
//!
//!   templates/                       ← SUB-VAULT 3: KiCad Project Templates
//!     default-4layer/                  (full KiCad project dirs)
//!       default-4layer.kicad_pro
//!       default-4layer.kicad_pcb
//!       default-4layer.kicad_sch
//!     impedance-controlled/
//!       impedance-controlled.kicad_pro
//!       ...
//!
//!   blocks/                          ← SUB-VAULT 4: Reusable Design Blocks
//!     buck-converter/
//!       buck-converter.kicad_sch       (schematic sheet)
//!       buck-converter.kicad_pcb       (layout block)
//!       buck-converter.json            (metadata)
//!     usb-c-connector/
//!       ...
//! ```
//!
//! The component sub-vault (`library/`) is managed by `LibraryVault.rs`.
//! This module manages the other three + the shared provisioning.

use std::fs;
use std::path::{Path, PathBuf};
use serde::{Deserialize, Serialize};
use rusqlite::Connection;

// ── Sub-vault directory names ────────────────────────────────────────────────

const STACKUPS_DIR:  &str = "stackups";
const TEMPLATES_DIR: &str = "templates";
const BLOCKS_DIR:    &str = "blocks";
const DB_FILE:       &str = "vault.db";

// ── Types ────────────────────────────────────────────────────────────────────

/// A PCB stackup configuration entry.
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct StackupEntry {
    pub id:          String,
    pub name:        String,
    pub layers:      u32,
    pub description: String,
    pub thickness_mm: f64,
    pub added_at:    String,
}

/// A KiCad project template entry.
/// Templates are full KiCad projects with pre-configured DRC rules,
/// netclasses, track widths, clearances, and layer stackups.
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct TemplateEntry {
    pub id:          String,
    pub name:        String,
    pub description: String,
    /// Number of copper layers configured in this template.
    pub layers:      u32,
    /// Comma-separated tags for filtering (e.g. "impedance,hdi,4-layer").
    pub tags:        String,
    pub added_at:    String,
}

/// A reusable design block entry.
/// Blocks are self-contained schematic + layout pairs that can be
/// dropped into new projects (e.g. buck converter, USB-C, Ethernet).
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct BlockEntry {
    pub id:          String,
    pub name:        String,
    pub description: String,
    /// Block category (e.g. "Power", "Communication", "Connector").
    pub category:    String,
    /// Whether this block has a layout (.kicad_pcb) in addition to schematic.
    pub has_layout:  bool,
    /// Comma-separated tags for filtering.
    pub tags:        String,
    pub added_at:    String,
}

/// Stackup layer definition stored as JSON inside the stackup file.
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct StackupLayer {
    pub layer_type:    String,    // "copper", "dielectric", "mask", "paste", "silk"
    pub name:          String,    // "F.Cu", "In1.Cu", "prepreg_1", etc.
    pub thickness_mm:  f64,
    pub material:      String,    // "FR4", "copper", "solder_mask", etc.
    pub epsilon_r:     Option<f64>,  // dielectric constant (for dielectrics)
}

/// Full stackup configuration.
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct StackupConfig {
    pub name:          String,
    pub description:   String,
    pub layers:        Vec<StackupLayer>,
    pub total_thickness_mm: f64,
}

// ── Paths ────────────────────────────────────────────────────────────────────

fn stackups_dir(vault_root: &str) -> PathBuf {
    Path::new(vault_root).join(STACKUPS_DIR)
}

fn templates_dir(vault_root: &str) -> PathBuf {
    Path::new(vault_root).join(TEMPLATES_DIR)
}

fn blocks_dir(vault_root: &str) -> PathBuf {
    Path::new(vault_root).join(BLOCKS_DIR)
}

fn db_path(vault_root: &str) -> PathBuf {
    Path::new(vault_root).join(DB_FILE)
}

fn open_db(vault_root: &str) -> anyhow::Result<Connection> {
    let conn = Connection::open(db_path(vault_root))?;
    Ok(conn)
}

// ── Provisioning ─────────────────────────────────────────────────────────────

/// Create all sub-vault directories and initialise the shared SQLite database
/// with tables for stackups, templates, and blocks.
/// Component vault provisioning is handled by `LibraryVault::provision_vault()`.
pub fn provision_all_vaults(vault_root: &str) -> anyhow::Result<()> {
    // Create sub-vault directories
    fs::create_dir_all(stackups_dir(vault_root))?;
    fs::create_dir_all(templates_dir(vault_root))?;
    fs::create_dir_all(blocks_dir(vault_root))?;

    // Provision component vault (delegates to existing LibraryVault)
    super::LibraryVault::provision_vault(vault_root)?;

    // Create tables for the new sub-vaults
    let conn = open_db(vault_root)?;
    conn.execute_batch(
        "CREATE TABLE IF NOT EXISTS stackups (
            id           TEXT PRIMARY KEY,
            name         TEXT NOT NULL,
            layers       INTEGER NOT NULL DEFAULT 2,
            description  TEXT NOT NULL DEFAULT '',
            thickness_mm REAL NOT NULL DEFAULT 1.6,
            added_at     TEXT NOT NULL DEFAULT (datetime('now'))
         );

         CREATE TABLE IF NOT EXISTS templates (
            id           TEXT PRIMARY KEY,
            name         TEXT NOT NULL,
            description  TEXT NOT NULL DEFAULT '',
            layers       INTEGER NOT NULL DEFAULT 2,
            tags         TEXT NOT NULL DEFAULT '',
            added_at     TEXT NOT NULL DEFAULT (datetime('now'))
         );

         CREATE TABLE IF NOT EXISTS blocks (
            id           TEXT PRIMARY KEY,
            name         TEXT NOT NULL,
            description  TEXT NOT NULL DEFAULT '',
            category     TEXT NOT NULL DEFAULT '',
            has_layout   INTEGER NOT NULL DEFAULT 0,
            tags         TEXT NOT NULL DEFAULT '',
            added_at     TEXT NOT NULL DEFAULT (datetime('now'))
         );"
    )?;
    Ok(())
}

// ═══════════════════════════════════════════════════════════════════════════════
// SUB-VAULT 2: Stackups
// ═══════════════════════════════════════════════════════════════════════════════

/// Save a stackup configuration (JSON file + DB index entry).
pub fn save_stackup(vault_root: &str, config: &StackupConfig) -> anyhow::Result<String> {
    let id = slugify(&config.name);
    let file_path = stackups_dir(vault_root).join(format!("{id}.json"));

    let json = serde_json::to_string_pretty(config)?;
    fs::write(&file_path, json)?;

    let conn = open_db(vault_root)?;
    conn.execute(
        "INSERT INTO stackups (id, name, layers, description, thickness_mm, added_at)
         VALUES (?1, ?2, ?3, ?4, ?5, datetime('now'))
         ON CONFLICT(id) DO UPDATE SET
           name=excluded.name, layers=excluded.layers,
           description=excluded.description, thickness_mm=excluded.thickness_mm,
           added_at=excluded.added_at",
        rusqlite::params![
            id, config.name, config.layers.len() as u32,
            config.description, config.total_thickness_mm,
        ],
    )?;
    Ok(id)
}

/// Load a stackup configuration by ID.
pub fn load_stackup(vault_root: &str, id: &str) -> anyhow::Result<StackupConfig> {
    let file_path = stackups_dir(vault_root).join(format!("{id}.json"));
    let json = fs::read_to_string(&file_path)?;
    let config: StackupConfig = serde_json::from_str(&json)?;
    Ok(config)
}

/// List all stackup entries from the DB index.
pub fn list_stackups(vault_root: &str) -> anyhow::Result<Vec<StackupEntry>> {
    let db = db_path(vault_root);
    if !db.exists() { return Ok(Vec::new()); }
    let conn = open_db(vault_root)?;
    let mut stmt = conn.prepare(
        "SELECT id, name, layers, description, thickness_mm, added_at
         FROM stackups ORDER BY name ASC"
    )?;
    let entries = stmt.query_map([], |row| {
        Ok(StackupEntry {
            id:           row.get(0)?,
            name:         row.get(1)?,
            layers:       row.get(2)?,
            description:  row.get(3)?,
            thickness_mm: row.get(4)?,
            added_at:     row.get(5)?,
        })
    })?
    .filter_map(|r| r.ok())
    .collect();
    Ok(entries)
}

/// Remove a stackup by ID (file + DB entry).
pub fn remove_stackup(vault_root: &str, id: &str) -> anyhow::Result<()> {
    let file_path = stackups_dir(vault_root).join(format!("{id}.json"));
    if file_path.exists() { fs::remove_file(&file_path)?; }
    let conn = open_db(vault_root)?;
    conn.execute("DELETE FROM stackups WHERE id = ?1", rusqlite::params![id])?;
    Ok(())
}

// ═══════════════════════════════════════════════════════════════════════════════
// SUB-VAULT 3: Templates (KiCad Project Templates with DRC/rules baked in)
// ═══════════════════════════════════════════════════════════════════════════════

/// Import a KiCad project directory as a template.
/// Copies the entire project folder into `templates/<id>/`.
pub fn import_template(
    vault_root: &str,
    source_dir: &str,
    name:        &str,
    description: &str,
    tags:        &str,
) -> anyhow::Result<String> {
    let id = slugify(name);
    let dest = templates_dir(vault_root).join(&id);
    fs::create_dir_all(&dest)?;

    // Copy all KiCad project files from source into template dir
    copy_dir_kicad_files(Path::new(source_dir), &dest)?;

    // Count copper layers from .kicad_pcb if present
    let layer_count = count_copper_layers(&dest);

    let conn = open_db(vault_root)?;
    conn.execute(
        "INSERT INTO templates (id, name, description, layers, tags, added_at)
         VALUES (?1, ?2, ?3, ?4, ?5, datetime('now'))
         ON CONFLICT(id) DO UPDATE SET
           name=excluded.name, description=excluded.description,
           layers=excluded.layers, tags=excluded.tags,
           added_at=excluded.added_at",
        rusqlite::params![id, name, description, layer_count, tags],
    )?;
    Ok(id)
}

/// List all template entries from the DB index.
pub fn list_templates(vault_root: &str) -> anyhow::Result<Vec<TemplateEntry>> {
    let db = db_path(vault_root);
    if !db.exists() { return Ok(Vec::new()); }
    let conn = open_db(vault_root)?;
    let mut stmt = conn.prepare(
        "SELECT id, name, description, layers, tags, added_at
         FROM templates ORDER BY name ASC"
    )?;
    let entries = stmt.query_map([], |row| {
        Ok(TemplateEntry {
            id:          row.get(0)?,
            name:        row.get(1)?,
            description: row.get(2)?,
            layers:      row.get(3)?,
            tags:        row.get(4)?,
            added_at:    row.get(5)?,
        })
    })?
    .filter_map(|r| r.ok())
    .collect();
    Ok(entries)
}

/// Instantiate a template into a new project directory.
/// Copies all files from `templates/<id>/` into `dest_dir`,
/// renaming the project files to match `project_name`.
pub fn instantiate_template(
    vault_root:   &str,
    template_id:  &str,
    dest_dir:     &str,
    project_name: &str,
) -> anyhow::Result<()> {
    let src = templates_dir(vault_root).join(template_id);
    if !src.exists() {
        anyhow::bail!("Template '{}' not found", template_id);
    }

    let dest = Path::new(dest_dir);
    fs::create_dir_all(dest)?;

    // Copy template files, renaming KiCad project files to the new project name
    for entry in fs::read_dir(&src)? {
        let entry = entry?;
        let file_name = entry.file_name();
        let name_str = file_name.to_string_lossy();

        // Rename KiCad project files to match new project name
        let dest_name = rename_kicad_project_file(&name_str, template_id, project_name);
        let dest_path = dest.join(&dest_name);

        if entry.file_type()?.is_dir() {
            copy_dir_recursive(&entry.path(), &dest_path)?;
        } else {
            // For .kicad_pro files, also update internal project name references
            if dest_name.ends_with(".kicad_pro") {
                let content = fs::read_to_string(entry.path())?;
                let updated = content.replace(template_id, project_name);
                fs::write(&dest_path, updated)?;
            } else {
                fs::copy(entry.path(), &dest_path)?;
            }
        }
    }

    Ok(())
}

/// Remove a template by ID (directory + DB entry).
pub fn remove_template(vault_root: &str, id: &str) -> anyhow::Result<()> {
    let dir = templates_dir(vault_root).join(id);
    if dir.exists() { fs::remove_dir_all(&dir)?; }
    let conn = open_db(vault_root)?;
    conn.execute("DELETE FROM templates WHERE id = ?1", rusqlite::params![id])?;
    Ok(())
}

// ═══════════════════════════════════════════════════════════════════════════════
// SUB-VAULT 4: Reusable Design Blocks
// ═══════════════════════════════════════════════════════════════════════════════

/// Block metadata stored alongside the KiCad files.
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct BlockMetadata {
    pub name:        String,
    pub description: String,
    pub category:    String,
    pub tags:        String,
    pub has_layout:  bool,
}

/// Import a schematic (+optional layout) as a reusable block.
///
/// `sch_path` — path to the `.kicad_sch` file (required).
/// `pcb_path` — optional path to a `.kicad_pcb` file.
/// Both are copied into `blocks/<id>/`.
pub fn import_block(
    vault_root:  &str,
    sch_path:    &str,
    pcb_path:    Option<&str>,
    name:        &str,
    description: &str,
    category:    &str,
    tags:        &str,
) -> anyhow::Result<String> {
    let id = slugify(name);
    let dest = blocks_dir(vault_root).join(&id);
    fs::create_dir_all(&dest)?;

    // Copy schematic
    let sch_dest = dest.join(format!("{id}.kicad_sch"));
    fs::copy(sch_path, &sch_dest)?;

    // Copy layout if provided
    let has_layout = if let Some(pcb) = pcb_path {
        let pcb_dest = dest.join(format!("{id}.kicad_pcb"));
        fs::copy(pcb, &pcb_dest)?;
        true
    } else {
        false
    };

    // Write metadata JSON
    let meta = BlockMetadata {
        name: name.to_string(),
        description: description.to_string(),
        category: category.to_string(),
        tags: tags.to_string(),
        has_layout,
    };
    let meta_json = serde_json::to_string_pretty(&meta)?;
    fs::write(dest.join(format!("{id}.json")), meta_json)?;

    // Index in DB
    let conn = open_db(vault_root)?;
    conn.execute(
        "INSERT INTO blocks (id, name, description, category, has_layout, tags, added_at)
         VALUES (?1, ?2, ?3, ?4, ?5, ?6, datetime('now'))
         ON CONFLICT(id) DO UPDATE SET
           name=excluded.name, description=excluded.description,
           category=excluded.category, has_layout=excluded.has_layout,
           tags=excluded.tags, added_at=excluded.added_at",
        rusqlite::params![
            id, name, description, category, has_layout as i32, tags,
        ],
    )?;
    Ok(id)
}

/// List all block entries from the DB index.
pub fn list_blocks(vault_root: &str) -> anyhow::Result<Vec<BlockEntry>> {
    let db = db_path(vault_root);
    if !db.exists() { return Ok(Vec::new()); }
    let conn = open_db(vault_root)?;
    let mut stmt = conn.prepare(
        "SELECT id, name, description, category, has_layout, tags, added_at
         FROM blocks ORDER BY category ASC, name ASC"
    )?;
    let entries = stmt.query_map([], |row| {
        Ok(BlockEntry {
            id:          row.get(0)?,
            name:        row.get(1)?,
            description: row.get(2)?,
            category:    row.get(3)?,
            has_layout:  row.get::<_, i32>(4)? != 0,
            tags:        row.get(5)?,
            added_at:    row.get(6)?,
        })
    })?
    .filter_map(|r| r.ok())
    .collect();
    Ok(entries)
}

/// Load block metadata by ID.
pub fn load_block_metadata(vault_root: &str, id: &str) -> anyhow::Result<BlockMetadata> {
    let meta_path = blocks_dir(vault_root).join(id).join(format!("{id}.json"));
    let json = fs::read_to_string(&meta_path)?;
    let meta: BlockMetadata = serde_json::from_str(&json)?;
    Ok(meta)
}

/// Get the filesystem path to a block's schematic file.
pub fn block_sch_path(vault_root: &str, id: &str) -> PathBuf {
    blocks_dir(vault_root).join(id).join(format!("{id}.kicad_sch"))
}

/// Get the filesystem path to a block's layout file (may not exist).
pub fn block_pcb_path(vault_root: &str, id: &str) -> PathBuf {
    blocks_dir(vault_root).join(id).join(format!("{id}.kicad_pcb"))
}

/// Remove a block by ID (directory + DB entry).
pub fn remove_block(vault_root: &str, id: &str) -> anyhow::Result<()> {
    let dir = blocks_dir(vault_root).join(id);
    if dir.exists() { fs::remove_dir_all(&dir)?; }
    let conn = open_db(vault_root)?;
    conn.execute("DELETE FROM blocks WHERE id = ?1", rusqlite::params![id])?;
    Ok(())
}

// ═══════════════════════════════════════════════════════════════════════════════
// Helpers
// ═══════════════════════════════════════════════════════════════════════════════

/// Convert a human-readable name to a filesystem-safe slug.
/// "4-Layer Standard" → "4-layer-standard"
fn slugify(name: &str) -> String {
    name.trim()
        .to_lowercase()
        .chars()
        .map(|c| if c.is_alphanumeric() || c == '-' { c } else { '-' })
        .collect::<String>()
        .split('-')
        .filter(|s| !s.is_empty())
        .collect::<Vec<_>>()
        .join("-")
}

/// Copy KiCad-relevant files from source dir into dest dir.
/// Copies: .kicad_pro, .kicad_pcb, .kicad_sch, .kicad_dru, .kicad_wks,
/// fp-lib-table, sym-lib-table, and any sub-directories.
fn copy_dir_kicad_files(src: &Path, dest: &Path) -> anyhow::Result<()> {
    for entry in fs::read_dir(src)? {
        let entry = entry?;
        let name = entry.file_name();
        let name_str = name.to_string_lossy();

        // Skip non-KiCad files and build artifacts
        if name_str.starts_with('.') { continue; }
        if name_str == "__pycache__" || name_str == "node_modules" { continue; }

        let dest_path = dest.join(&name);
        if entry.file_type()?.is_dir() {
            copy_dir_recursive(&entry.path(), &dest_path)?;
        } else {
            // Copy KiCad project files + lib tables + design rules
            let dominated = name_str.ends_with(".kicad_pro")
                || name_str.ends_with(".kicad_pcb")
                || name_str.ends_with(".kicad_sch")
                || name_str.ends_with(".kicad_dru")
                || name_str.ends_with(".kicad_wks")
                || name_str == "fp-lib-table"
                || name_str == "sym-lib-table";
            if dominated {
                fs::copy(entry.path(), &dest_path)?;
            }
        }
    }
    Ok(())
}

/// Recursively copy a directory.
fn copy_dir_recursive(src: &Path, dest: &Path) -> anyhow::Result<()> {
    fs::create_dir_all(dest)?;
    for entry in fs::read_dir(src)? {
        let entry = entry?;
        let dest_path = dest.join(entry.file_name());
        if entry.file_type()?.is_dir() {
            copy_dir_recursive(&entry.path(), &dest_path)?;
        } else {
            fs::copy(entry.path(), &dest_path)?;
        }
    }
    Ok(())
}

/// Rename a KiCad project file from old project name to new one.
/// "old-template.kicad_pro" → "new-project.kicad_pro"
fn rename_kicad_project_file(filename: &str, old_name: &str, new_name: &str) -> String {
    if filename.starts_with(old_name) {
        filename.replacen(old_name, new_name, 1)
    } else {
        filename.to_string()
    }
}

/// Count the number of copper layers in a .kicad_pcb file.
/// Quick heuristic: count `(layer N "X.Cu")` entries.
fn count_copper_layers(template_dir: &Path) -> u32 {
    // Find .kicad_pcb file
    let pcb_file = fs::read_dir(template_dir)
        .ok()
        .and_then(|entries| {
            entries
                .filter_map(|e| e.ok())
                .find(|e| e.file_name().to_string_lossy().ends_with(".kicad_pcb"))
        });

    let Some(pcb) = pcb_file else { return 2; };
    let content = fs::read_to_string(pcb.path()).unwrap_or_default();

    // Count lines matching (N "*.Cu" ...)
    content.lines()
        .filter(|line| {
            let trimmed = line.trim();
            trimmed.contains(".Cu\"") && trimmed.starts_with('(')
        })
        .count() as u32
}
