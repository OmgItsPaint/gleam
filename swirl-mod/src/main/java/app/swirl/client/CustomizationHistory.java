package app.swirl.client;

import java.util.ArrayDeque;
import java.util.Deque;

final class CustomizationHistory {
    private static final int LIMIT = 100;
    private final HudConfig config;
    private final Deque<String> undo = new ArrayDeque<>();
    private final Deque<String> redo = new ArrayDeque<>();

    CustomizationHistory(HudConfig config) { this.config = config; }

    void remember() {
        undo.push(config.snapshot());
        while (undo.size() > LIMIT) undo.removeLast();
        redo.clear();
    }

    boolean undo() {
        if (undo.isEmpty()) return false;
        redo.push(config.snapshot());
        config.restore(undo.pop());
        return true;
    }

    boolean redo() {
        if (redo.isEmpty()) return false;
        undo.push(config.snapshot());
        config.restore(redo.pop());
        return true;
    }

    int undoSize() { return undo.size(); }
    int redoSize() { return redo.size(); }
}
