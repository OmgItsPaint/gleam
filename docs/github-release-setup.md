# GitHub setup for Gleam

The repository contains two workflows:

- `Validate Gleam` runs Node contracts, Rust formatting/tests, a native Tauri compile, package QA, and both Java 25 Fabric builds on pushes and pull requests.
- `Build and publish Gleam for Windows` runs only for a version tag (or manually), imports a Windows signing certificate, builds signed NSIS/MSI packages, signs Gleam's update manifest, and creates a draft GitHub Release.

## One-time repository settings

1. In **Settings → Actions → General**, allow GitHub Actions and permit read/write workflow permissions.
2. Create an environment named **production**. Add a required reviewer so a compromised tag cannot immediately publish a signed build.
3. Protect `main`: require a pull request, require `Validate Gleam / launcher` and both `in-game-module` matrix checks, require branches to be current, and block force pushes/deletion.
4. Keep Actions dependency updates enabled. Review action major-version changes before merging them.
5. Never commit certificates, private update keys, provisioning keys, `.swirlpack` files, support exports, or production update configuration.

## Production secrets

Add these under **Settings → Environments → production → Environment secrets**:

| Secret                         | Value                                                                                                                     |
| ------------------------------ | ------------------------------------------------------------------------------------------------------------------------- |
| `WINDOWS_CERTIFICATE_BASE64`   | Base64 of the real Authenticode `.pfx` certificate.                                                                       |
| `WINDOWS_CERTIFICATE_PASSWORD` | Password for that PFX.                                                                                                    |
| `WINDOWS_PUBLISHER`            | Publisher name from the certificate.                                                                                      |
| `GLEAM_UPDATE_PRIVATE_KEY`     | PEM Ed25519 private key used only to sign `latest.json`.                                                                  |
| `GLEAM_UPDATE_PUBLIC_KEY`      | Matching PEM public key embedded in production builds.                                                                    |
| `GLEAM_PROVISIONING_METADATA`  | Versioned JSON describing trusted administrator provisioning keys/policy. Use `{}` until managed provisioning is enabled. |

Generate the update key pair on an offline administrator computer, not in GitHub Actions:

```powershell
openssl genpkey -algorithm Ed25519 -out gleam-update-private.pem
openssl pkey -in gleam-update-private.pem -pubout -out gleam-update-public.pem
```

Store the private PEM in a password manager or hardware-backed secret store. Paste the complete PEM text, including header and footer, into the GitHub secret. The public key is not secret, but keeping it in the protected environment prevents accidental mismatches.

The Windows certificate must be issued for code signing. A self-signed certificate is suitable only for private QA machines where its root is deliberately trusted; it must not be used for a public release.

## Publishing a release

1. Make the versions match in `package.json`, `src-tauri/Cargo.toml`, and `src-tauri/tauri.conf.json`.
2. Complete the manual Minecraft QA matrix for both supported versions.
3. Merge the release commit to `main` and wait for every required check.
4. Create and push the exact tag, for example `v3.0.0`.
5. Approve the `production` environment deployment.
6. Inspect the draft release: verify the Windows signatures, SHA-256 file, SBOM, inventory, signed `latest.json`, and both bundled Fabric JAR hashes.
7. Test the NSIS and MSI installers on a clean Windows account and an account with the existing `.icecream_client` library before publishing the draft.

Tauri's Windows packages use an offline WebView2 installer so setup does not depend on Microsoft endpoints being reachable at install time. Application/game downloads still obey Gleam's selected network mode and the organization's proxy/TLS policy.

## Existing identity upgrade

New Gleam identities use Windows DPAPI directly. An existing identity marked `os` or `os-async` was encrypted through Electron safeStorage and cannot safely be guessed or silently replaced. Before removing the last signed Electron build from deployment, ship a one-time compatibility migration that decrypts the readable key in Electron and immediately re-encrypts it as Gleam identity format 2. Keep its recovery backup until the same fingerprint successfully signs through Tauri.
