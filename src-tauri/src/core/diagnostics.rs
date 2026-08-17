use super::paths::AppPaths;
use super::profiles;
use super::storage::{directory_size, storage_report};
use chrono::Utc;
use serde::Serialize;
use std::fs;
use std::process::Command;

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct JavaRuntime {
    pub executable: String,
    pub version: String,
    pub usable: bool,
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct DiagnosticsReport {
    pub generated_at: String,
    pub gleam_version: &'static str,
    pub operating_system: String,
    pub architecture: String,
    pub library_available: bool,
    pub profile_count: usize,
    pub library_bytes: u64,
    pub java: Vec<JavaRuntime>,
    pub storage: Vec<super::storage::StorageEntry>,
}

fn java_candidates(paths: &AppPaths) -> Vec<std::path::PathBuf> {
    let mut candidates = vec![std::path::PathBuf::from("java")];
    for major in [8, 17, 21, 25] {
        let root = paths.data.join("java").join(format!("java-{major}"));
        for executable in [root.join("bin/javaw.exe"), root.join("bin/java.exe")] {
            if executable.is_file() {
                candidates.push(executable);
            }
        }
    }
    candidates
}

pub fn java_report(paths: &AppPaths) -> Vec<JavaRuntime> {
    let mut found = Vec::new();
    for candidate in java_candidates(paths) {
        let output = Command::new(&candidate).arg("-version").output();
        let Ok(output) = output else {
            continue;
        };
        let text = format!(
            "{}{}",
            String::from_utf8_lossy(&output.stdout),
            String::from_utf8_lossy(&output.stderr)
        );
        let version = text
            .lines()
            .next()
            .unwrap_or("Unknown Java")
            .chars()
            .take(180)
            .collect();
        found.push(JavaRuntime {
            executable: if candidate.is_absolute() {
                candidate.to_string_lossy().to_string()
            } else {
                "System PATH".to_string()
            },
            version,
            usable: output.status.success(),
        });
    }
    found
}

pub fn report(paths: &AppPaths) -> DiagnosticsReport {
    DiagnosticsReport {
        generated_at: Utc::now().to_rfc3339(),
        gleam_version: env!("CARGO_PKG_VERSION"),
        operating_system: std::env::consts::OS.to_string(),
        architecture: std::env::consts::ARCH.to_string(),
        library_available: paths.data.is_dir(),
        profile_count: profiles::list(paths).map_or(0, |profiles| profiles.len()),
        library_bytes: directory_size(&paths.data),
        java: java_report(paths),
        storage: storage_report(&paths.data),
    }
}

pub fn clean(paths: &AppPaths, category: &str, confirmed: bool) -> Result<u64, String> {
    if !confirmed {
        return Err("Storage cleanup requires confirmation.".to_string());
    }
    let target = match category {
        "logs" => paths.data.join("logs"),
        "updates" => paths.data.join("updates"),
        _ => return Err("That storage category cannot be cleaned automatically.".to_string()),
    };
    let bytes = directory_size(&target);
    if target.is_dir() {
        fs::remove_dir_all(&target)
            .map_err(|_| "Gleam could not clean that storage category.".to_string())?;
    }
    Ok(bytes)
}
