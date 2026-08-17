package app.swirl.client;

import net.minecraft.client.gui.GuiGraphicsExtractor;
import net.minecraft.client.gui.components.EditBox;
import net.minecraft.client.gui.screens.Screen;
import net.minecraft.network.chat.Component;

import java.util.function.IntConsumer;
import java.util.function.IntSupplier;
import java.util.Locale;

final class NumericEditScreen extends Screen {
    private final Screen parent;
    private final String label;
    private final int min, max;
    private final IntSupplier getter;
    private final IntConsumer setter;
    private EditBox input;
    private String error = "";

    NumericEditScreen(Screen parent, String label, int min, int max, IntSupplier getter, IntConsumer setter) {
        super(Component.literal("Exact numeric value"));
        this.parent = parent; this.label = label; this.min = min; this.max = max; this.getter = getter; this.setter = setter;
    }

    @Override protected void init() {
        input = new EditBox(font, width / 2 - 100, height / 2 - 10, 200, 22, Component.literal(label));
        input.setMaxLength(12); input.setValue(Integer.toString(getter.getAsInt())); addRenderableWidget(input); setInitialFocus(input);
        addRenderableWidget(new SwirlButton(width / 2 - 100, height / 2 + 22, 96, 22, Component.literal("CANCEL"), this::onClose));
        addRenderableWidget(new SwirlButton(width / 2 + 4, height / 2 + 22, 96, 22, Component.literal("APPLY"), this::apply).selected(true));
    }

    private void apply() {
        try {
            int value = Integer.parseInt(input.getValue().strip());
            if (value < min || value > max) { error = "Use a value from " + min + " to " + max; return; }
            setter.accept(value); ScreenBridge.show(minecraft, parent);
        } catch (NumberFormatException ignored) { error = "Enter a whole number"; }
    }

    @Override public void extractRenderState(GuiGraphicsExtractor g, int mouseX, int mouseY, float delta) {
        g.fill(0, 0, width, height, 0xC0000000);
        g.fill(width / 2 - 114, height / 2 - 58, width / 2 + 114, height / 2 + 66, SwirlTheme.SURFACE);
        g.outline(width / 2 - 114, height / 2 - 58, 228, 124, SwirlTheme.PLUM);
        g.centeredText(font, label.toUpperCase(Locale.ROOT), width / 2, height / 2 - 43, SwirlTheme.TEXT);
        g.centeredText(font, "Range: " + min + " to " + max, width / 2, height / 2 - 28, SwirlTheme.MUTED);
        if (!error.isBlank()) g.centeredText(font, error, width / 2, height / 2 + 49, SwirlTheme.DANGER);
        super.extractRenderState(g, mouseX, mouseY, delta);
    }

    @Override public boolean isPauseScreen() { return false; }
    @Override public void onClose() { ScreenBridge.show(minecraft, parent); }
}
