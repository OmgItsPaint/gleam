# Gleam

Gleam is a local-first, accountless Minecraft Java client built with Rust and Tauri 2. It is the successor to Swirl and keeps profiles, worlds, mods, servers, and player identities isolated on the player's computer.

## What is native now

The supported desktop runtime lives in `src-tauri`; the sandboxed webview lives in `gleam-ui`. Rust owns privileged filesystem, network, Java, Minecraft/Fabric, Modrinth, process, identity, provisioning, update, diagnostics, and server operations. The webview has no Node.js access.

The old Electron code remains under `src` only as migration reference and compatibility-test material. It is not shipped or used to launch Gleam.

Gleam deliberately preserves these compatibility identifiers:

- Application data remains at `%APPDATA%\icecream-client\.icecream_client`.
- Existing profile IDs, worlds, server records, lockfiles, and identity fingerprints are not renamed.
- `.swirlpack`, `swirl-client-*.jar`, and the `SWIRL-AUTH-1` protocol retain their historical names so existing installations and servers continue to work.

## Run locally

Install Node.js 22, Rust stable, Microsoft Visual Studio Build Tools with **Desktop development with C++**, and Java 25. Then run:

```powershell
npm ci
npm start
```

Create unsigned local Windows installers with:

```powershell
npm run dist:win
```

Tauri produces a per-user NSIS installer and an MSI for managed deployment. Production releases are signed in GitHub Actions.

## Minecraft and Fabric module

Minecraft 26.x requires Java 25. Every profile has its own game directory, mod inventory, settings, and worlds. Gleam downloads Minecraft, Fabric, libraries, assets, Java, and Modrinth artifacts through the bounded Rust network service and verifies published hashes where the upstream provides them.

The in-game client remains the Fabric project in `swirl-mod`; its internal mod ID stays `swirl_client` for migration safety while the visible name is **Gleam Client**. Build both supported targets with the checked-in Gradle wrapper:

```powershell
.\swirl-mod\gradlew.bat -p swirl-mod clean test bundleMod -PminecraftVersion=26.1.2
.\swirl-mod\gradlew.bat -p swirl-mod clean test bundleMod -PminecraftVersion=26.2
```

The verified JARs are copied to `bundled-mods` by `bundleMod` and installed into the matching profile at launch.

## Offline identity

Gleam identities are Ed25519 keys protected with Windows DPAPI. The private key stays in the launcher; Minecraft receives only a random loopback capability and asks the local broker to sign a fresh server nonce. This is an offline identity, not a Microsoft account, and it cannot join Realms or normal online-mode servers.

Legacy identities encrypted through Electron `safeStorage` are detected and never overwritten. They require the documented one-time migration before the old signed Electron build is retired.

## Quality gates

```powershell
npm test
npm run rust:test
npm run test:package
```

A release additionally requires both Fabric builds, native installer QA, clean/existing profile launches, and the manual matrix in `swirl-mod/QA-MATRIX.md`.

See [GitHub release setup](docs/github-release-setup.md), [release process](docs/release.md), [managed deployment](docs/managed-deployment.md), [offline provisioning](docs/offline-provisioning.md), [security](docs/security.md), and [troubleshooting](docs/troubleshooting.md).
