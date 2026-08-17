package app.swirl.client;

import org.junit.jupiter.api.Test;
import static org.junit.jupiter.api.Assertions.*;

final class HudColorsTest {
    @Test void roundTripsRepresentativeHsvColors() {
        for (int color : new int[] { 0xFFFF0000, 0xFF00FF00, 0xFF0000FF, 0xFFD89BD2, 0xFFFFFFFF }) {
            float[] hsv = HudColors.rgbToHsv(color);
            int actual = HudColors.hsvToRgb(hsv[0], hsv[1], hsv[2]);
            assertEquals(color, actual);
        }
    }
}
