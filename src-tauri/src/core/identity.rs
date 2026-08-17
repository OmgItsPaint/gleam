use super::paths::AppPaths;
use super::storage::{atomic_write_json, read_json};
use base64::Engine;
use base64::engine::general_purpose::{STANDARD, URL_SAFE_NO_PAD};
use chrono::Utc;
use ed25519_dalek::pkcs8::DecodePrivateKey;
use ed25519_dalek::{Signer, SigningKey};
use rand_core::OsRng;
use serde::Serialize;
use serde_json::{Value, json};
use sha2::{Digest, Sha256};
use std::fs;
use std::io::{Read, Write};
use std::net::{TcpListener, TcpStream};
use std::sync::Arc;
use std::sync::atomic::{AtomicBool, Ordering};
use std::thread;
use std::time::Duration;

const ED25519_SPKI_PREFIX: [u8; 12] = [
    0x30, 0x2a, 0x30, 0x05, 0x06, 0x03, 0x2b, 0x65, 0x70, 0x03, 0x21, 0x00,
];
const AUTH_PREFIX: &[u8] = b"SWIRL-AUTH-1\0";
const MANAGE_PREFIX: &[u8] = b"SWIRL-MANAGE-1\0";

pub struct IdentityBroker {
    pub port: u16,
    pub token: String,
    pub public_key: String,
    pub fingerprint: String,
    stop: Arc<AtomicBool>,
}

impl Drop for IdentityBroker {
    fn drop(&mut self) {
        self.stop.store(true, Ordering::Release);
        let _ = TcpStream::connect(("127.0.0.1", self.port));
    }
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct IdentityStatus {
    pub available: bool,
    pub fingerprint: String,
    pub public_key: String,
    pub created_at: String,
    pub protection: String,
    pub needs_legacy_migration: bool,
}

fn private_file(paths: &AppPaths) -> std::path::PathBuf {
    paths.data.join("identity").join("player-key.json")
}

fn public_file(paths: &AppPaths) -> std::path::PathBuf {
    paths.data.join("identity").join("player-identity.json")
}

fn public_der(key: &SigningKey) -> Vec<u8> {
    let mut der = ED25519_SPKI_PREFIX.to_vec();
    der.extend_from_slice(key.verifying_key().as_bytes());
    der
}

fn fingerprint(der: &[u8]) -> String {
    hex::encode(Sha256::digest(der))
}

#[cfg(windows)]
fn protect(bytes: &[u8]) -> Result<Vec<u8>, String> {
    use windows_sys::Win32::Foundation::LocalFree;
    use windows_sys::Win32::Security::Cryptography::{
        CRYPT_INTEGER_BLOB, CRYPTPROTECT_UI_FORBIDDEN, CryptProtectData,
    };
    let mut input = CRYPT_INTEGER_BLOB {
        cbData: bytes
            .len()
            .try_into()
            .map_err(|_| "The identity secret is too large.")?,
        pbData: bytes.as_ptr() as *mut u8,
    };
    let mut output = CRYPT_INTEGER_BLOB {
        cbData: 0,
        pbData: std::ptr::null_mut(),
    };
    let result = unsafe {
        CryptProtectData(
            &mut input,
            std::ptr::null(),
            std::ptr::null(),
            std::ptr::null_mut(),
            std::ptr::null(),
            CRYPTPROTECT_UI_FORBIDDEN,
            &mut output,
        )
    };
    if result == 0 || output.pbData.is_null() {
        return Err("Windows could not protect the Gleam identity.".to_string());
    }
    let protected =
        unsafe { std::slice::from_raw_parts(output.pbData, output.cbData as usize).to_vec() };
    unsafe { LocalFree(output.pbData as *mut _) };
    Ok(protected)
}

#[cfg(windows)]
fn unprotect(bytes: &[u8]) -> Result<Vec<u8>, String> {
    use windows_sys::Win32::Foundation::LocalFree;
    use windows_sys::Win32::Security::Cryptography::{
        CRYPT_INTEGER_BLOB, CRYPTPROTECT_UI_FORBIDDEN, CryptUnprotectData,
    };
    let mut input = CRYPT_INTEGER_BLOB {
        cbData: bytes
            .len()
            .try_into()
            .map_err(|_| "The protected identity is too large.")?,
        pbData: bytes.as_ptr() as *mut u8,
    };
    let mut output = CRYPT_INTEGER_BLOB {
        cbData: 0,
        pbData: std::ptr::null_mut(),
    };
    let result = unsafe {
        CryptUnprotectData(
            &mut input,
            std::ptr::null_mut(),
            std::ptr::null(),
            std::ptr::null_mut(),
            std::ptr::null(),
            CRYPTPROTECT_UI_FORBIDDEN,
            &mut output,
        )
    };
    if result == 0 || output.pbData.is_null() {
        return Err("Windows could not unlock the Gleam identity for this user.".to_string());
    }
    let clear =
        unsafe { std::slice::from_raw_parts(output.pbData, output.cbData as usize).to_vec() };
    unsafe { LocalFree(output.pbData as *mut _) };
    Ok(clear)
}

#[cfg(not(windows))]
fn protect(_bytes: &[u8]) -> Result<Vec<u8>, String> {
    Err("Gleam identity protection currently requires Windows.".to_string())
}

#[cfg(not(windows))]
fn unprotect(_bytes: &[u8]) -> Result<Vec<u8>, String> {
    Err("Gleam identity protection currently requires Windows.".to_string())
}

fn load_key(paths: &AppPaths) -> Result<SigningKey, String> {
    let record = read_json(&private_file(paths))?;
    let protection = record
        .get("protection")
        .and_then(Value::as_str)
        .unwrap_or("");
    let encoded = record
        .get("value")
        .and_then(Value::as_str)
        .ok_or("The identity record has no protected key.")?;
    let stored = STANDARD
        .decode(encoded)
        .map_err(|_| "The identity record is malformed.".to_string())?;
    if protection == "windows-dpapi" {
        let clear = unprotect(&stored)?;
        let seed: [u8; 32] = clear
            .try_into()
            .map_err(|_| "The protected identity key has an invalid length.".to_string())?;
        return Ok(SigningKey::from_bytes(&seed));
    }
    if protection == "file" {
        let pem = String::from_utf8(stored)
            .map_err(|_| "The legacy identity key is not valid text.".to_string())?;
        return SigningKey::from_pkcs8_pem(&pem)
            .map_err(|_| "The legacy Ed25519 identity could not be decoded.".to_string());
    }
    Err("This identity is still protected by Electron safeStorage. Run the signed identity migration before removing the compatibility launcher.".to_string())
}

pub fn status(paths: &AppPaths) -> IdentityStatus {
    let private = read_json(&private_file(paths)).ok();
    let public = read_json(&public_file(paths)).ok();
    let protection = private
        .as_ref()
        .and_then(|value| value.get("protection"))
        .and_then(Value::as_str)
        .unwrap_or("")
        .to_string();
    IdentityStatus {
        available: private.is_some() && public.is_some(),
        fingerprint: public
            .as_ref()
            .and_then(|value| value.get("fingerprint"))
            .and_then(Value::as_str)
            .unwrap_or("")
            .to_string(),
        public_key: public
            .as_ref()
            .and_then(|value| value.get("publicKey"))
            .and_then(Value::as_str)
            .unwrap_or("")
            .to_string(),
        created_at: public
            .as_ref()
            .and_then(|value| value.get("createdAt"))
            .and_then(Value::as_str)
            .unwrap_or("")
            .to_string(),
        needs_legacy_migration: matches!(protection.as_str(), "os" | "os-async"),
        protection,
    }
}

pub fn create(paths: &AppPaths) -> Result<IdentityStatus, String> {
    if private_file(paths).exists() {
        load_key(paths)?;
        return Ok(status(paths));
    }
    let key = SigningKey::generate(&mut OsRng);
    let der = public_der(&key);
    let created_at = Utc::now().to_rfc3339();
    let protected = protect(key.as_bytes())?;
    fs::create_dir_all(paths.data.join("identity"))
        .map_err(|_| "Gleam could not create the identity folder.".to_string())?;
    atomic_write_json(
        &private_file(paths),
        &json!({
            "format": 2,
            "algorithm": "Ed25519",
            "protection": "windows-dpapi",
            "value": STANDARD.encode(protected),
            "createdAt": created_at
        }),
    )?;
    atomic_write_json(
        &public_file(paths),
        &json!({
            "format": 2,
            "algorithm": "Ed25519",
            "publicKey": STANDARD.encode(&der),
            "fingerprint": fingerprint(&der),
            "createdAt": created_at
        }),
    )?;
    Ok(status(paths))
}

pub fn sign(paths: &AppPaths, payload_base64: &str) -> Result<Value, String> {
    if payload_base64.len() > 8192 {
        return Err("That identity challenge is too large.".to_string());
    }
    let payload = STANDARD
        .decode(payload_base64)
        .map_err(|_| "That identity challenge is not valid base64.".to_string())?;
    if payload.len() > 4096 {
        return Err("That identity challenge is too large.".to_string());
    }
    let key = load_key(paths)?;
    let der = public_der(&key);
    Ok(json!({
        "algorithm": "Ed25519",
        "publicKey": STANDARD.encode(&der),
        "fingerprint": fingerprint(&der),
        "signature": STANDARD.encode(key.sign(&payload).to_bytes())
    }))
}

fn broker_request(
    mut stream: TcpStream,
    token: &str,
    player_name: &str,
    key: &SigningKey,
    public_key: &str,
    fingerprint: &str,
) {
    let _ = stream.set_read_timeout(Some(Duration::from_secs(5)));
    let _ = stream.set_write_timeout(Some(Duration::from_secs(5)));
    let mut request = Vec::new();
    let mut buffer = [0_u8; 2048];
    loop {
        let count = match stream.read(&mut buffer) {
            Ok(0) | Err(_) => break,
            Ok(count) => count,
        };
        request.extend_from_slice(&buffer[..count]);
        if request.len() > 16 * 1024 {
            break;
        }
        if let Some(header_end) = request.windows(4).position(|window| window == b"\r\n\r\n") {
            let headers = String::from_utf8_lossy(&request[..header_end]);
            let length = headers
                .lines()
                .find_map(|line| {
                    line.split_once(':')
                        .filter(|(name, _)| name.eq_ignore_ascii_case("content-length"))
                        .and_then(|(_, value)| value.trim().parse::<usize>().ok())
                })
                .unwrap_or(0);
            if request.len() >= header_end + 4 + length {
                break;
            }
        }
    }
    let response = (|| {
        let header_end = request
            .windows(4)
            .position(|window| window == b"\r\n\r\n")
            .ok_or(())?;
        let headers = String::from_utf8_lossy(&request[..header_end]);
        let mut lines = headers.lines();
        if lines.next() != Some("POST /sign HTTP/1.1") {
            return Err(());
        }
        let authorized = lines.any(|line| {
            line.split_once(':').is_some_and(|(name, value)| {
                name.eq_ignore_ascii_case("authorization")
                    && value.trim() == format!("Bearer {token}")
            })
        });
        if !authorized {
            return Err(());
        }
        let encoded = std::str::from_utf8(&request[header_end + 4..])
            .map_err(|_| ())?
            .trim();
        let message = STANDARD.decode(encoded).map_err(|_| ())?;
        if message.len() > 4096
            || !(message.starts_with(AUTH_PREFIX) || message.starts_with(MANAGE_PREFIX))
        {
            return Err(());
        }
        let signature = STANDARD.encode(key.sign(&message).to_bytes());
        Ok(format!(
            "{player_name}\n{public_key}\n{fingerprint}\n{signature}\n\n"
        ))
    })();
    match response {
        Ok(body) => {
            let _ = write!(
                stream,
                "HTTP/1.1 200 OK\r\nContent-Type: text/plain; charset=utf-8\r\nCache-Control: no-store\r\nContent-Length: {}\r\nConnection: close\r\n\r\n{}",
                body.len(),
                body
            );
        }
        Err(()) => {
            let _ = stream.write_all(b"HTTP/1.1 404 Not Found\r\nCache-Control: no-store\r\nContent-Length: 0\r\nConnection: close\r\n\r\n");
        }
    }
}

pub fn start_broker(paths: &AppPaths, player_name: &str) -> Result<IdentityBroker, String> {
    if status(paths).needs_legacy_migration {
        return Err("Your existing identity must be migrated by the signed compatibility launcher before Gleam can use it.".into());
    }
    if !private_file(paths).is_file() {
        create(paths)?;
    }
    let key = Arc::new(load_key(paths)?);
    let der = public_der(&key);
    let public_key = STANDARD.encode(&der);
    let fingerprint = fingerprint(&der);
    let mut token_bytes = [0_u8; 32];
    use rand_core::RngCore;
    OsRng.fill_bytes(&mut token_bytes);
    let token = URL_SAFE_NO_PAD.encode(token_bytes);
    let listener = TcpListener::bind(("127.0.0.1", 0))
        .map_err(|_| "Gleam could not start the local identity signer.".to_string())?;
    let port = listener
        .local_addr()
        .map_err(|_| "Gleam could not read the identity signer address.".to_string())?
        .port();
    listener
        .set_nonblocking(true)
        .map_err(|_| "Gleam could not secure the local identity signer.".to_string())?;
    let stop = Arc::new(AtomicBool::new(false));
    let thread_stop = stop.clone();
    let thread_token = token.clone();
    let thread_player = player_name.to_string();
    let thread_public = public_key.clone();
    let thread_fingerprint = fingerprint.clone();
    thread::spawn(move || {
        while !thread_stop.load(Ordering::Acquire) {
            match listener.accept() {
                Ok((stream, address)) if address.ip().is_loopback() => broker_request(
                    stream,
                    &thread_token,
                    &thread_player,
                    &key,
                    &thread_public,
                    &thread_fingerprint,
                ),
                Ok(_) => {}
                Err(error) if error.kind() == std::io::ErrorKind::WouldBlock => {
                    thread::sleep(Duration::from_millis(50))
                }
                Err(_) => break,
            }
        }
    });
    Ok(IdentityBroker {
        port,
        token,
        public_key,
        fingerprint,
        stop,
    })
}
