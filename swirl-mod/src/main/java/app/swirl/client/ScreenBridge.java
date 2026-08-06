package app.swirl.client;

import java.lang.reflect.Method;
import net.minecraft.client.Minecraft;
import net.minecraft.client.gui.screens.Screen;

final class ScreenBridge {
    private ScreenBridge() {}

    static void show(Minecraft minecraft, Screen screen) {
        for (String name : new String[] { "setScreenAndShow", "setScreen" }) {
            try {
                Method method = Minecraft.class.getMethod(name, Screen.class);
                method.invoke(minecraft, (Object) screen);
                return;
            } catch (ReflectiveOperationException ignored) {
            }
        }
        throw new IllegalStateException("This Minecraft build does not expose a supported screen method.");
    }
}
