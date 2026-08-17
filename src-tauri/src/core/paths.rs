use std::path::{Component, Path, PathBuf};

#[derive(Clone)]
pub struct AppPaths {
    pub data: PathBuf,
    pub resources: PathBuf,
    pub profiles: PathBuf,
    pub backups: PathBuf,
    pub trash: PathBuf,
    pub jobs: PathBuf,
}

impl AppPaths {
    pub fn discover_with_resources(resources: PathBuf) -> Result<Self, String> {
        let app_data = std::env::var_os("APPDATA").ok_or("Windows AppData is unavailable.")?;
        let data = PathBuf::from(app_data)
            .join("icecream-client")
            .join(".icecream_client");
        Ok(Self {
            resources,
            profiles: data.join("instances").join("profiles"),
            backups: data.join("backups"),
            trash: data.join("trash"),
            jobs: data.join("jobs"),
            data,
        })
    }

    pub fn bundled_mod(&self, version: &str) -> Result<PathBuf, String> {
        if version.is_empty()
            || version.len() > 64
            || !version
                .bytes()
                .all(|byte| byte.is_ascii_alphanumeric() || matches!(byte, b'.' | b'-' | b'_'))
        {
            return Err("Choose a valid Minecraft version.".to_string());
        }
        Ok(self
            .resources
            .join("bundled-mods")
            .join(format!("swirl-client-{version}.jar")))
    }

    pub fn profile(&self, id: &str) -> Result<PathBuf, String> {
        validate_profile_id(id)?;
        Ok(self.profiles.join(id))
    }

    pub fn profile_backups(&self, id: &str) -> Result<PathBuf, String> {
        validate_profile_id(id)?;
        Ok(self.backups.join(id))
    }
}

pub fn validate_profile_id(id: &str) -> Result<(), String> {
    if id.len() == 16
        && id
            .bytes()
            .all(|byte| byte.is_ascii_hexdigit() && !byte.is_ascii_uppercase())
    {
        Ok(())
    } else {
        Err("Choose a valid Gleam profile.".to_string())
    }
}

pub fn safe_leaf(value: &str, max: usize, label: &str) -> Result<String, String> {
    let trimmed = value.trim();
    let invalid = trimmed.is_empty()
        || trimmed == "."
        || trimmed == ".."
        || trimmed.chars().count() > max
        || trimmed.chars().any(|character| {
            matches!(
                character,
                '\0' | '\\' | '/' | ':' | '*' | '?' | '"' | '<' | '>' | '|'
            )
        })
        || Path::new(trimmed)
            .components()
            .any(|component| !matches!(component, Component::Normal(_)));
    if invalid {
        Err(format!(
            "Choose a valid {label} without file-system symbols."
        ))
    } else {
        Ok(trimmed.to_string())
    }
}
