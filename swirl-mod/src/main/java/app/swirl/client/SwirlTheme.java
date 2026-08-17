package app.swirl.client;

final class SwirlTheme {
    static final int BACKDROP = 0xD6070708;
    static int SURFACE = 0xF20D0D0F;
    static final int RAISED = 0xFF141216;
    static final int SOFT = 0xFF19151B;
    static final int BORDER = 0xFF38323A;
    static final int BORDER_STRONG = 0xFF5B455B;
    static int PLUM = 0xFF95558D;
    static int PLUM_BRIGHT = 0xFFBD78B3;
    static int PLUM_DARK = 0xFF3D2039;
    static final int TEXT = 0xFFF7F5F7;
    static final int MUTED = 0xFFAAA5AD;
    static final int GOOD = 0xFF65B987;
    static final int DANGER = 0xFFD36B7C;

    private SwirlTheme() {}

    static void sync() {
        HudConfig config;
        try { config = SwirlHud.config(); } catch (RuntimeException ignored) { return; }
        if (config == null || config.interfaceTheme == null) return;
        HudConfig.InterfaceTheme theme = config.interfaceTheme;
        int accent = theme.accentColor;
        if (theme.accentMode == 1) accent = blend(theme.accentColor, theme.secondaryAccent, 0.5f);
        if (theme.accentMode == 2) {
            float hue = (float)((System.nanoTime() / 1_000_000_000.0 * (0.04 + theme.accentSpeed * 0.025)) % 1.0);
            accent = HudColors.hsvToRgb(hue, 0.72f, 1.0f);
        }
        PLUM_BRIGHT = 0xFF000000 | (accent & 0xFFFFFF);
        PLUM = blend(PLUM_BRIGHT, 0xFF161217, 0.30f);
        PLUM_DARK = blend(PLUM_BRIGHT, 0xFF080708, 0.70f);
        SURFACE = (Math.round(theme.panelOpacity * 255 / 100.0f) << 24) | 0x000D0D0F;
    }

    private static int blend(int first, int second, float amount) {
        int r = Math.round(((first >> 16) & 255) * (1 - amount) + ((second >> 16) & 255) * amount);
        int g = Math.round(((first >> 8) & 255) * (1 - amount) + ((second >> 8) & 255) * amount);
        int b = Math.round((first & 255) * (1 - amount) + (second & 255) * amount);
        return 0xFF000000 | r << 16 | g << 8 | b;
    }
}
