use super::identity;
use super::java;
use super::minecraft;
use super::mods;
use super::network::NetworkClient;
use super::paths::AppPaths;
use super::profiles;
use super::settings;
use super::storage::atomic_write_json;
use chrono::Utc;
use md5::{Digest, Md5};
use regex::Regex;
use serde::{Deserialize, Serialize};
use serde_json::{Value, json};
use std::collections::HashMap;
use std::fs::{self, File, OpenOptions};
use std::path::PathBuf;
use std::process::{Command, Stdio};
use sysinfo::System;

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct LaunchRequest {
    pub username: String,
    pub profile_id: String,
    #[serde(default)]
    pub offline_mode: String,
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct LaunchResult {
    pub pid: u32,
    pub game_directory: String,
    pub java: String,
    pub crash_report: String,
}

fn memory_gib() -> u64 {
    let mut system = System::new();
    system.refresh_memory();
    let gib = system.total_memory() as f64 / 1024_f64.powi(3);
    if gib < 7.0 {
        2
    } else if gib < 11.0 {
        3
    } else if gib < 25.0 {
        4
    } else {
        6
    }
}

fn offline_uuid(username: &str) -> String {
    let mut digest = Md5::new();
    digest.update(format!("OfflinePlayer:{username}").as_bytes());
    let mut bytes: [u8; 16] = digest.finalize().into();
    bytes[6] = (bytes[6] & 0x0f) | 0x30;
    bytes[8] = (bytes[8] & 0x3f) | 0x80;
    hex::encode(bytes)
}

fn logging_files(paths: &AppPaths, version: &str) -> Result<(PathBuf, PathBuf, File), String> {
    let root = paths.data.join("crash-reports");
    fs::create_dir_all(&root)
        .map_err(|_| "Gleam could not create the crash-report folder.".to_string())?;
    let stamp = Utc::now().format("%Y-%m-%dT%H-%M-%S%.3fZ").to_string();
    let log = root.join(format!("{stamp}-{version}.log"));
    let report = root.join(format!("{stamp}-{version}.json"));
    let output = OpenOptions::new()
        .create(true)
        .append(true)
        .open(&log)
        .map_err(|_| "Gleam could not create the game log.".to_string())?;
    Ok((log, report, output))
}

pub fn launch(paths: &AppPaths, request: LaunchRequest) -> Result<LaunchResult, String> {
    let username: String = request.username.trim().chars().take(16).collect();
    if !Regex::new(r"^[A-Za-z0-9_]{3,16}$")
        .unwrap()
        .is_match(&username)
    {
        return Err(
            "Minecraft requires a player name with 3–16 letters, numbers, or underscores."
                .to_string(),
        );
    }
    let profile = profiles::find(paths, &request.profile_id)?;
    let saved = settings::read(paths);
    let offline_mode = match request.offline_mode.as_str() {
        "online" | "prefer-offline" | "offline" => request.offline_mode,
        _ => saved
            .pointer("/offline/mode")
            .and_then(Value::as_str)
            .unwrap_or("online")
            .to_string(),
    };
    mods::install_bundled(paths, &profile.id, &profile.game_version)?;
    mods::verify_lock(paths, &profile.id)?;
    let network = NetworkClient::from_settings(paths)?;
    let installed = if offline_mode == "offline" {
        minecraft::installed_fabric(paths, &profile.game_version, &profile.id)?
    } else if offline_mode == "prefer-offline" {
        minecraft::installed_fabric(paths, &profile.game_version, &profile.id).or_else(|_| {
            minecraft::install_fabric(paths, &network, &profile.game_version, &profile.id)
        })?
    } else {
        minecraft::install_fabric(paths, &network, &profile.game_version, &profile.id)?
    };
    mods::write_lock(paths, &profile.id)?;
    let required_java = installed
        .vanilla
        .version
        .pointer("/javaVersion/majorVersion")
        .and_then(Value::as_u64)
        .unwrap_or_else(|| java::fallback_major(&profile.game_version) as u64)
        as u32;
    let java = if offline_mode == "offline" {
        java::find(paths, required_java)?
    } else {
        java::ensure(paths, required_java, &network)?
    };
    let game_directory = paths.profile(&profile.id)?;
    let assets = paths.data.join("assets");
    let libraries = paths.data.join("libraries");
    let natives = installed.vanilla.version_directory.join("natives");
    fs::create_dir_all(&game_directory)
        .map_err(|_| "Gleam could not create the game directory.".to_string())?;
    fs::create_dir_all(&natives)
        .map_err(|_| "Gleam could not create the native-library directory.".to_string())?;
    let fabric_id = installed
        .profile
        .get("id")
        .and_then(Value::as_str)
        .unwrap_or("fabric-loader");
    let asset_index = installed
        .vanilla
        .version
        .pointer("/assetIndex/id")
        .and_then(Value::as_str)
        .ok_or("Minecraft metadata has no asset index.")?;
    let classpath = std::env::join_paths(&installed.classpath)
        .map_err(|_| "Gleam could not build the Minecraft classpath.".to_string())?
        .to_string_lossy()
        .to_string();
    let mut variables = HashMap::from([
        ("auth_player_name".to_string(), username.clone()),
        ("version_name".to_string(), fabric_id.to_string()),
        (
            "game_directory".to_string(),
            game_directory.to_string_lossy().to_string(),
        ),
        (
            "assets_root".to_string(),
            assets.to_string_lossy().to_string(),
        ),
        ("assets_index_name".to_string(), asset_index.to_string()),
        ("auth_uuid".to_string(), offline_uuid(&username)),
        (
            "auth_access_token".to_string(),
            "gleam-local-offline-token".to_string(),
        ),
        ("auth_xuid".to_string(), String::new()),
        ("clientid".to_string(), String::new()),
        ("user_type".to_string(), "legacy".to_string()),
        (
            "version_type".to_string(),
            installed
                .vanilla
                .version
                .get("type")
                .and_then(Value::as_str)
                .unwrap_or("release")
                .to_string(),
        ),
        (
            "natives_directory".to_string(),
            natives.to_string_lossy().to_string(),
        ),
        ("launcher_name".to_string(), "Gleam".to_string()),
        (
            "launcher_version".to_string(),
            env!("CARGO_PKG_VERSION").to_string(),
        ),
        ("classpath".to_string(), classpath.clone()),
        ("classpath_separator".to_string(), ";".to_string()),
        (
            "library_directory".to_string(),
            libraries.to_string_lossy().to_string(),
        ),
        ("user_properties".to_string(), "{}".to_string()),
        ("resolution_width".to_string(), "1280".to_string()),
        ("resolution_height".to_string(), "720".to_string()),
        ("quickPlayMultiplayer".to_string(), String::new()),
        ("quickPlayPath".to_string(), String::new()),
    ]);
    if let Some(address) = profile.extra.get("serverAddress").and_then(Value::as_str) {
        variables.insert(
            "quickPlayMultiplayer".to_string(),
            address.chars().take(255).collect(),
        );
    }
    let mut jvm = vec![
        "-Xms1G".to_string(),
        format!("-Xmx{}G", memory_gib()),
        if required_java >= 25 {
            "-XX:+UseZGC".to_string()
        } else {
            "-XX:+UseG1GC".to_string()
        },
        "-XX:+DisableExplicitGC".to_string(),
        "-Dlog4j2.formatMsgNoLookups=true".to_string(),
    ];
    let identity_broker = identity::start_broker(paths, &username)?;
    jvm.extend([
        format!("-Dswirl.identity.port={}", identity_broker.port),
        format!("-Dswirl.identity.token={}", identity_broker.token),
        format!("-Dswirl.identity.publicKey={}", identity_broker.public_key),
        format!(
            "-Dswirl.identity.fingerprint={}",
            identity_broker.fingerprint
        ),
        format!("-Dswirl.identity.playerName={username}"),
    ]);
    jvm.extend(minecraft::resolved_arguments(
        installed.vanilla.version.pointer("/arguments/jvm"),
        &variables,
    ));
    jvm.extend(minecraft::resolved_arguments(
        installed.profile.pointer("/arguments/jvm"),
        &variables,
    ));
    if !jvm
        .iter()
        .any(|value| value.starts_with("-Djava.library.path="))
    {
        jvm.push(format!("-Djava.library.path={}", natives.display()));
    }
    if !jvm
        .iter()
        .any(|value| value == "-cp" || value == "-classpath")
    {
        jvm.extend(["-cp".to_string(), classpath]);
    }
    if let (Some(argument), Some(id)) = (
        installed
            .vanilla
            .version
            .pointer("/logging/client/argument")
            .and_then(Value::as_str),
        installed
            .vanilla
            .version
            .pointer("/logging/client/file/id")
            .and_then(Value::as_str),
    ) {
        jvm.push(argument.replace(
            "${path}",
            &assets.join("log_configs").join(id).to_string_lossy(),
        ));
    }
    let mut game = minecraft::resolved_arguments(
        installed.vanilla.version.pointer("/arguments/game"),
        &variables,
    );
    game.extend(minecraft::resolved_arguments(
        installed.profile.pointer("/arguments/game"),
        &variables,
    ));
    if game.is_empty() {
        game = vec![
            "--username".to_string(),
            username.clone(),
            "--version".to_string(),
            fabric_id.to_string(),
            "--gameDir".to_string(),
            game_directory.to_string_lossy().to_string(),
            "--assetsDir".to_string(),
            assets.to_string_lossy().to_string(),
            "--assetIndex".to_string(),
            asset_index.to_string(),
            "--uuid".to_string(),
            variables["auth_uuid"].clone(),
            "--accessToken".to_string(),
            variables["auth_access_token"].clone(),
            "--userType".to_string(),
            "legacy".to_string(),
            "--versionType".to_string(),
            variables["version_type"].clone(),
        ];
    }
    let main_class = installed
        .profile
        .get("mainClass")
        .and_then(Value::as_str)
        .ok_or("Fabric metadata has no main class.")?;
    let mut command = jvm;
    command.push(main_class.to_string());
    command.extend(game);
    let (_log_path, report_path, log_file) = logging_files(paths, &profile.game_version)?;
    let mut safe_command = command.clone();
    for index in 1..safe_command.len() {
        if safe_command[index - 1] == "--accessToken" {
            safe_command[index] = "<redacted>".to_string();
        }
    }
    for value in &mut safe_command {
        if value.starts_with("-Dswirl.identity.token=") {
            *value = "-Dswirl.identity.token=<redacted>".to_string();
        }
    }
    atomic_write_json(
        &report_path,
        &json!({
            "startedAt": Utc::now().to_rfc3339(),
            "minecraftVersion": profile.game_version,
            "fabricVersion": fabric_id,
            "java": java.executable,
            "javaMajor": java.major,
            "memoryGiB": memory_gib(),
            "gameDirectory": "<profile-directory>",
            "profile": { "id": profile.id, "name": profile.name },
            "command": safe_command
        }),
    )?;
    let stderr = log_file
        .try_clone()
        .map_err(|_| "Gleam could not attach the game log.".to_string())?;
    let mut child = Command::new(&java.executable)
        .args(&command)
        .current_dir(&game_directory)
        .stdin(Stdio::null())
        .stdout(Stdio::from(log_file))
        .stderr(Stdio::from(stderr))
        .spawn()
        .map_err(|error| format!("Minecraft could not start: {error}"))?;
    let pid = child.id();
    let report_for_thread = report_path.clone();
    std::thread::spawn(move || {
        let _identity_broker = identity_broker;
        if let Ok(status) = child.wait() {
            let current =
                super::storage::read_json(&report_for_thread).unwrap_or_else(|_| json!({}));
            let mut report = current.as_object().cloned().unwrap_or_default();
            report.insert(
                "finishedAt".to_string(),
                Value::String(Utc::now().to_rfc3339()),
            );
            report.insert(
                "exitCode".to_string(),
                status.code().map_or(Value::Null, Value::from),
            );
            report.insert("crashed".to_string(), Value::Bool(!status.success()));
            let _ = atomic_write_json(&report_for_thread, &Value::Object(report));
        }
    });
    Ok(LaunchResult {
        pid,
        game_directory: game_directory.to_string_lossy().to_string(),
        java: java.executable,
        crash_report: report_path.to_string_lossy().to_string(),
    })
}
