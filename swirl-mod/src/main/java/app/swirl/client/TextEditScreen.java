package app.swirl.client;

import net.minecraft.client.gui.GuiGraphicsExtractor;
import net.minecraft.client.gui.components.EditBox;
import net.minecraft.client.gui.screens.Screen;
import net.minecraft.network.chat.Component;

import java.util.function.Consumer;
import java.util.function.Supplier;

final class TextEditScreen extends Screen {
    private final Screen parent;
    private final String label;
    private final Supplier<String> getter;
    private final Consumer<String> setter;
    private EditBox input;

    TextEditScreen(Screen parent, String label, Supplier<String> getter, Consumer<String> setter) {
        super(Component.literal("Gleam text editor")); this.parent = parent; this.label = label; this.getter = getter; this.setter = setter;
    }
    @Override protected void init() {
        input = new EditBox(font, width / 2 - 100, height / 2 - 12, 200, 22, Component.literal(label));
        input.setMaxLength(40); input.setValue(getter.get()); addRenderableWidget(input); setInitialFocus(input);
        addRenderableWidget(new SwirlButton(width / 2 - 100, height / 2 + 20, 96, 22, Component.literal("CANCEL"), this::onClose));
        addRenderableWidget(new SwirlButton(width / 2 + 4, height / 2 + 20, 96, 22, Component.literal("SAVE"), () -> {
            setter.accept(input.getValue().strip()); SwirlHud.config().save(); ScreenBridge.show(minecraft, parent);
        }).selected(true));
    }
    @Override public void extractRenderState(GuiGraphicsExtractor g, int mouseX, int mouseY, float delta) {
        g.fill(0, 0, width, height, 0xC0000000); g.fill(width / 2 - 114, height / 2 - 52, width / 2 + 114, height / 2 + 58, SwirlTheme.SURFACE);
        g.outline(width / 2 - 114, height / 2 - 52, 228, 110, SwirlTheme.PLUM); g.centeredText(font, label.toUpperCase(), width / 2, height / 2 - 38, SwirlTheme.TEXT);
        super.extractRenderState(g, mouseX, mouseY, delta);
    }
    @Override public boolean isPauseScreen() { return false; }
    @Override public void onClose() { ScreenBridge.show(minecraft, parent); }
}
