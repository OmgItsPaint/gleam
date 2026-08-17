package app.swirl.input;

import org.junit.jupiter.api.Test;
import static org.junit.jupiter.api.Assertions.*;

final class ClickTrackerTest {
    @Test void recordsMoreThanTwentyPressesWithoutTickPolling() {
        ClickTracker tracker = new ClickTracker();
        long now = 10_000_000_000L;
        for (int index = 0; index < 37; index++) tracker.record(ClickTracker.Button.LEFT, now + index);
        assertEquals(37, tracker.count(ClickTracker.Button.LEFT, now + 100, 1000));
        assertEquals(0, tracker.count(ClickTracker.Button.RIGHT, now + 100, 1000));
    }

    @Test void expiresOnlyValuesOlderThanTheRollingBoundary() {
        ClickTracker tracker = new ClickTracker();
        long second = 1_000_000_000L;
        tracker.record(ClickTracker.Button.LEFT, second);
        tracker.record(ClickTracker.Button.LEFT, second + 1);
        assertEquals(2, tracker.count(ClickTracker.Button.LEFT, second * 2, 1000));
        assertEquals(1, tracker.count(ClickTracker.Button.LEFT, second * 2 + 1, 1000));
    }
}
