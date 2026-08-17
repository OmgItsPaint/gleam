package app.swirl.client;

import net.minecraft.client.Minecraft;
import net.minecraft.client.gui.GuiGraphicsExtractor;
import net.minecraft.client.gui.components.AbstractWidget;
import net.minecraft.client.gui.narration.NarrationElementOutput;
import net.minecraft.client.input.KeyEvent;
import net.minecraft.client.input.MouseButtonEvent;
import net.minecraft.network.chat.Component;
import org.lwjgl.glfw.GLFW;

final class SwirlButton extends AbstractWidget {
    private final Runnable action;
    private boolean selected;
    private boolean danger;
    private Component narration;

    SwirlButton(int x, int y, int width, int height, Component message, Runnable action) {
        super(x, y, width, height, message);
        this.action = action;
    }

    SwirlButton selected(boolean value) { selected = value; return this; }
    SwirlButton danger(boolean value) { danger = value; return this; }
    SwirlButton narration(Component value) { narration = value; return this; }

    @Override
    protected net.minecraft.network.chat.MutableComponent createNarrationMessage() {
        return narration == null ? super.createNarrationMessage() : Component.literal(narration.getString());
    }

    @Override
    protected void extractWidgetRenderState(GuiGraphicsExtractor graphics, int mouseX, int mouseY, float delta) {
        SwirlTheme.sync();
        int border = danger ? SwirlTheme.DANGER : selected ? SwirlTheme.PLUM_BRIGHT : isHoveredOrFocused() ? SwirlTheme.PLUM : SwirlTheme.BORDER;
        int fill = selected ? SwirlTheme.PLUM_DARK : isHoveredOrFocused() ? SwirlTheme.SOFT : SwirlTheme.RAISED;
        graphics.fill(getX(), getY(), getRight(), getBottom(), fill);
        graphics.outline(getX(), getY(), getWidth(), getHeight(), border);
        if (isFocused()) graphics.outline(getX() - 1, getY() - 1, getWidth() + 2, getHeight() + 2, SwirlTheme.TEXT);
        int color = active ? SwirlTheme.TEXT : SwirlTheme.MUTED;
        graphics.centeredText(Minecraft.getInstance().font, getMessage(), getX() + getWidth() / 2,
            getY() + (getHeight() - 8) / 2, color);
    }

    @Override
    public void onClick(MouseButtonEvent event, boolean doubled) { if (active) action.run(); }

    @Override
    public boolean keyPressed(KeyEvent event) {
        if (!active || !isFocused()) return false;
        if (event.key() == GLFW.GLFW_KEY_ENTER || event.key() == GLFW.GLFW_KEY_KP_ENTER || event.key() == GLFW.GLFW_KEY_SPACE) {
            action.run();
            return true;
        }
        return false;
    }

    @Override
    public void playDownSound(net.minecraft.client.sounds.SoundManager manager) { playButtonClickSound(manager); }

    @Override
    protected void updateWidgetNarration(NarrationElementOutput output) { defaultButtonNarrationText(output); }
}
