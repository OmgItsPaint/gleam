package app.swirl.client;

import net.fabricmc.fabric.api.client.rendering.v1.hud.HudElementRegistry;
import net.minecraft.client.DeltaTracker;
import net.minecraft.client.Minecraft;
import net.minecraft.client.gui.GuiGraphicsExtractor;
import net.minecraft.client.multiplayer.PlayerInfo;
import net.minecraft.resources.Identifier;
import net.minecraft.world.entity.EquipmentSlot;
import net.minecraft.world.item.ItemStack;

import java.time.LocalTime;
import java.time.format.DateTimeFormatter;
import java.util.ArrayDeque;
import java.util.Deque;
import java.util.Locale;

final class SwirlHud {
    private static final Identifier ID = Identifier.fromNamespaceAndPath("swirl_client", "hud");
    private static final DateTimeFormatter CLOCK = DateTimeFormatter.ofPattern("HH:mm:ss");
    private static final Deque<Long> CLICKS = new ArrayDeque<>();
    private static HudConfig config = HudConfig.load();
    private static boolean attackDown;
    private static long stopwatchStarted;

    private SwirlHud() {}
    static void initialize() { HudElementRegistry.addLast(ID, SwirlHud::render); }
    static HudConfig config() { return config; }
    static void reload() { config = HudConfig.load(); }
    static void tick(Minecraft client) {
        boolean down = client.options.keyAttack.isDown();
        if (down && !attackDown) CLICKS.addLast(System.currentTimeMillis());
        attackDown = down;
        long cutoff = System.currentTimeMillis() - 1000;
        while (!CLICKS.isEmpty() && CLICKS.peekFirst() < cutoff) CLICKS.removeFirst();
    }
    static void toggleStopwatch() { stopwatchStarted = stopwatchStarted == 0 ? System.currentTimeMillis() : 0; }

    private static void render(GuiGraphicsExtractor graphics, DeltaTracker delta) {
        Minecraft client = Minecraft.getInstance();
        if (client.player == null) return;
        renderElements(graphics, client, false);
    }

    static void renderEditor(GuiGraphicsExtractor graphics) { renderElements(graphics, Minecraft.getInstance(), true); }

    private static void renderElements(GuiGraphicsExtractor graphics, Minecraft client, boolean editor) {
        for (HudConfig.Element element : config.elements) {
            if (!element.enabled && !editor) continue;
            String text = text(element.id, client, editor);
            if (text == null || text.isBlank()) continue;
            float scale = Math.max(0.5f, Math.min(2.5f, element.scale));
            int width = client.font.width(text) + 8;
            graphics.pose().pushMatrix();
            graphics.pose().translate(element.x, element.y);
            graphics.pose().scale(scale);
            if (element.showBackground) graphics.fill(0, 0, width, 17, element.background);
            if (editor && !element.enabled) graphics.fill(0, 0, width, 17, 0x77402040);
            graphics.text(client.font, text, 4, 4, element.enabled ? element.color : 0xFF8A828A, true);
            graphics.pose().popMatrix();
        }
    }

    static String text(String id, Minecraft client, boolean sample) {
        if (sample && client.player == null) return switch (id) {
            case "fps" -> "144 FPS"; case "cps" -> "7 CPS"; case "keystrokes" -> "W A S D | LMB RMB";
            case "coordinates" -> "XYZ 128 / 64 / -32"; case "direction" -> "North (N)"; case "armor" -> "Armor 4/4";
            case "potions" -> "Effects 2"; case "ping" -> "32 ms"; case "server" -> "friends.local:25565";
            case "clock" -> "12:34:56"; case "stopwatch" -> "Timer 02:17"; case "memory" -> "Memory 42%";
            case "frametime" -> "Frame 6.9 ms"; case "profile" -> "Profile: Performance"; default -> id;
        };
        if (client.player == null) return "";
        return switch (id) {
            case "fps" -> client.getFps() + " FPS";
            case "cps" -> CLICKS.size() + " CPS";
            case "keystrokes" -> key(client.options.keyUp.isDown(), "W") + " " + key(client.options.keyLeft.isDown(), "A") + " " + key(client.options.keyDown.isDown(), "S") + " " + key(client.options.keyRight.isDown(), "D") + " | " + key(client.options.keyAttack.isDown(), "LMB");
            case "coordinates" -> String.format(Locale.ROOT, "XYZ %.1f / %.1f / %.1f", client.player.getX(), client.player.getY(), client.player.getZ());
            case "direction" -> client.player.getDirection().getName().toUpperCase(Locale.ROOT) + " (" + client.player.getDirection().getSerializedName().substring(0, 1).toUpperCase(Locale.ROOT) + ")";
            case "armor" -> armor(client);
            case "potions" -> "Effects " + client.player.getActiveEffects().size();
            case "ping" -> ping(client) + " ms";
            case "server" -> client.getCurrentServer() == null ? "Singleplayer" : client.getCurrentServer().ip;
            case "clock" -> LocalTime.now().format(CLOCK);
            case "stopwatch" -> stopwatchStarted == 0 ? "Timer stopped" : "Timer " + duration(System.currentTimeMillis() - stopwatchStarted);
            case "memory" -> memory();
            case "frametime" -> String.format(Locale.ROOT, "Frame %.1f ms", 1000.0 / Math.max(1, client.getFps()));
            case "profile" -> "Profile: " + System.getProperty("swirl.profile.name", "Swirl");
            default -> "";
        };
    }

    private static String key(boolean down, String name) { return down ? "[" + name + "]" : name; }
    private static int ping(Minecraft client) { PlayerInfo info = client.getConnection() == null ? null : client.getConnection().getPlayerInfo(client.player.getUUID()); return info == null ? 0 : info.getLatency(); }
    private static String armor(Minecraft client) { int used = 0; for (EquipmentSlot slot : new EquipmentSlot[] { EquipmentSlot.HEAD, EquipmentSlot.CHEST, EquipmentSlot.LEGS, EquipmentSlot.FEET }) { ItemStack stack = client.player.getItemBySlot(slot); if (!stack.isEmpty()) used++; } return "Armor " + used + "/4"; }
    private static String memory() { Runtime runtime = Runtime.getRuntime(); long used = runtime.totalMemory() - runtime.freeMemory(); return "Memory " + Math.round(used * 100.0 / runtime.maxMemory()) + "%"; }
    private static String duration(long millis) { long seconds = millis / 1000; return String.format(Locale.ROOT, "%02d:%02d", seconds / 60, seconds % 60); }
}
