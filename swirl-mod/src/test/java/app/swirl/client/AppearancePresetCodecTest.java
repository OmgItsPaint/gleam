package app.swirl.client;

import org.junit.jupiter.api.Test;

import static org.junit.jupiter.api.Assertions.*;

final class AppearancePresetCodecTest {
    @Test
    void roundTripsValidatedVersionedAppearanceOnlyJson() {
        HudConfig config = new HudConfig();
        config.interfaceTheme.accentColor = 0xFF44CCEE;
        config.element("fps").appearance.primaryColor = 0xFF112233;
        String encoded = AppearancePresetCodec.encode(config.captureAppearancePreset("Ocean"));
        HudConfig.AppearancePreset decoded = AppearancePresetCodec.decode(encoded);
        assertEquals("Ocean", decoded.name);
        assertEquals(0xFF44CCEE, decoded.interfaceTheme.accentColor);
        assertEquals(0xFF112233, decoded.modules.get("fps").primaryColor);
    }

    @Test
    void rejectsMalformedUnsupportedAndOversizedClipboardValues() {
        assertThrows(IllegalArgumentException.class, () -> AppearancePresetCodec.decode("{}"));
        assertThrows(RuntimeException.class, () -> AppearancePresetCodec.decode("not json"));
        assertThrows(IllegalArgumentException.class, () -> AppearancePresetCodec.decode("x".repeat(65_537)));
    }

    @Test
    void historyIsBoundedAndSupportsUndoAndRedo() {
        HudConfig config = new HudConfig();
        CustomizationHistory history = new CustomizationHistory(config);
        for (int i = 0; i < 120; i++) { history.remember(); config.general.menuScale = 70 + i % 71; }
        assertEquals(100, history.undoSize());
        int current = config.general.menuScale;
        assertTrue(history.undo());
        assertNotEquals(current, config.general.menuScale);
        assertTrue(history.redo());
        assertEquals(current, config.general.menuScale);
    }
}
