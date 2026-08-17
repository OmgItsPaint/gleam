package app.swirl.client;

import org.junit.jupiter.api.Test;
import org.junit.jupiter.api.io.TempDir;

import java.nio.file.Files;
import java.nio.file.Path;

import static org.junit.jupiter.api.Assertions.*;

final class HudConfigTest {
    @TempDir Path temporary;

    @Test
    void migratesFormatOneAndPreservesKnownValues() throws Exception {
        Path file = temporary.resolve("legacy.json");
        Files.writeString(file, """
            {"format":1,"zoom":false,"zoomFov":44,"elements":[
              {"id":"fps","x":91,"y":47,"enabled":false,"scale":1.7,"color":-1,"background":-1476395008,"showBackground":false},
              {"id":"unknown-old-module","x":1,"y":1,"enabled":true,"scale":1.0,"color":-1,"background":0,"showBackground":true}
            ]}
            """);

        HudConfig config = HudConfig.load(file);
        assertEquals(6, config.format);
        assertEquals(ModuleRegistry.MODULES.size(), config.elements.size());
        assertEquals(91, config.element("fps").x);
        assertEquals(47, config.element("fps").y);
        assertEquals(1.7f, config.element("fps").scale);
        assertFalse(config.element("fps").enabled);
        assertFalse(config.element("fps").showBackground);
        assertFalse(config.zoom);
        assertEquals(44, config.zoomFov);
        assertNull(config.element("unknown-old-module"));
        assertFalse(config.element("durability").enabled);
    }

    @Test
    void roundTripsFormatSixAppearanceBindingsVisualsAndFavorites() {
        Path file = temporary.resolve("current.json");
        HudConfig original = new HudConfig();
        original.favorites.add("biome");
        original.general.menuScale = 120;
        original.general.coordinatePrecision = 2;
        original.element("biome").enabled = true;
        original.element("keystrokes").options.showMouseCps = false;
        original.element("armor").options.horizontal = true;
        original.element("armor").chroma = true;
        original.element("armor").chromaSpeed = 9;
        original.bindings.toggleSprint = "key.keyboard.g";
        original.bindings.zoom = "key.keyboard.z";
        original.visuals.fullbrightMode = 2;
        original.visuals.crosshairColor = 0xFFBB55DD;
        original.visuals.crosshairChroma = true;
        original.element("fullbright").enabled = true;
        original.appearanceDefaults.primaryColor = 0xFF11EECC;
        original.element("biome").appearance.textScale = 135;
        original.interfaceTheme.iconSize = 88;
        original.place(original.element("biome"), 320, 180, 854, 480, 90, 17);
        original.save(file);

        HudConfig loaded = HudConfig.load(file);
        assertTrue(loaded.favorites.contains("biome"));
        assertEquals(120, loaded.general.menuScale);
        assertEquals(2, loaded.general.coordinatePrecision);
        assertTrue(loaded.element("biome").enabled);
        assertFalse(loaded.element("keystrokes").options.showMouseCps);
        assertTrue(loaded.element("armor").options.horizontal);
        assertTrue(loaded.element("armor").chroma);
        assertEquals(9, loaded.element("armor").chromaSpeed);
        assertEquals("key.keyboard.g", loaded.bindings.toggleSprint);
        assertEquals("key.keyboard.z", loaded.bindings.zoom);
        assertEquals(2, loaded.visuals.fullbrightMode);
        assertEquals(0xFFBB55DD, loaded.visuals.crosshairColor);
        assertTrue(loaded.visuals.crosshairChroma);
        assertTrue(loaded.element("fullbright").enabled);
        assertEquals(0xFF11EECC, loaded.appearanceDefaults.primaryColor);
        assertEquals(135, loaded.resolvedAppearance("biome").textScale);
        assertEquals(88, loaded.interfaceTheme.iconSize);
        assertEquals(320, loaded.screenX(loaded.element("biome"), 854, 90));
        assertEquals(180, loaded.screenY(loaded.element("biome"), 480, 17));
    }

    @Test
    void resolvesOverridesAndAppearancePresetsWithoutBehaviorOrPosition() {
        HudConfig config = new HudConfig();
        config.appearanceDefaults.primaryColor = 0xFF123456;
        config.element("fps").appearance.primaryColor = 0xFFABCDEF;
        config.element("fps").enabled = true;
        config.element("fps").x = 222;
        config.element("fps").options.showSuffix = false;
        assertEquals(0xFFABCDEF, config.resolvedAppearance("fps").primaryColor);
        assertEquals(0xFF123456, config.resolvedAppearance("clock").primaryColor);

        HudConfig.AppearancePreset preset = config.captureAppearancePreset("Plum test");
        config.element("fps").appearance.primaryColor = 0xFFFFFFFF;
        config.element("fps").enabled = false;
        config.element("fps").x = 10;
        config.element("fps").options.showSuffix = true;
        config.applyAppearancePreset(preset, HudConfig.PresetScope.SELECTED, java.util.Set.of("fps"));
        assertEquals(0xFFABCDEF, config.element("fps").appearance.primaryColor);
        assertFalse(config.element("fps").enabled);
        assertEquals(10, config.element("fps").x);
        assertTrue(config.element("fps").options.showSuffix);
    }

    @Test
    void layoutPresetsChangeOnlyDraggableLayoutStateAndRoundTrip() {
        Path file = temporary.resolve("layouts.json");
        HudConfig config = new HudConfig();
        HudConfig.Element fps = config.element("fps");
        fps.enabled = true;
        fps.scale = 1.45f;
        fps.xRatio = 0.72f;
        fps.yRatio = 0.31f;
        fps.options.showSuffix = false;
        fps.appearance.primaryColor = 0xFF123456;
        HudConfig.LayoutPreset preset = config.captureLayoutPreset("Streaming");
        config.layoutPresets.add(preset);

        fps.enabled = false;
        fps.scale = 0.7f;
        fps.xRatio = 0.1f;
        fps.yRatio = 0.9f;
        fps.options.showSuffix = true;
        fps.appearance.primaryColor = 0xFFABCDEF;
        config.applyLayoutPreset(preset);

        assertTrue(fps.enabled);
        assertEquals(1.45f, fps.scale);
        assertEquals(0.72f, fps.xRatio);
        assertEquals(0.31f, fps.yRatio);
        assertTrue(fps.options.showSuffix);
        assertEquals(0xFFABCDEF, fps.appearance.primaryColor);
        config.save(file);
        HudConfig loaded = HudConfig.load(file);
        assertEquals(1, loaded.layoutPresets.size());
        assertEquals("Streaming", loaded.layoutPresets.getFirst().name);
        assertTrue(loaded.layoutPresets.getFirst().modules.containsKey("fps"));
        assertFalse(loaded.layoutPresets.getFirst().modules.containsKey("fullbright"));
    }

    @Test
    void recoversFromLastKnownGoodBackupAndPreservesUnknownRootData() throws Exception {
        Path file = temporary.resolve("recover.json");
        Files.writeString(file, "{\"format\":6,\"futureFeature\":{\"token\":17}}");
        HudConfig first = HudConfig.load(file);
        first.save(file);
        first.general.menuScale = 120;
        first.save(file);
        Files.writeString(file, "{broken");
        HudConfig recovered = HudConfig.load(file);
        assertEquals(100, recovered.general.menuScale);
        recovered.save(file);
        assertTrue(Files.readString(file).contains("futureFeature"));
    }

    @Test
    void normalizedPlacementTracksResolutionAndClampsBounds() {
        HudConfig config = new HudConfig();
        HudConfig.Element fps = config.element("fps");
        config.place(fps, 400, 200, 854, 480, 100, 17);
        assertEquals(400, config.screenX(fps, 854, 100));
        assertEquals(200, config.screenY(fps, 480, 17));
        assertTrue(config.screenX(fps, 1708, 100) > 800);

        config.place(fps, -500, 9999, 854, 480, 100, 17);
        assertEquals(0, config.screenX(fps, 854, 100));
        assertEquals(463, config.screenY(fps, 480, 17));
    }

    @Test
    void positionResetPreservesModuleChoicesAndRestoresResponsivePlacement() {
        HudConfig config = new HudConfig();
        HudConfig.Element fps = config.element("fps");
        fps.enabled = true;
        fps.scale = 1.65f;
        fps.options.showSuffix = false;
        config.place(fps, 600, 300, 854, 480, 100, 17);

        config.resetPlacement("fps");

        assertTrue(fps.enabled);
        assertEquals(1.65f, fps.scale);
        assertFalse(fps.options.showSuffix);
        assertTrue(fps.xRatio >= 0.0f && fps.xRatio <= 1.0f);
        assertTrue(fps.yRatio >= 0.0f && fps.yRatio <= 1.0f);
        assertEquals(0.03f, fps.xRatio);
        assertEquals(0.04f, fps.yRatio);
    }

    @Test
    void rejectsMalformedDataAndSanitizesUnsafeValues() throws Exception {
        Path malformed = temporary.resolve("broken.json");
        Files.writeString(malformed, "{not json");
        assertEquals(ModuleRegistry.MODULES.size(), HudConfig.load(malformed).elements.size());

        Path unsafe = temporary.resolve("unsafe.json");
        Files.writeString(unsafe, """
            {"format":2,"general":{"menuScale":999,"dimStrength":-2,"snapSize":3,"backgroundOpacity":101,"coordinatePrecision":8},
             "favorites":["fps","missing"],"elements":[{"id":"fps","enabled":true,"scale":99,"xRatio":4,"yRatio":-3}]}
            """);
        HudConfig loaded = HudConfig.load(unsafe);
        assertEquals(120, loaded.general.menuScale);
        assertEquals(20, loaded.general.dimStrength);
        assertEquals(2, loaded.general.snapSize);
        assertEquals(90, loaded.general.backgroundOpacity);
        assertEquals(2, loaded.general.coordinatePrecision);
        assertEquals(2.5f, loaded.element("fps").scale);
        assertEquals(-1.0f, loaded.element("fps").xRatio);
        assertEquals(1, loaded.favorites.size());
    }

    @Test
    void freshAndResetLayoutsEnableNothing() {
        HudConfig config = new HudConfig();
        assertTrue(config.elements.stream().noneMatch(element -> element.enabled));
        assertEquals(31, config.elements.size());
        assertNull(config.element("profile"));
        assertNull(config.element("frametime"));
        assertNotNull(config.element("toggle_sprint"));
        assertNotNull(config.element("toggle_sneak"));
        assertNotNull(config.element("fullbright"));
        assertNotNull(config.element("fog"));
    }

    @Test
    void splitsLegacyCombinedSprintAndSneakWithoutLosingState() throws Exception {
        Path file = temporary.resolve("combined-toggle.json");
        Files.writeString(file, """
            {"format":4,"favorites":["toggle_sprint"],"elements":[
              {"id":"toggle_sprint","enabled":true,"scale":1.4,"color":-2581550,"showBackground":false,
               "options":{"sprintEnabled":true,"sneakEnabled":true,"sprintText":"Run","sneakText":"Crouch"}}
            ]}
            """);
        HudConfig loaded = HudConfig.load(file);
        assertTrue(loaded.element("toggle_sprint").enabled);
        assertTrue(loaded.element("toggle_sneak").enabled);
        assertEquals(1.4f, loaded.element("toggle_sneak").scale);
        assertEquals("Crouch", loaded.element("toggle_sneak").options.sneakText);
        assertTrue(loaded.favorites.contains("toggle_sprint"));
        assertTrue(loaded.favorites.contains("toggle_sneak"));
    }
}
