//! Runtime configuration loader.
//! Reads from environment variables and per-user config file.
//! All defaults come from AppConfig constants — never hardcoded here.

use std::env;

/// Returns the kicad-cli path: env var KIMASTER_KICAD_CLI overrides auto-discovery.
pub fn kicad_cli_override() -> Option<String> {
    env::var("KIMASTER_KICAD_CLI").ok()
}

/// Returns the bridge port: env var KIMASTER_BRIDGE_PORT overrides default.
pub fn bridge_port() -> u16 {
    env::var("KIMASTER_BRIDGE_PORT")
        .ok()
        .and_then(|v| v.parse().ok())
        .unwrap_or(crate::AppConfig::BRIDGE_WS_PORT)
}
