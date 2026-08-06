# Swirl in-game client

This Java 25 Fabric module targets Minecraft 26.1.2 and 26.2. It opens a small in-game menu with Right Shift and uses Minecraft/Fabric GUI APIs instead of raw OpenGL, so it remains compatible with the optional Vulkan backend.

Install Java 25 and Gradle 9.2 or newer, then build 26.2 with `gradle clean bundleMod -PminecraftVersion=26.2` and 26.1.2 with `gradle clean bundleMod -PminecraftVersion=26.1.2`. `bundleMod` copies the release JAR to `../bundled-mods`. Both builds must be tested in clean Swirl profiles before an installer is shared.
