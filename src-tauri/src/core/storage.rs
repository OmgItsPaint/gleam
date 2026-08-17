use serde::Serialize;
use serde_json::Value;
use sha2::{Digest, Sha256};
use std::fs::{self, File, OpenOptions};
use std::io::{Read, Write};
use std::path::{Path, PathBuf};
use std::time::{SystemTime, UNIX_EPOCH};
use walkdir::WalkDir;
use zip::ZipArchive;

pub const MAX_JSON_BYTES: u64 = 8 * 1024 * 1024;

pub fn read_json(path: &Path) -> Result<Value, String> {
    let metadata =
        fs::metadata(path).map_err(|_| "That Gleam data file is unavailable.".to_string())?;
    if !metadata.is_file() || metadata.len() > MAX_JSON_BYTES {
        return Err("That Gleam data file is invalid or too large.".to_string());
    }
    let mut file =
        File::open(path).map_err(|_| "Gleam could not read that data file.".to_string())?;
    let mut bytes = Vec::with_capacity(metadata.len() as usize);
    file.read_to_end(&mut bytes)
        .map_err(|_| "Gleam could not read that data file.".to_string())?;
    serde_json::from_slice(&bytes)
        .map_err(|_| "That Gleam data file contains malformed JSON.".to_string())
}

pub fn read_json_or(path: &Path, backup: &Path, fallback: Value) -> Value {
    read_json(path)
        .or_else(|_| read_json(backup))
        .unwrap_or(fallback)
}

pub fn atomic_write_json(path: &Path, value: &Value) -> Result<(), String> {
    let bytes = serde_json::to_vec_pretty(value)
        .map_err(|_| "Gleam could not encode that data.".to_string())?;
    atomic_write(path, &bytes)
}

pub fn atomic_write(path: &Path, bytes: &[u8]) -> Result<(), String> {
    let parent = path
        .parent()
        .ok_or("That destination has no parent directory.")?;
    fs::create_dir_all(parent)
        .map_err(|_| "Gleam could not create the destination folder.".to_string())?;
    let nonce = SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .unwrap_or_default()
        .as_nanos();
    let temporary = parent.join(format!(".gleam-{}-{nonce}.tmp", std::process::id()));
    let mut file = OpenOptions::new()
        .write(true)
        .create_new(true)
        .open(&temporary)
        .map_err(|_| "Gleam could not create a temporary data file.".to_string())?;
    let result = (|| {
        file.write_all(bytes)
            .map_err(|_| "Gleam could not write that data.".to_string())?;
        file.sync_all()
            .map_err(|_| "Gleam could not commit that data.".to_string())?;
        replace_file(&temporary, path)
    })();
    if result.is_err() {
        let _ = fs::remove_file(&temporary);
    }
    result
}

#[cfg(windows)]
fn replace_file(source: &Path, destination: &Path) -> Result<(), String> {
    use std::os::windows::ffi::OsStrExt;
    use windows_sys::Win32::Storage::FileSystem::{
        MOVEFILE_REPLACE_EXISTING, MOVEFILE_WRITE_THROUGH, MoveFileExW,
    };
    let source: Vec<u16> = source.as_os_str().encode_wide().chain(Some(0)).collect();
    let destination: Vec<u16> = destination
        .as_os_str()
        .encode_wide()
        .chain(Some(0))
        .collect();
    let moved = unsafe {
        MoveFileExW(
            source.as_ptr(),
            destination.as_ptr(),
            MOVEFILE_REPLACE_EXISTING | MOVEFILE_WRITE_THROUGH,
        )
    };
    if moved == 0 {
        Err("Gleam could not atomically replace that data file.".to_string())
    } else {
        Ok(())
    }
}

#[cfg(not(windows))]
fn replace_file(source: &Path, destination: &Path) -> Result<(), String> {
    fs::rename(source, destination)
        .map_err(|_| "Gleam could not atomically replace that data file.".to_string())
}

pub fn copy_tree(source: &Path, destination: &Path) -> Result<(), String> {
    if !source.is_dir() {
        return Err("The source folder no longer exists.".to_string());
    }
    if destination.exists() {
        return Err("The destination already exists.".to_string());
    }
    fs::create_dir_all(destination)
        .map_err(|_| "Gleam could not create the destination.".to_string())?;
    for entry in WalkDir::new(source).follow_links(false).max_depth(128) {
        let entry = entry.map_err(|_| "Gleam could not inspect that folder.".to_string())?;
        if entry.file_type().is_symlink() {
            return Err("Symbolic links are not allowed in managed profile data.".to_string());
        }
        let relative = entry
            .path()
            .strip_prefix(source)
            .map_err(|_| "An unsafe source path was rejected.".to_string())?;
        if relative.as_os_str().is_empty() {
            continue;
        }
        let target = destination.join(relative);
        if entry.file_type().is_dir() {
            fs::create_dir_all(&target)
                .map_err(|_| "Gleam could not create a copied folder.".to_string())?;
        } else if entry.file_type().is_file() {
            if let Some(parent) = target.parent() {
                fs::create_dir_all(parent)
                    .map_err(|_| "Gleam could not create a copied folder.".to_string())?;
            }
            fs::copy(entry.path(), target)
                .map_err(|_| "Gleam could not copy a managed file.".to_string())?;
        }
    }
    Ok(())
}

pub fn directory_size(path: &Path) -> u64 {
    WalkDir::new(path)
        .follow_links(false)
        .into_iter()
        .filter_map(Result::ok)
        .filter(|entry| entry.file_type().is_file())
        .filter_map(|entry| entry.metadata().ok().map(|metadata| metadata.len()))
        .sum()
}

pub fn sha256_file(path: &Path, max_bytes: u64) -> Result<String, String> {
    let metadata = fs::metadata(path).map_err(|_| "That file is unavailable.".to_string())?;
    if !metadata.is_file() || metadata.len() > max_bytes {
        return Err("That file is invalid or exceeds its size limit.".to_string());
    }
    let mut file = File::open(path).map_err(|_| "Gleam could not open that file.".to_string())?;
    let mut digest = Sha256::new();
    let mut buffer = [0_u8; 64 * 1024];
    loop {
        let read = file
            .read(&mut buffer)
            .map_err(|_| "Gleam could not verify that file.".to_string())?;
        if read == 0 {
            break;
        }
        digest.update(&buffer[..read]);
    }
    Ok(hex::encode(digest.finalize()))
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct StorageEntry {
    pub name: String,
    pub bytes: u64,
    pub cleanup: bool,
}

pub fn storage_report(root: &Path) -> Vec<StorageEntry> {
    [
        ("Assets", "assets", false),
        ("Libraries", "libraries", false),
        ("Minecraft versions", "versions", false),
        ("Java", "java", false),
        ("Profiles", "instances/profiles", false),
        ("Backups", "backups", false),
        ("Servers", "servers", false),
        ("Logs", "logs", true),
        ("Updates", "updates", true),
    ]
    .into_iter()
    .map(|(name, relative, cleanup)| StorageEntry {
        name: name.to_string(),
        bytes: directory_size(&root.join(PathBuf::from(relative))),
        cleanup,
    })
    .collect()
}

pub fn extract_zip(archive: &Path, destination: &Path, excludes: &[&str]) -> Result<(), String> {
    let metadata =
        fs::metadata(archive).map_err(|_| "That ZIP archive is unavailable.".to_string())?;
    if metadata.len() > 1024 * 1024 * 1024 {
        return Err("That ZIP archive exceeds the 1 GiB compressed limit.".to_string());
    }
    let file =
        File::open(archive).map_err(|_| "Gleam could not open that ZIP archive.".to_string())?;
    let mut zip = ZipArchive::new(file).map_err(|_| "That ZIP archive is invalid.".to_string())?;
    if zip.len() > 20_000 {
        return Err("That ZIP archive has too many entries.".to_string());
    }
    let mut expanded = 0_u64;
    for index in 0..zip.len() {
        let mut entry = zip
            .by_index(index)
            .map_err(|_| "Gleam could not read a ZIP entry.".to_string())?;
        let enclosed = entry
            .enclosed_name()
            .ok_or("Gleam rejected an unsafe ZIP path.")?
            .to_path_buf();
        if excludes.iter().any(|prefix| {
            enclosed
                .to_string_lossy()
                .replace('\\', "/")
                .starts_with(prefix)
        }) {
            continue;
        }
        expanded = expanded.saturating_add(entry.size());
        if expanded > 2 * 1024 * 1024 * 1024 {
            return Err("That ZIP archive expands beyond the 2 GiB safety limit.".to_string());
        }
        let output = destination.join(enclosed);
        if entry.is_dir() {
            fs::create_dir_all(&output)
                .map_err(|_| "Gleam could not create an extracted folder.".to_string())?;
            continue;
        }
        if let Some(parent) = output.parent() {
            fs::create_dir_all(parent)
                .map_err(|_| "Gleam could not create an extracted folder.".to_string())?;
        }
        let mut file = File::create(&output)
            .map_err(|_| "Gleam could not create an extracted file.".to_string())?;
        std::io::copy(&mut entry, &mut file)
            .map_err(|_| "Gleam could not extract that ZIP entry.".to_string())?;
    }
    Ok(())
}
