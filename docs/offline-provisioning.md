# Offline provisioning

Offline mode makes no remote requests. Prefer Offline reuses verified local files before attempting
the network. The profile editor's readiness check reports Java, metadata, client, libraries, assets,
mods, and hashes that are missing or invalid.

`.swirlpack` format 1 is a bounded stream containing a versioned JSON inventory followed by regular
files. Every path is relative, every file has a size and SHA-256, duplicate/traversal/symlink/private
paths are rejected, and import occurs in a staging directory before an atomic commit with rollback.
Worlds, servers, identities, credentials, logs, and secrets are excluded. Swirl never distributes
Minecraft content in its public installer; a user creates a pack from files they are entitled to use.

Personal packs may be unsigned after an explicit warning. Managed policy can require an Ed25519
signature from one of its trusted provisioning public keys.
