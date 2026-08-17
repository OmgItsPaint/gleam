mod core;

use core::{
    AppState, diagnostics, identity, java, jobs, launch, minecraft, mods, network::NetworkClient,
    profiles, provisioning, servers, settings, updates, worlds,
};
use serde::{Deserialize, Serialize};
use serde_json::Value;
use tauri::{AppHandle, Manager, State};
use tauri_plugin_dialog::DialogExt;

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
struct AppInfo {
    name: &'static str,
    version: &'static str,
    migration_stage: &'static str,
    data_location: &'static str,
    rust_core: bool,
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
struct LegacyStatus {
    available: bool,
    profile_count: usize,
    settings_available: bool,
    identity_available: bool,
    servers_available: bool,
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
struct ProfileSummary {
    id: String,
    name: String,
    game_version: String,
    mod_count: usize,
}

#[derive(Deserialize)]
struct ProfileIdRequest {
    id: String,
}

#[derive(Deserialize)]
struct RenameRequest {
    id: String,
    name: String,
}

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
struct WorldRequest {
    profile_id: String,
    world_name: String,
}

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
struct RenameWorldRequest {
    profile_id: String,
    world_name: String,
    name: String,
}

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
struct CopyWorldRequest {
    source_profile_id: String,
    target_profile_id: String,
    world_name: String,
}

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
struct RestoreRequest {
    profile_id: String,
    backup_id: String,
}

#[derive(Deserialize)]
struct JobCreateRequest {
    operation: String,
    scope: String,
    #[serde(default)]
    message: String,
}

#[derive(Deserialize)]
struct JobStateRequest {
    id: String,
    state: String,
}

#[derive(Deserialize)]
struct CleanupRequest {
    category: String,
    confirmed: bool,
}

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
struct GameVersionRequest {
    game_version: String,
}

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
struct SearchModsRequest {
    query: String,
    game_version: String,
}

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
struct RemoveModRequest {
    profile_id: String,
    project_id: String,
}

#[derive(Deserialize)]
struct ServerIdRequest {
    id: String,
}

#[derive(Deserialize)]
struct ServerCommandRequest {
    id: String,
    command: String,
}

#[derive(Deserialize)]
struct PackPathRequest {
    path: String,
}

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
struct ExportPackRequest {
    profile_id: String,
    path: String,
}

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
struct ImportPackRequest {
    path: String,
    #[serde(default)]
    allow_unsigned: bool,
}

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
struct IdentitySignRequest {
    payload_base64: String,
}

#[tauri::command]
fn app_info() -> AppInfo {
    AppInfo {
        name: "Gleam",
        version: env!("CARGO_PKG_VERSION"),
        migration_stage: "Native Rust core",
        data_location: "Existing local library (kept in place)",
        rust_core: true,
    }
}

#[tauri::command]
fn legacy_status(state: State<'_, AppState>) -> LegacyStatus {
    let paths = &state.paths;
    LegacyStatus {
        available: paths.data.is_dir(),
        profile_count: profiles::list(paths).map_or(0, |profiles| profiles.len()),
        settings_available: paths.data.join("settings.json").is_file(),
        identity_available: paths
            .data
            .join("identity")
            .join("player-key.json")
            .is_file(),
        servers_available: paths.data.join("servers").join("servers.json").is_file(),
    }
}

#[tauri::command]
fn identity_status(state: State<'_, AppState>) -> identity::IdentityStatus {
    identity::status(&state.paths)
}

#[tauri::command]
fn create_identity(state: State<'_, AppState>) -> Result<identity::IdentityStatus, String> {
    let _guard = state.lock_scope("identity")?;
    identity::create(&state.paths)
}

#[tauri::command]
fn sign_identity(
    state: State<'_, AppState>,
    request: IdentitySignRequest,
) -> Result<Value, String> {
    identity::sign(&state.paths, &request.payload_base64)
}

#[tauri::command]
fn list_servers(state: State<'_, AppState>) -> Result<Vec<servers::ServerView>, String> {
    servers::list(&state.paths, &state.servers)
}

#[tauri::command]
fn create_server(
    state: State<'_, AppState>,
    request: servers::CreateServerRequest,
) -> Result<servers::ServerRecord, String> {
    let _guard = state.lock_scope("servers")?;
    servers::create(&state.paths, request)
}

#[tauri::command]
fn start_server(
    state: State<'_, AppState>,
    request: ServerIdRequest,
) -> Result<servers::ServerView, String> {
    let _guard = state.lock_scope(&format!("server:{}", request.id))?;
    servers::start(
        &state.paths,
        state.servers.clone(),
        &NetworkClient::from_settings(&state.paths)?,
        &request.id,
    )
}

#[tauri::command]
fn stop_server(state: State<'_, AppState>, request: ServerIdRequest) -> Result<(), String> {
    servers::stop(&state.servers, &request.id)
}

#[tauri::command]
fn server_command(state: State<'_, AppState>, request: ServerCommandRequest) -> Result<(), String> {
    servers::command(&state.servers, &request.id, &request.command)
}

#[tauri::command]
fn server_console(state: State<'_, AppState>, request: ServerIdRequest) -> Result<String, String> {
    servers::console(&state.servers, &request.id)
}

#[tauri::command]
fn create_server_backup(
    state: State<'_, AppState>,
    request: ServerIdRequest,
) -> Result<servers::ServerBackup, String> {
    let _guard = state.lock_scope(&format!("server:{}", request.id))?;
    servers::backup(&state.paths, &request.id, 5)
}

#[tauri::command]
fn list_server_backups(
    state: State<'_, AppState>,
    request: ServerIdRequest,
) -> Result<Vec<servers::ServerBackup>, String> {
    servers::list_backups(&state.paths, &request.id)
}

#[tauri::command]
fn delete_server(state: State<'_, AppState>, request: ServerIdRequest) -> Result<String, String> {
    let _guard = state.lock_scope(&format!("server:{}", request.id))?;
    servers::remove(&state.paths, &state.servers, &request.id)
}

#[tauri::command]
fn get_server_properties(
    state: State<'_, AppState>,
    request: ServerIdRequest,
) -> Result<Value, String> {
    servers::properties(&state.paths, &request.id)
}

#[tauri::command]
fn inspect_provisioning_pack(request: PackPathRequest) -> Result<provisioning::PackInfo, String> {
    provisioning::inspect(&request.path)
}

#[tauri::command]
fn export_provisioning_pack(
    state: State<'_, AppState>,
    request: ExportPackRequest,
) -> Result<provisioning::PackResult, String> {
    let _guard = state.lock_scope(&format!("profile:{}", request.profile_id))?;
    provisioning::export(&state.paths, &request.profile_id, &request.path)
}

#[tauri::command]
fn import_provisioning_pack(
    state: State<'_, AppState>,
    request: ImportPackRequest,
) -> Result<provisioning::PackResult, String> {
    let _guard = state.lock_scope("provisioning")?;
    provisioning::import(&state.paths, &request.path, request.allow_unsigned)
}

#[tauri::command]
fn check_updates(state: State<'_, AppState>) -> Result<Value, String> {
    updates::check(&state.paths, &NetworkClient::from_settings(&state.paths)?)
}

#[tauri::command]
fn stage_update(state: State<'_, AppState>) -> Result<Value, String> {
    let _guard = state.lock_scope("updates")?;
    updates::stage(&state.paths, &NetworkClient::from_settings(&state.paths)?)
}

#[tauri::command]
fn apply_update(state: State<'_, AppState>) -> Result<Value, String> {
    let _guard = state.lock_scope("updates")?;
    updates::apply(&state.paths)
}

#[tauri::command]
fn choose_provisioning_import(app: AppHandle) -> Option<String> {
    app.dialog()
        .file()
        .add_filter("Swirl offline pack", &["swirlpack"])
        .blocking_pick_file()
        .and_then(|path| path.into_path().ok())
        .map(|path| path.to_string_lossy().into_owned())
}

#[tauri::command]
fn choose_provisioning_export(app: AppHandle) -> Option<String> {
    app.dialog()
        .file()
        .add_filter("Swirl offline pack", &["swirlpack"])
        .set_file_name("gleam-offline-profile.swirlpack")
        .blocking_save_file()
        .and_then(|path| path.into_path().ok())
        .map(|path| path.to_string_lossy().into_owned())
}

#[tauri::command]
fn list_profiles(state: State<'_, AppState>) -> Result<Vec<ProfileSummary>, String> {
    Ok(profiles::list(&state.paths)?
        .into_iter()
        .take(500)
        .map(|profile| ProfileSummary {
            id: profile.id,
            name: profile.name.chars().take(128).collect(),
            game_version: profile.game_version.chars().take(64).collect(),
            mod_count: profile.mods.len().min(10_000),
        })
        .collect())
}

#[tauri::command]
fn create_profile(
    state: State<'_, AppState>,
    request: profiles::CreateProfileRequest,
) -> Result<profiles::Profile, String> {
    let _guard = state.lock_scope("profiles")?;
    profiles::create(&state.paths, request)
}

#[tauri::command]
fn rename_profile(
    state: State<'_, AppState>,
    request: RenameRequest,
) -> Result<profiles::Profile, String> {
    let _guard = state.lock_scope(&format!("profile:{}", request.id))?;
    profiles::rename(&state.paths, &request.id, &request.name)
}

#[tauri::command]
fn delete_profile(state: State<'_, AppState>, request: ProfileIdRequest) -> Result<(), String> {
    let _guard = state.lock_scope(&format!("profile:{}", request.id))?;
    profiles::remove(&state.paths, &request.id)
}

#[tauri::command]
fn get_settings(state: State<'_, AppState>) -> Value {
    settings::read(&state.paths)
}

#[tauri::command]
fn update_settings(state: State<'_, AppState>, patch: Value) -> Result<Value, String> {
    let _guard = state.lock_scope("settings")?;
    settings::update(&state.paths, patch)
}

#[tauri::command]
fn list_worlds(
    state: State<'_, AppState>,
    request: ProfileIdRequest,
) -> Result<Vec<worlds::WorldSummary>, String> {
    worlds::list(&state.paths, &request.id)
}

#[tauri::command]
fn duplicate_world(state: State<'_, AppState>, request: WorldRequest) -> Result<String, String> {
    let _guard = state.lock_scope(&format!("profile:{}", request.profile_id))?;
    worlds::duplicate(&state.paths, &request.profile_id, &request.world_name)
}

#[tauri::command]
fn rename_world(state: State<'_, AppState>, request: RenameWorldRequest) -> Result<String, String> {
    let _guard = state.lock_scope(&format!("profile:{}", request.profile_id))?;
    worlds::rename(
        &state.paths,
        &request.profile_id,
        &request.world_name,
        &request.name,
    )
}

#[tauri::command]
fn copy_world(state: State<'_, AppState>, request: CopyWorldRequest) -> Result<String, String> {
    let _guard = state.lock_scope(&format!("profile:{}", request.target_profile_id))?;
    worlds::copy(
        &state.paths,
        &request.source_profile_id,
        &request.world_name,
        &request.target_profile_id,
    )
}

#[tauri::command]
fn delete_world(state: State<'_, AppState>, request: WorldRequest) -> Result<String, String> {
    let _guard = state.lock_scope(&format!("profile:{}", request.profile_id))?;
    worlds::remove(&state.paths, &request.profile_id, &request.world_name)
}

#[tauri::command]
fn create_profile_backup(
    state: State<'_, AppState>,
    request: ProfileIdRequest,
) -> Result<worlds::BackupSummary, String> {
    let _guard = state.lock_scope(&format!("profile:{}", request.id))?;
    let retention = settings::read(&state.paths)
        .get("backupRetention")
        .and_then(Value::as_u64)
        .unwrap_or(5) as usize;
    worlds::backup_profile(&state.paths, &request.id, retention)
}

#[tauri::command]
fn list_profile_backups(
    state: State<'_, AppState>,
    request: ProfileIdRequest,
) -> Result<Vec<worlds::BackupSummary>, String> {
    worlds::list_backups(&state.paths, &request.id)
}

#[tauri::command]
fn restore_profile_backup(
    state: State<'_, AppState>,
    request: RestoreRequest,
) -> Result<String, String> {
    let _guard = state.lock_scope(&format!("profile:{}", request.profile_id))?;
    worlds::restore_backup(&state.paths, &request.profile_id, &request.backup_id)
}

#[tauri::command]
fn list_jobs(state: State<'_, AppState>) -> Vec<jobs::JobRecord> {
    jobs::list(&state.paths)
}

#[tauri::command]
fn create_job(
    state: State<'_, AppState>,
    request: JobCreateRequest,
) -> Result<jobs::JobRecord, String> {
    let _guard = state.lock_scope("jobs")?;
    jobs::create(
        &state.paths,
        &request.operation,
        &request.scope,
        &request.message,
    )
}

#[tauri::command]
fn set_job_state(state: State<'_, AppState>, request: JobStateRequest) -> Result<bool, String> {
    let _guard = state.lock_scope("jobs")?;
    jobs::set_state(&state.paths, &request.id, &request.state)
}

#[tauri::command]
fn diagnostics_report(state: State<'_, AppState>) -> diagnostics::DiagnosticsReport {
    diagnostics::report(&state.paths)
}

#[tauri::command]
fn storage_cleanup(state: State<'_, AppState>, request: CleanupRequest) -> Result<u64, String> {
    let _guard = state.lock_scope("storage")?;
    diagnostics::clean(&state.paths, &request.category, request.confirmed)
}

#[tauri::command]
fn minecraft_readiness(
    state: State<'_, AppState>,
    request: ProfileIdRequest,
) -> Result<Value, String> {
    minecraft::readiness(&state.paths, &request.id)
}

#[tauri::command]
fn list_fabric_loaders(
    state: State<'_, AppState>,
    request: GameVersionRequest,
) -> Result<Vec<minecraft::FabricLoaderSummary>, String> {
    minecraft::fabric_loaders(
        &NetworkClient::from_settings(&state.paths)?,
        &request.game_version,
    )
}

#[tauri::command]
fn search_mods(state: State<'_, AppState>, request: SearchModsRequest) -> Result<Value, String> {
    mods::search(
        &NetworkClient::from_settings(&state.paths)?,
        &request.query,
        &request.game_version,
    )
}

#[tauri::command]
fn list_installed_mods(
    state: State<'_, AppState>,
    request: ProfileIdRequest,
) -> Result<Vec<mods::InstalledMod>, String> {
    mods::list(&state.paths, &request.id)
}

#[tauri::command]
fn install_mod(
    state: State<'_, AppState>,
    request: mods::InstallRequest,
) -> Result<Vec<String>, String> {
    let _guard = state.lock_scope(&format!("profile:{}", request.profile_id))?;
    mods::install(
        &state.paths,
        &NetworkClient::from_settings(&state.paths)?,
        request,
    )
}

#[tauri::command]
fn remove_mod(state: State<'_, AppState>, request: RemoveModRequest) -> Result<bool, String> {
    let _guard = state.lock_scope(&format!("profile:{}", request.profile_id))?;
    mods::remove(&state.paths, &request.profile_id, &request.project_id)
}

#[tauri::command]
fn plan_mod_updates(
    state: State<'_, AppState>,
    request: ProfileIdRequest,
) -> Result<Vec<Value>, String> {
    mods::plan_updates(
        &state.paths,
        &NetworkClient::from_settings(&state.paths)?,
        &request.id,
    )
}

#[tauri::command]
fn prepare_profile(state: State<'_, AppState>, request: ProfileIdRequest) -> Result<Value, String> {
    let _guard = state.lock_scope(&format!("profile:{}", request.id))?;
    let profile = profiles::find(&state.paths, &request.id)?;
    let network = NetworkClient::from_settings(&state.paths)?;
    minecraft::install_fabric(&state.paths, &network, &profile.game_version, &profile.id)?;
    let metadata = minecraft::version_metadata(&state.paths, &network, &profile.game_version)?;
    let required = metadata
        .pointer("/javaVersion/majorVersion")
        .and_then(Value::as_u64)
        .unwrap_or_else(|| java::fallback_major(&profile.game_version) as u64)
        as u32;
    let runtime = java::ensure(&state.paths, required, &network)?;
    mods::install_bundled(&state.paths, &profile.id, &profile.game_version)?;
    mods::write_lock(&state.paths, &profile.id)?;
    Ok(serde_json::json!({
        "ready": true,
        "profileId": profile.id,
        "gameVersion": profile.game_version,
        "java": runtime
    }))
}

#[tauri::command]
fn launch_game(
    state: State<'_, AppState>,
    request: launch::LaunchRequest,
) -> Result<launch::LaunchResult, String> {
    let _guard = state.lock_scope(&format!("profile:{}", request.profile_id))?;
    launch::launch(&state.paths, request)
}

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    tauri::Builder::default()
        .plugin(tauri_plugin_dialog::init())
        .setup(|app| {
            let resources = app.path().resource_dir()?;
            let state =
                AppState::discover_with_resources(resources).map_err(std::io::Error::other)?;
            app.manage(state);
            Ok(())
        })
        .invoke_handler(tauri::generate_handler![
            app_info,
            legacy_status,
            identity_status,
            create_identity,
            sign_identity,
            list_servers,
            create_server,
            start_server,
            stop_server,
            server_command,
            server_console,
            create_server_backup,
            list_server_backups,
            delete_server,
            get_server_properties,
            inspect_provisioning_pack,
            export_provisioning_pack,
            import_provisioning_pack,
            check_updates,
            stage_update,
            apply_update,
            choose_provisioning_import,
            choose_provisioning_export,
            list_profiles,
            create_profile,
            rename_profile,
            delete_profile,
            get_settings,
            update_settings,
            list_worlds,
            duplicate_world,
            rename_world,
            copy_world,
            delete_world,
            create_profile_backup,
            list_profile_backups,
            restore_profile_backup,
            list_jobs,
            create_job,
            set_job_state,
            diagnostics_report,
            storage_cleanup,
            minecraft_readiness,
            list_fabric_loaders,
            search_mods,
            list_installed_mods,
            install_mod,
            remove_mod,
            plan_mod_updates,
            prepare_profile,
            launch_game
        ])
        .run(tauri::generate_context!())
        .expect("error while running Gleam");
}
