use super::java;
use super::network::NetworkClient;
use super::paths::AppPaths;
use super::storage::{atomic_write_json, copy_tree, directory_size, read_json_or};
use chrono::Utc;
use rand_core::{OsRng, RngCore};
use regex::Regex;
use serde::{Deserialize, Serialize};
use serde_json::{Map, Value, json};
use std::collections::HashMap;
use std::fs::{self, File, OpenOptions};
use std::io::{BufRead, BufReader, Read, Write};
use std::net::TcpListener;
use std::path::{Path, PathBuf};
use std::process::{Child, Command, Stdio};
use std::sync::{Arc, Mutex};
use std::thread;
use std::time::Duration;

#[derive(Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ServerRecord {
    pub id: String,
    pub name: String,
    pub version: String,
    pub port: u16,
    #[serde(default = "default_memory")]
    pub memory_mb: u32,
    #[serde(default)]
    pub template: String,
    #[serde(default)]
    pub whitelist: bool,
    #[serde(default)]
    pub backup_schedule: String,
    #[serde(default)]
    pub created_at: String,
    #[serde(flatten)]
    pub extra: Map<String, Value>,
}

fn default_memory() -> u32 {
    4096
}

#[derive(Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ServerView {
    #[serde(flatten)]
    pub server: ServerRecord,
    pub state: String,
    pub message: String,
}

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct CreateServerRequest {
    pub name: String,
    pub version: String,
    pub port: u16,
    pub memory_mb: u32,
    #[serde(default)]
    pub whitelist: bool,
    pub accept_eula: bool,
}

#[derive(Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ServerBackup {
    pub id: String,
    pub created_at: String,
    pub size: u64,
}

#[derive(Default)]
pub struct ServerRuntime {
    children: Mutex<HashMap<String, Arc<Mutex<Child>>>>,
    states: Mutex<HashMap<String, (String, String)>>,
    consoles: Mutex<HashMap<String, String>>,
}

impl ServerRuntime {
    fn set_state(&self, id: &str, state: &str, message: &str) {
        if let Ok(mut states) = self.states.lock() {
            states.insert(id.to_string(), (state.to_string(), message.to_string()));
        }
    }

    fn append_console(&self, id: &str, line: &str) {
        if let Ok(mut consoles) = self.consoles.lock() {
            let text = consoles.entry(id.to_string()).or_default();
            text.push_str(line);
            if text.len() > 512 * 1024 {
                let boundary = text.len() - 512 * 1024;
                let safe = text
                    .char_indices()
                    .find(|(index, _)| *index >= boundary)
                    .map_or(boundary, |(index, _)| index);
                text.drain(..safe);
            }
        }
    }

    pub fn view_state(&self, id: &str) -> (String, String) {
        self.states
            .lock()
            .ok()
            .and_then(|states| states.get(id).cloned())
            .unwrap_or_else(|| ("stopped".into(), "Ready to start.".into()))
    }

    pub fn console(&self, id: &str) -> String {
        self.consoles
            .lock()
            .ok()
            .and_then(|values| values.get(id).cloned())
            .unwrap_or_default()
    }
}

fn root(paths: &AppPaths) -> PathBuf {
    paths.data.join("servers")
}
fn registry(paths: &AppPaths) -> PathBuf {
    root(paths).join("servers.json")
}

fn valid_id(id: &str) -> Result<(), String> {
    if Regex::new(r"^[a-f0-9]{16}$").unwrap().is_match(id) {
        Ok(())
    } else {
        Err("That server ID is invalid.".into())
    }
}

fn directory(paths: &AppPaths, id: &str) -> Result<PathBuf, String> {
    valid_id(id)?;
    Ok(root(paths).join(id))
}

fn load(paths: &AppPaths) -> Result<Vec<ServerRecord>, String> {
    let file = registry(paths);
    serde_json::from_value(read_json_or(
        &file,
        &file.with_extension("json.bak"),
        Value::Array(Vec::new()),
    ))
    .map_err(|_| "The server registry is damaged. Its recovery copy was left untouched.".into())
}

fn save(paths: &AppPaths, servers: &[ServerRecord]) -> Result<(), String> {
    let file = registry(paths);
    if file.is_file() {
        fs::copy(&file, file.with_extension("json.bak"))
            .map_err(|_| "Gleam could not preserve the server registry.".to_string())?;
    }
    atomic_write_json(
        &file,
        &serde_json::to_value(servers)
            .map_err(|_| "Gleam could not encode the server registry.".to_string())?,
    )
}

pub fn list(paths: &AppPaths, runtime: &ServerRuntime) -> Result<Vec<ServerView>, String> {
    Ok(load(paths)?
        .into_iter()
        .map(|server| {
            let (state, message) = runtime.view_state(&server.id);
            ServerView {
                server,
                state,
                message,
            }
        })
        .collect())
}

fn supported(version: &str) -> bool {
    let pieces: Vec<u32> = version
        .split('.')
        .map(str::parse)
        .collect::<Result<_, _>>()
        .unwrap_or_default();
    pieces.len() >= 2 && (pieces[0] >= 26 || pieces[0] > 1 || (pieces[0] == 1 && pieces[1] >= 14))
}

fn new_id() -> String {
    let mut bytes = [0_u8; 8];
    OsRng.fill_bytes(&mut bytes);
    hex::encode(bytes)
}

fn port_free(port: u16) -> bool {
    TcpListener::bind(("127.0.0.1", port)).is_ok()
}

pub fn create(paths: &AppPaths, request: CreateServerRequest) -> Result<ServerRecord, String> {
    let name: String = request.name.trim().chars().take(40).collect();
    if name.is_empty()
        || !supported(&request.version)
        || request.port < 1024
        || request.memory_mb < 1024
        || request.memory_mb > 16_384
    {
        return Err(
            "Use a name, supported Minecraft version, port 1024–65535, and 1–16 GiB of memory."
                .into(),
        );
    }
    if !request.accept_eula {
        return Err("Accept the Minecraft EULA before creating a server.".into());
    }
    let mut servers = load(paths)?;
    if servers.iter().any(|server| server.port == request.port) || !port_free(request.port) {
        return Err(format!("Port {} is already in use.", request.port));
    }
    let id = new_id();
    let dir = directory(paths, &id)?;
    fs::create_dir_all(dir.join("mods"))
        .map_err(|_| "Gleam could not create the server folder.".to_string())?;
    fs::create_dir_all(dir.join("logs"))
        .map_err(|_| "Gleam could not create the server log folder.".to_string())?;
    fs::write(dir.join("eula.txt"), "eula=true\n")
        .map_err(|_| "Gleam could not save the EULA choice.".to_string())?;
    fs::write(dir.join("server.properties"), format!("motd=Gleam private server\nserver-port={}\nonline-mode=false\nwhite-list={}\nenforce-whitelist={}\nenforce-secure-profile=false\nmax-players=12\ngamemode=survival\ndifficulty=easy\npvp=true\nenable-command-block=false\nview-distance=10\nsimulation-distance=8\nsync-chunk-writes=true\n", request.port, request.whitelist, request.whitelist)).map_err(|_| "Gleam could not write server.properties.".to_string())?;
    atomic_write_json(
        &dir.join("swirl-identities.json"),
        &json!({"format": 1, "approved": [], "pending": []}),
    )?;
    let server = ServerRecord {
        id,
        name,
        version: request.version,
        port: request.port,
        memory_mb: request.memory_mb,
        template: "custom".into(),
        whitelist: request.whitelist,
        backup_schedule: "off".into(),
        created_at: Utc::now().to_rfc3339(),
        extra: Map::new(),
    };
    servers.push(server.clone());
    if let Err(error) = save(paths, &servers) {
        let _ = fs::remove_dir_all(dir);
        return Err(error);
    }
    Ok(server)
}

fn installer_version(network: &NetworkClient) -> Result<String, String> {
    network
        .json("https://meta.fabricmc.net/v2/versions/installer")?
        .as_array()
        .and_then(|values| {
            values
                .iter()
                .find(|value| value.get("stable").and_then(Value::as_bool) == Some(true))
                .or_else(|| values.first())
        })
        .and_then(|value| value.get("version"))
        .and_then(Value::as_str)
        .map(str::to_string)
        .ok_or("Fabric did not provide a server installer.".into())
}

fn loader_version(network: &NetworkClient, version: &str) -> Result<String, String> {
    network
        .json(&format!(
            "https://meta.fabricmc.net/v2/versions/loader/{version}"
        ))?
        .as_array()
        .and_then(|values| values.first())
        .and_then(|value| value.pointer("/loader/version"))
        .and_then(Value::as_str)
        .map(str::to_string)
        .ok_or("Fabric did not provide a compatible loader.".into())
}

fn valid_jar(path: &Path) -> bool {
    let mut signature = [0_u8; 4];
    File::open(path)
        .and_then(|mut file| file.read_exact(&mut signature))
        .is_ok()
        && signature == [0x50, 0x4b, 0x03, 0x04]
}

fn stream_output(
    runtime: Arc<ServerRuntime>,
    id: String,
    log: PathBuf,
    stream: impl Read + Send + 'static,
) {
    thread::spawn(move || {
        let mut log_file = OpenOptions::new().create(true).append(true).open(log).ok();
        for line in BufReader::new(stream).lines().map_while(Result::ok) {
            let text = format!("{line}\n");
            runtime.append_console(&id, &text);
            if let Some(file) = log_file.as_mut() {
                let _ = file.write_all(text.as_bytes());
            }
            if line.contains("Done (") && line.contains("For help") {
                runtime.set_state(&id, "ready", "Server is ready for players.");
            }
        }
    });
}

pub fn start(
    paths: &AppPaths,
    runtime: Arc<ServerRuntime>,
    network: &NetworkClient,
    id: &str,
) -> Result<ServerView, String> {
    let server = load(paths)?
        .into_iter()
        .find(|server| server.id == id)
        .ok_or("That server was not found.")?;
    if runtime
        .children
        .lock()
        .map_err(|_| "The server process registry is unavailable.")?
        .contains_key(id)
    {
        return Err("That server is already running.".into());
    }
    if !port_free(server.port) {
        return Err(format!("Port {} is already in use.", server.port));
    }
    let dir = directory(paths, id)?;
    runtime.set_state(id, "preparing", "Checking Java and Fabric server files…");
    let loader = loader_version(network, &server.version)?;
    let installer = installer_version(network)?;
    let jar = dir.join("fabric-server-launch.jar");
    if !valid_jar(&jar) {
        let _ = fs::remove_file(&jar);
        network.download(
            &format!(
                "https://meta.fabricmc.net/v2/versions/loader/{}/{}/{}/server/jar",
                server.version, loader, installer
            ),
            &jar,
            "",
        )?;
        if !valid_jar(&jar) {
            let _ = fs::remove_file(&jar);
            return Err("The Fabric server download was not a valid JAR.".into());
        }
    }
    let required = java::fallback_major(&server.version);
    let java = java::ensure(paths, required, network)?;
    let mut child = Command::new(&java.executable)
        .args([
            format!("-Xms{}M", server.memory_mb.min(1024)),
            format!("-Xmx{}M", server.memory_mb),
            "-XX:+ExitOnOutOfMemoryError".into(),
            "-Dlog4j2.formatMsgNoLookups=true".into(),
            "-jar".into(),
            jar.to_string_lossy().into_owned(),
            "nogui".into(),
        ])
        .current_dir(&dir)
        .stdin(Stdio::piped())
        .stdout(Stdio::piped())
        .stderr(Stdio::piped())
        .spawn()
        .map_err(|error| format!("The server could not start: {error}"))?;
    let stdout = child.stdout.take();
    let stderr = child.stderr.take();
    let child = Arc::new(Mutex::new(child));
    runtime
        .children
        .lock()
        .map_err(|_| "The server process registry is unavailable.")?
        .insert(id.to_string(), child.clone());
    runtime.set_state(id, "starting", "Minecraft is starting…");
    let log = dir.join("logs").join("icecream-host.log");
    if let Some(stream) = stdout {
        stream_output(runtime.clone(), id.to_string(), log.clone(), stream);
    }
    if let Some(stream) = stderr {
        stream_output(runtime.clone(), id.to_string(), log, stream);
    }
    let monitor = runtime.clone();
    let server_id = id.to_string();
    thread::spawn(move || {
        loop {
            let result = child
                .lock()
                .ok()
                .and_then(|mut process| process.try_wait().ok())
                .flatten();
            if let Some(status) = result {
                if let Ok(mut children) = monitor.children.lock() {
                    children.remove(&server_id);
                }
                if status.success() {
                    monitor.set_state(&server_id, "stopped", "Server stopped.");
                } else {
                    monitor.set_state(
                        &server_id,
                        "error",
                        &format!(
                            "Server exited with status {status}. Open the console for details."
                        ),
                    );
                }
                break;
            }
            thread::sleep(Duration::from_millis(500));
        }
    });
    let (state, message) = runtime.view_state(id);
    Ok(ServerView {
        server,
        state,
        message,
    })
}

pub fn command(runtime: &ServerRuntime, id: &str, value: &str) -> Result<(), String> {
    valid_id(id)?;
    let command = value.trim();
    if command.is_empty() || command.len() > 500 || command.contains(['\r', '\n']) {
        return Err("Enter one server command up to 500 characters.".into());
    }
    let child = runtime
        .children
        .lock()
        .map_err(|_| "The server process registry is unavailable.")?
        .get(id)
        .cloned()
        .ok_or("Start the server before sending commands.")?;
    let mut process = child
        .lock()
        .map_err(|_| "The server process is unavailable.")?;
    process
        .stdin
        .as_mut()
        .ok_or("The server console is unavailable.")?
        .write_all(format!("{command}\n").as_bytes())
        .map_err(|_| "The command could not be sent.".into())
}

pub fn stop(runtime: &ServerRuntime, id: &str) -> Result<(), String> {
    runtime.set_state(id, "stopping", "Saving the world and stopping safely…");
    command(runtime, id, "stop")
}

pub fn console(runtime: &ServerRuntime, id: &str) -> Result<String, String> {
    valid_id(id)?;
    Ok(runtime.console(id))
}

pub fn backup(paths: &AppPaths, id: &str, retention: usize) -> Result<ServerBackup, String> {
    let dir = directory(paths, id)?;
    if !dir.is_dir() {
        return Err("That server was not found.".into());
    }
    let stamp = format!(
        "{}-{:04x}",
        Utc::now().format("%Y-%m-%dT%H-%M-%S%.3fZ"),
        OsRng.next_u32() & 0xffff
    );
    let destination = root(paths).join("backups").join(id).join(&stamp);
    copy_tree(&dir, &destination)?;
    let mut backups = list_backups(paths, id)?;
    for old in backups.drain(retention.max(1)..) {
        fs::remove_dir_all(root(paths).join("backups").join(id).join(old.id))
            .map_err(|_| "Gleam could not prune an old server backup.".to_string())?;
    }
    Ok(ServerBackup {
        id: stamp,
        created_at: Utc::now().to_rfc3339(),
        size: directory_size(&destination),
    })
}

pub fn list_backups(paths: &AppPaths, id: &str) -> Result<Vec<ServerBackup>, String> {
    valid_id(id)?;
    let base = root(paths).join("backups").join(id);
    let mut values = Vec::new();
    for entry in fs::read_dir(base).into_iter().flatten().flatten() {
        if !entry.path().is_dir() || !entry.path().join("server.properties").is_file() {
            continue;
        }
        let metadata = entry.metadata().ok();
        values.push(ServerBackup {
            id: entry.file_name().to_string_lossy().into_owned(),
            created_at: metadata
                .and_then(|value| value.modified().ok())
                .map(|value| chrono::DateTime::<Utc>::from(value).to_rfc3339())
                .unwrap_or_default(),
            size: directory_size(&entry.path()),
        });
    }
    values.sort_by(|a, b| b.id.cmp(&a.id));
    Ok(values)
}

pub fn remove(paths: &AppPaths, runtime: &ServerRuntime, id: &str) -> Result<String, String> {
    if runtime
        .children
        .lock()
        .map_err(|_| "The server process registry is unavailable.")?
        .contains_key(id)
    {
        return Err("Stop the server before deleting it.".into());
    }
    let mut servers = load(paths)?;
    let server = servers
        .iter()
        .find(|server| server.id == id)
        .cloned()
        .ok_or("That server was not found.")?;
    let source = directory(paths, id)?;
    let trash = root(paths).join("trash");
    fs::create_dir_all(&trash).map_err(|_| "Gleam could not create server trash.".to_string())?;
    let target = trash.join(format!("{}-{}", id, Utc::now().timestamp_millis()));
    if source.exists() {
        fs::rename(source, &target)
            .map_err(|_| "Gleam could not move the server to recoverable trash.".to_string())?;
    }
    servers.retain(|entry| entry.id != id);
    save(paths, &servers)?;
    Ok(server.name)
}

pub fn properties(paths: &AppPaths, id: &str) -> Result<Value, String> {
    let file = directory(paths, id)?.join("server.properties");
    let content =
        fs::read_to_string(file).map_err(|_| "server.properties is unavailable.".to_string())?;
    let mut values = Map::new();
    for line in content
        .lines()
        .filter(|line| !line.starts_with('#') && line.contains('='))
    {
        let (key, value) = line.split_once('=').unwrap();
        values.insert(key.to_string(), Value::String(value.to_string()));
    }
    Ok(Value::Object(values))
}

#[cfg(test)]
mod tests {
    use super::supported;

    #[test]
    fn validates_supported_minecraft_versions() {
        assert!(supported("1.14"));
        assert!(supported("1.21.4"));
        assert!(supported("26.1.2"));
        assert!(supported("26.2"));
        assert!(!supported("1.13.2"));
        assert!(!supported("release"));
        assert!(!supported(""));
    }
}
