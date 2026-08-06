# Swirl

Swirl is a profile-isolated Fabric launcher for Minecraft Java Edition. It supports stable legacy releases from 1.14 onward plus the tested calendar releases 26.1.2 and 26.2. Test versions can be shown from Settings and always require their own profile.

## Swirl 1.7

The 1.1–1.7 foundation is delivered as one coordinated release: first-run setup, managed Java, isolated profile presets, selective profile transfers, signed lockfile sharing, client and server Modrinth management, LAN invites and diagnostics, transactional mod updates, server gameplay settings, backup browsing and restoration, retention limits, accessibility controls, signed launcher updates, rollback, and saveable support reports. Client and server Update All operations show the exact version plan first and restore their pre-update backup if any later step fails.

## Swirl 1.9

The 1.8 world manager lists the worlds inside each profile and can safely duplicate, rename, copy to another existing profile, import, export, or delete them. Swirl backs up the affected profile before every change, preserves the original during cross-profile copies, warns before copying between Minecraft versions, resolves duplicate names, and moves deleted worlds to Swirl Trash.

The 1.9 friends and hosting update adds Friends, Performance, Creative, and Custom server templates; portable `.swirlinvite` files; and clearer host controls. Approved players can be promoted or demoted, removed, kicked, or banned from a running server. Existing signed invite verification, exact client-compatible mod synchronization, connection diagnostics, independent server folders, transactional updates, and backup restoration remain enforced. The 2.0 in-game milestone is intentionally not part of this release.

## Run

1. Install Node.js 20 or newer.
2. Run `npm install` in this folder.
3. Run `npm start`.
4. Pick a player name, Minecraft version, and profile.
5. Press **Play**. On Windows, Swirl downloads a verified matching Java runtime when one is not installed.

Minecraft 26.x requires Java 25. Swirl reads the required Java major from Mojang's version metadata, keeps every profile in its own game directory, and creates a backup before a calendar-version profile or server upgrades an existing world.

## Mods

The profile editor searches Modrinth for exact Fabric builds matching that profile's Minecraft version. Required dependencies are installed automatically. Recommendations are checked dynamically, so unavailable old recommendations are skipped instead of receiving an incompatible JAR.

The in-game Swirl module is under `swirl-mod`. Build a release with Gradle's `bundleMod` task for either `-PminecraftVersion=26.1.2` or `-PminecraftVersion=26.2`. Matching release JARs are placed in `bundled-mods` and copied into a profile at launch.

Each client and server profile has a generated lockfile containing exact Modrinth version IDs, filenames, and SHA-512 hashes. Swirl verifies it before play or hosting and stops when a file was changed outside the launcher. A host can copy a signed server invite; **Join with invite** verifies it, creates a new isolated client profile, pins the server's Minecraft and Fabric versions, installs every client-compatible server mod at the exact version and hash, and selects that profile. Extra client-only mods are allowed only when the normal compatibility check passes.

## Backups, hosting, and accessibility

Profile and server editors provide one-click backups, a dated backup browser, selected restore, and configurable retention. Multiple servers can be saved and run on unique automatic ports; every running server keeps its own console buffer. Server **Test connection** performs a Minecraft status handshake, checks the selected version, port availability, LAN addresses, and Windows network profile. Wi-Fi client isolation must still be tested from a second computer because a host laptop cannot reliably detect it by itself.

Settings include UI scaling, reduced motion, and a readable system-font option. Launcher updates accept only an HTTPS manifest signed with the configured Ed25519 release key and a SHA-256-matching installer. Rollback is automatically armed after the first known-good signed update is cached.

## Friends-only limitation

Swirl is intentionally offline-only. Local player names work in single-player and Swirl servers configured with `online-mode=false`; there is no account or token storage. Swirl cannot join Realms or normal online-mode servers. Signed invites prevent accidental invite corruption and pin files, but they do not verify a player's identity. Approved-name lists can be bypassed by copying a name, so only use offline hosting with people you trust.

## Tests

Run `npm test` for compatibility invariants and the Electron UI smoke test. A release still requires real clean-profile launch testing for each supported Minecraft/Fabric combination and GPU testing for both OpenGL and Vulkan on 26.2.
