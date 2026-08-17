# Managed deployment

Swirl 3.0 supports Windows x64 as a per-user NSIS install and as a signed full-trust MSIX. The
MSIX is intended for Intune, Company Portal, App Installer, or Microsoft Store servicing; Swirl
does not run its NSIS updater from an MSIX process.

Administrators can place `%ProgramData%\Swirl\policy.json` with any of these typed values:

```json
{
  "networkMode": "system",
  "offlineMode": "prefer-offline",
  "updatePolicy": "managed",
  "allowedEndpoints": ["launchermeta.mojang.com", "meta.fabricmc.net"],
  "serverHostingEnabled": false,
  "diagnosticsExportEnabled": true,
  "provisioningPublicKeys": ["-----BEGIN PUBLIC KEY-----\n...\n-----END PUBLIC KEY-----"]
}
```

Policy overrides user settings but does not rewrite them. System proxy mode uses Windows proxy and
certificate trust. Manual credentials are encrypted with Electron `safeStorage`; Direct mode does
not bypass Windows firewall, TLS, DNS, or organizational controls. Required executables are
`Swirl.exe`, managed `java.exe`/`javaw.exe`, and optionally a Fabric server Java process.

Production MSIX builds use Microsoft's `winapp` CLI and require certificate, publisher, update-key,
manifest, and provisioning metadata inputs from CI. No certificate or key is stored in this repo.
