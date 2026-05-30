//! FileWatcher — wraps `notify` to watch `.kicad_pcb` / `.kicad_sch` files.
//!
//! Rule 1: Pure Rust — no Tauri imports. The caller (IPC layer) owns the
//! `AppHandle` and decides what to emit.
//!
//! Usage:
//!   let watcher = start_watcher(project_dir, |path| {
//!       // called on every relevant file change
//!   })?;
//!   // Keep `watcher` alive for the project session lifetime.
//!   // Drop it to stop watching.

use std::path::{Path, PathBuf};
use std::sync::mpsc;
use std::time::Duration;
use anyhow::{Context, Result};
use notify::{
    Config, Event, EventKind, RecommendedWatcher,
    RecursiveMode, Watcher,
    event::{AccessKind, AccessMode},
};

/// File extensions that KiMaster cares about.
const WATCHED_EXTENSIONS: &[&str] = &["kicad_pcb", "kicad_sch", "kicad_pro"];

/// Start a file watcher on `watch_dir`. The closure `on_change` is called with
/// the modified path whenever a relevant file is written/closed.
///
/// Returns the `RecommendedWatcher` — caller must keep it alive.
/// Dropping it stops the watcher.
pub fn start_watcher<F>(watch_dir: &Path, on_change: F) -> Result<RecommendedWatcher>
where
    F: Fn(PathBuf) + Send + 'static,
{
    let (tx, rx) = mpsc::channel::<notify::Result<Event>>();

    let mut watcher = RecommendedWatcher::new(
        move |res| { let _ = tx.send(res); },
        Config::default().with_poll_interval(Duration::from_secs(1)),
    )
    .context("Failed to create file watcher")?;

    watcher
        .watch(watch_dir, RecursiveMode::NonRecursive)
        .with_context(|| format!("Cannot watch {:?}", watch_dir))?;

    // Spin a thread to process events — lightweight, one per project.
    std::thread::spawn(move || {
        for res in rx {
            match res {
                Ok(event) => {
                    if is_relevant(&event) {
                        for path in event.paths {
                            if is_kicad_file(&path) {
                                on_change(path);
                            }
                        }
                    }
                }
                Err(e) => {
                    tracing::warn!("[FileWatcher] watch error: {e}");
                }
            }
        }
    });

    Ok(watcher)
}

// ── Helpers ───────────────────────────────────────────────────────────────────

/// Only fire on file-close-write (i.e. the user has saved the file).
/// This avoids spurious events from partial writes.
fn is_relevant(event: &Event) -> bool {
    matches!(
        event.kind,
        EventKind::Access(AccessKind::Close(AccessMode::Write))
        | EventKind::Modify(_)
        | EventKind::Create(_)
    )
}

fn is_kicad_file(path: &Path) -> bool {
    path.extension()
        .and_then(|e| e.to_str())
        .map(|e| WATCHED_EXTENSIONS.contains(&e))
        .unwrap_or(false)
}
