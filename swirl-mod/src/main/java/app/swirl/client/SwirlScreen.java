package app.swirl.client;

import net.minecraft.client.gui.GuiGraphicsExtractor;
import net.minecraft.client.gui.components.Button;
import net.minecraft.client.gui.screens.Screen;
import net.minecraft.network.chat.Component;

final class SwirlScreen extends Screen {
    SwirlScreen() {
        super(Component.literal("Swirl"));
    }

    @Override
    protected void init() {
        int left = width / 2 - 90;
        int top = height / 2 - 35;
        addRenderableWidget(Button.builder(Component.literal("Close"), button -> onClose())
            .bounds(left, top, 180, 20).build());
    }

    @Override
    public void extractRenderState(GuiGraphicsExtractor graphics, int mouseX, int mouseY, float delta) {
        super.extractRenderState(graphics, mouseX, mouseY, delta);
        graphics.text(font, "SWIRL", width / 2 - 22, height / 2 - 65, 0xFF8C4D87, true);
    }

    @Override
    public void onClose() {
        ScreenBridge.show(minecraft, null);
    }
}
