//! Export profile persistence — JSON files in {app_config_dir}/kimaster/export-profiles/.
//! Built-in templates are compiled into the binary via include_str!.

use std::fs;
use std::path::PathBuf;
use serde::{Deserialize, Serialize};
use serde_json::Value;
use tauri::{AppHandle, Manager};

// ── Built-in profiles (compiled in) ─────────────────────────────────────────

const PROFILE_UNIVERSAL: &str = include_str!("../../resources/profiles/kimaster_universal.json");
const PROFILE_JLCPCB:    &str = include_str!("../../resources/profiles/jlcpcb.json");
const PROFILE_PCBWAY:    &str = include_str!("../../resources/profiles/pcbway.json");
const PROFILE_GLOBAL:    &str = include_str!("../../resources/profiles/global.json");

fn builtin_profiles() -> Vec<(&'static str, &'static str)> {
    vec![
        ("kimaster_universal", PROFILE_UNIVERSAL),
        ("jlcpcb",             PROFILE_JLCPCB),
        ("pcbway",             PROFILE_PCBWAY),
        ("global",             PROFILE_GLOBAL),
    ]
}

// ── Types ─────────────────────────────────────────────────────────────────────

#[derive(Serialize, Deserialize)]
pub struct ProfileMeta {
    pub id:         String,
    pub name:       String,
    pub is_builtin: bool,
}

#[derive(Deserialize)]
pub struct SaveProfileArgs {
    pub profile: Value,
}

#[derive(Deserialize)]
pub struct LoadProfileArgs {
    pub id: String,
}

#[derive(Deserialize)]
pub struct DeleteProfileArgs {
    pub id: String,
}

#[derive(Deserialize)]
pub struct CloneBuiltinArgs {
    pub builtin_id: String,
    pub name:       String,
}

// ── Helpers ───────────────────────────────────────────────────────────────────

fn profiles_dir(app: &AppHandle) -> Result<PathBuf, String> {
    let base = app.path().app_config_dir()
        .map_err(|e| format!("Cannot resolve app config dir: {e}"))?;
    let dir = base.join("kimaster").join("export-profiles");
    fs::create_dir_all(&dir).map_err(|e| format!("Cannot create profiles dir: {e}"))?;
    Ok(dir)
}

fn user_profile_path(dir: &PathBuf, id: &str) -> PathBuf {
    // Sanitize id to be safe as a filename
    let safe: String = id.chars()
        .map(|c| if c.is_alphanumeric() || c == '-' || c == '_' { c } else { '_' })
        .collect();
    dir.join(format!("{safe}.json"))
}

// ── Commands ─────────────────────────────────────────────────────────────────

/// List all available profiles: built-ins first, then user profiles.
#[tauri::command]
pub async fn cmd_list_export_profiles(app: AppHandle) -> Result<Vec<ProfileMeta>, String> {
    let mut list: Vec<ProfileMeta> = builtin_profiles()
        .iter()
        .filter_map(|(_, src)| serde_json::from_str::<Value>(src).ok())
        .map(|v| ProfileMeta {
            id:         v["id"].as_str().unwrap_or("").to_string(),
            name:       v["name"].as_str().unwrap_or("").to_string(),
            is_builtin: true,
        })
        .collect();

    let dir = profiles_dir(&app)?;
    if let Ok(entries) = fs::read_dir(&dir) {
        for entry in entries.flatten() {
            let path = entry.path();
            if path.extension().map_or(false, |e| e == "json") {
                if let Ok(raw) = fs::read_to_string(&path) {
                    if let Ok(v) = serde_json::from_str::<Value>(&raw) {
                        list.push(ProfileMeta {
                            id:         v["id"].as_str().unwrap_or("").to_string(),
                            name:       v["name"].as_str().unwrap_or("").to_string(),
                            is_builtin: false,
                        });
                    }
                }
            }
        }
    }

    Ok(list)
}

/// Load a profile by ID. Built-ins are served from memory; user profiles from disk.
#[tauri::command]
pub async fn cmd_load_export_profile(
    app: AppHandle,
    args: LoadProfileArgs,
) -> Result<Value, String> {
    // Check built-ins first
    for (id, src) in builtin_profiles() {
        if id == args.id {
            return serde_json::from_str(src).map_err(|e| e.to_string());
        }
    }

    // Load user profile from disk
    let dir = profiles_dir(&app)?;
    let path = user_profile_path(&dir, &args.id);
    let raw = fs::read_to_string(&path)
        .map_err(|e| format!("Profile '{}' not found: {e}", args.id))?;
    serde_json::from_str(&raw).map_err(|e| e.to_string())
}

/// Save a user profile to disk. The profile must have an "id" field.
#[tauri::command]
pub async fn cmd_save_export_profile(
    app: AppHandle,
    args: SaveProfileArgs,
) -> Result<serde_json::Value, String> {
    let id = args.profile["id"].as_str()
        .ok_or("Profile must have an 'id' field")?
        .to_string();

    if builtin_profiles().iter().any(|(bid, _)| *bid == id) {
        return Err(format!("Cannot overwrite built-in profile '{id}'"));
    }

    let dir = profiles_dir(&app)?;
    let path = user_profile_path(&dir, &id);
    let json = serde_json::to_string_pretty(&args.profile).map_err(|e| e.to_string())?;
    fs::write(&path, json).map_err(|e| format!("Cannot save profile: {e}"))?;

    Ok(serde_json::json!({ "id": id }))
}

/// Delete a user profile by ID. Built-ins cannot be deleted.
#[tauri::command]
pub async fn cmd_delete_export_profile(
    app: AppHandle,
    args: DeleteProfileArgs,
) -> Result<(), String> {
    if builtin_profiles().iter().any(|(id, _)| *id == args.id) {
        return Err(format!("Cannot delete built-in profile '{}'", args.id));
    }

    let dir = profiles_dir(&app)?;
    let path = user_profile_path(&dir, &args.id);
    if path.exists() {
        fs::remove_file(&path).map_err(|e| format!("Cannot delete profile: {e}"))?;
    }
    Ok(())
}

/// Clone a built-in profile into a new user profile with a new name/id.
#[tauri::command]
pub async fn cmd_clone_builtin_profile(
    app: AppHandle,
    args: CloneBuiltinArgs,
) -> Result<Value, String> {
    let src = builtin_profiles()
        .into_iter()
        .find(|(id, _)| *id == args.builtin_id)
        .map(|(_, src)| src)
        .ok_or(format!("Built-in profile '{}' not found", args.builtin_id))?;

    let mut profile: Value = serde_json::from_str(src).map_err(|e| e.to_string())?;

    let new_id = format!("user_{}", args.builtin_id);
    profile["id"]         = Value::String(new_id.clone());
    profile["name"]       = Value::String(args.name.clone());
    profile["is_builtin"] = Value::Bool(false);

    let dir = profiles_dir(&app)?;
    let path = user_profile_path(&dir, &new_id);
    let json = serde_json::to_string_pretty(&profile).map_err(|e| e.to_string())?;
    fs::write(&path, json).map_err(|e| format!("Cannot save cloned profile: {e}"))?;

    Ok(profile)
}
