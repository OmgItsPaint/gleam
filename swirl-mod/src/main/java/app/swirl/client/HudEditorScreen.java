package app.swirl.client;

import net.minecraft.client.gui.GuiGraphicsExtractor;
import net.minecraft.client.gui.screens.Screen;
import net.minecraft.client.input.KeyEvent;
import net.minecraft.client.input.MouseButtonEvent;
import net.minecraft.network.chat.Component;
import org.lwjgl.glfw.GLFW;

final class HudEditorScreen extends Screen {
    private final Screen parent;
    private final String initialSelection;
    private final CustomizationHistory history;
    private HudConfig.Element selected;
    private HudConfig.Element hovered;
    private int dragOffsetX;
    private int dragOffsetY;
    private double resizeStartX;
    private double resizeStartY;
    private float resizeStartScale;
    private boolean dragging;
    private boolean resizing;

    HudEditorScreen(Screen parent) { this(parent, null); }
    HudEditorScreen(Screen parent, String selectedId) {
        super(Component.literal("Gleam HUD layout"));
        this.parent = parent;
        this.initialSelection = selectedId;
        this.history = new CustomizationHistory(SwirlHud.config());
    }

    @Override
    protected void init() {
        selected = initialSelection == null ? null : SwirlHud.config().element(initialSelection);
        if (selected != null && (ModuleRegistry.byId(selected.id) == null || !ModuleRegistry.byId(selected.id).draggable())) selected = null;
        addRenderableWidget(new SwirlButton(width / 2 - 56, height / 2 + 25, 112, 22,
            Component.literal("SETTINGS"), this::openSettings).selected(true));
    }

    private void openSettings() {
        normalizeAndSave();
        ScreenBridge.show(minecraft, new SwirlScreen(this));
    }

    private HudConfig.Element at(double mouseX, double mouseY) {
        for (int index = SwirlHud.config().elements.size() - 1; index >= 0; index--) {
            HudConfig.Element element = SwirlHud.config().elements.get(index);
            if (!element.enabled) continue;
            ModuleRegistry.Module module = ModuleRegistry.byId(element.id);
            if (module == null || !module.draggable()) continue;
            int x = currentX(element);
            int y = currentY(element);
            int elementWidth = SwirlHud.renderedWidth(element, minecraft, true);
            int elementHeight = SwirlHud.renderedHeight(element);
            if (mouseX >= x - 3 && mouseX <= x + elementWidth + 3 && mouseY >= y - 3 && mouseY <= y + elementHeight + 3) return element;
        }
        return null;
    }

    private boolean inClose(HudConfig.Element element, double x, double y) {
        return x >= currentX(element) - 3 && x < currentX(element) + 11 && y >= currentY(element) - 3 && y < currentY(element) + 11;
    }

    private boolean inGear(HudConfig.Element element, double x, double y) {
        int right = currentX(element) + SwirlHud.renderedWidth(element, minecraft, true) + 3;
        return x > right - 14 && x <= right && y >= currentY(element) - 3 && y < currentY(element) + 11;
    }

    private boolean inResize(HudConfig.Element element, double x, double y) {
        int right = currentX(element) + SwirlHud.renderedWidth(element, minecraft, true) + 3;
        int bottom = currentY(element) + SwirlHud.renderedHeight(element) + 3;
        return x > right - 10 && x <= right && y > bottom - 10 && y <= bottom;
    }

    @Override
    public boolean mouseClicked(MouseButtonEvent event, boolean doubled) {
        if (super.mouseClicked(event, doubled)) return true;
        HudConfig.Element hit = at(event.x(), event.y());
        if (hit == null) { selected = null; return false; }
        selected = hit;
        if (event.button() == GLFW.GLFW_MOUSE_BUTTON_RIGHT) {
            history.remember();
            SwirlHud.config().resetPlacement(hit.id);
            selected = SwirlHud.config().element(hit.id);
            return true;
        }
        if (event.button() != GLFW.GLFW_MOUSE_BUTTON_LEFT) return false;
        if (inClose(hit, event.x(), event.y())) {
            history.remember();
            hit.enabled = false;
            selected = null;
            return true;
        }
        if (inGear(hit, event.x(), event.y())) {
            normalizeAndSave();
            ScreenBridge.show(minecraft, new ModuleSettingsScreen(this, hit.id));
            return true;
        }
        if (inResize(hit, event.x(), event.y())) {
            history.remember();
            resizing = true;
            resizeStartX = event.x();
            resizeStartY = event.y();
            resizeStartScale = hit.scale;
            return true;
        }
        history.remember();
        dragging = true;
        dragOffsetX = (int) event.x() - currentX(hit);
        dragOffsetY = (int) event.y() - currentY(hit);
        return true;
    }

    @Override
    public boolean mouseDragged(MouseButtonEvent event, double deltaX, double deltaY) {
        if (selected == null) return super.mouseDragged(event, deltaX, deltaY);
        if (resizing) {
            double movement = ((event.x() - resizeStartX) + (event.y() - resizeStartY)) / 2.0;
            int basis = Math.max(24, Math.max(SwirlHud.renderedWidth(selected, minecraft, true), SwirlHud.renderedHeight(selected)));
            selected.scale = Math.max(0.5f, Math.min(2.5f, resizeStartScale + (float) movement / basis));
            place(selected, currentX(selected), currentY(selected));
            return true;
        }
        if (dragging) {
            place(selected, (int) event.x() - dragOffsetX, (int) event.y() - dragOffsetY);
            return true;
        }
        return super.mouseDragged(event, deltaX, deltaY);
    }

    @Override
    public boolean mouseReleased(MouseButtonEvent event) {
        dragging = false;
        resizing = false;
        return super.mouseReleased(event);
    }

    @Override
    public boolean keyPressed(KeyEvent event) {
        boolean control = (event.modifiers() & GLFW.GLFW_MOD_CONTROL) != 0;
        if (control && event.key() == GLFW.GLFW_KEY_Z) {
            String id = selected == null ? null : selected.id;
            if (history.undo()) selected = id == null ? null : SwirlHud.config().element(id);
            return true;
        }
        if (control && event.key() == GLFW.GLFW_KEY_Y) {
            String id = selected == null ? null : selected.id;
            if (history.redo()) selected = id == null ? null : SwirlHud.config().element(id);
            return true;
        }
        if (selected != null && selected.enabled && event.key() == GLFW.GLFW_KEY_DELETE) {
            history.remember();
            selected.enabled = false;
            selected = null;
            return true;
        }
        if (selected != null && selected.enabled && (event.key() == GLFW.GLFW_KEY_R || event.key() == GLFW.GLFW_KEY_HOME)) {
            history.remember();
            String id = selected.id;
            SwirlHud.config().resetPlacement(id);
            selected = SwirlHud.config().element(id);
            return true;
        }
        if (selected != null && selected.enabled && switch (event.key()) {
            case GLFW.GLFW_KEY_EQUAL, GLFW.GLFW_KEY_KP_ADD, GLFW.GLFW_KEY_MINUS, GLFW.GLFW_KEY_KP_SUBTRACT -> true;
            default -> false;
        }) {
            history.remember();
            float amount = (event.modifiers() & GLFW.GLFW_MOD_SHIFT) != 0 ? 0.25f : 0.05f;
            if (event.key() == GLFW.GLFW_KEY_MINUS || event.key() == GLFW.GLFW_KEY_KP_SUBTRACT) amount = -amount;
            selected.scale = Math.max(0.5f, Math.min(2.5f, selected.scale + amount));
            place(selected, currentX(selected), currentY(selected));
            return true;
        }
        if (selected != null && selected.enabled && switch (event.key()) {
            case GLFW.GLFW_KEY_LEFT, GLFW.GLFW_KEY_RIGHT, GLFW.GLFW_KEY_UP, GLFW.GLFW_KEY_DOWN -> true;
            default -> false;
        }) {
            history.remember();
            int step = (event.modifiers() & GLFW.GLFW_MOD_SHIFT) != 0 ? 10 : Math.max(1, SwirlHud.config().general.snapSize);
            int x = currentX(selected);
            int y = currentY(selected);
            if (event.key() == GLFW.GLFW_KEY_LEFT) x -= step;
            if (event.key() == GLFW.GLFW_KEY_RIGHT) x += step;
            if (event.key() == GLFW.GLFW_KEY_UP) y -= step;
            if (event.key() == GLFW.GLFW_KEY_DOWN) y += step;
            place(selected, x, y);
            return true;
        }
        return super.keyPressed(event);
    }

    private int currentX(HudConfig.Element element) {
        return SwirlHud.config().screenX(element, width, SwirlHud.renderedWidth(element, minecraft, true));
    }
    private int currentY(HudConfig.Element element) {
        return SwirlHud.config().screenY(element, height, SwirlHud.renderedHeight(element));
    }
    private void place(HudConfig.Element element, int x, int y) {
        int snap = SwirlHud.config().general.snapSize;
        if (snap > 1) { x = Math.round(x / (float) snap) * snap; y = Math.round(y / (float) snap) * snap; }
        int elementWidth = SwirlHud.renderedWidth(element, minecraft, true);
        int elementHeight = SwirlHud.renderedHeight(element);
        int centerSnap = Math.max(3, snap);
        if (Math.abs(x + elementWidth / 2 - width / 2) <= centerSnap) x = width / 2 - elementWidth / 2;
        if (Math.abs(y + elementHeight / 2 - height / 2) <= centerSnap) y = height / 2 - elementHeight / 2;
        SwirlHud.config().place(element, x, y, width, height,
            elementWidth, elementHeight);
    }

    @Override
    public void extractRenderState(GuiGraphicsExtractor graphics, int mouseX, int mouseY, float delta) {
        int alpha = Math.round(SwirlHud.config().general.dimStrength * 255.0f / 100.0f);
        graphics.fill(0, 0, width, height, alpha << 24);
        drawLogo(graphics);
        SwirlHud.renderEditor(graphics);
        hovered = at(mouseX, mouseY);
        HudConfig.Element handles = hovered != null ? hovered : selected;
        if (handles != null && handles.enabled) drawHandles(graphics, handles);
        if ((dragging || resizing) && selected != null) drawGuides(graphics, selected);
        super.extractRenderState(graphics, mouseX, mouseY, delta);
    }

    private void drawLogo(GuiGraphicsExtractor graphics) {
        int cx = width / 2;
        int cy = height / 2 - 16;
        graphics.fill(cx - 18, cy - 18, cx + 18, cy + 18, 0xC90B090B);
        graphics.outline(cx - 18, cy - 18, 36, 36, SwirlTheme.PLUM);
        graphics.fill(cx - 11, cy - 11, cx + 11, cy - 7, SwirlTheme.PLUM_BRIGHT);
        graphics.fill(cx + 7, cy - 7, cx + 11, cy + 8, SwirlTheme.PLUM_BRIGHT);
        graphics.fill(cx - 6, cy + 4, cx + 11, cy + 8, SwirlTheme.PLUM_BRIGHT);
        graphics.fill(cx - 6, cy - 2, cx - 2, cy + 5, SwirlTheme.PLUM_BRIGHT);
        graphics.centeredText(font, "GLEAM", cx, cy + 22, SwirlTheme.TEXT);
    }

    private void drawHandles(GuiGraphicsExtractor graphics, HudConfig.Element element) {
        int x = currentX(element);
        int y = currentY(element);
        int w = SwirlHud.renderedWidth(element, minecraft, true);
        int h = SwirlHud.renderedHeight(element);
        graphics.outline(x - 3, y - 3, w + 6, h + 6, SwirlTheme.PLUM_BRIGHT);
        graphics.fill(x - 3, y - 3, x + 11, y + 11, 0xEE8E263B);
        graphics.centeredText(font, "X", x + 4, y, 0xFFFFFFFF);
        graphics.fill(x + w - 11, y - 3, x + w + 3, y + 11, 0xEE171317);
        graphics.outline(x + w - 11, y - 3, 14, 14, SwirlTheme.PLUM);
        graphics.centeredText(font, "⚙", x + w - 4, y, 0xFFFFFFFF);
        graphics.fill(x + w - 7, y + h - 7, x + w + 3, y + h + 3, SwirlTheme.PLUM_BRIGHT);
        graphics.fill(x + w - 5, y + h - 5, x + w + 1, y + h + 1, 0xFF171317);
    }

    private void drawGuides(GuiGraphicsExtractor graphics, HudConfig.Element element) {
        int cx = currentX(element) + SwirlHud.renderedWidth(element, minecraft, true) / 2;
        int cy = currentY(element) + SwirlHud.renderedHeight(element) / 2;
        if (Math.abs(cx - width / 2) <= Math.max(2, SwirlHud.config().general.snapSize)) graphics.verticalLine(width / 2, 0, height, 0x99D89BD2);
        if (Math.abs(cy - height / 2) <= Math.max(2, SwirlHud.config().general.snapSize)) graphics.horizontalLine(0, width, height / 2, 0x99D89BD2);
    }

    @Override public boolean isPauseScreen() { return false; }
    @Override public void onClose() { normalizeAndSave(); ScreenBridge.show(minecraft, parent); }

    private void normalizeAndSave() {
        SwirlHud.config().normalize(width, height, new HudConfig.HudConfigMetrics() {
            public int width(HudConfig.Element element) { return SwirlHud.renderedWidth(element, minecraft, true); }
            public int height(HudConfig.Element element) { return SwirlHud.renderedHeight(element); }
        });
        SwirlHud.config().save();
    }
}
