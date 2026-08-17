package app.swirl.screen;

/** Frame-rate independent pixel scrolling shared by Swirl screens and testable without Minecraft. */
public final class SmoothScrollState {
    private double position;
    private double target;
    private double velocity;
    private double maximum;

    public double position() { return position; }
    public double target() { return target; }
    public double maximum() { return maximum; }

    public void maximum(double value) {
        maximum = Math.max(0.0, value);
        target = clamp(target);
        position = clamp(position);
        if (position == 0.0 || position == maximum) velocity = 0.0;
    }

    public void wheel(double amount, double pixelsPerStep) {
        if (!Double.isFinite(amount)) return;
        target = clamp(target - amount * pixelsPerStep);
    }

    public void moveTo(double value, boolean immediate) {
        target = clamp(value);
        if (immediate) { position = target; velocity = 0.0; }
    }

    public boolean update(double seconds, boolean reducedMotion) {
        double before = position;
        if (reducedMotion) { position = target; velocity = 0.0; return before != position; }
        double dt = Math.max(0.0, Math.min(0.05, seconds));
        double acceleration = (target - position) * 85.0;
        velocity = (velocity + acceleration * dt) * Math.exp(-15.0 * dt);
        position = clamp(position + velocity * dt);
        if (Math.abs(target - position) < 0.05 && Math.abs(velocity) < 0.5) {
            position = target; velocity = 0.0;
        }
        return Math.abs(before - position) > 0.001;
    }

    public int rounded() { return (int)Math.round(position); }
    public int thumbSize(int viewport, int content) {
        return content <= viewport ? viewport : Math.max(18, viewport * viewport / Math.max(1, content));
    }
    public int thumbOffset(int track, int thumb) {
        return maximum <= 0 ? 0 : (int)Math.round((track - thumb) * position / maximum);
    }
    public void dragThumb(double pointer, double trackStart, double grabOffset, double trackLength, double thumbLength, boolean immediate) {
        double travel = Math.max(1.0, trackLength - thumbLength);
        moveTo((pointer - trackStart - grabOffset) / travel * maximum, immediate);
    }
    public boolean contains(double x, double y, int left, int top, int right, int bottom) {
        return x >= left && x < right && y >= top && y < bottom;
    }
    private double clamp(double value) { return Math.max(0.0, Math.min(maximum, value)); }
}
