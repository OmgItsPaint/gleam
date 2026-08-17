package app.swirl.input;

import java.util.ArrayDeque;
import java.util.Deque;

public final class ClickTracker {
    public enum Button { LEFT, RIGHT }
    private final Deque<Long> left = new ArrayDeque<>();
    private final Deque<Long> right = new ArrayDeque<>();

    public void record(Button button, long nowNanos) { queue(button).addLast(nowNanos); }
    public int count(Button button, long nowNanos, int windowMillis) {
        Deque<Long> values = queue(button);
        long cutoff = nowNanos - windowMillis * 1_000_000L;
        while (!values.isEmpty() && values.peekFirst() < cutoff) values.removeFirst();
        return values.size();
    }
    public void clear() { left.clear(); right.clear(); }
    private Deque<Long> queue(Button button) { return button == Button.LEFT ? left : right; }
}
