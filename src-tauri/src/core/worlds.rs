use super::paths::{AppPaths, safe_leaf, validate_profile_id};
use super::profiles;
use super::storage::{atomic_write_json, copy_tree, directory_size};
use chrono::{DateTime, Utc};
use serde::Serialize;
use serde_json::to_value;
use std::fs;
use std::path::{Path, PathBuf};

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct WorldSummary {
    pub name: String,
    pub profile_id: String,
    pub profile_name: String,
    pub profile_version: String,
    pub size: u64,
    pub modified_at: String,
    pub valid: bool,
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct BackupSummary {
    pub id: String,
    pub created_at: String,
    pub size: u64,
}

fn saves(paths: &AppPaths, profile_id: &str) -> Result<PathBuf, String> {
    profiles::find(paths, profile_id)?;
    let saves = paths.profile(profile_id)?.join("saves");
    fs::create_dir_all(&saves)
        .map_err(|_| "Gleam could not open the profile's world folder.".to_string())?;
    Ok(saves)
}

fn world(paths: &AppPaths, profile_id: &str, name: &str) -> Result<PathBuf, String> {
    let safe = safe_leaf(name, 80, "world name")?;
    let path = saves(paths, profile_id)?.join(safe);
    if !path.is_dir() {
        return Err("That world was not found in this profile.".to_string());
    }
    Ok(path)
}

fn modified_iso(path: &Path) -> String {
    fs::metadata(path)
        .and_then(|metadata| metadata.modified())
        .map(DateTime::<Utc>::from)
        .map(|value| value.to_rfc3339())
        .unwrap_or_else(|_| Utc::now().to_rfc3339())
}

fn unique_name(parent: &Path, requested: &str) -> Result<String, String> {
    let base = safe_leaf(requested, 80, "world name")?;
    if !parent.join(&base).exists() {
        return Ok(base);
    }
    for suffix in 2..10_000 {
        let suffix_text = format!(" ({suffix})");
        let kept: String = base
            .chars()
            .take(80_usize.saturating_sub(suffix_text.len()))
            .collect();
        let candidate = format!("{kept}{suffix_text}");
        if !parent.join(&candidate).exists() {
            return Ok(candidate);
        }
    }
    Err("Gleam could not choose an unused world name.".to_string())
}

pub fn list(paths: &AppPaths, profile_id: &str) -> Result<Vec<WorldSummary>, String> {
    let profile = profiles::find(paths, profile_id)?;
    let saves = saves(paths, profile_id)?;
    let mut worlds = Vec::new();
    for entry in
        fs::read_dir(saves).map_err(|_| "Gleam could not read the world folder.".to_string())?
    {
        let entry = entry.map_err(|_| "Gleam could not inspect a world.".to_string())?;
        let file_type = entry
            .file_type()
            .map_err(|_| "Gleam could not inspect a world.".to_string())?;
        if !file_type.is_dir() || file_type.is_symlink() {
            continue;
        }
        let path = entry.path();
        worlds.push(WorldSummary {
            name: entry
                .file_name()
                .to_string_lossy()
                .chars()
                .take(80)
                .collect(),
            profile_id: profile.id.clone(),
            profile_name: profile.name.clone(),
            profile_version: profile.game_version.clone(),
            size: directory_size(&path),
            modified_at: modified_iso(&path),
            valid: path.join("level.dat").is_file(),
        });
    }
    worlds.sort_by(|left, right| right.modified_at.cmp(&left.modified_at));
    Ok(worlds)
}

pub fn duplicate(paths: &AppPaths, profile_id: &str, world_name: &str) -> Result<String, String> {
    let source = world(paths, profile_id, world_name)?;
    backup_profile(paths, profile_id, 5)?;
    let name = unique_name(
        source.parent().ok_or("That world has no parent folder.")?,
        &format!("{world_name} Copy"),
    )?;
    copy_tree(&source, &source.parent().unwrap().join(&name))?;
    Ok(name)
}

pub fn rename(
    paths: &AppPaths,
    profile_id: &str,
    world_name: &str,
    requested: &str,
) -> Result<String, String> {
    let source = world(paths, profile_id, world_name)?;
    let name = safe_leaf(requested, 80, "world name")?;
    if name == world_name {
        return Ok(name);
    }
    let target = source.parent().unwrap().join(&name);
    if target.exists() {
        return Err("A world with that name already exists in this profile.".to_string());
    }
    backup_profile(paths, profile_id, 5)?;
    fs::rename(source, target).map_err(|_| "Gleam could not rename that world.".to_string())?;
    Ok(name)
}

pub fn copy(
    paths: &AppPaths,
    source_profile_id: &str,
    world_name: &str,
    target_profile_id: &str,
) -> Result<String, String> {
    if source_profile_id == target_profile_id {
        return Err("Choose a different destination profile, or use Duplicate.".to_string());
    }
    let source = world(paths, source_profile_id, world_name)?;
    let target_saves = saves(paths, target_profile_id)?;
    backup_profile(paths, target_profile_id, 5)?;
    let name = unique_name(&target_saves, world_name)?;
    copy_tree(&source, &target_saves.join(&name))?;
    Ok(name)
}

pub fn remove(paths: &AppPaths, profile_id: &str, world_name: &str) -> Result<String, String> {
    let source = world(paths, profile_id, world_name)?;
    backup_profile(paths, profile_id, 5)?;
    let destination = paths.trash.join("worlds").join(format!(
        "{}-{profile_id}-{}",
        Utc::now().format("%Y-%m-%dT%H-%M-%S%.3fZ"),
        safe_leaf(world_name, 80, "world name")?
    ));
    fs::create_dir_all(destination.parent().unwrap())
        .map_err(|_| "Gleam could not create the world recovery folder.".to_string())?;
    fs::rename(source, &destination)
        .map_err(|_| "Gleam could not move that world to recoverable trash.".to_string())?;
    Ok(destination.to_string_lossy().to_string())
}

pub fn backup_profile(
    paths: &AppPaths,
    profile_id: &str,
    retention: usize,
) -> Result<BackupSummary, String> {
    validate_profile_id(profile_id)?;
    let profile = profiles::find(paths, profile_id)?;
    let source = paths.profile(profile_id)?;
    if !source.is_dir() {
        return Err("That profile directory no longer exists.".to_string());
    }
    let id = Utc::now().format("%Y-%m-%dT%H-%M-%S%.6fZ").to_string();
    let destination = paths.profile_backups(profile_id)?.join(&id);
    copy_tree(&source, &destination)?;
    atomic_write_json(
        &destination.join("swirl-profile.json"),
        &to_value(profile)
            .map_err(|_| "Gleam could not preserve the profile metadata.".to_string())?,
    )?;
    prune_backups(paths, profile_id, retention)?;
    Ok(BackupSummary {
        id,
        created_at: Utc::now().to_rfc3339(),
        size: directory_size(&destination),
    })
}

pub fn list_backups(paths: &AppPaths, profile_id: &str) -> Result<Vec<BackupSummary>, String> {
    profiles::find(paths, profile_id)?;
    let root = paths.profile_backups(profile_id)?;
    let mut backups = Vec::new();
    for entry in fs::read_dir(root).into_iter().flatten().flatten() {
        if !entry.file_type().is_ok_and(|kind| kind.is_dir())
            || entry.file_name() == "world-upgrades"
        {
            continue;
        }
        let id = entry.file_name().to_string_lossy().to_string();
        backups.push(BackupSummary {
            created_at: modified_iso(&entry.path()),
            size: directory_size(&entry.path()),
            id,
        });
    }
    backups.sort_by(|left, right| right.id.cmp(&left.id));
    Ok(backups)
}

fn prune_backups(paths: &AppPaths, profile_id: &str, retention: usize) -> Result<(), String> {
    let keep = retention.clamp(1, 20);
    for backup in list_backups(paths, profile_id)?.into_iter().skip(keep) {
        let target = paths.profile_backups(profile_id)?.join(backup.id);
        if target.is_dir() {
            fs::remove_dir_all(target)
                .map_err(|_| "Gleam could not prune an old backup.".to_string())?;
        }
    }
    Ok(())
}

pub fn restore_backup(
    paths: &AppPaths,
    profile_id: &str,
    backup_id: &str,
) -> Result<String, String> {
    validate_profile_id(profile_id)?;
    safe_leaf(backup_id, 96, "backup")?;
    let source = paths.profile_backups(profile_id)?.join(backup_id);
    if !source.is_dir() {
        return Err("That backup no longer exists.".to_string());
    }
    let target = paths.profile(profile_id)?;
    let safety = paths.trash.join("profiles").join(format!(
        "{}-{profile_id}-before-restore",
        Utc::now().format("%Y-%m-%dT%H-%M-%S%.3fZ")
    ));
    fs::create_dir_all(safety.parent().unwrap())
        .map_err(|_| "Gleam could not create a restore safety folder.".to_string())?;
    if target.exists() {
        fs::rename(&target, &safety)
            .map_err(|_| "Gleam could not preserve the current profile.".to_string())?;
    }
    if let Err(error) = copy_tree(&source, &target) {
        let _ = fs::remove_dir_all(&target);
        if safety.exists() {
            let _ = fs::rename(&safety, &target);
        }
        return Err(error);
    }
    let _ = fs::remove_file(target.join("swirl-profile.json"));
    Ok(safety.to_string_lossy().to_string())
}
