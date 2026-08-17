# Security model

The renderer loads packaged local UI under a strict CSP with sandboxing and context isolation.
Node integration, navigation, popups, webviews, and permissions are denied. Privileged actions pass
through explicit preload methods and validated domain IPC routes. Core services do not import
Electron, and architecture tests reject renderer Node access, route drift, dependency cycles, legacy
root runtime files, and unexpected package contents.

Identity format 2 uses asynchronous OS-backed `safeStorage` where available, validates readable
format-1 identities before atomic re-encryption, and retains recovery behavior. Structured logs
redact tokens, credentials, identity material, usernames, private paths, and sensitive query values.

Network hosts, response sizes, redirect behavior, timeouts, collections, enums, and paths are
bounded. Updates require HTTPS, a format-2 Ed25519 signature, exact artifact type/size/SHA-256, and
a source-build configuration that remains disabled unless CI injects the production trust data.
