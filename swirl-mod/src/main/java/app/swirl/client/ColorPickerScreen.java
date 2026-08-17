package app.swirl.client;

import net.minecraft.client.gui.GuiGraphicsExtractor;
import net.minecraft.client.gui.components.EditBox;
import net.minecraft.client.gui.screens.Screen;
import net.minecraft.client.input.MouseButtonEvent;
import net.minecraft.network.chat.Component;
import org.lwjgl.glfw.GLFW;
import java.util.function.IntConsumer;
import java.util.function.IntSupplier;

final class ColorPickerScreen extends Screen {
    private final Screen parent;
    private final IntSupplier getter;
    private final IntConsumer setter;
    private final int original;
    private float hue;
    private float saturation;
    private float value;
    private int left;
    private int top;
    private EditBox hex;
    private boolean draggingSquare;
    private boolean draggingHue;
    private boolean committed;

    ColorPickerScreen(Screen parent, HudConfig.Element element) {
        this(parent, () -> element.color, value -> element.color = value);
    }

    ColorPickerScreen(Screen parent, IntSupplier getter, IntConsumer setter) {
        super(Component.literal("Gleam color picker"));
        this.parent = parent;
        this.getter = getter;
        this.setter = setter;
        original = getter.getAsInt();
        float[] hsv = HudColors.rgbToHsv(original);
        hue = hsv[0]; saturation = hsv[1]; value = hsv[2];
    }

    @Override protected void init() {
        left = width / 2 - 92;
        top = height / 2 - 75;
        hex = new EditBox(font, left + 91, top + 83, 79, 20, Component.literal("Hex color"));
        hex.setMaxLength(7);
        hex.setValue(String.format("#%06X", getter.getAsInt() & 0xFFFFFF));
        hex.setResponder(this::parseHex);
        addRenderableWidget(hex);
        addRenderableWidget(new SwirlButton(left + 91, top + 110, 79, 21, Component.literal("DONE"), () -> {
            committed = true; SwirlHud.config().save(); ScreenBridge.show(minecraft, parent);
        }).selected(true));
        addRenderableWidget(new SwirlButton(left + 8, top + 110, 75, 21, Component.literal("CANCEL"), this::onClose));
    }

    private void parseHex(String input) {
        try {
            String value = input.startsWith("#") ? input.substring(1) : input;
            if (value.length() != 6) return;
            setter.accept(0xFF000000 | Integer.parseInt(value, 16));
            float[] hsv = HudColors.rgbToHsv(getter.getAsInt());
            hue = hsv[0]; saturation = hsv[1]; this.value = hsv[2];
        } catch (NumberFormatException ignored) { }
    }

    private void setSquare(double x, double y) {
        saturation = Math.max(0, Math.min(1, (float) ((x - left - 8) / 64.0)));
        value = Math.max(0, Math.min(1, 1.0f - (float) ((y - top - 34) / 64.0)));
        apply();
    }
    private void setHue(double y) {
        hue = Math.max(0, Math.min(0.999f, (float) ((y - top - 34) / 64.0)));
        apply();
    }
    private void apply() {
        setter.accept(HudColors.hsvToRgb(hue, saturation, value));
        if (hex != null) hex.setValue(String.format("#%06X", getter.getAsInt() & 0xFFFFFF));
    }

    @Override public boolean mouseClicked(MouseButtonEvent event, boolean doubled) {
        if (event.button() == GLFW.GLFW_MOUSE_BUTTON_LEFT) {
            if (event.x() >= left + 8 && event.x() <= left + 72 && event.y() >= top + 34 && event.y() <= top + 98) {
                draggingSquare = true; setSquare(event.x(), event.y()); return true;
            }
            if (event.x() >= left + 77 && event.x() <= left + 85 && event.y() >= top + 34 && event.y() <= top + 98) {
                draggingHue = true; setHue(event.y()); return true;
            }
        }
        return super.mouseClicked(event, doubled);
    }
    @Override public boolean mouseDragged(MouseButtonEvent event, double dx, double dy) {
        if (draggingSquare) { setSquare(event.x(), event.y()); return true; }
        if (draggingHue) { setHue(event.y()); return true; }
        return super.mouseDragged(event, dx, dy);
    }
    @Override public boolean mouseReleased(MouseButtonEvent event) {
        draggingSquare = false; draggingHue = false;
        return super.mouseReleased(event);
    }

    @Override public void extractRenderState(GuiGraphicsExtractor graphics, int mouseX, int mouseY, float delta) {
        graphics.fill(0, 0, width, height, 0xB8000000);
        graphics.fill(left, top, left + 184, top + 142, SwirlTheme.SURFACE);
        graphics.outline(left, top, 184, 142, SwirlTheme.PLUM);
        graphics.text(font, "HUD COLOR", left + 8, top + 10, SwirlTheme.TEXT, true);
        for (int sy = 0; sy < 64; sy += 2) for (int sx = 0; sx < 64; sx += 2)
            graphics.fill(left + 8 + sx, top + 34 + sy, left + 10 + sx, top + 36 + sy,
                HudColors.hsvToRgb(hue, sx / 62.0f, 1.0f - sy / 62.0f));
        for (int y = 0; y < 64; y += 2) graphics.fill(left + 77, top + 34 + y, left + 85, top + 36 + y,
            HudColors.hsvToRgb(y / 62.0f, 1, 1));
        int sx = left + 8 + Math.round(saturation * 64);
        int sy = top + 34 + Math.round((1 - value) * 64);
        graphics.outline(sx - 2, sy - 2, 5, 5, 0xFFFFFFFF);
        graphics.horizontalLine(left + 75, left + 87, top + 34 + Math.round(hue * 64), 0xFFFFFFFF);
        graphics.fill(left + 91, top + 34, left + 170, top + 72, getter.getAsInt());
        graphics.outline(left + 91, top + 34, 79, 38, SwirlTheme.BORDER_STRONG);
        super.extractRenderState(graphics, mouseX, mouseY, delta);
    }

    @Override public boolean isPauseScreen() { return false; }
    @Override public void onClose() {
        if (!committed) setter.accept(original);
        ScreenBridge.show(minecraft, parent);
    }
}
