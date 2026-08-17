pub mod diagnostics;
pub mod identity;
pub mod java;
pub mod jobs;
pub mod launch;
pub mod minecraft;
pub mod mods;
pub mod network;
pub mod paths;
pub mod profiles;
pub mod provisioning;
pub mod servers;
pub mod settings;
pub mod storage;
pub mod updates;
pub mod worlds;

use paths::AppPaths;
use std::collections::HashSet;
use std::path::PathBuf;
use std::sync::{Arc, Mutex};

pub struct AppState {
    pub paths: AppPaths,
    pub mutations: Mutex<HashSet<String>>,
    pub servers: Arc<servers::ServerRuntime>,
}

impl AppState {
    pub fn discover_with_resources(resources: PathBuf) -> Result<Self, String> {
        Ok(Self {
            paths: AppPaths::discover_with_resources(resources)?,
            mutations: Mutex::new(HashSet::new()),
            servers: Arc::new(servers::ServerRuntime::default()),
        })
    }

    pub fn lock_scope(&self, scope: &str) -> Result<MutationGuard<'_>, String> {
        let mut active = self
            .mutations
            .lock()
            .map_err(|_| "The mutation lock is unavailable.".to_string())?;
        if !active.insert(scope.to_string()) {
            return Err("That profile is already being changed by another operation.".to_string());
        }
        Ok(MutationGuard {
            state: self,
            scope: scope.to_string(),
        })
    }
}

pub struct MutationGuard<'a> {
    state: &'a AppState,
    scope: String,
}

impl Drop for MutationGuard<'_> {
    fn drop(&mut self) {
        if let Ok(mut active) = self.state.mutations.lock() {
            active.remove(&self.scope);
        }
    }
}
