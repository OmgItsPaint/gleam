# Releasing Swirl

## Supported release channels

- Stable calendar releases: Minecraft 26.1.2 and 26.2 only.
- Legacy stable releases: Minecraft 1.14 and newer when both Mojang and Fabric publish metadata for the exact version.
- Test releases: hidden by default and limited to the 26.x snapshot, pre-release, and release-candidate formats. Users must enable **Show test versions** in Settings.
- Never add a new stable calendar release by changing only the UI. Add it to `version-policy.js`, update the compatibility tests, and complete the manual launch matrix below.

## Automated release gate

Run from this directory:

```powershell
npm.cmd install
npm.cmd test
```

The test command checks version admission, metadata-driven Java selection, argument rules, profile isolation, lockfile tamper rejection, concurrent server creation and automatic port allocation, approved-name persistence, signed server invites and tamper rejection, invite-profile isolation, backup retention and restoration, server defaults and diagnostics, signed-manifest verification, IPC wiring, every static button, and basic UI navigation.

## Manual 26.x release matrix

Complete every row on a clean Windows user account before sharing a build:

| Version | Vanilla client | Fabric client | New world | Existing-world backup | Dedicated server | Friend joins over LAN |
| --- | --- | --- | --- | --- | --- | --- |
| 26.1.2 | [ ] | [ ] | [ ] | [ ] | [ ] | [ ] |
| 26.2 OpenGL | [ ] | [ ] | [ ] | [ ] | [ ] | [ ] |
| 26.2 Vulkan | [ ] | [ ] | [ ] | [ ] | [ ] | [ ] |

Also verify:

- Java 25 downloads on a computer without Java and is reused on the second launch.
- Cancelled or interrupted downloads resume safely and checksum failures redownload.
- A profile's worlds, options, configs, resource packs, and mods never appear in another profile.
- Modrinth shows only exact-version Fabric files; incompatible JARs block launch with a readable explanation.
- Restoring a backup is tested on a copy, never on the only copy of a world.
- The server console reaches **Ready**, the copied LAN address works, whitelist names match exactly, and Stop exits cleanly.
- Two or more servers can run on different ports, their console output stays separated, and closing Swirl stops each process cleanly.
- A signed server invite works on a second clean computer, installs the exact compatible mod hashes, selects the imported profile, and direct-joins the correct address.
- The bundled Swirl in-game mod opens with Right Shift for both supported versions.
- Every backup browser restores the selected timestamp and respects its retention setting.
- Server Modrinth installs, dependency installs, updates, removals, and lockfile failures are exercised on a disposable server.
- UI scaling, reduced motion, and readable-font modes remain usable at 90%, 100%, 120%, and 140%.

## Build the bundled in-game mod

The launcher does not compile Java code at runtime. Build and test both JARs before packaging:

```powershell
cd swirl-mod
gradle clean bundleMod -PminecraftVersion=26.1.2
gradle clean bundleMod -PminecraftVersion=26.2
cd ..
```

Both resulting files must exist in `bundled-mods` before the installer is built.

## Signed Windows installer

1. Create a GitHub repository and push this folder to it.
2. Add the Actions secrets `WINDOWS_CERTIFICATE_BASE64` and `WINDOWS_CERTIFICATE_PASSWORD` for your code-signing `.pfx`.
3. Generate a separate Ed25519 update keypair. Add the PEM values as `SWIRL_UPDATE_PRIVATE_KEY` and `SWIRL_UPDATE_PUBLIC_KEY`; keep the private key restricted to the release workflow.
4. Increase `version` in `package.json`, commit it, and push a matching tag such as `v1.0.1`.
5. Let the release workflow build, sign, and publish the x64 NSIS installer plus `latest.json`.

For a local unsigned test installer, run `npm.cmd run dist:win`. Do not distribute an unsigned installer as a public release.

## Deliberate limits and external checks

- Microsoft/Xbox/Minecraft authentication is intentionally absent from this offline build. Local names are suitable only for private offline-mode servers.
- The checked-in update channel remains disabled until the release workflow embeds your public key and GitHub release URL. The first installed build has no older cached installer, so automatic rollback becomes available after its first successful signed update.
- Windows Firewall, router isolation, and school/work device policy can block LAN hosting; Swirl must explain these failures but must not weaken those controls automatically.
