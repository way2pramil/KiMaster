//! KiCad CLI subprocess manager.
//! Discovers kicad-cli binary and spawns headless subprocesses for:
//!   DRC, ERC, Gerber export, SVG export, PDF export, BOM export,
//!   drill files, position files.

#![allow(non_snake_case)]

pub mod CliRunner;
pub mod DrcParser;
pub mod ErcParser;
pub mod ExportRunner;

use std::path::PathBuf;
use crate::AppConfig;

/// Resolves the kicad-cli binary path. Tries the default path first,
/// then alt paths, returning None if none exist.
pub fn resolve_kicad_cli() -> Option<PathBuf> {
    let default = PathBuf::from(AppConfig::KICAD_CLI_DEFAULT_PATH);
    if default.exists() {
        return Some(default);
    }
    for &alt in AppConfig::KICAD_CLI_ALT_PATHS {
        let p = PathBuf::from(alt);
        if p.exists() {
            return Some(p);
        }
    }
    None
}
