use super::network::{NetworkClient, file_hash};
use super::paths::{AppPaths, validate_profile_id};
use super::profiles;
use super::storage::{atomic_write_json, read_json_or};
use chrono::Utc;
use serde::{Deserialize, Serialize};
use serde_json::{Value, json};
use std::collections::{HashMap, HashSet};
use std::fs;
use std::path::{Path, PathBuf};
use url::Url;

const MODRINTH_API: &str = "https://api.modrinth.com/v2";

#[derive(Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct InstalledMod {
    pub project_id: String,
    pub version_id: String,
    #[serde(default)]
    pub version_number: String,
    pub file: String,
    #[serde(default)]
    pub name: String,
    #[serde(default)]
    pub sha1: String,
    #[serde(default)]
    pub sha512: String,
}

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct InstallRequest {
    pub profile_id: String,
    pub project_id: String,
    #[serde(default)]
    pub version_id: String,
}

fn manifest(paths: &AppPaths, profile_id: &str) -> Result<PathBuf, String> {
    validate_profile_id(profile_id)?;
    Ok(paths
        .profile(profile_id)?
        .join("mods")
        .join("icecream-mods.json"))
}

pub fn list(paths: &AppPaths, profile_id: &str) -> Result<Vec<InstalledMod>, String> {
    profiles::find(paths, profile_id)?;
    let file = manifest(paths, profile_id)?;
    let value = read_json_or(
        &file,
        &file.with_extension("json.bak"),
        Value::Array(Vec::new()),
    );
    serde_json::from_value(value).map_err(|_| "The installed-mod manifest is damaged.".to_string())
}

fn save(paths: &AppPaths, profile_id: &str, mods: &[InstalledMod]) -> Result<(), String> {
    let file = manifest(paths, profile_id)?;
    if file.is_file() {
        fs::copy(&file, file.with_extension("json.bak"))
            .map_err(|_| "Gleam could not preserve the previous mod manifest.".to_string())?;
    }
    let value = serde_json::to_value(mods)
        .map_err(|_| "Gleam could not encode the mod manifest.".to_string())?;
    atomic_write_json(&file, &value)?;
    profiles::update_mod_refs(
        paths,
        profile_id,
        mods.iter()
            .map(|item| json!({ "projectId": item.project_id, "versionId": item.version_id }))
            .collect(),
    )
}

fn compatible_versions(
    network: &NetworkClient,
    project_id: &str,
    game_version: &str,
) -> Result<Vec<Value>, String> {
    let loaders = urlencoding::encode("[\"fabric\"]");
    let version_filter = serde_json::to_string(&[game_version]).unwrap();
    let versions = urlencoding::encode(&version_filter);
    let value = network.json(&format!(
        "{MODRINTH_API}/project/{}/version?loaders={loaders}&game_versions={versions}",
        urlencoding::encode(project_id)
    ))?;
    value
        .as_array()
        .cloned()
        .ok_or("Modrinth returned an invalid version list.".to_string())
}

fn choose_version(
    network: &NetworkClient,
    project_id: &str,
    game_version: &str,
    requested: &str,
) -> Result<Value, String> {
    if !requested.is_empty() {
        let value = network.json(&format!(
            "{MODRINTH_API}/version/{}",
            urlencoding::encode(requested)
        ))?;
        if value.get("project_id").and_then(Value::as_str) != Some(project_id)
            || !value
                .get("game_versions")
                .and_then(Value::as_array)
                .is_some_and(|items| items.iter().any(|item| item.as_str() == Some(game_version)))
            || !value
                .get("loaders")
                .and_then(Value::as_array)
                .is_some_and(|items| items.iter().any(|item| item.as_str() == Some("fabric")))
        {
            return Err(format!(
                "That mod version is not compatible with Fabric {game_version}."
            ));
        }
        return Ok(value);
    }
    let versions = compatible_versions(network, project_id, game_version)?;
    versions
        .iter()
        .find(|version| version.get("version_type").and_then(Value::as_str) == Some("release"))
        .or_else(|| versions.first())
        .cloned()
        .ok_or_else(|| {
            format!("No compatible Fabric {game_version} version was found for this mod.")
        })
}

fn safe_file_name(url: &str) -> Result<String, String> {
    let parsed =
        Url::parse(url).map_err(|_| "Modrinth returned an invalid download URL.".to_string())?;
    let name = Path::new(parsed.path())
        .file_name()
        .and_then(|value| value.to_str())
        .ok_or("The mod download has no valid filename.")?;
    if !name.to_ascii_lowercase().ends_with(".jar") || name.len() > 180 {
        return Err("The selected Modrinth file is not a valid JAR.".to_string());
    }
    Ok(name.to_string())
}

fn install_recursive(
    paths: &AppPaths,
    network: &NetworkClient,
    profile_id: &str,
    game_version: &str,
    project_id: &str,
    requested: &str,
    visited: &mut HashSet<String>,
) -> Result<Vec<String>, String> {
    if !visited.insert(project_id.to_string()) {
        return Ok(Vec::new());
    }
    let version = choose_version(network, project_id, game_version, requested)?;
    let mut installed_names = Vec::new();
    for dependency in version
        .get("dependencies")
        .and_then(Value::as_array)
        .into_iter()
        .flatten()
    {
        if dependency.get("dependency_type").and_then(Value::as_str) != Some("required") {
            continue;
        }
        let dependency_version = dependency
            .get("version_id")
            .and_then(Value::as_str)
            .unwrap_or("");
        let dependency_project =
            if let Some(project) = dependency.get("project_id").and_then(Value::as_str) {
                project.to_string()
            } else if !dependency_version.is_empty() {
                network
                    .json(&format!(
                        "{MODRINTH_API}/version/{}",
                        urlencoding::encode(dependency_version)
                    ))?
                    .get("project_id")
                    .and_then(Value::as_str)
                    .ok_or("A required dependency has no project ID.")?
                    .to_string()
            } else {
                continue;
            };
        installed_names.extend(install_recursive(
            paths,
            network,
            profile_id,
            game_version,
            &dependency_project,
            dependency_version,
            visited,
        )?);
    }
    let file = version
        .get("files")
        .and_then(Value::as_array)
        .and_then(|files| {
            files
                .iter()
                .find(|file| file.get("primary").and_then(Value::as_bool) == Some(true))
                .or_else(|| files.first())
        })
        .ok_or("The selected Modrinth version contains no downloadable file.")?;
    let url = file
        .get("url")
        .and_then(Value::as_str)
        .ok_or("The mod file has no download URL.")?;
    let name = safe_file_name(url)?;
    let mods_dir = paths.profile(profile_id)?.join("mods");
    fs::create_dir_all(&mods_dir)
        .map_err(|_| "Gleam could not create the mod folder.".to_string())?;
    let destination = mods_dir.join(&name);
    let sha1 = file
        .pointer("/hashes/sha1")
        .and_then(Value::as_str)
        .unwrap_or("");
    network.download(url, &destination, sha1)?;
    let mut manifest = list(paths, profile_id)?;
    if let Some(previous) = manifest.iter().find(|item| item.project_id == project_id) {
        if previous.file != name {
            let old = mods_dir.join(&previous.file);
            if old.is_file() {
                fs::remove_file(old)
                    .map_err(|_| "Gleam could not replace the previous mod file.".to_string())?;
            }
        }
    }
    manifest.retain(|item| item.project_id != project_id);
    let display_name = version
        .get("name")
        .and_then(Value::as_str)
        .unwrap_or(project_id)
        .to_string();
    manifest.push(InstalledMod {
        project_id: project_id.to_string(),
        version_id: version
            .get("id")
            .and_then(Value::as_str)
            .ok_or("The Modrinth version has no ID.")?
            .to_string(),
        version_number: version
            .get("version_number")
            .and_then(Value::as_str)
            .unwrap_or("")
            .to_string(),
        file: name,
        name: display_name.clone(),
        sha1: sha1.to_string(),
        sha512: file
            .pointer("/hashes/sha512")
            .and_then(Value::as_str)
            .map(str::to_owned)
            .unwrap_or(file_hash(&destination, 128)?),
    });
    manifest.sort_by(|left, right| left.name.cmp(&right.name));
    save(paths, profile_id, &manifest)?;
    installed_names.push(display_name);
    Ok(installed_names)
}

pub fn install(
    paths: &AppPaths,
    network: &NetworkClient,
    request: InstallRequest,
) -> Result<Vec<String>, String> {
    let profile = profiles::find(paths, &request.profile_id)?;
    if request.project_id.is_empty() || request.project_id.len() > 128 {
        return Err("Choose a valid Modrinth project.".to_string());
    }
    install_recursive(
        paths,
        network,
        &profile.id,
        &profile.game_version,
        &request.project_id,
        &request.version_id,
        &mut HashSet::new(),
    )
}

pub fn remove(paths: &AppPaths, profile_id: &str, project_id: &str) -> Result<bool, String> {
    let mut manifest = list(paths, profile_id)?;
    let Some(current) = manifest
        .iter()
        .find(|item| item.project_id == project_id)
        .cloned()
    else {
        return Ok(false);
    };
    let file = paths.profile(profile_id)?.join("mods").join(current.file);
    if file.is_file() {
        fs::remove_file(file).map_err(|_| "Gleam could not remove that mod file.".to_string())?;
    }
    manifest.retain(|item| item.project_id != project_id);
    save(paths, profile_id, &manifest)?;
    Ok(true)
}

pub fn search(network: &NetworkClient, query: &str, game_version: &str) -> Result<Value, String> {
    let facets = serde_json::to_string(&[
        [format!("versions:{game_version}")],
        ["categories:fabric".to_string()],
        ["project_type:mod".to_string()],
    ])
    .unwrap();
    let response = network.json(&format!(
        "{MODRINTH_API}/search?query={}&limit=24&index=relevance&facets={}",
        urlencoding::encode(&query.chars().take(120).collect::<String>()),
        urlencoding::encode(&facets)
    ))?;
    Ok(response
        .get("hits")
        .cloned()
        .unwrap_or(Value::Array(Vec::new())))
}

pub fn plan_updates(
    paths: &AppPaths,
    network: &NetworkClient,
    profile_id: &str,
) -> Result<Vec<Value>, String> {
    let profile = profiles::find(paths, profile_id)?;
    let mut plan = Vec::new();
    for installed in list(paths, profile_id)? {
        let latest = choose_version(network, &installed.project_id, &profile.game_version, "")?;
        let latest_id = latest.get("id").and_then(Value::as_str).unwrap_or("");
        if latest_id != installed.version_id {
            plan.push(json!({
                "projectId": installed.project_id,
                "name": installed.name,
                "fromVersionId": installed.version_id,
                "fromVersion": installed.version_number,
                "toVersionId": latest_id,
                "toVersion": latest.get("version_number").and_then(Value::as_str).unwrap_or(latest_id)
            }));
        }
    }
    Ok(plan)
}

pub fn install_bundled(
    paths: &AppPaths,
    profile_id: &str,
    game_version: &str,
) -> Result<bool, String> {
    let source = paths.bundled_mod(game_version)?;
    if !source.is_file() {
        return Ok(false);
    }
    let mods = paths.profile(profile_id)?.join("mods");
    fs::create_dir_all(&mods)
        .map_err(|_| "Gleam could not create the profile mod folder.".to_string())?;
    let bundled_name = source
        .file_name()
        .and_then(|name| name.to_str())
        .ok_or("The bundled module has an invalid filename.")?;
    for entry in fs::read_dir(&mods).into_iter().flatten().flatten() {
        let name = entry.file_name().to_string_lossy().to_string();
        if name.starts_with("swirl-client-") && name.ends_with(".jar") && name != bundled_name {
            let _ = fs::remove_file(entry.path());
        }
    }
    fs::copy(&source, mods.join(source.file_name().unwrap()))
        .map_err(|_| "Gleam could not install its bundled in-game module.".to_string())?;
    Ok(true)
}

pub fn write_lock(paths: &AppPaths, profile_id: &str) -> Result<Value, String> {
    let profile = profiles::find(paths, profile_id)?;
    let mut locked = Vec::new();
    for item in list(paths, profile_id)? {
        let file = paths.profile(profile_id)?.join("mods").join(&item.file);
        if !file.is_file() {
            return Err(format!("Cannot lock missing mod file: {}", item.file));
        }
        locked.push(json!({
            "projectId": item.project_id,
            "versionId": item.version_id,
            "versionNumber": item.version_number,
            "file": item.file,
            "sha512": if item.sha512.is_empty() { file_hash(&file, 128)? } else { item.sha512 }
        }));
    }
    locked.sort_by(|left, right| {
        left.get("projectId")
            .and_then(Value::as_str)
            .cmp(&right.get("projectId").and_then(Value::as_str))
    });
    let lock = json!({
        "format": 1,
        "profileId": profile.id,
        "gameVersion": profile.game_version,
        "fabricLoaderVersion": profile.extra.get("fabricLoaderVersion").and_then(Value::as_str).unwrap_or(""),
        "generatedAt": Utc::now().to_rfc3339(),
        "mods": locked
    });
    atomic_write_json(&paths.profile(profile_id)?.join("swirl.lock.json"), &lock)?;
    Ok(lock)
}

pub fn verify_lock(paths: &AppPaths, profile_id: &str) -> Result<Value, String> {
    let profile = profiles::find(paths, profile_id)?;
    let lock_file = paths.profile(profile_id)?.join("swirl.lock.json");
    if !lock_file.is_file() {
        return write_lock(paths, profile_id);
    }
    let lock = super::storage::read_json(&lock_file)?;
    if lock.get("gameVersion").and_then(Value::as_str) != Some(profile.game_version.as_str()) {
        return Err("This profile lockfile belongs to a different Minecraft version.".to_string());
    }
    let manifest = list(paths, profile_id)?;
    let expected: HashMap<&str, &Value> = lock
        .get("mods")
        .and_then(Value::as_array)
        .into_iter()
        .flatten()
        .filter_map(|item| Some((item.get("projectId")?.as_str()?, item)))
        .collect();
    if manifest.len() != expected.len() {
        return Err("The profile mod list does not match swirl.lock.json.".to_string());
    }
    for item in manifest {
        let pinned = expected
            .get(item.project_id.as_str())
            .ok_or("A managed mod is missing from the lockfile.")?;
        if pinned.get("versionId").and_then(Value::as_str) != Some(item.version_id.as_str())
            || pinned.get("file").and_then(Value::as_str) != Some(item.file.as_str())
        {
            return Err(format!(
                "{} does not match the profile lockfile.",
                item.name
            ));
        }
        let expected_hash = pinned.get("sha512").and_then(Value::as_str).unwrap_or("");
        let actual = file_hash(
            &paths.profile(profile_id)?.join("mods").join(&item.file),
            128,
        )?;
        if expected_hash != actual {
            return Err(format!("{} failed its SHA-512 lockfile check.", item.file));
        }
    }
    Ok(lock)
}
