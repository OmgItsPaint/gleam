use super::paths::AppPaths;
use super::storage::{atomic_write_json, read_json_or};
use serde_json::{Map, Value, json};
use std::fs;

fn defaults() -> Value {
    json!({
        "format": 2,
        "autoUpdate": true,
        "updatePolicy": "notify",
        "fabricLoaderVersion": "",
        "activeProfiles": {},
        "lastVersion": "26.2",
        "beginnerMode": true,
        "experimentalVersions": false,
        "backupRetention": 5,
        "uiScale": 1.0,
        "reducedMotion": false,
        "readableFont": false,
        "network": { "mode": "system", "manualProxyUrl": "" },
        "offline": { "mode": "online" },
        "jobs": { "concurrency": 3 },
        "diagnostics": { "allowExport": true }
    })
}

fn merge_objects(base: &mut Map<String, Value>, incoming: &Map<String, Value>) {
    for (key, value) in incoming {
        if let (Some(Value::Object(current)), Value::Object(next)) = (base.get_mut(key), value) {
            merge_objects(current, next);
        } else {
            base.insert(key.clone(), value.clone());
        }
    }
}

fn normalized(mut value: Value) -> Value {
    let mut base = defaults().as_object().cloned().unwrap_or_default();
    if let Value::Object(loaded) = &value {
        merge_objects(&mut base, loaded);
    }
    base.insert("format".to_string(), Value::from(2));
    let legacy_auto = base
        .get("autoUpdate")
        .and_then(Value::as_bool)
        .unwrap_or(false);
    let policy = base
        .get("updatePolicy")
        .and_then(Value::as_str)
        .unwrap_or("");
    if !matches!(policy, "notify" | "automatic" | "disabled" | "managed") {
        base.insert(
            "updatePolicy".to_string(),
            Value::String(if legacy_auto { "notify" } else { "disabled" }.to_string()),
        );
    }
    let retention = base
        .get("backupRetention")
        .and_then(Value::as_u64)
        .unwrap_or(5)
        .clamp(1, 20);
    base.insert("backupRetention".to_string(), Value::from(retention));
    let scale = base
        .get("uiScale")
        .and_then(Value::as_f64)
        .unwrap_or(1.0)
        .clamp(0.8, 1.4);
    base.insert("uiScale".to_string(), Value::from(scale));
    value = Value::Object(base);
    value
}

pub fn read(paths: &AppPaths) -> Value {
    normalized(read_json_or(
        &paths.data.join("settings.json"),
        &paths.data.join("settings.backup.json"),
        defaults(),
    ))
}

pub fn update(paths: &AppPaths, patch: Value) -> Result<Value, String> {
    let Value::Object(patch) = patch else {
        return Err("Settings changes must be an object.".to_string());
    };
    let mut current = read(paths).as_object().cloned().unwrap_or_default();
    merge_objects(&mut current, &patch);
    let next = normalized(Value::Object(current));
    let file = paths.data.join("settings.json");
    if file.is_file() {
        fs::copy(&file, paths.data.join("settings.backup.json"))
            .map_err(|_| "Gleam could not preserve the previous settings.".to_string())?;
    }
    atomic_write_json(&file, &next)?;
    Ok(next)
}
