# Troubleshooting

Use **Settings → Test connection** to probe Minecraft metadata/assets/libraries, Fabric, Modrinth,
and Java endpoints through the selected proxy. Results distinguish HTTP status, timeout, and general
transport failures without exposing credentials. **Save support report** exports redacted JSON;
`Swirl-support-*.json` is ignored and excluded from packages.

Use a profile's **Check offline readiness** before disconnecting. **Repair files** replaces only
missing or hash-invalid managed artifacts. The Jobs area shows queued, running, paused, failed, and
retryable work. Close Minecraft fully before expecting a newly bundled Swirl mod JAR to be copied.

Data remains under Electron app data at `icecream-client/.icecream_client`. Do not rename or move it.
Cleanup is limited to displayed derived caches or data the user explicitly selects after seeing its
size and consequence.
