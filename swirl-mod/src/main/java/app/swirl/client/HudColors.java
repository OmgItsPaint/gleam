package app.swirl.client;

final class HudColors {
    private HudColors() {}

    static int color(HudConfig.Element element, int x, int y) {
        HudConfig.Appearance appearance = SwirlHud.config().resolvedAppearance(element);
        int alpha = Math.round(appearance.opacity * 255 / 100.0f);
        if (appearance.colorMode == 0) return alpha << 24 | (appearance.primaryColor & 0x00FFFFFF);
        if (appearance.colorMode == 1) {
            double radians = Math.toRadians(appearance.gradientAngle);
            float position = (float)((x * Math.cos(radians) + y * Math.sin(radians)) / 120.0);
            position -= (float)Math.floor(position);
            return alpha << 24 | (mix(appearance.primaryColor, appearance.secondaryColor, position) & 0x00FFFFFF);
        }
        double seconds = System.nanoTime() / 1_000_000_000.0;
        double spatial = switch (appearance.chromaDirection) { case 1 -> y; case 2 -> x + y; case 3 -> x - y; default -> x; };
        float hue = (float) ((seconds * (0.04 + appearance.chromaSpeed * 0.025) +
            spatial * appearance.chromaSpread / 12500.0 + appearance.animationPhase / 360.0) % 1.0);
        return alpha << 24 | (hsvToRgb(hue, appearance.chromaSaturation / 100.0f, appearance.chromaBrightness / 100.0f) & 0x00FFFFFF);
    }

    private static int mix(int a, int b, float amount) {
        int r = Math.round(((a >> 16) & 255) * (1 - amount) + ((b >> 16) & 255) * amount);
        int g = Math.round(((a >> 8) & 255) * (1 - amount) + ((b >> 8) & 255) * amount);
        int blue = Math.round((a & 255) * (1 - amount) + (b & 255) * amount);
        return 0xFF000000 | r << 16 | g << 8 | blue;
    }

    static int hsvToRgb(float hue, float saturation, float value) {
        hue = ((hue % 1.0f) + 1.0f) % 1.0f;
        saturation = clamp(saturation);
        value = clamp(value);
        float scaled = hue * 6.0f;
        int sector = (int) Math.floor(scaled);
        float fraction = scaled - sector;
        float p = value * (1.0f - saturation);
        float q = value * (1.0f - fraction * saturation);
        float t = value * (1.0f - (1.0f - fraction) * saturation);
        float r, g, b;
        switch (sector % 6) {
            case 0 -> { r = value; g = t; b = p; }
            case 1 -> { r = q; g = value; b = p; }
            case 2 -> { r = p; g = value; b = t; }
            case 3 -> { r = p; g = q; b = value; }
            case 4 -> { r = t; g = p; b = value; }
            default -> { r = value; g = p; b = q; }
        }
        return 0xFF000000 | Math.round(r * 255) << 16 | Math.round(g * 255) << 8 | Math.round(b * 255);
    }

    static float[] rgbToHsv(int color) {
        float r = ((color >> 16) & 255) / 255.0f;
        float g = ((color >> 8) & 255) / 255.0f;
        float b = (color & 255) / 255.0f;
        float max = Math.max(r, Math.max(g, b));
        float min = Math.min(r, Math.min(g, b));
        float delta = max - min;
        float hue = 0;
        if (delta != 0) {
            if (max == r) hue = ((g - b) / delta) % 6;
            else if (max == g) hue = (b - r) / delta + 2;
            else hue = (r - g) / delta + 4;
            hue /= 6;
            if (hue < 0) hue += 1;
        }
        return new float[] { hue, max == 0 ? 0 : delta / max, max };
    }
    private static float clamp(float value) { return Math.max(0, Math.min(1, value)); }
}
