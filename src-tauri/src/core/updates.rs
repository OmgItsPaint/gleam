use super::network::{NetworkClient, file_hash};
use super::paths::AppPaths;
use super::storage::{atomic_write_json, read_json_or};
use base64::Engine;
use base64::engine::general_purpose::STANDARD;
use ed25519_dalek::pkcs8::DecodePublicKey;
use ed25519_dalek::{Signature, Verifier, VerifyingKey};
use serde_json::{Map, Value, json};
use std::fs;
use std::process::{Command, Stdio};

fn stable(value: &Value) -> String {
    match value {
        Value::Array(values) => format!(
            "[{}]",
            values.iter().map(stable).collect::<Vec<_>>().join(",")
        ),
        Value::Object(values) => {
            let mut keys: Vec<&String> = values.keys().collect();
            keys.sort();
            format!(
                "{{{}}}",
                keys.into_iter()
                    .map(|key| format!(
                        "{}:{}",
                        serde_json::to_string(key).unwrap(),
                        stable(&values[key])
                    ))
                    .collect::<Vec<_>>()
                    .join(",")
            )
        }
        _ => serde_json::to_string(value).unwrap_or_else(|_| "null".into()),
    }
}

fn newer(candidate: &str, current: &str) -> bool {
    let parse = |value: &str| {
        value
            .split('.')
            .map(|part| part.parse::<u32>().unwrap_or(0))
            .collect::<Vec<_>>()
    };
    let left = parse(candidate);
    let right = parse(current);
    (0..left.len().max(right.len()))
        .find_map(|index| {
            let a = *left.get(index).unwrap_or(&0);
            let b = *right.get(index).unwrap_or(&0);
            (a != b).then_some(a > b)
        })
        .unwrap_or(false)
}

fn config(paths: &AppPaths) -> Value {
    let file = paths.resources.join("config").join("update-config.json");
    read_json_or(
        &file,
        &file.with_extension("json.bak"),
        json!({"format": 2, "enabled": false, "manifestUrl": "", "publicKey": ""}),
    )
}

fn verifying_key(value: &str) -> Result<VerifyingKey, String> {
    let expanded = value.replace("\\n", "\n");
    if expanded.contains("BEGIN PUBLIC KEY") {
        return VerifyingKey::from_public_key_pem(&expanded)
            .map_err(|_| "The configured update public key is invalid.".into());
    }
    let bytes = STANDARD
        .decode(expanded.trim())
        .map_err(|_| "The configured update public key is invalid.".to_string())?;
    if bytes.len() == 32 {
        return VerifyingKey::from_bytes(&bytes.try_into().unwrap())
            .map_err(|_| "The configured update public key is invalid.".into());
    }
    VerifyingKey::from_public_key_der(&bytes)
        .map_err(|_| "The configured update public key is invalid.".into())
}

fn verify(document: &Value, public_key: &str) -> Result<Value, String> {
    let payload = document
        .get("payload")
        .cloned()
        .ok_or("The update manifest has no payload.")?;
    let signature = document
        .get("signature")
        .and_then(Value::as_str)
        .ok_or("The update manifest has no signature.")?;
    let object = payload
        .as_object()
        .ok_or("The update payload is malformed.")?;
    let valid = object.get("format").and_then(Value::as_u64) == Some(2)
        && object
            .get("version")
            .and_then(Value::as_str)
            .is_some_and(|value| value.split('.').count() == 3)
        && object
            .get("minimumVersion")
            .and_then(Value::as_str)
            .is_some_and(|value| value.split('.').count() == 3)
        && object
            .get("channel")
            .and_then(Value::as_str)
            .is_some_and(|value| matches!(value, "stable" | "beta"))
        && object.get("artifactType").and_then(Value::as_str) == Some("nsis")
        && object
            .get("url")
            .and_then(Value::as_str)
            .is_some_and(|value| value.starts_with("https://"))
        && object
            .get("size")
            .and_then(Value::as_u64)
            .is_some_and(|value| (1..=350 * 1024 * 1024).contains(&value))
        && object
            .get("sha256")
            .and_then(Value::as_str)
            .is_some_and(|value| {
                value.len() == 64 && value.bytes().all(|byte| byte.is_ascii_hexdigit())
            });
    if !valid {
        return Err("The update manifest contains invalid release data.".into());
    }
    let signature_bytes = STANDARD
        .decode(signature)
        .map_err(|_| "The update manifest signature is malformed.".to_string())?;
    let signature = Signature::from_slice(&signature_bytes)
        .map_err(|_| "The update manifest signature is malformed.".to_string())?;
    verifying_key(public_key)?
        .verify(stable(&payload).as_bytes(), &signature)
        .map_err(|_| "The update manifest signature is not trusted.".to_string())?;
    Ok(payload)
}

pub fn check(paths: &AppPaths, network: &NetworkClient) -> Result<Value, String> {
    let config = config(paths);
    if config.get("enabled").and_then(Value::as_bool) != Some(true) {
        return Ok(
            json!({"enabled": false, "currentVersion": env!("CARGO_PKG_VERSION"), "message": "Updates are disabled in this source build."}),
        );
    }
    let url = config
        .get("manifestUrl")
        .and_then(Value::as_str)
        .unwrap_or("");
    let key = config
        .get("publicKey")
        .and_then(Value::as_str)
        .unwrap_or("");
    if url.is_empty() || key.is_empty() {
        return Err("Signed updates are enabled without a manifest URL or public key.".into());
    }
    let document = network.json(url)?;
    let payload = verify(&document, key)?;
    let version = payload
        .get("version")
        .and_then(Value::as_str)
        .unwrap_or("0.0.0");
    Ok(
        json!({"enabled": true, "available": newer(version, env!("CARGO_PKG_VERSION")), "currentVersion": env!("CARGO_PKG_VERSION"), "payload": payload}),
    )
}

pub fn stage(paths: &AppPaths, network: &NetworkClient) -> Result<Value, String> {
    let result = check(paths, network)?;
    if result.get("available").and_then(Value::as_bool) != Some(true) {
        return Ok(result);
    }
    let payload = result
        .get("payload")
        .and_then(Value::as_object)
        .ok_or("The verified update payload disappeared.")?;
    let version = payload.get("version").and_then(Value::as_str).unwrap();
    let url = payload.get("url").and_then(Value::as_str).unwrap();
    let expected = payload.get("sha256").and_then(Value::as_str).unwrap();
    let size = payload.get("size").and_then(Value::as_u64).unwrap();
    let root = paths.data.join("updates");
    fs::create_dir_all(&root)
        .map_err(|_| "Gleam could not create the update staging folder.".to_string())?;
    let installer = root.join(format!("Gleam-{version}-Setup.exe"));
    network.download(url, &installer, expected)?;
    if installer
        .metadata()
        .map_err(|_| "The staged update disappeared.".to_string())?
        .len()
        != size
        || file_hash(&installer, 64)? != expected.to_ascii_lowercase()
    {
        let _ = fs::remove_file(&installer);
        return Err("The staged update did not match the signed release manifest.".into());
    }
    let state_file = root.join("state.json");
    let mut state = read_json_or(
        &state_file,
        &state_file.with_extension("json.bak"),
        Value::Object(Map::new()),
    );
    state["staged"] = json!({"version": version, "installer": installer, "sha256": expected, "notes": payload.get("notes").cloned().unwrap_or(Value::String(String::new())), "stagedAt": chrono::Utc::now().to_rfc3339()});
    atomic_write_json(&state_file, &state)?;
    Ok(json!({"enabled": true, "available": true, "payload": payload, "staged": state["staged"]}))
}

pub fn apply(paths: &AppPaths) -> Result<Value, String> {
    let file = paths.data.join("updates").join("state.json");
    let state = read_json_or(
        &file,
        &file.with_extension("json.bak"),
        Value::Object(Map::new()),
    );
    let staged = state
        .get("staged")
        .ok_or("Download an update before installing it.")?;
    let installer = staged
        .get("installer")
        .and_then(Value::as_str)
        .ok_or("The staged update record is incomplete.")?;
    if !std::path::Path::new(installer).is_file() {
        return Err("The staged update installer is missing.".into());
    }
    Command::new(installer)
        .arg("/S")
        .stdin(Stdio::null())
        .stdout(Stdio::null())
        .stderr(Stdio::null())
        .spawn()
        .map_err(|error| format!("The signed update could not start: {error}"))?;
    Ok(json!({"installing": staged.get("version").cloned().unwrap_or(Value::Null)}))
}

#[cfg(test)]
mod tests {
    use super::{newer, stable};
    use serde_json::json;

    #[test]
    fn compares_versions_component_by_component() {
        assert!(newer("3.0.1", "3.0.0"));
        assert!(newer("3.1.0", "3.0.99"));
        assert!(!newer("3.0.0", "3.0.0"));
        assert!(!newer("2.99.99", "3.0.0"));
    }

    #[test]
    fn canonical_json_is_independent_of_object_order() {
        let left = json!({"version": "3.0.0", "format": 2, "nested": {"b": 2, "a": 1}});
        let right = json!({"nested": {"a": 1, "b": 2}, "format": 2, "version": "3.0.0"});
        assert_eq!(stable(&left), stable(&right));
    }
}
