package app.swirl.client;

import com.google.gson.JsonObject;
import com.google.gson.JsonParser;

final class AppearancePresetCodec {
    private static final int MAX_LENGTH = 65_536;
    private static final String KIND = "swirl-appearance";

    private AppearancePresetCodec() {}

    static String encode(HudConfig.AppearancePreset preset) {
        JsonObject root = new JsonObject();
        root.addProperty("kind", KIND);
        root.addProperty("version", 1);
        root.add("preset", HudConfig.GSON.toJsonTree(preset));
        String value = HudConfig.GSON.toJson(root);
        if (value.length() > MAX_LENGTH) throw new IllegalArgumentException("Appearance preset is too large.");
        return value;
    }

    static HudConfig.AppearancePreset decode(String value) {
        if (value == null || value.isBlank() || value.length() > MAX_LENGTH) throw new IllegalArgumentException("Invalid appearance preset size.");
        JsonObject root = JsonParser.parseString(value).getAsJsonObject();
        if (!root.has("kind") || !KIND.equals(root.get("kind").getAsString()) || root.get("version").getAsInt() != 1)
            throw new IllegalArgumentException("Unsupported appearance preset.");
        HudConfig.AppearancePreset preset = HudConfig.GSON.fromJson(root.get("preset"), HudConfig.AppearancePreset.class);
        if (preset == null || preset.name == null || preset.name.isBlank() || preset.name.length() > 32)
            throw new IllegalArgumentException("Invalid preset name.");
        if (preset.modules == null || preset.modules.size() > ModuleRegistry.MODULES.size())
            throw new IllegalArgumentException("Invalid module appearance collection.");
        preset.modules.keySet().removeIf(id -> ModuleRegistry.byId(id) == null);
        return preset;
    }
}
