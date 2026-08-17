package app.swirl.client;

import net.minecraft.client.Minecraft;
import net.minecraft.client.gui.GuiGraphicsExtractor;
import net.minecraft.client.gui.components.AbstractWidget;
import net.minecraft.client.gui.narration.NarrationElementOutput;
import net.minecraft.client.input.KeyEvent;
import net.minecraft.client.input.MouseButtonEvent;
import net.minecraft.network.chat.Component;
import org.lwjgl.glfw.GLFW;

import java.util.function.DoubleConsumer;
import java.util.function.DoubleFunction;
import java.util.function.DoubleSupplier;

final class SwirlSlider extends AbstractWidget {
    private final double min, max, step;
    private final DoubleSupplier getter;
    private final DoubleConsumer setter;
    private final DoubleFunction<String> formatter;
    private final Runnable beforeChange;

    SwirlSlider(int x, int y, int width, int height, double min, double max, double step,
                DoubleSupplier getter, DoubleConsumer setter, DoubleFunction<String> formatter, Runnable beforeChange) {
        super(x, y, width, height, Component.literal("Slider"));
        this.min = min; this.max = max; this.step = step; this.getter = getter; this.setter = setter;
        this.formatter = formatter; this.beforeChange = beforeChange;
    }

    private void setFromX(double mouseX) {
        double ratio = Math.max(0, Math.min(1, (mouseX - getX() - 3) / Math.max(1.0, getWidth() - 6.0)));
        double raw = min + ratio * (max - min);
        setter.accept(Math.max(min, Math.min(max, Math.round(raw / step) * step)));
    }

    @Override public void onClick(MouseButtonEvent event, boolean doubled) { beforeChange.run(); setFromX(event.x()); }
    @Override protected void onDrag(MouseButtonEvent event, double dx, double dy) { setFromX(event.x()); }

    @Override public boolean keyPressed(KeyEvent event) {
        if (!isFocused() || !active) return false;
        if (event.key() == GLFW.GLFW_KEY_LEFT || event.key() == GLFW.GLFW_KEY_RIGHT) {
            beforeChange.run();
            setter.accept(Math.max(min, Math.min(max, getter.getAsDouble() + (event.key() == GLFW.GLFW_KEY_RIGHT ? step : -step))));
            return true;
        }
        if (event.key() == GLFW.GLFW_KEY_HOME || event.key() == GLFW.GLFW_KEY_END) {
            beforeChange.run(); setter.accept(event.key() == GLFW.GLFW_KEY_HOME ? min : max); return true;
        }
        return false;
    }

    @Override protected void extractWidgetRenderState(GuiGraphicsExtractor g, int mouseX, int mouseY, float delta) {
        SwirlTheme.sync();
        double ratio = (getter.getAsDouble() - min) / (max - min);
        int knob = getX() + 3 + (int)Math.round(Math.max(0, Math.min(1, ratio)) * (getWidth() - 6));
        g.fill(getX(), getY(), getRight(), getBottom(), SwirlTheme.RAISED);
        g.outline(getX(), getY(), getWidth(), getHeight(), isHoveredOrFocused() ? SwirlTheme.PLUM : SwirlTheme.BORDER);
        int cy = getY() + getHeight() / 2;
        g.fill(getX() + 4, cy - 1, getRight() - 4, cy + 2, SwirlTheme.BORDER);
        g.fill(getX() + 4, cy - 1, knob, cy + 2, SwirlTheme.PLUM_BRIGHT);
        g.fill(knob - 2, getY() + 3, knob + 3, getBottom() - 3, SwirlTheme.TEXT);
        String value = formatter.apply(getter.getAsDouble());
        g.text(Minecraft.getInstance().font, value, getRight() - Minecraft.getInstance().font.width(value) - 5, getY() + 4, SwirlTheme.TEXT, true);
        if (isFocused()) g.outline(getX() - 1, getY() - 1, getWidth() + 2, getHeight() + 2, SwirlTheme.TEXT);
    }

    @Override protected void updateWidgetNarration(NarrationElementOutput output) { defaultButtonNarrationText(output); }
}
