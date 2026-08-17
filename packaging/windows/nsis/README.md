# Per-user NSIS

Gleam's normal Windows installer is the per-user NSIS package produced by Tauri. Production GitHub Actions signs the executable and installer. Built-in updates accept only a format-2 manifest signed by Gleam's Ed25519 update key, then verify the declared size and SHA-256 before starting the staged installer.
