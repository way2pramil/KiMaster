//! LibTableManager — registers KiMaster libraries in KiCad's project lib tables.
//!
//! KiCad tracks symbol and footprint libraries in two S-expression config files
//! located in the project directory:
//!
//!   sym-lib-table   →  symbol library registry
//!   fp-lib-table    →  footprint library registry
//!
//! When the vault writes its first component, this module appends the KiMaster
//! library paths to both files so KiCad finds them automatically — no manual
//! library manager steps required.
//!
//! 3D model paths are written as absolute paths directly into the .kicad_mod
//! files by KiModGenerator and are therefore always in sync with the vault.

use std::fs;
use std::path::{Path, PathBuf};
use anyhow::Result;

const LIB_NAME:  &str = "KiMaster";
const LIB_DESCR: &str = "KiMaster Component Vault";

// ── Public API ────────────────────────────────────────────────────────────────

/// Result of registering the KiMaster libraries in the project lib tables.
#[derive(Debug, Default, Clone, serde::Serialize, serde::Deserialize)]
pub struct LibRegistration {
    /// True if the entry was not present before and was just added.
    pub sym_was_new: bool,
    pub fp_was_new:  bool,
}

impl LibRegistration {
    pub fn any_new(&self) -> bool {
        self.sym_was_new || self.fp_was_new
    }
}

/// Ensure KiMaster's symbol lib and footprint lib are registered in the
/// project-level `sym-lib-table` and `fp-lib-table` files.
///
/// `project_dir`  — directory containing the `.kicad_pro` file.
/// `vault_dir`    — the vault root (the dir that contains the `library/` subdir).
///
/// Returns `Ok(LibRegistration)` even if the files already had the entries.
/// Creates the table files from scratch if they don't exist yet.
pub fn ensure_kimaster_libraries(
    project_dir: &Path,
    vault_dir:   &Path,
) -> Result<LibRegistration> {
    let vault_lib   = vault_dir.join("library");
    let sym_lib     = vault_lib.join("KiMaster.kicad_sym");
    let fp_lib_dir  = vault_lib.join("KiMaster.pretty");

    let sym_was_new = ensure_lib_entry(
        &project_dir.join("sym-lib-table"),
        "sym_lib_table",
        LIB_NAME,
        &path_to_uri(&sym_lib),
        LIB_DESCR,
    )?;

    let fp_was_new = ensure_lib_entry(
        &project_dir.join("fp-lib-table"),
        "fp_lib_table",
        LIB_NAME,
        &path_to_uri(&fp_lib_dir),
        LIB_DESCR,
    )?;

    Ok(LibRegistration { sym_was_new, fp_was_new })
}

/// Return the absolute path to the KiMaster 3D models directory for a vault.
/// Callers can use this for informational display; the actual model path is
/// already embedded as an absolute reference inside each `.kicad_mod` file.
pub fn models_dir_for_vault(vault_dir: &Path) -> PathBuf {
    vault_dir.join("library").join("3dmodels")
}

// ── S-expression helpers ──────────────────────────────────────────────────────

/// Insert the KiMaster `(lib ...)` entry into a lib table file if missing.
///
/// Creates the file with a minimal valid table header when it doesn't exist.
/// Returns `true` if a new entry was written, `false` if already present.
fn ensure_lib_entry(
    table_path: &Path,
    table_tag:  &str,
    name:       &str,
    uri:        &str,
    descr:      &str,
) -> Result<bool> {
    let content = if table_path.exists() {
        fs::read_to_string(table_path)?
    } else {
        format!("({table_tag}\n)\n")
    };

    let marker = format!("(name \"{name}\")");
    if content.contains(&marker) {
        return Ok(false);
    }

    let entry = format!(
        "  (lib (name \"{name}\")(type \"KiCad\")(uri \"{uri}\")(options \"\")(descr \"{descr}\"))\n"
    );

    // Find the last ')' in the file — that is the table's closing paren.
    let last = content
        .rfind(')')
        .ok_or_else(|| anyhow::anyhow!("Malformed {}: no closing paren", table_path.display()))?;

    let mut new_content = content[..last].to_string();
    new_content.push_str(&entry);
    new_content.push(')');
    new_content.push('\n');

    // Ensure parent directory exists before writing
    if let Some(parent) = table_path.parent() {
        fs::create_dir_all(parent)?;
    }

    fs::write(table_path, new_content)?;
    tracing::info!(
        "[LibTable] Registered '{}' in {}",
        name,
        table_path.display()
    );
    Ok(true)
}

/// Convert an absolute filesystem path to a forward-slash URI for KiCad lib tables.
/// KiCad accepts forward slashes on Windows.
fn path_to_uri(path: &Path) -> String {
    path.to_string_lossy().replace('\\', "/")
}
