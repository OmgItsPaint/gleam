# Swirl in-game client

This Java 25 Fabric module targets Minecraft 26.1.2 and 26.2. Right Shift opens the in-world HUD layout editor; its Settings action opens the full Swirl module menu. It uses Minecraft/Fabric GUI APIs instead of raw OpenGL, so it remains compatible with the optional Vulkan backend.

Swirl 1.4.2 contains 31 functional modules: 21 draggable HUD/control modules plus Fullbright, Zoom, Crosshair Editor, Block Outline, Low Fire, Low Shield, Damage Overlay, Local Time, Local Weather, and Fog Controls. Fresh and reset configurations start with every module disabled. Module visibility, layout, favorites, layered appearance overrides, appearance presets, Swirl-owned key bindings, typed visual options, and interface settings are stored per isolated game profile in the format-6 `config/swirl-hud.json`.

Stage 1 of the client roadmap is implemented. Performance modules, safe waypoints/navigation, and broader accessibility features remain later-stage roadmap work and are intentionally absent from the functional module catalog until implemented.

The layout editor has no toolbars: hover a visible module for its disable, options, and corner-resize handles, or drag its body to move it. Swirl bindings are assigned in the relevant Swirl settings pages and report conflicts with vanilla controls without appearing in vanilla Controls. CPS uses exact remapped attack/use press events rather than client-tick polling. Named HUD presets remain deferred.

The module catalog opens on a human-friendly Recommended view and includes clickable artwork banners, option-aware search, Enabled and Favorites views, responsive density-aware cards, smooth clipped scrolling, appearance presets, and session undo/redo. Alphabetical/custom sorting, NEW badges, HUD multi-select, right-click position reset, and automatic profiles remain backlog items.

## Staged roadmap after 1.3

- Stage 2, performance: protected particle/weather limits, only-reducing entity distance, animation limits, bounded dynamic render distance, frame-pacing graphs, diagnostics, and named presets.
- Stage 3, safe navigation: user waypoints, local death markers, bearings, coordinate conversion, plain-text sharing, and per-world/server isolation. It will not add radar, cave maps, structure discovery, or other hidden information.
- Stage 4, accessibility and polish: color-vision palettes, enhanced vanilla-sound subtitles, reduced motion/flashing, notification controls, high contrast, editor undo/alignment, HUD presets, sorting, screenshots, and local session statistics.

Install Java 25 and Gradle 9.5 or newer, then build 26.2 with `gradle clean bundleMod -PminecraftVersion=26.2` and 26.1.2 with `gradle clean bundleMod -PminecraftVersion=26.1.2`. `bundleMod` copies the release JAR to `../bundled-mods`. Both builds must be tested in clean Swirl profiles before an installer is shared.
