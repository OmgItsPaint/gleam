# Swirl 1.4.2 mod QA matrix

Automated means the module is registered, defaults disabled, survives format-6 persistence, has unique validated artwork, and compiles/tests on both target mappings. Runtime smoke items require launching the listed Minecraft target and are intentionally not represented as automated passes.

| Module | Automated | Runtime checks |
|---|---:|---|
| FPS | Pass | Live refresh, suffix, brackets, static width |
| Clicks per second | Pass | Remapped attack/use, rolling window, menus ignored |
| Keystrokes | Pass | WASD/mouse/space states, CPS, fade |
| Coordinates | Pass | Precision, compact, dimension conversion |
| Direction | Pass | Compact/ribbon, degrees, intercardinals |
| Armor status | Pass | Empty/partial/full armor collapse and durability |
| Potion effects | Pass | Empty state, names, amplifiers, timers, sorting |
| Ping | Pass | Disconnected and multiplayer thresholds |
| Server | Pass | Singleplayer, address/name, privacy masking |
| Clock | Pass | 12/24 hour, seconds, date, UTC |
| Stopwatch | Pass | Start/pause/reset bindings and persistence |
| Memory | Pass | Percent/used/max and refresh |
| Durability | Pass | Empty hands, both hands, nondamageable items |
| Movement speed | Pass | Horizontal/3D, units, smoothing |
| Biome | Pass | Friendly/resource identifiers and refresh |
| Player count | Pass | Singleplayer hiding and online/max |
| World day & time | Pass | Day numbering and clock formats |
| Target block | Pass | Air collapse, coordinates and distance |
| Light level | Pass | Combined/block/sky values |
| Toggle Sprint | Pass | Binding, screens/world changes, disable cleanup |
| Toggle Sneak | Pass | Binding, inventory modifier safety, disable cleanup |
| Fullbright | Pass | Dimensions, Darkness/Blindness, shader conflict |
| Zoom | Pass | Fractional wheel, hold/toggle, limits, restoration |
| Crosshair | Pass | Modes, center dot, movement/attack expansion, third person |
| Block Outline | Pass | Target-only color/width/pulse and occlusion |
| Low Fire | Pass | Offset, scale, opacity safety minimum |
| Low Shield | Pass | Offset/scale; unverified opacity control hidden |
| Damage Overlay | Pass | Color/intensity/style; unverified tilt control hidden |
| Local Time | Pass | Server/fixed/real/cycle and dimensions |
| Local Weather | Pass | Server/clear/rain/snow; unverified fine controls hidden |
| Fog Controls | Pass | Hazard preservation, distances, presets, biome blend |

## UI matrix

- Viewports: 854×480, 1280×720, 1920×1080, 3440×1440.
- Inputs: wheel, fractional touchpad deltas, scrollbar drag, Home/End/Page keys, keyboard focus, mouse.
- Screens: Recommended catalog, every filter, search, Interface, HUD Defaults, Presets, Essentials, Advanced, color/text/numeric/binding editors, HUD editor.
- Required observations: no content outside scissor regions, no off-screen hitboxes, sticky headers remain visible, scroll targets clamp, Reduced Motion is immediate, and returning from child editors preserves position.
