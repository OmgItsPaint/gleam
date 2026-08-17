use super::paths::AppPaths;
use super::storage::{atomic_write_json, read_json_or};
use chrono::Utc;
use serde::{Deserialize, Serialize};
use serde_json::Value;
use sha2::{Digest, Sha256};
use std::fs;

#[derive(Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct JobRecord {
    pub id: String,
    #[serde(rename = "type")]
    pub operation: String,
    pub scope: String,
    pub state: String,
    #[serde(default)]
    pub message: String,
    #[serde(default)]
    pub completed: u64,
    #[serde(default)]
    pub total: u64,
    #[serde(default = "yes")]
    pub retryable: bool,
    #[serde(default = "yes")]
    pub cancellable: bool,
    #[serde(default)]
    pub recoverable: bool,
    pub created_at: String,
    pub updated_at: String,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub error: Option<String>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub payload: Option<Value>,
}

fn yes() -> bool {
    true
}

fn file(paths: &AppPaths) -> std::path::PathBuf {
    paths.jobs.join("jobs.json")
}

fn backup(paths: &AppPaths) -> std::path::PathBuf {
    paths.jobs.join("jobs.json.bak")
}

pub fn list(paths: &AppPaths) -> Vec<JobRecord> {
    let value = read_json_or(&file(paths), &backup(paths), Value::Array(Vec::new()));
    let mut jobs: Vec<JobRecord> = serde_json::from_value(value).unwrap_or_default();
    let now = Utc::now().to_rfc3339();
    for job in &mut jobs {
        if matches!(job.state.as_str(), "running" | "queued") {
            job.state = "paused".to_string();
            job.message = "Paused after Gleam restarted".to_string();
            job.updated_at = now.clone();
        }
        job.message = job.message.chars().take(300).collect();
        job.error = job
            .error
            .take()
            .map(|value| value.chars().take(500).collect());
    }
    jobs.retain(|job| {
        job.id.len() == 24
            && job
                .id
                .bytes()
                .all(|byte| byte.is_ascii_hexdigit() && !byte.is_ascii_uppercase())
            && !job.operation.is_empty()
            && !job.scope.is_empty()
    });
    jobs.into_iter()
        .rev()
        .take(500)
        .collect::<Vec<_>>()
        .into_iter()
        .rev()
        .collect()
}

pub fn save(paths: &AppPaths, jobs: &[JobRecord]) -> Result<(), String> {
    fs::create_dir_all(&paths.jobs)
        .map_err(|_| "Gleam could not create the jobs folder.".to_string())?;
    let destination = file(paths);
    if destination.is_file() {
        fs::copy(&destination, backup(paths))
            .map_err(|_| "Gleam could not preserve the previous job state.".to_string())?;
    }
    atomic_write_json(
        &destination,
        &serde_json::to_value(jobs).map_err(|_| "Gleam could not encode job state.".to_string())?,
    )
}

pub fn create(
    paths: &AppPaths,
    operation: &str,
    scope: &str,
    message: &str,
) -> Result<JobRecord, String> {
    let operation = operation.trim();
    if operation.is_empty()
        || operation.len() > 64
        || !operation
            .bytes()
            .all(|byte| byte.is_ascii_lowercase() || byte.is_ascii_digit() || byte == b'-')
    {
        return Err("Choose a valid job operation.".to_string());
    }
    let scope: String = scope.trim().chars().take(128).collect();
    if scope.is_empty() {
        return Err("Choose a valid job scope.".to_string());
    }
    let now = Utc::now().to_rfc3339();
    let mut digest = Sha256::new();
    digest.update(operation.as_bytes());
    digest.update(scope.as_bytes());
    digest.update(now.as_bytes());
    let id = hex::encode(digest.finalize())[..24].to_string();
    let record = JobRecord {
        id,
        operation: operation.to_string(),
        scope,
        state: "queued".to_string(),
        message: message.chars().take(300).collect(),
        completed: 0,
        total: 0,
        retryable: true,
        cancellable: true,
        recoverable: false,
        created_at: now.clone(),
        updated_at: now,
        error: None,
        payload: None,
    };
    let mut jobs = list(paths);
    jobs.push(record.clone());
    if jobs.len() > 500 {
        jobs.drain(..jobs.len() - 500);
    }
    save(paths, &jobs)?;
    Ok(record)
}

pub fn set_state(paths: &AppPaths, id: &str, state: &str) -> Result<bool, String> {
    if !matches!(state, "queued" | "paused" | "cancelled") {
        return Err("That job state transition is not allowed.".to_string());
    }
    let mut jobs = list(paths);
    let Some(job) = jobs.iter_mut().find(|job| job.id == id) else {
        return Ok(false);
    };
    if matches!(job.state.as_str(), "succeeded" | "cancelled") {
        return Ok(false);
    }
    job.state = state.to_string();
    job.message = match state {
        "queued" => "Waiting",
        "paused" => "Paused",
        _ => "Cancelled",
    }
    .to_string();
    job.updated_at = Utc::now().to_rfc3339();
    save(paths, &jobs)?;
    Ok(true)
}
