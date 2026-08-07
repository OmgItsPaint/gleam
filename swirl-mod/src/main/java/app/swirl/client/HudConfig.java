package app.swirl.client;

import com.google.gson.Gson;
import com.google.gson.GsonBuilder;
import net.minecraft.client.Minecraft;

import java.nio.charset.StandardCharsets;
import java.nio.file.Files;
import java.nio.file.Path;
import java.nio.file.StandardCopyOption;
import java.util.ArrayList;
import java.util.LinkedHashMap;
import java.util.List;
import java.util.Map;

final class HudConfig {
    static final Gson GSON = new GsonBuilder().setPrettyPrinting().create();
    static final int[] COLORS = { 0xFFFFFFFF, 0xFFD89BD2, 0xFF9BE7FF, 0xFFA8F0B0, 0xFFFFD37A };
    int format = 1;
    List<Element> elements = defaults();
    boolean zoom = true;
    int zoomFov = 30;

    static final class Element {
        String id;
        int x;
        int y;
        boolean enabled;
        float scale;
        int color;
        int background;
        boolean showBackground;

        Element() {}
        Element(String id, int x, int y, boolean enabled) {
            this.id = id; this.x = x; this.y = y; this.enabled = enabled;
            this.scale = 1.0f; this.color = COLORS[0]; this.background = 0xA8000000; this.showBackground = true;
        }
    }

    private static List<Element> defaults() {
        List<Element> values = new ArrayList<>();
        values.add(new Element("fps", 8, 8, true));
        values.add(new Element("cps", 8, 30, true));
        values.add(new Element("keystrokes", 8, 52, true));
        values.add(new Element("coordinates", 8, 74, true));
        values.add(new Element("direction", 8, 96, true));
        values.add(new Element("armor", 8, 118, false));
        values.add(new Element("potions", 8, 140, false));
        values.add(new Element("ping", 8, 162, true));
        values.add(new Element("server", 8, 184, false));
        values.add(new Element("clock", 8, 206, false));
        values.add(new Element("stopwatch", 8, 228, false));
        values.add(new Element("memory", 8, 250, false));
        values.add(new Element("frametime", 8, 272, false));
        values.add(new Element("profile", 8, 294, false));
        return values;
    }

    private static Path file() {
        return Minecraft.getInstance().gameDirectory.toPath().resolve("config").resolve("swirl-hud.json");
    }

    static HudConfig load() {
        try {
            HudConfig loaded = GSON.fromJson(Files.readString(file(), StandardCharsets.UTF_8), HudConfig.class);
            if (loaded == null) return new HudConfig();
            Map<String, Element> existing = new LinkedHashMap<>();
            if (loaded.elements != null) for (Element element : loaded.elements) if (element != null && element.id != null) existing.put(element.id, element);
            List<Element> merged = defaults();
            for (int index = 0; index < merged.size(); index++) {
                Element saved = existing.get(merged.get(index).id);
                if (saved != null) { saved.scale = Math.max(0.5f, Math.min(2.5f, saved.scale)); merged.set(index, saved); }
            }
            loaded.elements = merged;
            return loaded;
        } catch (Exception ignored) {
            return new HudConfig();
        }
    }

    void save() {
        try {
            Path target = file(); Files.createDirectories(target.getParent());
            Path temporary = target.resolveSibling(target.getFileName() + ".tmp");
            Files.writeString(temporary, GSON.toJson(this), StandardCharsets.UTF_8);
            try { Files.move(temporary, target, StandardCopyOption.REPLACE_EXISTING, StandardCopyOption.ATOMIC_MOVE); }
            catch (Exception ignored) { Files.move(temporary, target, StandardCopyOption.REPLACE_EXISTING); }
        } catch (Exception ignored) {}
    }
}
