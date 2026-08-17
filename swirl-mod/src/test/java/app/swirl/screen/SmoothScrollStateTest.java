package app.swirl.screen;

import org.junit.jupiter.api.Test;
import static org.junit.jupiter.api.Assertions.*;

final class SmoothScrollStateTest {
    @Test void accumulatesFractionalInputAndConvergesWithoutOverscroll() {
        SmoothScrollState state = new SmoothScrollState(); state.maximum(500);
        state.wheel(-0.25, 48); state.wheel(-0.5, 48);
        assertEquals(36.0, state.target(), 0.001);
        for (int i = 0; i < 300; i++) state.update(1.0 / 60.0, false);
        assertEquals(36.0, state.position(), 0.1);
        state.wheel(-100, 48);
        assertEquals(500.0, state.target());
        for (int i = 0; i < 300; i++) state.update(1.0 / 60.0, false);
        assertTrue(state.position() <= 500.0);
    }

    @Test void reducedMotionAndBoundsAreImmediate() {
        SmoothScrollState state = new SmoothScrollState(); state.maximum(100);
        state.moveTo(80, false); state.update(0.016, true);
        assertEquals(80.0, state.position());
        state.maximum(20); assertEquals(20.0, state.position());
        assertTrue(state.contains(10, 10, 0, 0, 20, 20));
        assertFalse(state.contains(20, 10, 0, 0, 20, 20));
    }

    @Test void scrollbarDragMapsTrackToContent() {
        SmoothScrollState state = new SmoothScrollState(); state.maximum(600); state.moveTo(300, true);
        int thumb = state.thumbSize(200, 800);
        assertEquals(50, thumb);
        assertEquals(75, state.thumbOffset(200, thumb));
        state.dragThumb(150, 0, 25, 200, thumb, true);
        assertEquals(500, state.position(), 0.001);
    }
}
