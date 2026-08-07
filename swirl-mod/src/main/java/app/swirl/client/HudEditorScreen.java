package app.swirl.client;

import net.minecraft.client.gui.GuiGraphicsExtractor;
import net.minecraft.client.gui.components.Button;
import net.minecraft.client.gui.screens.Screen;
import net.minecraft.client.input.MouseButtonEvent;
import net.minecraft.network.chat.Component;

final class HudEditorScreen extends Screen {
    private final Screen parent;
    private HudConfig.Element selected;
    private Button enabledButton;
    private int dragOffsetX;
    private int dragOffsetY;
    private boolean dragging;

    HudEditorScreen(Screen parent) { super(Component.literal("Swirl HUD editor")); this.parent = parent; }

    @Override
    protected void init() {
        int bottom = height - 28;
        enabledButton = addRenderableWidget(Button.builder(Component.literal("Visibility"), button -> { if (selected != null) { selected.enabled = !selected.enabled; refreshLabels(); } }).bounds(8, bottom, 92, 20).build());
        addRenderableWidget(Button.builder(Component.literal("Scale -"), button -> { if (selected != null) selected.scale = Math.max(0.5f, selected.scale - 0.1f); }).bounds(104, bottom, 70, 20).build());
        addRenderableWidget(Button.builder(Component.literal("Scale +"), button -> { if (selected != null) selected.scale = Math.min(2.5f, selected.scale + 0.1f); }).bounds(178, bottom, 70, 20).build());
        addRenderableWidget(Button.builder(Component.literal("Color"), button -> cycleColor()).bounds(252, bottom, 62, 20).build());
        addRenderableWidget(Button.builder(Component.literal("Background"), button -> { if (selected != null) selected.showBackground = !selected.showBackground; }).bounds(318, bottom, 92, 20).build());
        addRenderableWidget(Button.builder(Component.literal("Reset"), button -> reset()).bounds(414, bottom, 58, 20).build());
        addRenderableWidget(Button.builder(Component.literal("Done"), button -> onClose()).bounds(width - 88, bottom, 80, 20).build());
        if (!SwirlHud.config().elements.isEmpty()) selected = SwirlHud.config().elements.get(0);
        refreshLabels();
    }

    private void refreshLabels() {
        enabledButton.setMessage(Component.literal(selected == null ? "Visibility" : selected.enabled ? "Visible" : "Hidden"));
    }
    private void cycleColor() {
        if (selected == null) return;
        int index = 0;
        for (int i = 0; i < HudConfig.COLORS.length; i++) if (HudConfig.COLORS[i] == selected.color) index = i + 1;
        selected.color = HudConfig.COLORS[index % HudConfig.COLORS.length];
    }
    private void reset() {
        if (selected == null) return;
        HudConfig fresh = new HudConfig();
        for (HudConfig.Element element : fresh.elements) if (element.id.equals(selected.id)) {
            selected.x = element.x; selected.y = element.y; selected.scale = element.scale; selected.color = element.color; selected.background = element.background; selected.showBackground = element.showBackground; selected.enabled = element.enabled;
        }
        refreshLabels();
    }
    private HudConfig.Element at(double x, double y) {
        for (int i = SwirlHud.config().elements.size() - 1; i >= 0; i--) {
            HudConfig.Element element = SwirlHud.config().elements.get(i);
            String text = SwirlHud.text(element.id, minecraft, true);
            double width = (font.width(text) + 8) * element.scale;
            double height = 17 * element.scale;
            if (x >= element.x && x <= element.x + width && y >= element.y && y <= element.y + height) return element;
        }
        return null;
    }

    @Override
    public boolean mouseClicked(MouseButtonEvent event, boolean doubled) {
        if (super.mouseClicked(event, doubled)) return true;
        if (event.button() != 0) return false;
        HudConfig.Element hit = at(event.x(), event.y());
        if (hit == null || event.y() > height - 36) return false;
        selected = hit; dragOffsetX = (int) event.x() - hit.x; dragOffsetY = (int) event.y() - hit.y; dragging = true; refreshLabels(); return true;
    }

    @Override
    public boolean mouseDragged(MouseButtonEvent event, double deltaX, double deltaY) {
        if (!dragging || selected == null) return super.mouseDragged(event, deltaX, deltaY);
        selected.x = Math.max(0, Math.min(width - 20, (int) event.x() - dragOffsetX));
        selected.y = Math.max(24, Math.min(height - 48, (int) event.y() - dragOffsetY));
        return true;
    }

    @Override
    public boolean mouseReleased(MouseButtonEvent event) { dragging = false; return super.mouseReleased(event); }

    @Override
    public void extractRenderState(GuiGraphicsExtractor graphics, int mouseX, int mouseY, float delta) {
        graphics.fill(0, 0, width, height, 0xE6060508);
        SwirlHud.renderEditor(graphics);
        super.extractRenderState(graphics, mouseX, mouseY, delta);
        graphics.fill(0, 0, width, 23, 0xED160E18);
        graphics.text(font, "HUD EDITOR — drag any widget, then change its look below", 8, 7, 0xFFD89BD2, true);
        if (selected != null) graphics.text(font, selected.id.toUpperCase() + "  " + Math.round(selected.scale * 100) + "%", width - 150, 7, selected.color, true);
    }

    @Override
    public void onClose() { SwirlHud.config().save(); ScreenBridge.show(minecraft, parent); }
}
