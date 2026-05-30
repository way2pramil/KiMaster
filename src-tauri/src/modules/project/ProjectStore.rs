//! ProjectStore — SQLite-backed project database.
//!
//! Rule 1: This module is pure Rust — zero Tauri imports.
//! The DB file lives at `<project>/.kimaster/db.sqlite`.
//! Schema migrations are tracked via `PRAGMA user_version`.
//!
//! Schema v1:
//!   - `projects`  — recent project registry
//!   - `annotations` — per-component notes/tags (Phase 5)

use std::path::{Path, PathBuf};
use anyhow::{Context, Result};
use rusqlite::{Connection, params};
use serde::{Deserialize, Serialize};

/// Current schema version — bump when schema changes.
const SCHEMA_VERSION: u32 = 1;

/// Kimaster working directory name inside the project folder.
pub const KIMASTER_DIR: &str = ".kimaster";

/// SQLite file inside the kimaster dir.
pub const DB_FILE: &str = "db.sqlite";

// ── Types ─────────────────────────────────────────────────────────────────────

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct RecentProject {
    pub path:        String,
    pub name:        String,
    pub last_opened: String, // ISO-8601
}

// ── Provisioning ──────────────────────────────────────────────────────────────

/// Create the `.kimaster/` directory next to the `.kicad_pro` file if it does
/// not exist, and return its absolute path.
pub fn provision_kimaster_dir(pro_path: &Path) -> Result<PathBuf> {
    let parent = pro_path
        .parent()
        .with_context(|| format!("No parent directory for {:?}", pro_path))?;
    let km_dir = parent.join(KIMASTER_DIR);
    std::fs::create_dir_all(&km_dir)
        .with_context(|| format!("Cannot create {:?}", km_dir))?;
    Ok(km_dir)
}

/// Open (or create) the project SQLite database and apply pending migrations.
pub fn open_db(kimaster_dir: &Path) -> Result<Connection> {
    let db_path = kimaster_dir.join(DB_FILE);
    let conn = Connection::open(&db_path)
        .with_context(|| format!("Cannot open DB at {:?}", db_path))?;
    migrate(&conn)?;
    Ok(conn)
}

// ── Migrations ────────────────────────────────────────────────────────────────

fn migrate(conn: &Connection) -> Result<()> {
    let current: u32 = conn
        .pragma_query_value(None, "user_version", |row| row.get(0))
        .context("Cannot read user_version pragma")?;

    if current < 1 {
        conn.execute_batch(
            "BEGIN;
             CREATE TABLE IF NOT EXISTS recent_projects (
                 id          INTEGER PRIMARY KEY AUTOINCREMENT,
                 path        TEXT NOT NULL UNIQUE,
                 name        TEXT NOT NULL,
                 last_opened TEXT NOT NULL
             );
             CREATE TABLE IF NOT EXISTS annotations (
                 id        INTEGER PRIMARY KEY AUTOINCREMENT,
                 ref_des   TEXT NOT NULL,
                 tag       TEXT,
                 note      TEXT,
                 created   TEXT NOT NULL
             );
             PRAGMA user_version = 1;
             COMMIT;",
        )
        .context("Migration v1 failed")?;
    }

    // Future: if current < 2 { … }

    Ok(())
}

// ── Recent projects ───────────────────────────────────────────────────────────

/// Upsert a project into the global recent-projects registry.
/// Uses a separate DB at `~/.kimaster/global.sqlite` — this function
/// operates on a `Connection` already opened by the caller.
pub fn upsert_recent(conn: &Connection, path: &str, name: &str) -> Result<()> {
    let now = chrono_now();
    conn.execute(
        "INSERT INTO recent_projects (path, name, last_opened)
         VALUES (?1, ?2, ?3)
         ON CONFLICT(path) DO UPDATE SET name = excluded.name, last_opened = excluded.last_opened",
        params![path, name, now],
    )
    .context("upsert_recent failed")?;
    Ok(())
}

/// Return recent projects ordered by last_opened descending.
pub fn get_recent(conn: &Connection, limit: usize) -> Result<Vec<RecentProject>> {
    let mut stmt = conn.prepare(
        "SELECT path, name, last_opened FROM recent_projects
         ORDER BY last_opened DESC LIMIT ?1",
    )?;
    let rows = stmt.query_map(params![limit as i64], |row| {
        Ok(RecentProject {
            path:        row.get(0)?,
            name:        row.get(1)?,
            last_opened: row.get(2)?,
        })
    })?;
    rows.collect::<Result<Vec<_>, _>>().context("get_recent query failed")
}

/// Remove a project from the recent list.
pub fn remove_recent(conn: &Connection, path: &str) -> Result<()> {
    conn.execute("DELETE FROM recent_projects WHERE path = ?1", params![path])
        .context("remove_recent failed")?;
    Ok(())
}

// ── Helpers ───────────────────────────────────────────────────────────────────

fn chrono_now() -> String {
    // No chrono dep — use std::time for a simple ISO-8601-like string.
    use std::time::{SystemTime, UNIX_EPOCH};
    let secs = SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .unwrap_or_default()
        .as_secs();
    // Format: seconds since epoch as decimal (simple, sortable, no chrono dep)
    format!("{secs}")
}
