//! Python plugin WebSocket bridge — Phase 3.
//! WsClient manages the async connection. BridgeInstaller copies the plugin.

pub mod WsClient;

pub use WsClient::{spawn_bridge_task, BridgeCmd};

use std::path::{Path, PathBuf};
use crate::AppConfig;

/// Resolve the KiMaster plugin destination inside the user's KiCad plugins dir.
/// `home_dir` is provided by the caller (e.g. from Tauri `app.path().home_dir()`).
pub fn plugin_install_dir(home_dir: &Path) -> PathBuf {
    home_dir
        .join(AppConfig::KICAD_PLUGIN_SUBDIR)
        .join("kimaster_plugin")
}

/// Copy the bundled bridge plugin to the KiCad scripting plugins directory.
///
/// `plugin_src_dir` — resolved by caller via `app.path().resource_dir()`
///                    pointing at `bridge/kimaster_plugin/`.
/// `home_dir`       — resolved by caller via `app.path().home_dir()`.
pub fn install_bridge_plugin(
    plugin_src_dir: &Path,
    home_dir: &Path,
) -> Result<PathBuf, String> {
    let dest = plugin_install_dir(home_dir);

    std::fs::create_dir_all(&dest)
        .map_err(|e| format!("Cannot create plugin dir '{}': {e}", dest.display()))?;

    copy_dir_recursive(plugin_src_dir, &dest)?;

    tracing::info!("Bridge plugin installed to '{}'", dest.display());
    Ok(dest)
}

fn copy_dir_recursive(src: &Path, dst: &Path) -> Result<(), String> {
    for entry in std::fs::read_dir(src)
        .map_err(|e| format!("Cannot read '{}': {e}", src.display()))?
    {
        let entry    = entry.map_err(|e| e.to_string())?;
        let src_path = entry.path();
        let dst_path = dst.join(entry.file_name());

        if src_path.is_dir() {
            std::fs::create_dir_all(&dst_path).map_err(|e| e.to_string())?;
            copy_dir_recursive(&src_path, &dst_path)?;
        } else {
            std::fs::copy(&src_path, &dst_path).map_err(|e| {
                format!("Copy '{}' → '{}': {e}", src_path.display(), dst_path.display())
            })?;
        }
    }
    Ok(())
}
