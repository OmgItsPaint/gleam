package app.swirl.client;

import java.util.List;
import java.util.Set;
import java.util.function.Supplier;

final class ModuleRegistry {
    enum Category { HUD, WORLD, SYSTEM, VISUAL }
    enum Kind { HUD, VISUAL, CONTROL, PERFORMANCE, NAVIGATION, ACCESSIBILITY }
    enum RuntimeHook { HUD, LIGHTING, CAMERA, GUI, WORLD, OVERLAY, NONE }
    enum Compatibility { AVAILABLE, SHADER_CONFLICT, RESOURCE_PACK_CONFLICT, UNSUPPORTED_VERSION, TEMPORARILY_DISABLED }

    record Module(String id, String title, String description, Category category, Kind kind,
                  String icon, RuntimeHook runtimeHook, boolean draggable,
                  String searchTerms, Supplier<HudConfig.Options> settingsFactory) {
        HudConfig.Options newSettings() { return settingsFactory.get(); }
    }

    private static Module hud(String id, String title, String description, Category category, String terms) {
        return new Module(id, title, description, category, Kind.HUD, id, RuntimeHook.HUD, true, terms, HudConfig.Options::new);
    }

    private static Module visual(String id, String title, String description, RuntimeHook hook, String terms) {
        return new Module(id, title, description, Category.VISUAL, Kind.VISUAL, id, hook, false, terms, HudConfig.Options::new);
    }

    private static Module control(String id, String title, String description, String terms) {
        return new Module(id, title, description, Category.HUD, Kind.CONTROL, id, RuntimeHook.HUD, true, terms, HudConfig.Options::new);
    }

    static final List<Module> MODULES = List.of(
        hud("fps", "FPS", "Live rendered frames per second.", Category.SYSTEM, "suffix brackets static width refresh performance"),
        hud("cps", "Clicks per second", "Left and right clicks from the last second.", Category.HUD, "left right clicks label separator rolling window mouse"),
        hud("keystrokes", "Keystrokes", "WASD, mouse CPS, and jump input display.", Category.HUD, "wasd movement mouse cps space arrows fade padding gap border pressed color"),
        hud("coordinates", "Coordinates", "Your world position with configurable precision.", Category.WORLD, "xyz precision compact nether overworld conversion movement signs"),
        hud("direction", "Direction", "Compact heading or scrolling compass ribbon.", Category.WORLD, "compass ribbon intercardinal degrees heading"),
        hud("armor", "Armor status", "Armor items with remaining durability.", Category.HUD, "horizontal reverse durability percent remaining bar warning"),
        hud("potions", "Potion effects", "Every active effect, amplifier, and remaining time.", Category.HUD, "effects icons names amplifiers timers sorting expiring"),
        hud("ping", "Ping", "Current multiplayer connection latency.", Category.SYSTEM, "latency refresh suffix quality thresholds good warning bad"),
        hud("server", "Server", "Current server or singleplayer.", Category.SYSTEM, "address name port singleplayer privacy mask label"),
        hud("clock", "Clock", "Local real-world time.", Category.HUD, "12 24 hour seconds date local utc"),
        hud("stopwatch", "Stopwatch", "Keybind-controlled session timer.", Category.HUD, "timer start pause reset keybind format tenths prefix"),
        hud("memory", "Memory", "Java heap usage.", Category.SYSTEM, "ram heap percent used maximum mib gib refresh"),
        hud("durability", "Durability", "Held-item durability remaining.", Category.HUD, "held item main hand offhand name damageable percent remaining bar warning"),
        hud("speed", "Movement speed", "Horizontal blocks per second.", Category.HUD, "movement horizontal 3d blocks second km h precision smoothing"),
        hud("biome", "Biome", "Biome at your position.", Category.WORLD, "friendly resource id namespace label refresh"),
        hud("players", "Player count", "Players visible on the connection.", Category.SYSTEM, "online maximum label multiplayer singleplayer"),
        hud("world_time", "World day & time", "Current world day and clock.", Category.WORLD, "world day clock zero one 12 24 hour seconds"),
        hud("target_block", "Target block", "Block under the crosshair.", Category.WORLD, "crosshair block resource id coordinates distance label"),
        hud("light", "Light level", "Local combined, block, or sky light.", Category.WORLD, "combined block sky level label"),
        control("toggle_sprint", "Toggle Sprint", "Persistent sprint without changing vanilla hold controls.", "toggle sprint run keybind active text icon flying"),
        control("toggle_sneak", "Toggle Sneak", "Persistent sneak without acting as Shift in menus.", "toggle sneak crouch keybind active text icon"),

        visual("fullbright", "Fullbright", "Local brightness without changing world light or packets.", RuntimeHook.LIGHTING, "gamma lightmap cave dark soft bright full darkness shader"),
        visual("zoom", "Zoom", "Smooth client camera FOV magnification.", RuntimeHook.CAMERA, "camera fov hold toggle sensitivity scroll"),
        visual("crosshair", "Crosshair", "Custom cross, dot, circle, or vanilla reticle.", RuntimeHook.GUI, "reticle cross dot circle size gap outline opacity chroma"),
        visual("block_outline", "Block Outline", "Customize the normally targeted block outline.", RuntimeHook.WORLD, "target block line color width opacity chroma"),
        visual("low_fire", "Low Fire", "Lower the first-person burning overlay.", RuntimeHook.OVERLAY, "fire flame overlay height opacity first person"),
        visual("low_shield", "Low Shield", "Lower the first-person blocking shield.", RuntimeHook.OVERLAY, "shield blocking overlay height opacity first person"),
        visual("damage_overlay", "Damage Overlay", "Customize the local hurt-screen flash.", RuntimeHook.GUI, "hurt damage flash tint color intensity warning"),
        visual("local_time", "Local Time", "Cosmetic client-only sky time presentation.", RuntimeHook.WORLD, "server fixed real world smooth day night cosmetic"),
        visual("local_weather", "Local Weather", "Cosmetic client-only rain and snow presentation.", RuntimeHook.WORLD, "server clear rain snow volume cosmetic"),
        visual("fog", "Fog Controls", "Atmospheric fog density and color presets.", RuntimeHook.WORLD, "atmosphere fog density color clear moody warm cool hazard")
    );
    private static final Set<String> RECOMMENDED = Set.of("fps", "keystrokes", "coordinates", "armor", "potions", "ping",
        "durability", "toggle_sprint", "toggle_sneak", "fullbright", "zoom", "crosshair", "low_fire");

    private ModuleRegistry() {}

    static Module byId(String id) {
        for (Module module : MODULES) if (module.id().equals(id)) return module;
        return null;
    }

    static String searchTerms(String id) {
        Module module = byId(id);
        return module == null ? "" : module.searchTerms();
    }

    static boolean recommended(String id) { return RECOMMENDED.contains(id); }
}
