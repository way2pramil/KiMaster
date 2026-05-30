//! GitCommands — Tauri IPC handlers for git history and PCB diff.
//!
//! Rule 3: Thin wrappers only. All logic lives in modules/git/GitRunner.
//! Arg names must match AppCommands.js JSDoc exactly.

use std::path::PathBuf;
use tauri::State;
use serde::{Deserialize, Serialize};

use crate::AppState::KiMasterState;
use crate::modules::git::GitRunner::{self, GitCommit, DrcDiff};
use crate::modules::cli::CliRunner;
use crate::modules::cli::DrcParser;

// ── Response types ────────────────────────────────────────────────────────────

#[derive(Serialize, Deserialize)]
pub struct GitStatusResponse {
    pub available:    bool,
    pub is_repo:      bool,
    pub git_version:  Option<String>,
    pub repo_root:    Option<String>,
}

#[derive(Serialize, Deserialize)]
pub struct GitHistoryResponse {
    pub commits: Vec<GitCommit>,
    pub error:   Option<String>,
}

#[derive(Serialize, Deserialize)]
pub struct GitDrcDiffResponse {
    pub diff:          Option<DrcDiff>,
    pub commit_short:  String,
    pub error:         Option<String>,
}

// ── cmd_git_status ────────────────────────────────────────────────────────────

/// Check whether git is available and whether the active project is in a repo.
/// No args.
#[tauri::command]
pub async fn cmd_git_status(
    state: State<'_, KiMasterState>,
) -> Result<GitStatusResponse, String> {
    // Detect git binary
    let git_path = GitRunner::discover_git();
    let available = git_path.is_some();

    if !available {
        return Ok(GitStatusResponse { available: false, is_repo: false, git_version: None, repo_root: None });
    }

    // Detect git version
    let git_version = get_git_version().await;

    // Get project dir from active project
    let project_dir = {
        let guard = state.0.lock().unwrap();
        guard.active_project.as_ref()
            .and_then(|p| std::path::Path::new(&p.path).parent().map(|p| p.to_path_buf()))
    };

    let Some(proj_dir) = project_dir else {
        return Ok(GitStatusResponse { available, is_repo: false, git_version, repo_root: None });
    };

    let is_repo  = GitRunner::is_git_repo(&proj_dir).await;
    let repo_root = if is_repo {
        GitRunner::git_root(&proj_dir).await.map(|p| p.to_string_lossy().into_owned())
    } else {
        None
    };

    Ok(GitStatusResponse { available, is_repo, git_version, repo_root })
}

// ── cmd_git_get_history ───────────────────────────────────────────────────────

/// Return up to `limit` git commits that touched KiCad files in the project.
/// Args: { limit?: number }
#[tauri::command]
pub async fn cmd_git_get_history(
    state: State<'_, KiMasterState>,
    limit: Option<usize>,
) -> Result<GitHistoryResponse, String> {
    let project_dir = {
        let guard = state.0.lock().unwrap();
        guard.active_project.as_ref()
            .and_then(|p| std::path::Path::new(&p.path).parent().map(|p| p.to_path_buf()))
    };

    let Some(proj_dir) = project_dir else {
        return Ok(GitHistoryResponse { commits: vec![], error: Some("No active project".into()) });
    };

    let repo_root = match GitRunner::git_root(&proj_dir).await {
        Some(r) => r,
        None    => return Ok(GitHistoryResponse { commits: vec![], error: Some("Not a git repository".into()) }),
    };

    Ok(match GitRunner::get_project_history(&repo_root, limit.unwrap_or(25)).await {
        Ok(commits) => GitHistoryResponse { commits, error: None },
        Err(e)      => GitHistoryResponse { commits: vec![], error: Some(e.to_string()) },
    })
}

// ── cmd_git_diff_drc ─────────────────────────────────────────────────────────

/// Run DRC on the current PCB and the PCB at `commit_hash`, return the diff.
/// Args: { commit_hash: string }
#[tauri::command(rename_all = "snake_case")]
pub async fn cmd_git_diff_drc(
    state:       State<'_, KiMasterState>,
    commit_hash: String,
) -> Result<GitDrcDiffResponse, String> {
    // Gather from locked state, then release lock before any await
    let (pcb_path, project_dir, kicad_cli) = {
        let guard = state.0.lock().unwrap();
        let pcb = guard.active_project.as_ref().and_then(|p| p.pcb_file.clone());
        let dir = guard.active_project.as_ref()
            .and_then(|p| std::path::Path::new(&p.path).parent().map(|p| p.to_path_buf()));
        let cli = guard.kicad_cli_path.clone();
        (pcb, dir, cli)
    };

    let Some(pcb_abs)  = pcb_path   else { return Ok(err_resp("No PCB file in active project", &commit_hash)); };
    let Some(proj_dir) = project_dir else { return Ok(err_resp("No active project directory",  &commit_hash)); };
    let Some(cli_path) = kicad_cli   else { return Ok(err_resp("kicad-cli not found",           &commit_hash)); };

    let repo_root = match GitRunner::git_root(&proj_dir).await {
        Some(r) => r,
        None    => return Ok(err_resp("Not a git repository", &commit_hash)),
    };

    let pcb_path_obj = PathBuf::from(&pcb_abs);
    let pcb_rel = match pcb_path_obj.strip_prefix(&repo_root) {
        Ok(rel) => rel.to_string_lossy().replace('\\', "/"),
        Err(_)  => return Ok(err_resp("PCB file is outside the git repository", &commit_hash)),
    };

    let old_tmp = match GitRunner::checkout_file_to_temp(&repo_root, &pcb_rel, &commit_hash).await {
        Ok(p)  => p,
        Err(e) => return Ok(err_resp(&format!("Cannot extract PCB at {commit_hash}: {e}"), &commit_hash)),
    };

    let cli      = PathBuf::from(&cli_path);
    let cli2     = cli.clone();
    let pcb_cur  = pcb_path_obj.clone();
    let tmp2     = old_tmp.clone();

    let (current_res, old_res) = tokio::join!(
        run_drc_quiet(&cli, &pcb_cur),
        run_drc_quiet(&cli2, &tmp2),
    );
    let _ = std::fs::remove_file(&old_tmp);

    let current_viols = match current_res {
        Ok(r)  => r,
        Err(e) => return Ok(err_resp(&format!("DRC on current PCB failed: {e}"), &commit_hash)),
    };
    let old_viols = match old_res {
        Ok(r)  => r,
        Err(e) => return Ok(err_resp(&format!("DRC on old PCB failed: {e}"),     &commit_hash)),
    };

    let diff = GitRunner::diff_drc_results(&current_viols, &old_viols);
    Ok(GitDrcDiffResponse {
        diff:         Some(diff),
        commit_short: commit_hash.chars().take(8).collect(),
        error:        None,
    })
}

// ── cmd_git_show_file ─────────────────────────────────────────────────────────

/// Return the raw content of a file at a given commit (for future viewer use).
/// Args: { commit_hash: string, file_rel: string }
#[tauri::command(rename_all = "snake_case")]
pub async fn cmd_git_show_file(
    state:       State<'_, KiMasterState>,
    commit_hash: String,
    file_rel:    String,
) -> Result<String, String> {
    let project_dir = {
        let guard = state.0.lock().unwrap();
        guard.active_project.as_ref()
            .and_then(|p| std::path::Path::new(&p.path).parent().map(|p| p.to_path_buf()))
    };
    let Some(proj_dir) = project_dir else { return Err("No active project".into()); };
    let Some(repo_root) = GitRunner::git_root(&proj_dir).await
        else { return Err("Not a git repository".into()); };

    let tmp = GitRunner::checkout_file_to_temp(&repo_root, &file_rel, &commit_hash)
        .await
        .map_err(|e| e.to_string())?;

    let content = std::fs::read_to_string(&tmp).map_err(|e| e.to_string())?;
    let _ = std::fs::remove_file(&tmp);
    Ok(content)
}

// ── Helpers ───────────────────────────────────────────────────────────────────

fn err_resp(msg: &str, hash: &str) -> GitDrcDiffResponse {
    GitDrcDiffResponse {
        diff:         None,
        commit_short: hash.chars().take(8).collect(),
        error:        Some(msg.to_string()),
    }
}

/// Run DRC quietly and return violations, or an error.
async fn run_drc_quiet(
    kicad_cli: &std::path::Path,
    pcb_file:  &std::path::Path,
) -> anyhow::Result<Vec<DrcParser::DrcViolation>> {
    use crate::modules::cli::CliRunner::DrcOptions;

    let opts   = DrcOptions::default();
    let result = CliRunner::run_drc(kicad_cli, pcb_file, &opts)
        .await
        .map_err(|e| anyhow::anyhow!(e))?;

    Ok(result.report.map(|r| r.violations).unwrap_or_default())
}

async fn get_git_version() -> Option<String> {
    let git = GitRunner::discover_git()?;
    let out = tokio::process::Command::new(&git)
        .arg("--version")
        .output()
        .await
        .ok()?;
    let v = String::from_utf8_lossy(&out.stdout);
    Some(v.trim().to_string())
}
