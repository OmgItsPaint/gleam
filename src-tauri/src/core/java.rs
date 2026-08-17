use super::network::NetworkClient;
use super::paths::AppPaths;
use super::storage::extract_zip;
use regex::Regex;
use serde::Serialize;
use serde_json::Value;
use std::collections::HashSet;
use std::env;
use std::fs;
use std::path::{Path, PathBuf};
use std::process::Command;
use walkdir::WalkDir;

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct JavaSelection {
    pub executable: String,
    pub major: u32,
    pub managed: bool,
}

pub fn fallback_major(version: &str) -> u32 {
    if version.starts_with("26.") {
        return 25;
    }
    let pieces: Vec<u32> = version
        .split(['.', '-'])
        .take(3)
        .map(|piece| piece.parse().unwrap_or(0))
        .collect();
    let minor = pieces.get(1).copied().unwrap_or(0);
    let patch = pieces.get(2).copied().unwrap_or(0);
    if minor >= 21 || (minor == 20 && patch >= 5) {
        21
    } else if minor >= 17 {
        17
    } else {
        8
    }
}

pub fn major(executable: &Path) -> u32 {
    let output = Command::new(executable).arg("-version").output();
    let Ok(output) = output else {
        return 0;
    };
    if !output.status.success() {
        return 0;
    }
    let text = format!(
        "{}{}",
        String::from_utf8_lossy(&output.stdout),
        String::from_utf8_lossy(&output.stderr)
    );
    let regex = Regex::new(r#"version\s+"(?:1\.)?(\d+)"#).unwrap();
    regex
        .captures(&text)
        .and_then(|captures| captures.get(1))
        .and_then(|value| value.as_str().parse().ok())
        .unwrap_or(0)
}

fn executable_names() -> [&'static str; 2] {
    ["javaw.exe", "java.exe"]
}

fn candidates(paths: &AppPaths, required: u32) -> Vec<PathBuf> {
    let mut candidates = Vec::new();
    for variable in [format!("JAVA_{required}_HOME"), "JAVA_HOME".to_string()] {
        if let Some(home) = env::var_os(variable) {
            for name in executable_names() {
                candidates.push(PathBuf::from(&home).join("bin").join(name));
            }
        }
    }
    let managed = paths.data.join("runtime").join(format!("java-{required}"));
    if managed.is_dir() {
        for entry in WalkDir::new(&managed)
            .max_depth(8)
            .follow_links(false)
            .into_iter()
            .filter_map(Result::ok)
        {
            if entry.file_type().is_file()
                && executable_names()
                    .iter()
                    .any(|name| entry.file_name().eq_ignore_ascii_case(name))
            {
                candidates.push(entry.path().to_path_buf());
            }
        }
    }
    candidates.extend(executable_names().map(PathBuf::from));
    candidates
}

pub fn find(paths: &AppPaths, required: u32) -> Result<JavaSelection, String> {
    let mut seen = HashSet::new();
    for candidate in candidates(paths, required) {
        let key = candidate.to_string_lossy().to_lowercase();
        if !seen.insert(key) {
            continue;
        }
        let detected = major(&candidate);
        if detected >= required {
            return Ok(JavaSelection {
                managed: candidate.starts_with(paths.data.join("runtime")),
                executable: candidate.to_string_lossy().to_string(),
                major: detected,
            });
        }
    }
    Err(format!(
        "Minecraft needs Java {required}. Install Temurin {required} or let Gleam provision it."
    ))
}

pub fn ensure(
    paths: &AppPaths,
    required: u32,
    network: &NetworkClient,
) -> Result<JavaSelection, String> {
    if let Ok(found) = find(paths, required) {
        return Ok(found);
    }
    let architecture = if std::env::consts::ARCH == "aarch64" {
        "aarch64"
    } else {
        "x64"
    };
    let url = format!(
        "https://api.adoptium.net/v3/assets/latest/{required}/hotspot?architecture={architecture}&image_type=jre&os=windows&vendor=eclipse"
    );
    let assets = network.json(&url)?;
    let asset = assets
        .as_array()
        .and_then(|items| {
            items.iter().find(|item| {
                item.pointer("/binary/package/link")
                    .and_then(Value::as_str)
                    .is_some()
                    && item
                        .pointer("/binary/package/checksum")
                        .and_then(Value::as_str)
                        .is_some()
            })
        })
        .ok_or_else(|| {
            format!("No verified Temurin {required} runtime is available for this computer.")
        })?;
    let link = asset
        .pointer("/binary/package/link")
        .and_then(Value::as_str)
        .unwrap();
    let checksum = asset
        .pointer("/binary/package/checksum")
        .and_then(Value::as_str)
        .unwrap();
    let runtime_root = paths.data.join("runtime").join(format!("java-{required}"));
    let archive = paths
        .data
        .join("runtime")
        .join(format!("temurin-{required}-{architecture}.zip"));
    network.download(link, &archive, checksum)?;
    if runtime_root.exists() {
        fs::remove_dir_all(&runtime_root)
            .map_err(|_| "Gleam could not replace the managed Java runtime.".to_string())?;
    }
    fs::create_dir_all(&runtime_root)
        .map_err(|_| "Gleam could not create the Java runtime folder.".to_string())?;
    extract_zip(&archive, &runtime_root, &[])?;
    find(paths, required)
}
