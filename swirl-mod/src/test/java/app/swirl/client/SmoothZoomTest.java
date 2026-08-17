package app.swirl.client;

import org.junit.jupiter.api.Test;
import static org.junit.jupiter.api.Assertions.*;

final class SmoothZoomTest {
    @Test void easingMovesContinuouslyAndConverges() {
        double value = 70;
        for (int i = 0; i < 200; i++) value = VisualModuleService.approachZoom(value, 20, 1.0 / 60.0, 180, 1, false);
        assertEquals(20, value, 0.05);
    }

    @Test void reducedMotionAndZeroDurationAreImmediate() {
        assertEquals(20, VisualModuleService.approachZoom(70, 20, 0.016, 180, 1, true));
        assertEquals(20, VisualModuleService.approachZoom(70, 20, 0.016, 0, 1, false));
    }

    @Test void allEasingModesStayBetweenEndpoints() {
        for (int easing = 0; easing < 4; easing++) {
            double value = VisualModuleService.approachZoom(70, 20, 0.05, 200, easing, false);
            assertTrue(value < 70 && value > 20, "easing " + easing);
        }
    }
}
