use super::paths::AppPaths;
use super::settings;
use reqwest::Proxy;
use reqwest::blocking::{Client, Response};
use reqwest::header::{ACCEPT_ENCODING, RANGE, USER_AGENT};
use serde_json::Value;
use sha1::Sha1;
use sha2::{Digest, Sha256, Sha512};
use std::fs::{self, File, OpenOptions};
use std::io::{Read, Write};
use std::path::Path;
use std::time::Duration;
use url::Url;

const MAX_JSON: u64 = 10 * 1024 * 1024;
const MAX_DOWNLOAD: u64 = 2 * 1024 * 1024 * 1024;

pub struct NetworkClient {
    client: Client,
    offline: bool,
}

fn allowed_host(host: &str) -> bool {
    [
        "launchermeta.mojang.com",
        "piston-meta.mojang.com",
        "piston-data.mojang.com",
        "libraries.minecraft.net",
        "resources.download.minecraft.net",
        "meta.fabricmc.net",
        "maven.fabricmc.net",
        "api.modrinth.com",
        "cdn.modrinth.com",
        "api.adoptium.net",
        "github.com",
        "objects.githubusercontent.com",
    ]
    .iter()
    .any(|allowed| host == *allowed || host.ends_with(&format!(".{allowed}")))
}

fn validated_url(value: &str) -> Result<Url, String> {
    let url =
        Url::parse(value).map_err(|_| "A remote service returned an invalid URL.".to_string())?;
    if url.scheme() != "https" || url.username() != "" || url.password().is_some() {
        return Err("Only credential-free HTTPS download URLs are allowed.".to_string());
    }
    let host = url.host_str().ok_or("That download URL has no host.")?;
    if !allowed_host(host) {
        return Err(format!("Gleam blocked an unexpected download host: {host}"));
    }
    Ok(url)
}

impl NetworkClient {
    pub fn from_settings(paths: &AppPaths) -> Result<Self, String> {
        let settings = settings::read(paths);
        let offline = settings
            .pointer("/offline/mode")
            .and_then(Value::as_str)
            .is_some_and(|mode| mode == "offline");
        let proxy_mode = settings
            .pointer("/network/mode")
            .and_then(Value::as_str)
            .unwrap_or("system");
        let mut builder = Client::builder()
            .timeout(Duration::from_secs(60))
            .connect_timeout(Duration::from_secs(20))
            .redirect(reqwest::redirect::Policy::limited(5));
        if proxy_mode == "direct" {
            builder = builder.no_proxy();
        } else if proxy_mode == "manual" {
            let value = settings
                .pointer("/network/manualProxyUrl")
                .and_then(Value::as_str)
                .unwrap_or("");
            let url =
                Url::parse(value).map_err(|_| "Enter a valid manual proxy URL.".to_string())?;
            if !matches!(url.scheme(), "http" | "https") || url.host_str().is_none() {
                return Err("Manual proxies must use an HTTP or HTTPS URL.".to_string());
            }
            builder = builder.proxy(
                Proxy::all(url.as_str())
                    .map_err(|_| "Gleam could not configure that proxy.".to_string())?,
            );
        }
        let client = builder
            .build()
            .map_err(|_| "Gleam could not initialize secure networking.".to_string())?;
        Ok(Self { client, offline })
    }

    fn request(&self, url: &str) -> Result<Response, String> {
        if self.offline {
            return Err(
                "Gleam is in Offline mode and did not attempt a network request.".to_string(),
            );
        }
        let url = validated_url(url)?;
        let response = self
            .client
            .get(url)
            .header(
                USER_AGENT,
                format!("Gleam-Launcher/{}", env!("CARGO_PKG_VERSION")),
            )
            .header(ACCEPT_ENCODING, "identity")
            .send()
            .map_err(|error| format!("The secure request failed: {error}"))?;
        if !response.status().is_success() {
            return Err(format!(
                "The service returned HTTP {}.",
                response.status().as_u16()
            ));
        }
        Ok(response)
    }

    pub fn json(&self, url: &str) -> Result<Value, String> {
        let response = self.request(url)?;
        if response
            .content_length()
            .is_some_and(|size| size > MAX_JSON)
        {
            return Err("The JSON response exceeded the 10 MiB limit.".to_string());
        }
        let mut bytes = Vec::new();
        response
            .take(MAX_JSON + 1)
            .read_to_end(&mut bytes)
            .map_err(|_| "Gleam could not read the service response.".to_string())?;
        if bytes.len() as u64 > MAX_JSON {
            return Err("The JSON response exceeded the 10 MiB limit.".to_string());
        }
        serde_json::from_slice(&bytes)
            .map_err(|_| "The service returned malformed JSON.".to_string())
    }

    pub fn download(&self, url: &str, destination: &Path, expected: &str) -> Result<(), String> {
        if self.offline {
            return Err("Gleam is in Offline mode and did not attempt a download.".to_string());
        }
        let url = validated_url(url)?;
        if destination.is_file()
            && (expected.is_empty()
                || file_hash(destination, expected.len())? == expected.to_lowercase())
        {
            return Ok(());
        }
        let parent = destination
            .parent()
            .ok_or("That download destination is invalid.")?;
        fs::create_dir_all(parent)
            .map_err(|_| "Gleam could not create the download folder.".to_string())?;
        let partial = destination.with_extension(format!(
            "{}part",
            destination
                .extension()
                .map_or(String::new(), |value| format!(
                    "{}.",
                    value.to_string_lossy()
                ))
        ));
        let existing = fs::metadata(&partial).map_or(0, |metadata| metadata.len());
        let mut request = self
            .client
            .get(url)
            .header(
                USER_AGENT,
                format!("Gleam-Launcher/{}", env!("CARGO_PKG_VERSION")),
            )
            .header(ACCEPT_ENCODING, "identity");
        if existing > 0 {
            request = request.header(RANGE, format!("bytes={existing}-"));
        }
        let mut response = request
            .send()
            .map_err(|error| format!("The download failed: {error}"))?;
        let append = existing > 0 && response.status() == reqwest::StatusCode::PARTIAL_CONTENT;
        if !response.status().is_success() {
            return Err(format!(
                "The download service returned HTTP {}.",
                response.status().as_u16()
            ));
        }
        let total = response
            .content_length()
            .unwrap_or(0)
            .saturating_add(if append { existing } else { 0 });
        if total > MAX_DOWNLOAD {
            return Err("The download exceeded the 2 GiB safety limit.".to_string());
        }
        let mut output = OpenOptions::new()
            .create(true)
            .write(true)
            .append(append)
            .truncate(!append)
            .open(&partial)
            .map_err(|_| "Gleam could not create the partial download.".to_string())?;
        let mut received = if append { existing } else { 0 };
        let mut buffer = [0_u8; 64 * 1024];
        loop {
            let count = response
                .read(&mut buffer)
                .map_err(|_| "The download was interrupted.".to_string())?;
            if count == 0 {
                break;
            }
            received = received.saturating_add(count as u64);
            if received > MAX_DOWNLOAD {
                return Err("The download exceeded the 2 GiB safety limit.".to_string());
            }
            output
                .write_all(&buffer[..count])
                .map_err(|_| "Gleam could not save the download.".to_string())?;
        }
        output
            .sync_all()
            .map_err(|_| "Gleam could not commit the download.".to_string())?;
        if !expected.is_empty() && file_hash(&partial, expected.len())? != expected.to_lowercase() {
            let _ = fs::remove_file(&partial);
            return Err("The downloaded file failed its checksum verification.".to_string());
        }
        if destination.exists() {
            fs::remove_file(destination)
                .map_err(|_| "Gleam could not replace the old managed file.".to_string())?;
        }
        fs::rename(partial, destination)
            .map_err(|_| "Gleam could not commit the verified download.".to_string())?;
        Ok(())
    }
}

pub fn file_hash(path: &Path, expected_length: usize) -> Result<String, String> {
    let mut file = File::open(path).map_err(|_| "That managed file is unavailable.".to_string())?;
    let mut buffer = [0_u8; 64 * 1024];
    macro_rules! digest_file {
        ($digest:expr) => {{
            let mut digest = $digest;
            loop {
                let count = file
                    .read(&mut buffer)
                    .map_err(|_| "Gleam could not verify that file.".to_string())?;
                if count == 0 {
                    break;
                }
                digest.update(&buffer[..count]);
            }
            Ok(hex::encode(digest.finalize()))
        }};
    }
    match expected_length {
        40 => digest_file!(Sha1::new()),
        64 => digest_file!(Sha256::new()),
        128 => digest_file!(Sha512::new()),
        _ => Err("That checksum algorithm is unsupported.".to_string()),
    }
}
