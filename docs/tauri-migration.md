# Gleam Tauri migration

Gleam is replacing the Electron desktop shell incrementally. The migration boundary is deliberate: the new Rust process must reach behavioral and recovery parity before it owns profile mutations, game launches, identities, servers, or updates.

## Implemented

- Tauri 2/Rust workspace and Windows desktop configuration.
- Gleam cream/forest/moss/sage/glow brand system, vector logo, desktop icons, responsive shell, navigation, reduced motion, and accessible focus states.
- Bounded, read-only Rust commands for app information, existing-library health, and sanitized profile summaries.
- Existing data discovery at `icecream-client/.icecream_client` without moving or modifying it.
- Electron compatibility entrypoint through `npm run start:legacy`.

## Migration order

1. Profile and settings contracts, validation, atomic writes, and recovery.
2. Network transport, verified downloads, metadata, Java discovery, and offline readiness.
3. Profile locking and launch lifecycle with crash reporting.
4. Mods, backups, worlds, persistent jobs, and repair.
5. Identity broker and server hosting.
6. Signed update, NSIS/MSI packaging, and removal of the Electron runtime after parity QA.

Each mutating Rust service must pass recovery and compatibility tests against a copy of real legacy data before it becomes the default. Internal `swirl-*` protocol, Fabric mod, and data-format identifiers stay stable until separate migrations exist; public launcher surfaces use Gleam.
