//! Async kicad-cli subprocess manager.
//! Spawns headless `kicad-cli` processes for DRC, ERC, and export commands.
//! All process spawning goes through `spawn_kicad_cli()` — single choke point.

use std::path::{Path, PathBuf};
use tokio::process::Command;
use serde::Serialize;

use super::DrcParser::{self, DrcReport};
use super::ErcParser::{self, ErcReport};

// ── Result types ───────────────────────────────────────────────────────────

/// Raw process output from a kicad-cli invocation.
#[derive(Debug, Clone, Serialize)]
pub struct CliOutput {
    pub exit_code: i32,
    pub stdout: String,
    pub stderr: String,
    pub success: bool,
}

/// Typed result from a DRC run.
#[derive(Debug, Clone, Serialize)]
pub struct DrcResult {
    pub report: Option<DrcReport>,
    pub raw: CliOutput,
    pub output_file: Option<String>,
}

/// Typed result from an ERC run.
#[derive(Debug, Clone, Serialize)]
pub struct ErcResult {
    pub report: Option<ErcReport>,
    pub raw: CliOutput,
    pub output_file: Option<String>,
}

/// Typed result from an export command (gerbers, SVG, PDF, etc.).
#[derive(Debug, Clone, Serialize)]
pub struct ExportResult {
    pub raw: CliOutput,
    pub output_path: Option<String>,
}

// ── Core process spawner ───────────────────────────────────────────────────

/// Single choke point for all kicad-cli invocations.
/// Spawns the process, captures stdout/stderr, returns structured output.
pub async fn spawn_kicad_cli(
    cli_path: &Path,
    args: &[&str],
) -> Result<CliOutput, String> {
    tracing::debug!(
        "Spawning: {} {}",
        cli_path.display(),
        args.join(" ")
    );

    let output = Command::new(cli_path)
        .args(args)
        .output()
        .await
        .map_err(|e| format!("Failed to spawn kicad-cli: {e}"))?;

    let exit_code = output.status.code().unwrap_or(-1);
    let stdout = String::from_utf8_lossy(&output.stdout).into_owned();
    let stderr = String::from_utf8_lossy(&output.stderr).into_owned();
    let success = output.status.success();

    if !success {
        tracing::warn!(
            "kicad-cli exited {exit_code}: {}",
            stderr.lines().next().unwrap_or("(no stderr)")
        );
    }

    Ok(CliOutput { exit_code, stdout, stderr, success })
}

// ── DRC ────────────────────────────────────────────────────────────────────

/// Run DRC on a `.kicad_pcb` file. Returns parsed report + raw output.
///
/// kicad-cli pcb drc \
///   --output <temp.json> \
///   --format json \
///   [--severity-error | --severity-warning | --severity-exclusion] \
///   [--exit-code-violations] \
///   <input.kicad_pcb>
pub async fn run_drc(
    cli_path: &Path,
    pcb_file: &Path,
    opts: &DrcOptions,
) -> Result<DrcResult, String> {
    // Create temp file for JSON output
    let tmp = tempfile::Builder::new()
        .prefix("km_drc_")
        .suffix(".json")
        .tempfile()
        .map_err(|e| format!("Failed to create temp file: {e}"))?;
    let output_path = tmp.path().to_path_buf();

    let mut args: Vec<String> = vec![
        "pcb".into(),
        "drc".into(),
        "--output".into(),
        output_path.to_string_lossy().into_owned(),
        "--format".into(),
        "json".into(),
    ];

    // Severity filters
    if opts.severity_all || (opts.severity_error && opts.severity_warning && opts.severity_exclusion) {
        // default — include all
    } else {
        if opts.severity_error     { args.push("--severity-error".into()); }
        if opts.severity_warning   { args.push("--severity-warning".into()); }
        if opts.severity_exclusion { args.push("--severity-exclusion".into()); }
    }

    if opts.exit_code_violations {
        args.push("--exit-code-violations".into());
    }

    // Input file must be last
    args.push(pcb_file.to_string_lossy().into_owned());

    let arg_refs: Vec<&str> = args.iter().map(|s| s.as_str()).collect();
    let raw = spawn_kicad_cli(cli_path, &arg_refs).await?;

    // Parse JSON output file
    let report = match std::fs::read_to_string(&output_path) {
        Ok(json_str) => {
            match DrcParser::parse_drc_json(&json_str) {
                Ok(r) => {
                    tracing::info!(
                        "DRC: {} violations ({} errors, {} warnings)",
                        r.total_issues(), r.error_count(), r.warning_count()
                    );
                    Some(r)
                }
                Err(e) => {
                    tracing::error!("Failed to parse DRC JSON: {e}");
                    None
                }
            }
        }
        Err(e) => {
            tracing::warn!("Could not read DRC output file: {e}");
            None
        }
    };

    Ok(DrcResult {
        report,
        raw,
        output_file: Some(output_path.to_string_lossy().into_owned()),
    })
}

/// Options for `run_drc()`.
#[derive(Debug, Clone)]
pub struct DrcOptions {
    pub severity_all: bool,
    pub severity_error: bool,
    pub severity_warning: bool,
    pub severity_exclusion: bool,
    pub exit_code_violations: bool,
}

impl Default for DrcOptions {
    fn default() -> Self {
        Self {
            severity_all: true,
            severity_error: true,
            severity_warning: true,
            severity_exclusion: true,
            exit_code_violations: false,
        }
    }
}

// ── ERC ────────────────────────────────────────────────────────────────────

/// Run ERC on a `.kicad_sch` file. Returns parsed report + raw output.
///
/// kicad-cli sch erc \
///   --output <temp.json> \
///   --format json \
///   [--severity-error | --severity-warning | --severity-exclusion] \
///   [--exit-code-violations] \
///   <input.kicad_sch>
pub async fn run_erc(
    cli_path: &Path,
    sch_file: &Path,
    opts: &ErcOptions,
) -> Result<ErcResult, String> {
    let tmp = tempfile::Builder::new()
        .prefix("km_erc_")
        .suffix(".json")
        .tempfile()
        .map_err(|e| format!("Failed to create temp file: {e}"))?;
    let output_path = tmp.path().to_path_buf();

    let mut args: Vec<String> = vec![
        "sch".into(),
        "erc".into(),
        "--output".into(),
        output_path.to_string_lossy().into_owned(),
        "--format".into(),
        "json".into(),
    ];

    if opts.severity_all || (opts.severity_error && opts.severity_warning && opts.severity_exclusion) {
        // default — include all
    } else {
        if opts.severity_error     { args.push("--severity-error".into()); }
        if opts.severity_warning   { args.push("--severity-warning".into()); }
        if opts.severity_exclusion { args.push("--severity-exclusion".into()); }
    }

    if opts.exit_code_violations {
        args.push("--exit-code-violations".into());
    }

    args.push(sch_file.to_string_lossy().into_owned());

    let arg_refs: Vec<&str> = args.iter().map(|s| s.as_str()).collect();
    let raw = spawn_kicad_cli(cli_path, &arg_refs).await?;

    let report = match std::fs::read_to_string(&output_path) {
        Ok(json_str) => {
            match ErcParser::parse_erc_json(&json_str) {
                Ok(r) => {
                    tracing::info!(
                        "ERC: {} violations ({} errors, {} warnings)",
                        r.total_violations(), r.error_count(), r.warning_count()
                    );
                    Some(r)
                }
                Err(e) => {
                    tracing::error!("Failed to parse ERC JSON: {e}");
                    None
                }
            }
        }
        Err(e) => {
            tracing::warn!("Could not read ERC output file: {e}");
            None
        }
    };

    Ok(ErcResult {
        report,
        raw,
        output_file: Some(output_path.to_string_lossy().into_owned()),
    })
}

/// Options for `run_erc()`.
#[derive(Debug, Clone)]
pub struct ErcOptions {
    pub severity_all: bool,
    pub severity_error: bool,
    pub severity_warning: bool,
    pub severity_exclusion: bool,
    pub exit_code_violations: bool,
}

impl Default for ErcOptions {
    fn default() -> Self {
        Self {
            severity_all: true,
            severity_error: true,
            severity_warning: true,
            severity_exclusion: true,
            exit_code_violations: false,
        }
    }
}

// ── Generic export runner ──────────────────────────────────────────────────

/// Run any kicad-cli export subcommand.
/// Used by `ExportRunner` module — this is the low-level spawn wrapper.
pub async fn run_export(
    cli_path: &Path,
    args: &[String],
    output_dir: &Path,
) -> Result<ExportResult, String> {
    // Ensure output directory exists
    if !output_dir.exists() {
        std::fs::create_dir_all(output_dir)
            .map_err(|e| format!("Cannot create output dir: {e}"))?;
    }

    let arg_refs: Vec<&str> = args.iter().map(|s| s.as_str()).collect();
    let raw = spawn_kicad_cli(cli_path, &arg_refs).await?;

    Ok(ExportResult {
        raw,
        output_path: Some(output_dir.to_string_lossy().into_owned()),
    })
}

// ── Version check ──────────────────────────────────────────────────────────

/// Get kicad-cli version string.
pub async fn get_version(cli_path: &Path) -> Result<String, String> {
    let raw = spawn_kicad_cli(cli_path, &["version"]).await?;
    Ok(raw.stdout.trim().to_string())
}

// ── Helpers ────────────────────────────────────────────────────────────────

/// Resolve kicad-cli path from state, env, or filesystem discovery.
pub fn resolve_cli_path(state_path: &Option<String>) -> Result<PathBuf, String> {
    // 1. Explicit state path (already resolved on startup)
    if let Some(p) = state_path {
        let path = PathBuf::from(p);
        if path.exists() {
            return Ok(path);
        }
    }
    // 2. Environment override
    if let Ok(env_path) = std::env::var("KIMASTER_KICAD_CLI") {
        let path = PathBuf::from(&env_path);
        if path.exists() {
            return Ok(path);
        }
    }
    // 3. Filesystem discovery (default + alt paths)
    super::resolve_kicad_cli()
        .ok_or_else(|| "kicad-cli not found. Install KiCad or set KIMASTER_KICAD_CLI".into())
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn test_drc_options_default() {
        let opts = DrcOptions::default();
        assert!(opts.severity_all);
        assert!(opts.severity_error);
        assert!(opts.severity_warning);
        assert!(!opts.exit_code_violations);
    }

    #[test]
    fn test_erc_options_default() {
        let opts = ErcOptions::default();
        assert!(opts.severity_all);
        assert!(!opts.exit_code_violations);
    }

    #[test]
    fn test_resolve_cli_path_from_state() {
        // Should return the state path if it exists on disk
        // (We can only test the None case portably)
        let result = resolve_cli_path(&Some("nonexistent_binary".into()));
        // Falls through to env var and then discovery
        // On CI without KiCad, this will be Err
        let _ = result; // Just verify it doesn't panic
    }
}
