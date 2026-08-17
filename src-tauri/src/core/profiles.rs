use super::paths::{AppPaths, validate_profile_id};
use super::storage::{atomic_write_json, copy_tree, read_json_or};
use chrono::Utc;
use serde::{Deserialize, Serialize};
use serde_json::{Map, Value};
use sha2::{Digest, Sha256};
use std::fs;
use std::path::Path;

#[derive(Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct Profile {
    pub id: String,
    pub name: String,
    pub game_version: String,
    #[serde(default = "default_preset")]
    pub preset: String,
    #[serde(default)]
    pub auto_sync: bool,
    #[serde(default)]
    pub created_at: String,
    #[serde(default)]
    pub mods: Vec<Value>,
    #[serde(flatten)]
    pub extra: Map<String, Value>,
}

fn default_preset() -> String {
    "custom".to_string()
}

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct CreateProfileRequest {
    pub name: String,
    pub game_version: String,
    #[serde(default)]
    pub preset: String,
    #[serde(default)]
    pub source_profile_id: String,
    #[serde(default)]
    pub copy_worlds: bool,
    #[serde(default)]
    pub copy_mods: bool,
    #[serde(default)]
    pub copy_settings: bool,
}

fn profile_file(paths: &AppPaths) -> std::path::PathBuf {
    paths.data.join("mod-profiles.json")
}

fn profile_backup_file(paths: &AppPaths) -> std::path::PathBuf {
    paths.data.join("mod-profiles.backup.json")
}

pub fn list(paths: &AppPaths) -> Result<Vec<Profile>, String> {
    let value = read_json_or(
        &profile_file(paths),
        &profile_backup_file(paths),
        Value::Array(Vec::new()),
    );
    serde_json::from_value(value).map_err(|_| "The profile store is not valid.".to_string())
}

pub fn find(paths: &AppPaths, id: &str) -> Result<Profile, String> {
    validate_profile_id(id)?;
    list(paths)?
        .into_iter()
        .find(|profile| profile.id == id)
        .ok_or("That profile was not found.".to_string())
}

fn save(paths: &AppPaths, profiles: &[Profile]) -> Result<(), String> {
    let file = profile_file(paths);
    if file.is_file() {
        fs::copy(&file, profile_backup_file(paths))
            .map_err(|_| "Gleam could not preserve the previous profile list.".to_string())?;
    }
    let value = serde_json::to_value(profiles)
        .map_err(|_| "Gleam could not encode the profile list.".to_string())?;
    atomic_write_json(&file, &value)
}

pub fn update_extra(
    paths: &AppPaths,
    id: &str,
    key: &str,
    value: Value,
) -> Result<Profile, String> {
    validate_profile_id(id)?;
    if key.is_empty() || key.len() > 80 {
        return Err("That profile setting name is invalid.".to_string());
    }
    let mut profiles = list(paths)?;
    let profile = profiles
        .iter_mut()
        .find(|profile| profile.id == id)
        .ok_or("That profile was not found.")?;
    profile.extra.insert(key.to_string(), value);
    let result = profile.clone();
    save(paths, &profiles)?;
    Ok(result)
}

pub fn update_mod_refs(paths: &AppPaths, id: &str, mods: Vec<Value>) -> Result<(), String> {
    validate_profile_id(id)?;
    let mut profiles = list(paths)?;
    let profile = profiles
        .iter_mut()
        .find(|profile| profile.id == id)
        .ok_or("That profile was not found.")?;
    profile.mods = mods;
    save(paths, &profiles)
}

fn new_id(paths: &AppPaths, name: &str) -> String {
    let mut counter = 0_u64;
    loop {
        let mut digest = Sha256::new();
        digest.update(name.as_bytes());
        digest.update(Utc::now().to_rfc3339().as_bytes());
        digest.update(counter.to_le_bytes());
        let id = hex::encode(digest.finalize())[..16].to_string();
        if !paths.profiles.join(&id).exists() {
            return id;
        }
        counter += 1;
    }
}

pub fn create(paths: &AppPaths, request: CreateProfileRequest) -> Result<Profile, String> {
    let name: String = request.name.trim().chars().take(50).collect();
    if name.is_empty() {
        return Err("Enter a name for the profile.".to_string());
    }
    let game_version: String = request.game_version.trim().chars().take(64).collect();
    if game_version.is_empty() || game_version.chars().any(char::is_whitespace) {
        return Err("Choose a valid Minecraft version.".to_string());
    }
    let mut profiles = list(paths)?;
    let id = new_id(paths, &name);
    let directory = paths.profile(&id)?;
    fs::create_dir_all(directory.join("mods"))
        .map_err(|_| "Gleam could not create the mod folder.".to_string())?;
    fs::create_dir_all(directory.join("saves"))
        .map_err(|_| "Gleam could not create the world folder.".to_string())?;
    fs::create_dir_all(directory.join("config"))
        .map_err(|_| "Gleam could not create the config folder.".to_string())?;
    atomic_write_json(
        &directory.join("mods").join("icecream-mods.json"),
        &Value::Array(Vec::new()),
    )?;

    let mut copied_mods = Vec::new();
    if !request.source_profile_id.is_empty() {
        let source = find(paths, &request.source_profile_id)?;
        let source_dir = paths.profile(&source.id)?;
        if request.copy_worlds && source_dir.join("saves").is_dir() {
            let _ = fs::remove_dir_all(directory.join("saves"));
            copy_tree(&source_dir.join("saves"), &directory.join("saves"))?;
        }
        if request.copy_settings && source_dir.join("options.txt").is_file() {
            fs::copy(
                source_dir.join("options.txt"),
                directory.join("options.txt"),
            )
            .map_err(|_| "Gleam could not copy Minecraft settings.".to_string())?;
        }
        if request.copy_mods
            && source.game_version == game_version
            && source_dir.join("mods").is_dir()
        {
            let _ = fs::remove_dir_all(directory.join("mods"));
            copy_tree(&source_dir.join("mods"), &directory.join("mods"))?;
            copied_mods = source.mods.clone();
        }
    }

    let profile = Profile {
        id,
        name,
        game_version,
        preset: match request.preset.as_str() {
            "vanilla" | "performance" | "custom" => request.preset,
            _ => "custom".to_string(),
        },
        auto_sync: false,
        created_at: Utc::now().to_rfc3339(),
        mods: copied_mods,
        extra: Map::new(),
    };
    profiles.push(profile.clone());
    if let Err(error) = save(paths, &profiles) {
        let _ = fs::remove_dir_all(directory);
        return Err(error);
    }
    Ok(profile)
}

pub fn rename(paths: &AppPaths, id: &str, requested_name: &str) -> Result<Profile, String> {
    validate_profile_id(id)?;
    let name: String = requested_name.trim().chars().take(50).collect();
    if name.is_empty() {
        return Err("Enter a name for the profile.".to_string());
    }
    let mut profiles = list(paths)?;
    let profile = profiles
        .iter_mut()
        .find(|profile| profile.id == id)
        .ok_or("That profile was not found.")?;
    profile.name = name;
    let result = profile.clone();
    save(paths, &profiles)?;
    Ok(result)
}

pub fn remove(paths: &AppPaths, id: &str) -> Result<(), String> {
    let profile = find(paths, id)?;
    let source = paths.profile(id)?;
    let destination = paths.trash.join("profiles").join(format!(
        "{}-{}",
        Utc::now().format("%Y-%m-%dT%H-%M-%S%.3fZ"),
        id
    ));
    if source.exists() {
        fs::create_dir_all(destination.parent().unwrap_or(Path::new(".")))
            .map_err(|_| "Gleam could not create the recovery folder.".to_string())?;
        fs::rename(&source, &destination)
            .map_err(|_| "Gleam could not move the profile to recoverable trash.".to_string())?;
    }
    let mut profiles = list(paths)?;
    profiles.retain(|candidate| candidate.id != profile.id);
    if let Err(error) = save(paths, &profiles) {
        if destination.exists() {
            let _ = fs::rename(destination, source);
        }
        return Err(error);
    }
    Ok(())
}
