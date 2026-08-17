# Releasing Gleam 3.0

Gleam 3.0 is a Windows x64 Rust/Tauri application. It produces a per-user NSIS setup executable and an MSI for managed deployment. Both packages embed the same UI, native core, update configuration, and version-specific Fabric JARs.

## Local gate

Use Node.js 22, Rust stable, Microsoft C++ Build Tools, and Java 25. The repository supplies its pinned Gradle 9.5 wrapper:

```powershell
npm ci
cargo fmt --manifest-path src-tauri/Cargo.toml --check
cargo test --manifest-path src-tauri/Cargo.toml
npm test
npm run test:package
.\swirl-mod\gradlew.bat -p swirl-mod clean test bundleMod -PminecraftVersion=26.1.2
.\swirl-mod\gradlew.bat -p swirl-mod clean test bundleMod -PminecraftVersion=26.2
npm run dist:win
```

Local unsigned installers are for QA only. The production GitHub environment supplies Authenticode and Ed25519 signing material. See [GitHub release setup](github-release-setup.md).

## Release acceptance

- Install, upgrade, start, and uninstall NSIS and MSI packages on clean Windows 10/11 x64 accounts.
- Verify the publisher signature and published SHA-256 for every installer.
- Confirm an existing `icecream-client/.icecream_client` tree is reused without moving profiles, worlds, servers, locks, or identity fingerprints.
- Test System, Manual, and Direct proxy modes on the actual managed network.
- Block network access and launch a complete profile in Offline mode; confirm no request occurs.
- Exercise `.swirlpack` traversal, duplicate, size, hash, trailing-data, interruption, and rollback defenses.
- Test Java discovery/provisioning, repairs, Modrinth dependencies, world/profile backups, server start/stop/console/backups, and crash records.
- Test the Gleam shell at 900×620, 720p, 1080p, ultrawide, keyboard-only, Reduced Motion, and Windows scaling.
- Boot Minecraft 26.1.2 and 26.2 and complete `swirl-mod/QA-MATRIX.md`.

Public installers never contain Minecraft assets/libraries, profile data, worlds, servers, `.swirlpack` files, logs, credentials, private keys, or support exports. Production updates remain disabled unless `config/update-config.json` is injected with a valid HTTPS manifest URL and the Ed25519 public key.
