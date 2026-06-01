//! Immutable application constants. All hardcoded values live here exclusively.

pub const APP_NAME: &str = "KiMaster";
pub const APP_VERSION: &str = env!("CARGO_PKG_VERSION");

pub const BRIDGE_WS_PORT: u16 = 40_001;
pub const BRIDGE_WS_CONNECT_TIMEOUT_MS: u64 = 3_000;

pub const KIMASTER_DIR: &str = ".kimaster";

/// Sub-directory inside Tauri's `app_data_dir` for the global component vault fallback.
pub const VAULT_DIR_NAME: &str = "vault";

/// Default global vault folder name inside the user's Documents directory.
/// Windows default: `%USERPROFILE%\Documents\KiMaster Library`
pub const GLOBAL_VAULT_DEFAULT_NAME: &str = "KiMaster Library";
pub const DB_FILENAME: &str = "db.sqlite";
pub const EMBEDDINGS_DB_FILENAME: &str = "embeddings.sqlite";
pub const CRDT_FILENAME: &str = "crdt_state.bin";
pub const AI_NOTES_FILENAME: &str = "ai_notes.md";
pub const COMPONENT_CACHE_FILENAME: &str = "component_cache.json";
/// Sub-directory inside `.kimaster/` for markdown images, notes attachments, etc.
pub const KIMASTER_ASSETS_DIR: &str = "assets";
pub const ASSETS_DIR: &str = "assets";

#[cfg(target_os = "windows")]
pub const KICAD_CLI_DEFAULT_PATH: &str = r"C:\Program Files\KiCad\10.0\bin\kicad-cli.exe";
#[cfg(target_os = "windows")]
pub const KICAD_PLUGIN_SUBDIR: &str = r"AppData\Roaming\kicad\10.0\scripting\plugins";

#[cfg(target_os = "macos")]
pub const KICAD_CLI_DEFAULT_PATH: &str =
    "/Applications/KiCad/KiCad.app/Contents/MacOS/kicad-cli";
#[cfg(target_os = "macos")]
pub const KICAD_PLUGIN_SUBDIR: &str = "Library/Preferences/kicad/10.0/scripting/plugins";

#[cfg(target_os = "linux")]
pub const KICAD_CLI_DEFAULT_PATH: &str = "/usr/bin/kicad-cli";
#[cfg(target_os = "linux")]
pub const KICAD_PLUGIN_SUBDIR: &str = ".local/share/kicad/10.0/scripting/plugins";

/// Alt fallback paths tried in order when the default is missing (Windows).
#[cfg(target_os = "windows")]
pub const KICAD_CLI_ALT_PATHS: &[&str] = &[
    r"C:\Program Files\KiCad\9.0\bin\kicad-cli.exe",
    r"C:\Program Files (x86)\KiCad\10.0\bin\kicad-cli.exe",
    r"C:\Program Files (x86)\KiCad\9.0\bin\kicad-cli.exe",
];
#[cfg(not(target_os = "windows"))]
pub const KICAD_CLI_ALT_PATHS: &[&str] = &[];
