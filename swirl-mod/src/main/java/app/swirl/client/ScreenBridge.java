package app.swirl.client;

import java.lang.reflect.InvocationTargetException;
import java.lang.reflect.Method;
import java.lang.reflect.Field;
import net.minecraft.client.Minecraft;
import net.minecraft.client.gui.screens.Screen;

public final class ScreenBridge {
    private ScreenBridge() {}

    static void show(Minecraft minecraft, Screen screen) {
        // 26.2 moved the deferred transition to Gui#setScreen. Its Minecraft-level
        // setScreenAndShow wrapper renders synchronously and is unsafe from END_CLIENT_TICK.
        if (invoke(minecraft.gui, "setScreen", screen)) return;
        if (invoke(minecraft, "setScreen", screen)) return;
        throw new IllegalStateException("This Minecraft build does not expose a safe screen transition.");
    }

    public static boolean hasOpenUi(Minecraft minecraft) {
        try {
            Field field = minecraft.getClass().getField("screen");
            if (field.get(minecraft) != null) return true;
        } catch (ReflectiveOperationException ignored) { }
        if (nonNull(minecraft, "getOverlay")) return true;
        return nonNull(minecraft.gui, "screen") || nonNull(minecraft.gui, "overlay");
    }

    private static boolean nonNull(Object target, String methodName) {
        try { return target.getClass().getMethod(methodName).invoke(target) != null; }
        catch (ReflectiveOperationException ignored) { return false; }
    }

    private static boolean invoke(Object target, String name, Screen screen) {
        try {
            Method method = target.getClass().getMethod(name, Screen.class);
            method.invoke(target, (Object) screen);
            return true;
        } catch (NoSuchMethodException ignored) {
            return false;
        } catch (IllegalAccessException error) {
            throw new IllegalStateException("Could not access Minecraft's screen transition.", error);
        } catch (InvocationTargetException error) {
            Throwable cause = error.getCause();
            if (cause instanceof RuntimeException runtime) throw runtime;
            if (cause instanceof Error fatal) throw fatal;
            throw new IllegalStateException("Minecraft rejected the screen transition.", cause);
        }
    }
}
