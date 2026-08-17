# Managed Windows package

Gleam's supported managed package is the WiX MSI emitted by Tauri from the same inspected runtime tree as the NSIS installer. Production GitHub Actions applies the configured Authenticode certificate.

The older experimental Electron/MSIX manifest remains outside the Tauri bundle and is not shipped. If Microsoft Store MSIX distribution is added later, generate it from the signed Tauri executable and update the package identity to Gleam before enabling that release path.
