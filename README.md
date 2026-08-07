# Swirl

Swirl is a profile-isolated Fabric launcher for Minecraft Java Edition. It supports stable legacy releases from 1.14 onward plus the tested calendar releases 26.1.2 and 26.2. Test versions can be shown from Settings and always require their own profile.

## Swirl 1.7

The 1.1–1.7 foundation is delivered as one coordinated release: first-run setup, managed Java, isolated profile presets, selective profile transfers, signed lockfile sharing, client and server Modrinth management, LAN invites and diagnostics, transactional mod updates, server gameplay settings, backup browsing and restoration, retention limits, accessibility controls, signed launcher updates, rollback, and saveable support reports. Client and server Update All operations show the exact version plan first and restore their pre-update backup if any later step fails.

## Swirl 1.9

The 1.8 world manager lists the worlds inside each profile and can safely duplicate, rename, copy to another existing profile, import, export, or delete them. Swirl backs up the affected profile before every change, preserves the original during cross-profile copies, warns before copying between Minecraft versions, resolves duplicate names, and moves deleted worlds to Swirl Trash.

The 1.9 friends and hosting update adds Friends, Performance, Creative, and Custom server templates; portable `.swirlinvite` files; and clearer host controls. Approved players can be promoted or demoted, removed, kicked, or banned from a running server. Existing signed invite verification, exact client-compatible mod synchronization, connection diagnostics, independent server folders, transactional updates, and backup restoration remain enforced.

## Swirl 2.0

Swirl 2.0 unifies the entire launcher under one black, white, and plum interface. Play, profiles, profile editing, worlds, hosting, dialogs, and settings now share the same spacing, borders, controls, typography, active navigation, and responsive behavior. Page navigation resets to the beginning of the destination, the title bar remains available while scrolling, and dense screens use readable system text alongside the pixel display font. This release deliberately keeps the proven launcher and hosting engines unchanged; the next in-game feature milestone begins with 2.1.

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

## Offline player identities

Swirl is intentionally offline-only. It cannot join Realms or normal online-mode servers, and a Swirl identity is not a Microsoft account or proof of a person's real identity.

For 26.1.2 and 26.2, every launcher creates an Ed25519 player key. The private key is protected with the operating system's credential encryption and never enters Minecraft; the in-game module asks a loopback-only launcher broker to sign a fresh server nonce. A signed invite carries a one-time enrollment token that expires after 24 hours. The first join creates a pending request, the host compares the short fingerprint with their friend, and **Players** approves or denies that exact key. Copying an approved player name without its private key fails authentication.

Use **Name → Identity & recovery** to save an AES-256-GCM encrypted recovery file protected by a password. Restoring it moves the same player identity to another computer. Losing both the computer key and recovery file creates a new identity that hosts must approve again. Older Minecraft versions continue to use trusted-friends name lists because the bundled verification module currently targets only the tested 26.x releases.

## Tests

Run `npm test` for compatibility invariants and the Electron UI smoke test. A release still requires real clean-profile launch testing for each supported Minecraft/Fabric combination and GPU testing for both OpenGL and Vulkan on 26.2.
