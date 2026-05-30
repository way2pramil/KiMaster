//! GitRunner — thin subprocess wrapper around the `git` CLI.
//!
//! Rule 1: Pure Rust — no Tauri imports anywhere in this file.
//! Uses `tokio::process::Command` (same pattern as CliRunner.rs).
//!
//! Key operations:
//!  - is_git_repo(dir)          → bool
//!  - get_project_history(...)  → Vec<GitCommit>
//!  - checkout_file_to_temp(…)  → PathBuf (temp file path)
//!  - discover_git()            → Option<PathBuf>

use std::path::{Path, PathBuf};
use anyhow::{Context, Result, bail};
use serde::{Deserialize, Serialize};
use tokio::process::Command;

// ── Types ─────────────────────────────────────────────────────────────────────

/// A single git commit that touched at least one KiCad file.
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct GitCommit {
    /// Full 40-char SHA.
    pub hash:    String,
    /// Abbreviated 8-char SHA.
    pub short:   String,
    /// ISO-8601 date string (YYYY-MM-DD).
    pub date:    String,
    /// Author name.
    pub author:  String,
    /// Commit subject line.
    pub message: String,
    /// KiCad files changed in this commit.
    pub files:   Vec<String>,
}

/// Violation in a DRC diff result — minimal shape for cross-commit comparison.
#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq, Hash)]
pub struct DiffViolation {
    pub description:    String,
    pub severity:       String,
    pub violation_type: String,
}

/// Result of comparing DRC results between two commits.
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct DrcDiff {
    /// New violations not present in the reference commit.
    pub added:     Vec<DiffViolation>,
    /// Violations that were in the reference commit but are now fixed.
    pub fixed:     Vec<DiffViolation>,
    /// Violations present in both.
    pub unchanged: Vec<DiffViolation>,
}

// ── Git discovery ─────────────────────────────────────────────────────────────

/// Return the path to the `git` binary, or None if not found.
pub fn discover_git() -> Option<PathBuf> {
    which::which("git").ok()
}

/// Return true if `dir` (or any ancestor) is inside a git working tree.
pub async fn is_git_repo(dir: &Path) -> bool {
    let Some(git) = discover_git() else { return false; };
    Command::new(&git)
        .args(["-C", &dir.to_string_lossy(), "rev-parse", "--is-inside-work-tree"])
        .output()
        .await
        .map(|o| o.status.success())
        .unwrap_or(false)
}

/// Return the root of the git repository that contains `dir`, or None.
pub async fn git_root(dir: &Path) -> Option<PathBuf> {
    let git = discover_git()?;
    let out = Command::new(&git)
        .args(["-C", &dir.to_string_lossy(), "rev-parse", "--show-toplevel"])
        .output()
        .await
        .ok()?;
    if !out.status.success() { return None; }
    let root = String::from_utf8_lossy(&out.stdout).trim().to_string();
    Some(PathBuf::from(root))
}

// ── History ───────────────────────────────────────────────────────────────────

/// Return up to `limit` commits that changed `.kicad_pcb` or `.kicad_sch` files
/// within the repository rooted at `repo_root`.
pub async fn get_project_history(repo_root: &Path, limit: usize) -> Result<Vec<GitCommit>> {
    let git = discover_git().context("git not found on PATH")?;

    // First pass: get hashes/metadata for commits that touched kicad files
    let log_out = Command::new(&git)
        .current_dir(repo_root)
        .args([
            "log",
            &format!("-n{}", limit * 2), // overshoot to account for non-kicad commits
            "--pretty=format:%H\x1f%h\x1f%ad\x1f%an\x1f%s",
            "--date=short",
            "--",
            "*.kicad_pcb",
            "*.kicad_sch",
            "*.kicad_pro",
        ])
        .output()
        .await
        .context("git log failed")?;

    if !log_out.status.success() {
        let stderr = String::from_utf8_lossy(&log_out.stderr);
        bail!("git log error: {stderr}");
    }

    let log_text = String::from_utf8_lossy(&log_out.stdout);
    let mut commits: Vec<GitCommit> = Vec::new();

    for line in log_text.lines() {
        let parts: Vec<&str> = line.splitn(5, '\x1f').collect();
        if parts.len() < 5 { continue; }

        let hash = parts[0].to_string();

        // Get files changed in this commit (kicad only)
        let files = get_changed_kicad_files(repo_root, &git, &hash).await;

        if files.is_empty() { continue; } // skip commits with no kicad files

        commits.push(GitCommit {
            hash:    hash,
            short:   parts[1].to_string(),
            date:    parts[2].to_string(),
            author:  parts[3].to_string(),
            message: parts[4].to_string(),
            files,
        });

        if commits.len() >= limit { break; }
    }

    Ok(commits)
}

/// Return the list of `.kicad_*` files touched by `hash`.
async fn get_changed_kicad_files(repo_root: &Path, git: &Path, hash: &str) -> Vec<String> {
    let out = Command::new(git)
        .current_dir(repo_root)
        .args(["show", "--name-only", "--format=", hash])
        .output()
        .await;

    let Ok(o) = out else { return vec![]; };
    String::from_utf8_lossy(&o.stdout)
        .lines()
        .filter(|l| {
            let l = l.trim();
            !l.is_empty()
                && (l.ends_with(".kicad_pcb") || l.ends_with(".kicad_sch") || l.ends_with(".kicad_pro"))
        })
        .map(|l| l.trim().to_string())
        .collect()
}

// ── File extraction ───────────────────────────────────────────────────────────

/// Extract the contents of `file_rel` (repo-relative path) at commit `hash`
/// into a temporary file. Returns the temp file path.
///
/// The caller is responsible for deleting the temp file when done.
pub async fn checkout_file_to_temp(
    repo_root: &Path,
    file_rel:  &str,
    hash:      &str,
) -> Result<PathBuf> {
    let git = discover_git().context("git not found on PATH")?;

    let out = Command::new(&git)
        .current_dir(repo_root)
        .args(["show", &format!("{hash}:{file_rel}")])
        .output()
        .await
        .with_context(|| format!("git show {hash}:{file_rel} failed"))?;

    if !out.status.success() {
        let stderr = String::from_utf8_lossy(&out.stderr);
        bail!("git show error: {stderr}");
    }

    // Write to a named temp file with the same extension
    let ext = std::path::Path::new(file_rel)
        .extension()
        .and_then(|e| e.to_str())
        .unwrap_or("tmp");
    let tmp = tempfile::Builder::new()
        .suffix(&format!(".{ext}"))
        .tempfile()
        .context("Cannot create temp file")?;
    let tmp_path = tmp.path().to_path_buf();

    std::fs::write(&tmp_path, &out.stdout)
        .with_context(|| format!("Cannot write temp file {:?}", tmp_path))?;

    // Leak the NamedTempFile so the file persists; caller must clean up
    std::mem::forget(tmp);

    Ok(tmp_path)
}

// ── DRC diff ──────────────────────────────────────────────────────────────────

/// Compare DRC violations between `current_drc` JSON output and `old_drc` JSON.
/// Returns added/fixed/unchanged violation sets.
///
/// Uses `description + violation_type` as the comparison key (positions may
/// shift between commits so positional matching is unreliable).
pub fn diff_drc_results(
    current_violations: &[crate::modules::cli::DrcParser::DrcViolation],
    old_violations:     &[crate::modules::cli::DrcParser::DrcViolation],
) -> DrcDiff {
    use std::collections::HashSet;

    let key = |v: &crate::modules::cli::DrcParser::DrcViolation| -> String {
        format!("{}|{}", v.description, v.violation_type)
    };

    let current_keys: HashSet<String> = current_violations.iter().map(key).collect();
    let old_keys:     HashSet<String> = old_violations.iter().map(key).collect();

    let to_diff = |v: &crate::modules::cli::DrcParser::DrcViolation| DiffViolation {
        description:    v.description.clone(),
        severity:       v.severity.clone(),
        violation_type: v.violation_type.clone(),
    };

    DrcDiff {
        added:     current_violations.iter().filter(|v| !old_keys.contains(&key(v))).map(to_diff).collect(),
        fixed:     old_violations.iter().filter(|v|     !current_keys.contains(&key(v))).map(to_diff).collect(),
        unchanged: current_violations.iter().filter(|v| old_keys.contains(&key(v))).map(to_diff).collect(),
    }
}
