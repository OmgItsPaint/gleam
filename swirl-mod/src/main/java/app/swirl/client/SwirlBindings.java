package app.swirl.client;

import com.mojang.blaze3d.platform.InputConstants;
import net.minecraft.client.Minecraft;
import net.minecraft.client.KeyMapping;
import net.minecraft.client.input.KeyEvent;
import net.minecraft.client.input.MouseButtonInfo;
import net.minecraft.network.chat.Component;
import org.lwjgl.glfw.GLFW;
import app.swirl.identity.SwirlHostClient;

public final class SwirlBindings {
    private static boolean sprintToggled;
    private static boolean sneakToggled;

    private SwirlBindings() {}

    public static void keyboard(KeyEvent event, int action) {
        if (action == GLFW.GLFW_REPEAT) return;
        dispatch(InputConstants.getKey(event), action == GLFW.GLFW_PRESS);
    }

    public static void mouse(MouseButtonInfo event, int action) {
        if (action == GLFW.GLFW_REPEAT) return;
        dispatch(InputConstants.Type.MOUSE.getOrCreate(event.button()), action == GLFW.GLFW_PRESS);
    }

    private static void dispatch(InputConstants.Key key, boolean pressed) {
        Minecraft client = Minecraft.getInstance();
        HudConfig config = SwirlHud.config();
        String name = key.getName();
        if (name.equals(config.bindings.zoom)) VisualModuleService.zoomKey(pressed);
        if (!pressed || client.player == null || ScreenBridge.hasOpenUi(client) || !client.isWindowActive()) return;
        if (name.equals(config.bindings.fullbrightToggle)) VisualModuleService.fullbrightKey(true);
        if (name.equals(config.bindings.openMenu)) {
            ScreenBridge.show(client, new HudEditorScreen(null));
            return;
        }
        if (name.equals(config.bindings.hostManager) && SwirlHostClient.available()) {
            ScreenBridge.show(client, new HostManagerScreen(null));
            return;
        }
        if (name.equals(config.bindings.stopwatchToggle)) SwirlHud.toggleStopwatch();
        if (name.equals(config.bindings.stopwatchReset)) SwirlHud.resetStopwatch();
        HudConfig.Element sprint = config.element("toggle_sprint");
        HudConfig.Element sneak = config.element("toggle_sneak");
        if (sprint != null && sprint.enabled && name.equals(config.bindings.toggleSprint)) sprintToggled = !sprintToggled;
        if (sneak != null && sneak.enabled && name.equals(config.bindings.toggleSneak)) sneakToggled = !sneakToggled;
    }

    static boolean sprintToggled() { return sprintToggled; }
    static boolean sneakToggled() { return sneakToggled; }
    public static boolean applySprint() {
        HudConfig.Element element = SwirlHud.config().element("toggle_sprint");
        return element != null && element.enabled && sprintToggled;
    }
    public static boolean applySneak() {
        HudConfig.Element element = SwirlHud.config().element("toggle_sneak");
        return element != null && element.enabled && sneakToggled;
    }

    static InputConstants.Key key(String serialized) {
        try { return InputConstants.getKey(serialized); }
        catch (Exception ignored) { return InputConstants.UNKNOWN; }
    }

    static String conflict(String action, String serialized) {
        InputConstants.Key key = key(serialized);
        if (key.equals(InputConstants.UNKNOWN)) return "";
        try {
            for (KeyMapping mapping : app.swirl.mixin.KeyMappingAccessor.swirl$keyMap().getOrDefault(key, java.util.List.of()))
                return Component.translatable(mapping.getName()).getString();
        } catch (Exception ignored) { }
        HudConfig.Bindings bindings = SwirlHud.config().bindings;
        java.util.Map<String, String> own = java.util.Map.of(
            "Open Swirl", bindings.openMenu, "Stopwatch", bindings.stopwatchToggle,
            "Host Manager", bindings.hostManager,
            "Reset stopwatch", bindings.stopwatchReset, "Toggle sprint", bindings.toggleSprint,
            "Toggle sneak", bindings.toggleSneak, "Fullbright", bindings.fullbrightToggle,
            "Zoom", bindings.zoom);
        for (var entry : own.entrySet()) if (!entry.getKey().equals(action) && serialized.equals(entry.getValue())) return entry.getKey();
        return "";
    }
}
