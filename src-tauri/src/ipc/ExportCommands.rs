//! Export directory preparation command.
//! Handles safe filesystem operations the JS frontend cannot perform under Tauri's sandbox.

use std::fs;
use std::path::PathBuf;
use serde::{Deserialize, Serialize};

#[derive(Deserialize)]
pub struct PrepareDirArgs {
    pub path: String,
    /// "clean" | "keep" | "version"
    pub mode: String,
}

#[derive(Serialize)]
pub struct PrepareDirResult {
    pub resolved_path: String,
    pub existed: bool,
}

/// Prepare an output directory for export.
///
/// - `keep`:    create if absent; leave existing files untouched.
/// - `clean`:   delete the directory if present, then recreate it empty.
/// - `version`: if the directory exists and is non-empty, append `_v2`, `_v3`, …
///              until a non-existent or empty directory name is found.
#[tauri::command]
pub async fn cmd_export_prepare_dir(args: PrepareDirArgs) -> Result<PrepareDirResult, String> {
    let mut target = PathBuf::from(&args.path);
    let existed = target.exists();

    match args.mode.as_str() {
        "clean" => {
            if existed {
                fs::remove_dir_all(&target).map_err(|e| e.to_string())?;
            }
        }
        "version" => {
            if existed {
                let mut counter: u32 = 2;
                let base = target.clone();
                loop {
                    // If target doesn't exist, or exists but is empty — use it
                    if !target.exists() {
                        break;
                    }
                    let is_empty = fs::read_dir(&target)
                        .map(|mut e| e.next().is_none())
                        .unwrap_or(false);
                    if is_empty {
                        break;
                    }
                    let mut name = base
                        .file_name()
                        .unwrap_or_default()
                        .to_os_string();
                    name.push(format!("_v{}", counter));
                    target = base.with_file_name(name);
                    counter += 1;
                }
            }
        }
        _ => { /* keep — no pre-action */ }
    }

    fs::create_dir_all(&target).map_err(|e| e.to_string())?;

    Ok(PrepareDirResult {
        resolved_path: target.to_string_lossy().into_owned(),
        existed,
    })
}
