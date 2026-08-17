use super::paths::{AppPaths, validate_profile_id};
use super::profiles;
use super::storage::sha256_file;
use chrono::Utc;
use rand_core::{OsRng, RngCore};
use serde::{Deserialize, Serialize};
use serde_json::Value;
use sha2::{Digest, Sha256};
use std::collections::HashSet;
use std::fs::{self, File, OpenOptions};
use std::io::{Read, Seek, SeekFrom, Write};
use std::path::{Component, Path, PathBuf};
use walkdir::WalkDir;

const MAGIC: &[u8] = b"SWIRLPACK1\n";
const MAX_MANIFEST: u64 = 8 * 1024 * 1024;
const MAX_TOTAL: u64 = 32 * 1024 * 1024 * 1024;
const MAX_ARTIFACTS: usize = 100_000;

#[derive(Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
struct Artifact {
    path: String,
    size: u64,
    sha256: String,
}

#[derive(Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
struct Payload {
    format: u32,
    #[serde(rename = "type")]
    kind: String,
    created_at: String,
    launcher: String,
    profile: Value,
    total_size: u64,
    artifacts: Vec<Artifact>,
}

#[derive(Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
struct Envelope {
    payload: Payload,
    #[serde(default)]
    signer_fingerprint: String,
    #[serde(default)]
    signature: String,
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct PackInfo {
    pub format: u32,
    pub profile: Value,
    pub artifacts: usize,
    pub total_size: u64,
    pub signed: bool,
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct PackResult {
    pub artifacts: usize,
    pub bytes: u64,
    pub signed: bool,
    pub profile: Value,
}

fn validate_pack_file(path: &str, must_exist: bool) -> Result<PathBuf, String> {
    if path.len() > 1024 {
        return Err("That provisioning path is too long.".into());
    }
    let value = PathBuf::from(path);
    if value
        .extension()
        .and_then(|part| part.to_str())
        .map(str::to_ascii_lowercase)
        .as_deref()
        != Some("swirlpack")
    {
        return Err("Choose a .swirlpack file.".into());
    }
    if must_exist && !value.is_file() {
        return Err("That provisioning pack does not exist.".into());
    }
    if value
        .symlink_metadata()
        .is_ok_and(|metadata| metadata.file_type().is_symlink())
    {
        return Err("Provisioning packs cannot be symbolic links.".into());
    }
    Ok(value)
}

fn safe_relative(value: &str) -> Result<PathBuf, String> {
    if value.is_empty() || value.len() > 512 {
        return Err("The provisioning archive contains an unsafe path.".into());
    }
    let normalized = value.replace('\\', "/");
    let path = PathBuf::from(&normalized);
    if path.is_absolute()
        || path
            .components()
            .any(|component| !matches!(component, Component::Normal(_)))
    {
        return Err("The provisioning archive contains an unsafe path.".into());
    }
    let lower = normalized.to_ascii_lowercase();
    if lower.split('/').any(|part| {
        matches!(
            part,
            "saves" | "servers" | "identity" | "log" | "logs" | "crash-reports"
        )
    }) {
        return Err(
            "Provisioning archives cannot contain worlds, servers, identities, or logs.".into(),
        );
    }
    let parts: Vec<&str> = lower.split('/').collect();
    let profile_path = parts.len() >= 4
        && parts[0] == "instances"
        && parts[1] == "profiles"
        && parts[2].len() == 16
        && parts[2].bytes().all(|byte| byte.is_ascii_hexdigit())
        && matches!(
            parts[3],
            "mods" | "config" | "swirl-profile.json" | "swirl.lock.json"
        );
    if !matches!(
        parts.first().copied(),
        Some("assets" | "libraries" | "versions" | "runtime" | "java")
    ) && !profile_path
    {
        return Err(format!(
            "Provisioning path is not an approved managed artifact: {normalized}"
        ));
    }
    Ok(path)
}

fn read_envelope(file: &mut File) -> Result<(Envelope, u64), String> {
    let mut magic = vec![0_u8; MAGIC.len()];
    file.read_exact(&mut magic)
        .map_err(|_| "That provisioning pack is truncated.".to_string())?;
    if magic != MAGIC {
        return Err("That is not a Swirl provisioning archive.".into());
    }
    let mut length = [0_u8; 4];
    file.read_exact(&mut length)
        .map_err(|_| "That provisioning manifest is truncated.".to_string())?;
    let size = u32::from_be_bytes(length) as u64;
    if size == 0 || size > MAX_MANIFEST {
        return Err("The provisioning manifest is invalid.".into());
    }
    let mut bytes = vec![0_u8; size as usize];
    file.read_exact(&mut bytes)
        .map_err(|_| "That provisioning manifest is truncated.".to_string())?;
    let envelope: Envelope = serde_json::from_slice(&bytes)
        .map_err(|_| "The provisioning manifest is malformed.".to_string())?;
    validate_envelope(&envelope)?;
    Ok((envelope, MAGIC.len() as u64 + 4 + size))
}

fn validate_envelope(envelope: &Envelope) -> Result<(), String> {
    let payload = &envelope.payload;
    if payload.format != 1
        || payload.kind != "swirl-offline-provisioning"
        || payload.artifacts.len() > MAX_ARTIFACTS
    {
        return Err("That provisioning format is unsupported.".into());
    }
    let mut total = 0_u64;
    let mut seen = HashSet::new();
    for artifact in &payload.artifacts {
        let path = safe_relative(&artifact.path)?;
        let key = path.to_string_lossy().to_ascii_lowercase();
        if !seen.insert(key) {
            return Err("The provisioning manifest contains duplicate paths.".into());
        }
        if artifact.size > MAX_TOTAL
            || total.saturating_add(artifact.size) > MAX_TOTAL
            || artifact.sha256.len() != 64
            || !artifact.sha256.bytes().all(|byte| byte.is_ascii_hexdigit())
        {
            return Err("The provisioning artifact metadata is invalid.".into());
        }
        total += artifact.size;
    }
    if total != payload.total_size {
        return Err("The provisioning total size is invalid.".into());
    }
    Ok(())
}

pub fn inspect(source: &str) -> Result<PackInfo, String> {
    let source = validate_pack_file(source, true)?;
    let mut file = File::open(source)
        .map_err(|_| "Gleam could not open that provisioning pack.".to_string())?;
    let (envelope, _) = read_envelope(&mut file)?;
    Ok(PackInfo {
        format: envelope.payload.format,
        profile: envelope.payload.profile,
        artifacts: envelope.payload.artifacts.len(),
        total_size: envelope.payload.total_size,
        signed: !envelope.signature.is_empty(),
    })
}

fn collect(
    root: &Path,
    relative_root: &Path,
    artifacts: &mut Vec<(PathBuf, String)>,
) -> Result<(), String> {
    if !root.exists() {
        return Ok(());
    }
    for entry in WalkDir::new(root)
        .follow_links(false)
        .into_iter()
        .filter_map(Result::ok)
    {
        if entry.file_type().is_symlink() {
            return Err("Provisioning sources cannot contain symbolic links.".into());
        }
        if !entry.file_type().is_file() {
            continue;
        }
        let relative = entry
            .path()
            .strip_prefix(root)
            .map_err(|_| "Gleam could not resolve a provisioning source.".to_string())?;
        let archive = relative_root
            .join(relative)
            .to_string_lossy()
            .replace('\\', "/");
        safe_relative(&archive)?;
        artifacts.push((entry.path().to_path_buf(), archive));
        if artifacts.len() > MAX_ARTIFACTS {
            return Err("The profile contains too many managed artifacts.".into());
        }
    }
    Ok(())
}

pub fn export(paths: &AppPaths, profile_id: &str, destination: &str) -> Result<PackResult, String> {
    validate_profile_id(profile_id)?;
    let profile = profiles::find(paths, profile_id)?;
    let destination = validate_pack_file(destination, false)?;
    let mut sources = Vec::new();
    for name in ["assets", "libraries", "versions", "runtime", "java"] {
        collect(&paths.data.join(name), Path::new(name), &mut sources)?;
    }
    let profile_root = paths.profile(profile_id)?;
    for name in ["mods", "config"] {
        collect(
            &profile_root.join(name),
            &Path::new("instances")
                .join("profiles")
                .join(profile_id)
                .join(name),
            &mut sources,
        )?;
    }
    for name in ["swirl-profile.json", "swirl.lock.json"] {
        let source = profile_root.join(name);
        if source.is_file() {
            sources.push((
                source,
                Path::new("instances")
                    .join("profiles")
                    .join(profile_id)
                    .join(name)
                    .to_string_lossy()
                    .replace('\\', "/"),
            ));
        }
    }
    let mut artifacts = Vec::with_capacity(sources.len());
    let mut total = 0_u64;
    for (source, relative) in &sources {
        let size = source
            .metadata()
            .map_err(|_| "A provisioning source disappeared.".to_string())?
            .len();
        total = total
            .checked_add(size)
            .filter(|value| *value <= MAX_TOTAL)
            .ok_or("The provisioning pack exceeds 32 GiB.")?;
        artifacts.push(Artifact {
            path: relative.clone(),
            size,
            sha256: sha256_file(source, MAX_TOTAL)?,
        });
    }
    let envelope = Envelope {
        payload: Payload {
            format: 1,
            kind: "swirl-offline-provisioning".into(),
            created_at: Utc::now().to_rfc3339(),
            launcher: env!("CARGO_PKG_VERSION").into(),
            profile: serde_json::json!({"id": profile.id, "gameVersion": profile.game_version}),
            total_size: total,
            artifacts,
        },
        signer_fingerprint: String::new(),
        signature: String::new(),
    };
    let manifest = serde_json::to_vec(&envelope)
        .map_err(|_| "Gleam could not encode the provisioning manifest.".to_string())?;
    if manifest.len() as u64 > MAX_MANIFEST {
        return Err("The provisioning manifest is too large.".into());
    }
    if let Some(parent) = destination.parent() {
        fs::create_dir_all(parent)
            .map_err(|_| "Gleam could not create the export folder.".to_string())?;
    }
    let temporary = destination.with_extension(format!("swirlpack.{}.tmp", std::process::id()));
    let mut output = OpenOptions::new()
        .create_new(true)
        .write(true)
        .open(&temporary)
        .map_err(|_| "Gleam could not create the provisioning pack.".to_string())?;
    let result = (|| {
        output
            .write_all(MAGIC)
            .map_err(|_| "Gleam could not write the provisioning header.".to_string())?;
        output
            .write_all(&(manifest.len() as u32).to_be_bytes())
            .map_err(|_| "Gleam could not write the provisioning header.".to_string())?;
        output
            .write_all(&manifest)
            .map_err(|_| "Gleam could not write the provisioning manifest.".to_string())?;
        for (source, _) in &sources {
            std::io::copy(
                &mut File::open(source)
                    .map_err(|_| "A provisioning source disappeared.".to_string())?,
                &mut output,
            )
            .map_err(|_| "Gleam could not write a provisioning artifact.".to_string())?;
        }
        output
            .sync_all()
            .map_err(|_| "Gleam could not commit the provisioning pack.".to_string())?;
        if destination.exists() {
            fs::remove_file(&destination)
                .map_err(|_| "Gleam could not replace the old provisioning pack.".to_string())?;
        }
        fs::rename(&temporary, &destination)
            .map_err(|_| "Gleam could not finish the provisioning pack.".to_string())
    })();
    if result.is_err() {
        let _ = fs::remove_file(&temporary);
    }
    result?;
    Ok(PackResult {
        artifacts: envelope.payload.artifacts.len(),
        bytes: total,
        signed: false,
        profile: envelope.payload.profile,
    })
}

pub fn import(paths: &AppPaths, source: &str, allow_unsigned: bool) -> Result<PackResult, String> {
    let source = validate_pack_file(source, true)?;
    let mut input = File::open(&source)
        .map_err(|_| "Gleam could not open that provisioning pack.".to_string())?;
    let (envelope, mut position) = read_envelope(&mut input)?;
    if envelope.signature.is_empty() && !allow_unsigned {
        return Err("This policy requires a trusted signed provisioning pack.".into());
    }
    let mut random = [0_u8; 8];
    OsRng.fill_bytes(&mut random);
    let stage = paths
        .data
        .join("provisioning")
        .join(format!("stage-{}", hex::encode(random)));
    fs::create_dir_all(&stage)
        .map_err(|_| "Gleam could not create provisioning staging.".to_string())?;
    let result = (|| {
        for artifact in &envelope.payload.artifacts {
            let relative = safe_relative(&artifact.path)?;
            let target = stage.join(&relative);
            if let Some(parent) = target.parent() {
                fs::create_dir_all(parent)
                    .map_err(|_| "Gleam could not stage a provisioning artifact.".to_string())?;
            }
            let mut output = OpenOptions::new()
                .create_new(true)
                .write(true)
                .open(&target)
                .map_err(|_| "The provisioning pack contains a duplicate output.".to_string())?;
            let mut digest = Sha256::new();
            let mut remaining = artifact.size;
            let mut buffer = vec![0_u8; 1024 * 1024];
            while remaining > 0 {
                let requested = buffer.len().min(remaining as usize);
                let count = input
                    .read(&mut buffer[..requested])
                    .map_err(|_| "The provisioning pack ended unexpectedly.".to_string())?;
                if count == 0 {
                    return Err("The provisioning pack ended unexpectedly.".into());
                }
                output
                    .write_all(&buffer[..count])
                    .map_err(|_| "Gleam could not stage a provisioning artifact.".to_string())?;
                digest.update(&buffer[..count]);
                remaining -= count as u64;
                position += count as u64;
            }
            output
                .sync_all()
                .map_err(|_| "Gleam could not verify the staged artifact.".to_string())?;
            if hex::encode(digest.finalize()) != artifact.sha256.to_ascii_lowercase() {
                return Err(format!("Provisioning hash failed: {}", artifact.path));
            }
        }
        if input
            .seek(SeekFrom::End(0))
            .map_err(|_| "Gleam could not finish reading the pack.".to_string())?
            != position
        {
            return Err("The provisioning pack contains unexpected trailing data.".into());
        }
        let rollback = stage.join(".rollback");
        let mut committed: Vec<(PathBuf, PathBuf, bool)> = Vec::new();
        for (index, artifact) in envelope.payload.artifacts.iter().enumerate() {
            let relative = safe_relative(&artifact.path)?;
            let staged = stage.join(&relative);
            let destination = paths.data.join(&relative);
            let previous = rollback.join(format!("{index}.previous"));
            if let Some(parent) = destination.parent() {
                fs::create_dir_all(parent)
                    .map_err(|_| "Gleam could not create a managed destination.".to_string())?;
            }
            let had_previous = destination.exists();
            if had_previous {
                fs::create_dir_all(&rollback)
                    .map_err(|_| "Gleam could not create provisioning rollback.".to_string())?;
                fs::rename(&destination, &previous)
                    .map_err(|_| "Gleam could not preserve a managed file.".to_string())?;
            }
            committed.push((destination.clone(), previous, had_previous));
            if let Err(error) = fs::rename(staged, &destination) {
                for (target, old, existed) in committed.into_iter().rev() {
                    let _ = fs::remove_file(&target);
                    if existed {
                        let _ = fs::rename(old, target);
                    }
                }
                return Err(format!(
                    "Gleam rolled back the provisioning import: {error}"
                ));
            }
        }
        Ok(())
    })();
    let _ = fs::remove_dir_all(&stage);
    result?;
    Ok(PackResult {
        artifacts: envelope.payload.artifacts.len(),
        bytes: envelope.payload.total_size,
        signed: !envelope.signature.is_empty(),
        profile: envelope.payload.profile,
    })
}

#[cfg(test)]
mod tests {
    use super::safe_relative;

    #[test]
    fn accepts_only_managed_relative_paths() {
        assert!(safe_relative("assets/indexes/26.json").is_ok());
        assert!(safe_relative("libraries/example/library.jar").is_ok());
        assert!(safe_relative("instances/profiles/0123456789abcdef/mods/example.jar").is_ok());
        assert!(safe_relative("../identity.json").is_err());
        assert!(safe_relative("C:/Windows/System32/file.dll").is_err());
        assert!(
            safe_relative("instances/profiles/0123456789abcdef/saves/world/level.dat").is_err()
        );
        assert!(safe_relative("servers/server.properties").is_err());
    }
}
