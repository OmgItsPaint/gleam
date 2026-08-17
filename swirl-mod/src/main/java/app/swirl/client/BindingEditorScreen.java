package app.swirl.client;

import com.mojang.blaze3d.platform.InputConstants;
import net.minecraft.client.gui.GuiGraphicsExtractor;
import net.minecraft.client.gui.screens.Screen;
import net.minecraft.client.input.KeyEvent;
import net.minecraft.client.input.MouseButtonEvent;
import net.minecraft.network.chat.Component;
import org.lwjgl.glfw.GLFW;

import java.util.function.Consumer;
import java.util.function.Supplier;

final class BindingEditorScreen extends Screen {
    private final Screen parent;
    private final String action;
    private final Supplier<String> getter;
    private final Consumer<String> setter;
    private final String original;
    private boolean capturing = true;
    private boolean committed;

    BindingEditorScreen(Screen parent, String action, Supplier<String> getter, Consumer<String> setter) {
        super(Component.literal("Gleam key binding")); this.parent = parent; this.action = action; this.getter = getter; this.setter = setter; this.original = getter.get();
    }
    @Override protected void init() {
        if (capturing) addRenderableWidget(new SwirlButton(width / 2 - 78, height / 2 + 35, 74, 22, Component.literal("UNBIND"), () -> bind(InputConstants.UNKNOWN)).danger(true));
        else addRenderableWidget(new SwirlButton(width / 2 - 78, height / 2 + 35, 74, 22, Component.literal("SAVE"), () -> { committed = true; SwirlHud.config().save(); ScreenBridge.show(minecraft, parent); }).selected(true));
        addRenderableWidget(new SwirlButton(width / 2 + 4, height / 2 + 35, 74, 22, Component.literal("CANCEL"), this::onClose));
    }
    @Override public boolean keyPressed(KeyEvent event) {
        if (event.key() == GLFW.GLFW_KEY_ESCAPE) { onClose(); return true; }
        if (event.key() == GLFW.GLFW_KEY_DELETE || event.key() == GLFW.GLFW_KEY_BACKSPACE) bind(InputConstants.UNKNOWN);
        else bind(InputConstants.getKey(event));
        return true;
    }
    @Override public boolean mouseClicked(MouseButtonEvent event, boolean doubled) {
        if (super.mouseClicked(event, doubled)) return true;
        if (capturing) { bind(InputConstants.Type.MOUSE.getOrCreate(event.button())); return true; }
        return false;
    }
    private void bind(InputConstants.Key key) { capturing = false; setter.accept(key.getName()); rebuildWidgets(); }
    @Override public void extractRenderState(GuiGraphicsExtractor g, int mouseX, int mouseY, float delta) {
        g.fill(0, 0, width, height, 0xC0000000);
        int x = width / 2 - 110, y = height / 2 - 58;
        g.fill(x, y, x + 220, y + 126, SwirlTheme.SURFACE); g.outline(x, y, 220, 126, SwirlTheme.PLUM);
        g.centeredText(font, action.toUpperCase(), width / 2, y + 13, SwirlTheme.TEXT);
        g.centeredText(font, "Press a keyboard key or mouse button", width / 2, y + 38, SwirlTheme.MUTED);
        g.centeredText(font, SwirlBindings.key(getter.get()).getDisplayName(), width / 2, y + 57, SwirlTheme.PLUM_BRIGHT);
        String conflict = SwirlBindings.conflict(action, getter.get());
        if (!conflict.isEmpty()) g.centeredText(font, "Already used by " + conflict, width / 2, y + 74, 0xFFFF6476);
        super.extractRenderState(g, mouseX, mouseY, delta);
    }
    @Override public boolean isPauseScreen() { return false; }
    @Override public void onClose() { if (!committed) setter.accept(original); ScreenBridge.show(minecraft, parent); }
}
