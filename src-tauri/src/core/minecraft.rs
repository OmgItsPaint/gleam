use super::network::NetworkClient;
use super::paths::AppPaths;
use super::profiles;
use super::settings;
use super::storage::{atomic_write_json, extract_zip, read_json};
use serde::Serialize;
use serde_json::{Value, json};
use std::collections::HashMap;
use std::fs;
use std::path::PathBuf;

const MANIFEST_URL: &str = "https://launchermeta.mojang.com/mc/game/version_manifest_v2.json";
const FABRIC_META: &str = "https://meta.fabricmc.net/v2/versions/loader";

#[derive(Clone)]
pub struct InstalledVersion {
    pub version: Value,
    pub version_directory: PathBuf,
    pub classpath: Vec<PathBuf>,
}

#[derive(Clone)]
pub struct InstalledFabric {
    pub vanilla: InstalledVersion,
    pub profile: Value,
    pub classpath: Vec<PathBuf>,
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct FabricLoaderSummary {
    pub version: String,
    pub stable: bool,
}

fn string<'a>(value: &'a Value, pointer: &str) -> Result<&'a str, String> {
    value
        .pointer(pointer)
        .and_then(Value::as_str)
        .ok_or_else(|| format!("Minecraft metadata is missing {pointer}."))
}

fn rules_allow(rules: Option<&Value>) -> bool {
    let Some(rules) = rules.and_then(Value::as_array) else {
        return true;
    };
    let mut allowed = false;
    for rule in rules {
        let os = rule.get("os");
        let os_matches = os.is_none()
            || os.is_some_and(|value| {
                value
                    .get("name")
                    .and_then(Value::as_str)
                    .is_none_or(|name| name == "windows")
                    && value
                        .get("arch")
                        .and_then(Value::as_str)
                        .is_none_or(|arch| {
                            arch == if std::env::consts::ARCH == "x86_64" {
                                "x86_64"
                            } else {
                                std::env::consts::ARCH
                            }
                        })
            });
        if os_matches {
            allowed = rule.get("action").and_then(Value::as_str) == Some("allow");
        }
    }
    allowed
}

fn library_path(coordinate: &str) -> Result<PathBuf, String> {
    let parts: Vec<&str> = coordinate.split(':').collect();
    if parts.len() < 3
        || parts
            .iter()
            .any(|part| part.is_empty() || part.contains(['/', '\\']))
    {
        return Err("Fabric returned an invalid library coordinate.".to_string());
    }
    let name = format!(
        "{}-{}{}.jar",
        parts[1],
        parts[2],
        parts
            .get(3)
            .map_or(String::new(), |classifier| format!("-{classifier}"))
    );
    let mut path = PathBuf::new();
    for segment in parts[0].split('.') {
        path.push(segment);
    }
    path.push(parts[1]);
    path.push(parts[2]);
    path.push(name);
    Ok(path)
}

pub fn version_metadata(
    paths: &AppPaths,
    network: &NetworkClient,
    version_id: &str,
) -> Result<Value, String> {
    let local = paths
        .data
        .join("versions")
        .join(version_id)
        .join(format!("{version_id}.json"));
    if let Ok(value) = read_json(&local) {
        return Ok(value);
    }
    let manifest = network.json(MANIFEST_URL)?;
    let entry = manifest
        .get("versions")
        .and_then(Value::as_array)
        .and_then(|versions| {
            versions
                .iter()
                .find(|version| version.get("id").and_then(Value::as_str) == Some(version_id))
        })
        .ok_or_else(|| {
            format!("Minecraft version {version_id} was not found in Mojang's manifest.")
        })?;
    network.json(string(entry, "/url")?)
}

fn native_download(library: &Value) -> Option<&Value> {
    let classifier = library.pointer("/natives/windows")?.as_str()?;
    let arch = if std::env::consts::ARCH == "x86_64" {
        "64"
    } else {
        "32"
    };
    let classifier = classifier.replace("${arch}", arch);
    library.pointer(&format!("/downloads/classifiers/{classifier}"))
}

pub fn download_version(
    paths: &AppPaths,
    network: &NetworkClient,
    version_id: &str,
) -> Result<InstalledVersion, String> {
    let version = version_metadata(paths, network, version_id)?;
    let version_directory = paths.data.join("versions").join(version_id);
    fs::create_dir_all(&version_directory)
        .map_err(|_| "Gleam could not create the version folder.".to_string())?;
    atomic_write_json(
        &version_directory.join(format!("{version_id}.json")),
        &version,
    )?;
    let jar = version_directory.join(format!("{version_id}.jar"));
    network.download(
        string(&version, "/downloads/client/url")?,
        &jar,
        string(&version, "/downloads/client/sha1")?,
    )?;
    let mut classpath = vec![jar];
    let natives = version_directory.join("natives");
    fs::create_dir_all(&natives)
        .map_err(|_| "Gleam could not create the native-library folder.".to_string())?;
    for library in version
        .get("libraries")
        .and_then(Value::as_array)
        .into_iter()
        .flatten()
    {
        if !rules_allow(library.get("rules")) {
            continue;
        }
        if let Some(artifact) = library.pointer("/downloads/artifact") {
            let relative = string(artifact, "/path")?;
            let file = paths.data.join("libraries").join(relative);
            network.download(
                string(artifact, "/url")?,
                &file,
                artifact.get("sha1").and_then(Value::as_str).unwrap_or(""),
            )?;
            classpath.push(file);
        }
        if let Some(native) = native_download(library) {
            let file = paths.data.join("libraries").join(string(native, "/path")?);
            network.download(
                string(native, "/url")?,
                &file,
                native.get("sha1").and_then(Value::as_str).unwrap_or(""),
            )?;
            extract_zip(&file, &natives, &["META-INF/"])?;
        }
    }
    let asset_index = version
        .get("assetIndex")
        .ok_or("Minecraft metadata is missing its asset index.")?;
    let index_id = string(asset_index, "/id")?;
    let index_file = paths
        .data
        .join("assets")
        .join("indexes")
        .join(format!("{index_id}.json"));
    network.download(
        string(asset_index, "/url")?,
        &index_file,
        string(asset_index, "/sha1")?,
    )?;
    let index = read_json(&index_file)?;
    for item in index
        .get("objects")
        .and_then(Value::as_object)
        .into_iter()
        .flatten()
        .map(|(_, value)| value)
    {
        let hash = string(item, "/hash")?;
        if hash.len() != 40 || !hash.bytes().all(|byte| byte.is_ascii_hexdigit()) {
            return Err("The asset index contains an invalid checksum.".to_string());
        }
        let prefix = &hash[..2];
        let destination = paths
            .data
            .join("assets")
            .join("objects")
            .join(prefix)
            .join(hash);
        network.download(
            &format!("https://resources.download.minecraft.net/{prefix}/{hash}"),
            &destination,
            hash,
        )?;
    }
    if let Some(log) = version.pointer("/logging/client/file") {
        network.download(
            string(log, "/url")?,
            &paths
                .data
                .join("assets")
                .join("log_configs")
                .join(string(log, "/id")?),
            string(log, "/sha1")?,
        )?;
    }
    Ok(InstalledVersion {
        version,
        version_directory,
        classpath,
    })
}

pub fn installed_version(paths: &AppPaths, version_id: &str) -> Result<InstalledVersion, String> {
    let version_directory = paths.data.join("versions").join(version_id);
    let version = read_json(&version_directory.join(format!("{version_id}.json")))?;
    let client = version_directory.join(format!("{version_id}.jar"));
    if !client.is_file() {
        return Err("The Minecraft client is not installed for offline play.".to_string());
    }
    let mut classpath = vec![client];
    for library in version
        .get("libraries")
        .and_then(Value::as_array)
        .into_iter()
        .flatten()
    {
        if !rules_allow(library.get("rules")) {
            continue;
        }
        if let Some(relative) = library
            .pointer("/downloads/artifact/path")
            .and_then(Value::as_str)
        {
            let file = paths.data.join("libraries").join(relative);
            if !file.is_file() {
                return Err(format!("A Minecraft library is missing: {relative}"));
            }
            classpath.push(file);
        }
    }
    Ok(InstalledVersion {
        version,
        version_directory,
        classpath,
    })
}

pub fn fabric_loaders(
    network: &NetworkClient,
    game_version: &str,
) -> Result<Vec<FabricLoaderSummary>, String> {
    let value = network.json(&format!("{FABRIC_META}/{game_version}"))?;
    Ok(value
        .as_array()
        .into_iter()
        .flatten()
        .filter_map(|item| {
            Some(FabricLoaderSummary {
                version: item.pointer("/loader/version")?.as_str()?.to_string(),
                stable: item
                    .pointer("/loader/stable")
                    .and_then(Value::as_bool)
                    .unwrap_or(false),
            })
        })
        .take(40)
        .collect())
}

pub fn install_fabric(
    paths: &AppPaths,
    network: &NetworkClient,
    version_id: &str,
    profile_id: &str,
) -> Result<InstalledFabric, String> {
    let vanilla = download_version(paths, network, version_id)?;
    let loaders = network.json(&format!("{FABRIC_META}/{version_id}"))?;
    let profile = profiles::find(paths, profile_id)?;
    let saved_settings = settings::read(paths);
    let requested = profile
        .extra
        .get("fabricLoaderVersion")
        .and_then(Value::as_str)
        .map(str::to_owned)
        .or_else(|| {
            saved_settings
                .pointer(&format!("/fabricLoaderVersions/{version_id}"))
                .and_then(Value::as_str)
                .map(str::to_owned)
        })
        .unwrap_or_default();
    let items = loaders
        .as_array()
        .ok_or("Fabric returned an invalid loader list.")?;
    let chosen = items
        .iter()
        .find(|item| {
            !requested.is_empty()
                && item.pointer("/loader/version").and_then(Value::as_str)
                    == Some(requested.as_str())
        })
        .or_else(|| {
            items
                .iter()
                .find(|item| item.pointer("/loader/stable").and_then(Value::as_bool) == Some(true))
        })
        .or_else(|| items.first())
        .ok_or_else(|| format!("No Fabric Loader is available for Minecraft {version_id}."))?;
    let loader = string(chosen, "/loader/version")?;
    let fabric = network.json(&format!("{FABRIC_META}/{version_id}/{loader}/profile/json"))?;
    let mut fabric_libraries = Vec::new();
    for library in fabric
        .get("libraries")
        .and_then(Value::as_array)
        .into_iter()
        .flatten()
    {
        if !rules_allow(library.get("rules")) {
            continue;
        }
        let relative = if let Some(path) = library
            .pointer("/downloads/artifact/path")
            .and_then(Value::as_str)
        {
            PathBuf::from(path)
        } else {
            library_path(string(library, "/name")?)?
        };
        let base = library
            .get("url")
            .and_then(Value::as_str)
            .unwrap_or("https://maven.fabricmc.net")
            .trim_end_matches('/');
        let url = library
            .pointer("/downloads/artifact/url")
            .and_then(Value::as_str)
            .map(str::to_owned)
            .unwrap_or_else(|| format!("{base}/{}", relative.to_string_lossy().replace('\\', "/")));
        let file = paths.data.join("libraries").join(&relative);
        network.download(
            &url,
            &file,
            library
                .pointer("/downloads/artifact/sha1")
                .and_then(Value::as_str)
                .unwrap_or(""),
        )?;
        fabric_libraries.push(file);
    }
    let fabric_id = string(&fabric, "/id")?;
    atomic_write_json(
        &paths
            .data
            .join("versions")
            .join(format!("{fabric_id}.json")),
        &fabric,
    )?;
    profiles::update_extra(
        paths,
        profile_id,
        "fabricLoaderVersion",
        Value::String(loader.to_string()),
    )?;
    let mut classpath = fabric_libraries;
    classpath.extend(vanilla.classpath.clone());
    Ok(InstalledFabric {
        vanilla,
        profile: fabric,
        classpath,
    })
}

pub fn installed_fabric(
    paths: &AppPaths,
    version_id: &str,
    profile_id: &str,
) -> Result<InstalledFabric, String> {
    let profile = profiles::find(paths, profile_id)?;
    let vanilla = installed_version(paths, version_id)?;
    let loader = profile
        .extra
        .get("fabricLoaderVersion")
        .and_then(Value::as_str)
        .ok_or("This profile has no installed Fabric Loader selection for offline play.")?;
    let fabric_id = format!("fabric-loader-{loader}-{version_id}");
    let fabric = read_json(
        &paths
            .data
            .join("versions")
            .join(format!("{fabric_id}.json")),
    )?;
    let mut fabric_libraries = Vec::new();
    for library in fabric
        .get("libraries")
        .and_then(Value::as_array)
        .into_iter()
        .flatten()
    {
        if !rules_allow(library.get("rules")) {
            continue;
        }
        let relative = library
            .pointer("/downloads/artifact/path")
            .and_then(Value::as_str)
            .map(PathBuf::from)
            .unwrap_or(library_path(string(library, "/name")?)?);
        let file = paths.data.join("libraries").join(&relative);
        if !file.is_file() {
            return Err(format!(
                "A Fabric library is missing: {}",
                relative.display()
            ));
        }
        fabric_libraries.push(file);
    }
    let mut classpath = fabric_libraries;
    classpath.extend(vanilla.classpath.clone());
    Ok(InstalledFabric {
        vanilla,
        profile: fabric,
        classpath,
    })
}

pub fn substitute(value: &str, variables: &HashMap<String, String>) -> String {
    let mut output = value.to_string();
    for (name, replacement) in variables {
        output = output.replace(&format!("${{{name}}}"), replacement);
    }
    output
}

pub fn resolved_arguments(
    entries: Option<&Value>,
    variables: &HashMap<String, String>,
) -> Vec<String> {
    let mut output = Vec::new();
    for entry in entries.and_then(Value::as_array).into_iter().flatten() {
        if let Some(value) = entry.as_str() {
            output.push(substitute(value, variables));
        } else if rules_allow(entry.get("rules")) {
            if let Some(value) = entry.get("value") {
                for item in value
                    .as_array()
                    .into_iter()
                    .flatten()
                    .chain(value.as_str().map(Value::from).as_ref())
                {
                    if let Some(text) = item.as_str() {
                        output.push(substitute(text, variables));
                    }
                }
            }
        }
    }
    output
}

pub fn readiness(paths: &AppPaths, profile_id: &str) -> Result<Value, String> {
    let profile = profiles::find(paths, profile_id)?;
    let version_dir = paths.data.join("versions").join(&profile.game_version);
    let required = [
        (
            "Minecraft metadata",
            version_dir.join(format!("{}.json", profile.game_version)),
        ),
        (
            "Minecraft client",
            version_dir.join(format!("{}.jar", profile.game_version)),
        ),
        ("Asset indexes", paths.data.join("assets/indexes")),
        ("Libraries", paths.data.join("libraries")),
        ("Profile directory", paths.profile(profile_id)?),
    ];
    let missing: Vec<String> = required
        .iter()
        .filter(|(_, path)| !path.exists())
        .map(|(name, _)| (*name).to_string())
        .collect();
    Ok(json!({
        "complete": missing.is_empty(),
        "profileId": profile_id,
        "gameVersion": profile.game_version,
        "missing": missing,
        "networkRequired": !missing.is_empty()
    }))
}
