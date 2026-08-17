package app.swirl.client;

import com.google.gson.Gson;
import com.google.gson.GsonBuilder;
import com.google.gson.JsonElement;
import com.google.gson.JsonObject;
import com.google.gson.JsonParser;
import net.minecraft.client.Minecraft;

import java.nio.charset.StandardCharsets;
import java.nio.file.Files;
import java.nio.file.Path;
import java.nio.file.StandardCopyOption;
import java.lang.reflect.Field;
import java.util.ArrayList;
import java.util.LinkedHashMap;
import java.util.LinkedHashSet;
import java.util.List;
import java.util.Map;
import java.util.Set;

final class HudConfig {
    enum PresetScope { ALL, HUD, VISUAL, SELECTED }
    static final Gson GSON = new GsonBuilder().setPrettyPrinting().create();
    static final int[] COLORS = { 0xFFFFFFFF, 0xFFD89BD2, 0xFF9BE7FF, 0xFFA8F0B0, 0xFFFFD37A };
    int format = 6;
    List<Element> elements = defaults();
    Set<String> favorites = new LinkedHashSet<>();
    General general = new General();
    Bindings bindings = new Bindings();
    VisualSettings visuals = new VisualSettings();
    InterfaceTheme interfaceTheme = new InterfaceTheme();
    Appearance appearanceDefaults = Appearance.defaults();
    List<AppearancePreset> appearancePresets = new ArrayList<>();
    List<LayoutPreset> layoutPresets = new ArrayList<>();
    transient JsonObject unknownRoot = new JsonObject();
    // Reserved for the future movement module; retained so old configs never lose these values.
    boolean zoom = true;
    int zoomFov = 30;

    static final class General {
        int menuScale = 100;
        int dimStrength = 58;
        int snapSize = 2;
        int backgroundOpacity = 66;
        boolean textShadow = true;
        boolean hideInDebug = true;
        boolean clock24Hour = true;
        int coordinatePrecision = 1;
        boolean reducedMotion;
    }

    static final class InterfaceTheme {
        int accentMode;
        int accentColor = 0xFFBD78B3;
        int secondaryAccent = 0xFFD89BD2;
        int accentSpeed = 5;
        int panelOpacity = 95;
        int cardDensity = 1;
        int iconSize = 72;
        int focusStrength = 100;
        int backdropStyle;
    }

    static final class Appearance {
        Integer colorMode;
        Integer primaryColor;
        Integer secondaryColor;
        Integer labelColor;
        Integer valueColor;
        Integer iconColor;
        Integer barColor;
        Integer warningColor;
        Integer criticalColor;
        Integer opacity;
        Integer gradientAngle;
        Integer chromaDirection;
        Integer chromaSpeed;
        Integer chromaSpread;
        Integer chromaSaturation;
        Integer chromaBrightness;
        Integer animationPhase;
        Integer backgroundColor;
        Integer backgroundOpacity;
        Integer borderColor;
        Integer borderOpacity;
        Integer borderWidth;
        Integer paddingX;
        Integer paddingY;
        Integer itemGap;
        Integer alignment;
        Integer textScale;
        Integer casing;
        Boolean textShadow;
        Integer shadowColor;
        Integer shadowOffset;
        Integer shadowOpacity;
        Boolean hideInDebug;
        Boolean hideInChat;
        Boolean hideInScreens;
        Boolean hideInSpectator;
        Boolean hideInScreenshots;
        Boolean hideWhenEmpty;
        Integer transition;
        Integer transitionMillis;

        static Appearance defaults() {
            Appearance value = new Appearance();
            value.colorMode = 0; value.primaryColor = 0xFFFFFFFF; value.secondaryColor = 0xFFD89BD2;
            value.labelColor = 0xFFFFFFFF; value.valueColor = 0xFFFFFFFF; value.iconColor = 0xFFFFFFFF;
            value.barColor = 0xFFD89BD2; value.warningColor = 0xFFFFD37A; value.criticalColor = 0xFFFF5C6C;
            value.opacity = 100; value.gradientAngle = 0; value.chromaDirection = 0; value.chromaSpeed = 5;
            value.chromaSpread = 50; value.chromaSaturation = 82; value.chromaBrightness = 100; value.animationPhase = 0;
            value.backgroundColor = 0xFF000000; value.backgroundOpacity = 66; value.borderColor = 0xFFD89BD2;
            value.borderOpacity = 0; value.borderWidth = 0; value.paddingX = 4; value.paddingY = 4; value.itemGap = 2;
            value.alignment = 0; value.textScale = 100; value.casing = 0; value.textShadow = true;
            value.shadowColor = 0xFF000000; value.shadowOffset = 1; value.shadowOpacity = 75;
            value.hideInDebug = true; value.hideInChat = false; value.hideInScreens = true; value.hideInSpectator = false;
            value.hideInScreenshots = false; value.hideWhenEmpty = true; value.transition = 0; value.transitionMillis = 150;
            return value;
        }
    }

    static final class AppearancePreset {
        String name = "Preset";
        int version = 1;
        InterfaceTheme interfaceTheme = new InterfaceTheme();
        Appearance defaults = Appearance.defaults();
        Map<String, Appearance> modules = new LinkedHashMap<>();
    }

    static final class LayoutPreset {
        String name = "Layout";
        int version = 1;
        Map<String, LayoutEntry> modules = new LinkedHashMap<>();
    }

    static final class LayoutEntry {
        float xRatio;
        float yRatio;
        float scale = 1.0f;
        boolean enabled;
    }

    static final class Bindings {
        String openMenu = "key.keyboard.right.shift";
        String hostManager = "key.keyboard.unknown";
        String stopwatchToggle = "key.keyboard.unknown";
        String stopwatchReset = "key.keyboard.unknown";
        String toggleSprint = "key.keyboard.left.control";
        String toggleSneak = "key.keyboard.left.shift";
        String fullbrightToggle = "key.keyboard.unknown";
        String zoom = "key.keyboard.c";
    }

    static final class VisualSettings {
        int fullbrightMode = 1;
        int fullbrightIntensity = 75;
        boolean preserveDarkness = true;
        int fullbrightCustomGamma = 8;
        int fullbrightTransitionMillis = 250;
        int fullbrightDimensions = 7;
        int zoomMode;
        int zoomFov = 30;
        boolean zoomSmooth = true;
        int zoomSensitivity = 50;
        boolean zoomScroll = true;
        int zoomMinFov = 10;
        int zoomMaxFov = 70;
        int zoomScrollStep = 2;
        boolean zoomReverseScroll;
        int zoomEasing = 1;
        int zoomDurationMillis = 180;
        boolean zoomCinematic;
        int crosshairMode;
        int crosshairSize = 7;
        int crosshairGap = 3;
        int crosshairThickness = 1;
        boolean crosshairOutline = true;
        int crosshairOpacity = 100;
        int crosshairColor = 0xFFFFFFFF;
        boolean crosshairChroma;
        boolean crosshairHideThirdPerson = true;
        boolean crosshairCenterDot;
        int crosshairRotation;
        int crosshairExpansion;
        int blockOutlineColor = 0xFF000000;
        int blockOutlineOpacity = 40;
        int blockOutlineWidth = 2;
        boolean blockOutlineChroma;
        int blockOutlinePulse;
        int blockFaceOpacity;
        int lowFireHeight = 45;
        int lowFireOpacity = 75;
        int lowFireX;
        int lowFireScale = 100;
        int lowFireTransitionMillis = 150;
        int lowFireSafetyMinimum = 25;
        int lowShieldHeight = 45;
        int lowShieldOpacity = 100;
        int lowShieldX;
        int lowShieldScale = 100;
        int lowShieldTransitionMillis = 150;
        int lowShieldSafetyMinimum = 25;
        int damageColor = 0xFFFF3030;
        int damageIntensity = 35;
        boolean damageSafetyMinimum = true;
        int damageStyle;
        int damageCurve;
        int damageTiltReduction;
        int localTimeMode;
        int fixedTime = 6000;
        int realTimeOffsetMinutes;
        int localTimeCycleMinutes = 20;
        int localTimeTransitionMillis = 500;
        int localTimeDimensions = 7;
        int localWeatherMode;
        int weatherVolume = 60;
        int weatherSplashDensity = 60;
        int weatherOpacity = 100;
        int weatherSoundVolume = 100;
        int weatherTransitionMillis = 500;
        int weatherDimensions = 7;
        int fogDensity = 100;
        int fogColorMode;
        int fogStart = 0;
        int fogEnd = 100;
        int fogColor = 0xFFB8C4D8;
        int fogBiomeBlend = 100;
        int fogTransitionMillis = 500;
        int fogDimensions = 7;
    }

    static final class Element {
        String id;
        int x;
        int y;
        float xRatio = -1.0f;
        float yRatio = -1.0f;
        boolean enabled;
        float scale;
        int color;
        int background;
        boolean showBackground;
        boolean chroma;
        int chromaSpeed = 5;
        Options options = new Options();
        Appearance appearance = new Appearance();

        Element() {}
        Element(String id, int x, int y, boolean enabled) {
            this.id = id;
            this.x = x;
            this.y = y;
            this.enabled = enabled;
            this.scale = 1.0f;
            this.color = COLORS[0];
            this.background = 0xA8000000;
            this.showBackground = true;
        }
    }

    static final class Options {
        String customLabel = "";
        String customSuffix = "";
        boolean hideZero;
        boolean showMinimum;
        boolean showAverage;
        boolean showMaximum;
        int smoothingMillis;
        int layoutMode;
        boolean showSuffix = true;
        boolean showBrackets;
        boolean staticWidth;
        int refreshMillis;
        boolean showLeftCps = true;
        boolean showRightCps = true;
        boolean showCpsLabel = true;
        int cpsWindowMillis = 1000;
        int separatorStyle;
        boolean showMouse = true;
        boolean showMouseCps = true;
        boolean showMovement = true;
        boolean showSpace = true;
        boolean useArrows;
        int keyFadeMillis = 120;
        int keyGap = 2;
        int borderWidth = 1;
        int pressedColor = 0xFFD89BD2;
        int idleColor = 0x99000000;
        int keyWidth = 20;
        int keyHeight = 20;
        int spaceWidth = 64;
        int keyPadding = 2;
        int fadeEasing = 1;
        boolean horizontal;
        boolean reverseOrder;
        boolean sortEffectsByDuration = true;
        boolean showDurability = true;
        boolean showItemName = true;
        boolean compassRibbon = true;
        boolean showIntercardinal = true;
        boolean showDegrees;
        int coordinatePrecision = 1;
        boolean compactCoordinates;
        boolean showNetherConversion;
        boolean showMovementSigns;
        int durabilityMode = 1;
        int warningThreshold = 15;
        int warningColor = 0xFFFF5C6C;
        boolean showPotionIcons = true;
        boolean showPotionNames = true;
        boolean showPotionAmplifiers = true;
        boolean showPotionTimers = true;
        boolean sortEffectsByName;
        int expiringSeconds = 10;
        int maximumEntries = 12;
        int effectFilter;
        boolean qualityColors;
        int pingGood = 80;
        int pingWarn = 160;
        boolean showPort = true;
        boolean hideSingleplayer;
        boolean privacyMask;
        boolean clock24Hour = true;
        boolean showSeconds = true;
        boolean showDate;
        boolean utcTime;
        int stopwatchFormat;
        boolean stopwatchTenths;
        boolean stopwatchHundredths;
        boolean stopwatchCountdown;
        int stopwatchDurationSeconds = 300;
        boolean stopwatchCompletionSound;
        int stopwatchAutoStart;
        String prefix = "";
        int memoryMode;
        boolean memoryGib;
        int handMode;
        boolean damageableOnly;
        int speedMode;
        int speedUnit;
        int precision = 1;
        int smoothingTicks = 5;
        boolean resourceId;
        boolean showNamespace;
        boolean showMaxPlayers = true;
        boolean showDay = true;
        boolean showWorldClock = true;
        boolean dayStartsAtOne = true;
        boolean showTargetCoordinates;
        boolean showTargetDistance;
        int lightMode;
        boolean showLabel = true;
        boolean sprintEnabled = true;
        boolean sneakEnabled = true;
        int toggleHudMode;
        boolean activeOnly = true;
        String sprintText = "Sprinting (Toggled)";
        String sneakText = "Sneaking (Toggled)";
        String flyingText = "Flying";
        String inactiveText = "";
        int activeColor = 0xFFFFFFFF;
        int inactiveColor = 0xFFAAAAAA;
        boolean toggleNotification;
    }

    private static List<Element> defaults() {
        List<Element> values = new ArrayList<>();
        for (int index = 0; index < ModuleRegistry.MODULES.size(); index++) {
            ModuleRegistry.Module module = ModuleRegistry.MODULES.get(index);
            Element element = new Element(module.id(), 8, 8, false);
            if (index < 6) {
                element.xRatio = 0.03f + index * 0.19f;
                element.yRatio = 0.04f;
            } else if (index < 11) {
                element.xRatio = 0.96f;
                element.yRatio = 0.22f + (index - 6) * 0.14f;
            } else if (index < 16) {
                element.xRatio = 0.82f - (index - 11) * 0.19f;
                element.yRatio = 0.94f;
            } else {
                element.xRatio = 0.03f;
                element.yRatio = 0.78f - (index - 16) * 0.14f;
            }
            values.add(element);
        }
        return values;
    }

    static Path file() {
        return Minecraft.getInstance().gameDirectory.toPath().resolve("config").resolve("swirl-hud.json");
    }

    static HudConfig load() { return load(file()); }

    static HudConfig load(Path source) {
        try {
            return loadJson(Files.readString(source, StandardCharsets.UTF_8));
        } catch (Exception ignored) { }
        try { return loadJson(Files.readString(source.resolveSibling(source.getFileName() + ".bak"), StandardCharsets.UTF_8)); }
        catch (Exception ignored) { return new HudConfig(); }
    }

    private static HudConfig loadJson(String json) {
        JsonObject root = JsonParser.parseString(json).getAsJsonObject();
        HudConfig value = sanitize(GSON.fromJson(root, HudConfig.class));
        JsonObject unknown = root.deepCopy();
        for (String key : List.of("format", "elements", "favorites", "general", "bindings", "visuals", "interfaceTheme",
            "appearanceDefaults", "appearancePresets", "layoutPresets", "zoom", "zoomFov")) unknown.remove(key);
        value.unknownRoot = unknown;
        return value;
    }

    private static HudConfig sanitize(HudConfig loaded) {
        if (loaded == null) return new HudConfig();
        Map<String, Element> existing = new LinkedHashMap<>();
        if (loaded.elements != null) {
            for (Element element : loaded.elements) {
                if (element != null && ModuleRegistry.byId(element.id) != null) existing.put(element.id, element);
            }
        }
        boolean splitLegacyToggle = existing.containsKey("toggle_sprint") && !existing.containsKey("toggle_sneak");
        List<Element> merged = defaults();
        for (int index = 0; index < merged.size(); index++) {
            Element saved = existing.get(merged.get(index).id);
            if (saved == null) continue;
            saved.scale = clamp(saved.scale == 0 ? 1.0f : saved.scale, 0.5f, 2.5f);
            saved.xRatio = validRatio(saved.xRatio) ? saved.xRatio : -1.0f;
            saved.yRatio = validRatio(saved.yRatio) ? saved.yRatio : -1.0f;
            if (saved.options == null) saved.options = new Options();
            if (saved.appearance == null) saved.appearance = new Appearance();
            saved.chromaSpeed = clamp(saved.chromaSpeed == 0 ? 5 : saved.chromaSpeed, 1, 10);
            saved.options.cpsWindowMillis = validCpsWindow(saved.options.cpsWindowMillis) ? saved.options.cpsWindowMillis : 1000;
            saved.options.coordinatePrecision = clamp(saved.options.coordinatePrecision, 0, 3);
            saved.options.warningThreshold = clamp(saved.options.warningThreshold, 1, 100);
            saved.options.pingGood = clamp(saved.options.pingGood, 1, 999);
            saved.options.pingWarn = clamp(saved.options.pingWarn, saved.options.pingGood, 2000);
            saved.options.precision = clamp(saved.options.precision, 0, 3);
            saved.options.smoothingMillis = clamp(saved.options.smoothingMillis, 0, 5000);
            saved.options.layoutMode = clamp(saved.options.layoutMode, 0, 2);
            saved.options.keyWidth = clamp(saved.options.keyWidth, 12, 48);
            saved.options.keyHeight = clamp(saved.options.keyHeight, 12, 48);
            saved.options.spaceWidth = clamp(saved.options.spaceWidth, 24, 144);
            saved.options.keyPadding = clamp(saved.options.keyPadding, 0, 12);
            saved.options.fadeEasing = clamp(saved.options.fadeEasing, 0, 3);
            saved.options.maximumEntries = clamp(saved.options.maximumEntries, 1, 32);
            saved.options.effectFilter = clamp(saved.options.effectFilter, 0, 3);
            saved.options.stopwatchDurationSeconds = clamp(saved.options.stopwatchDurationSeconds, 1, 359999);
            saved.options.stopwatchAutoStart = clamp(saved.options.stopwatchAutoStart, 0, 3);
            merged.set(index, saved);
        }
        if (splitLegacyToggle) {
            Element sprint = find(merged, "toggle_sprint");
            Element sneakDefault = find(merged, "toggle_sneak");
            if (sprint != null && sneakDefault != null) {
                boolean combinedEnabled = sprint.enabled;
                Element sneak = GSON.fromJson(GSON.toJson(sprint), Element.class);
                sneak.id = "toggle_sneak";
                sneak.enabled = combinedEnabled && sprint.options.sneakEnabled;
                sneak.yRatio = validRatio(sneak.yRatio) ? Math.min(1.0f, sneak.yRatio + 0.06f) : sneak.yRatio;
                sprint.enabled = combinedEnabled && sprint.options.sprintEnabled;
                for (int index = 0; index < merged.size(); index++) if ("toggle_sneak".equals(merged.get(index).id)) merged.set(index, sneak);
            }
        }
        loaded.elements = merged;
        loaded.favorites = loaded.favorites == null ? new LinkedHashSet<>() : new LinkedHashSet<>(loaded.favorites);
        if (splitLegacyToggle && loaded.favorites.contains("toggle_sprint")) loaded.favorites.add("toggle_sneak");
        loaded.favorites.removeIf(id -> ModuleRegistry.byId(id) == null);
        if (loaded.general == null) loaded.general = new General();
        if (loaded.bindings == null) loaded.bindings = new Bindings();
        if (loaded.visuals == null) loaded.visuals = new VisualSettings();
        if (loaded.interfaceTheme == null) loaded.interfaceTheme = new InterfaceTheme();
        if (loaded.appearanceDefaults == null) loaded.appearanceDefaults = Appearance.defaults();
        if (loaded.appearancePresets == null) loaded.appearancePresets = new ArrayList<>();
        if (loaded.layoutPresets == null) loaded.layoutPresets = new ArrayList<>();
        sanitizeBindings(loaded.bindings);
        loaded.general.menuScale = clamp(loaded.general.menuScale, 80, 120);
        loaded.general.dimStrength = clamp(loaded.general.dimStrength, 20, 85);
        loaded.general.snapSize = validSnap(loaded.general.snapSize) ? loaded.general.snapSize : 2;
        loaded.general.backgroundOpacity = clamp(loaded.general.backgroundOpacity, 0, 90);
        loaded.general.coordinatePrecision = clamp(loaded.general.coordinatePrecision, 0, 2);
        loaded.zoomFov = clamp(loaded.zoomFov, 10, 70);
        sanitizeVisuals(loaded.visuals);
        sanitizeTheme(loaded.interfaceTheme);
        sanitizeAppearance(loaded.appearanceDefaults, true);
        for (Element element : merged) sanitizeAppearance(element.appearance, false);
        loaded.appearancePresets.removeIf(value -> value == null || value.name == null || value.name.isBlank());
        if (loaded.appearancePresets.size() > 32) loaded.appearancePresets = new ArrayList<>(loaded.appearancePresets.subList(0, 32));
        for (AppearancePreset preset : loaded.appearancePresets) {
            if (preset.interfaceTheme == null) preset.interfaceTheme = new InterfaceTheme();
            if (preset.defaults == null) preset.defaults = Appearance.defaults();
            if (preset.modules == null) preset.modules = new LinkedHashMap<>();
            preset.modules.keySet().removeIf(id -> ModuleRegistry.byId(id) == null);
            sanitizeTheme(preset.interfaceTheme); sanitizeAppearance(preset.defaults, true);
            preset.modules.values().forEach(value -> sanitizeAppearance(value, false));
        }
        loaded.layoutPresets.removeIf(value -> value == null || value.name == null || value.name.isBlank());
        if (loaded.layoutPresets.size() > 32) loaded.layoutPresets = new ArrayList<>(loaded.layoutPresets.subList(0, 32));
        for (LayoutPreset preset : loaded.layoutPresets) {
            preset.name = preset.name.trim().substring(0, Math.min(32, preset.name.trim().length()));
            if (preset.modules == null) preset.modules = new LinkedHashMap<>();
            preset.modules.entrySet().removeIf(entry -> {
                ModuleRegistry.Module module = ModuleRegistry.byId(entry.getKey());
                return module == null || !module.draggable() || entry.getValue() == null;
            });
            for (LayoutEntry entry : preset.modules.values()) {
                entry.xRatio = validRatio(entry.xRatio) ? entry.xRatio : 0.0f;
                entry.yRatio = validRatio(entry.yRatio) ? entry.yRatio : 0.0f;
                entry.scale = clamp(entry.scale, 0.5f, 2.5f);
            }
        }
        if (loaded.format < 4) {
            Element clock = find(merged, "clock");
            Element coordinates = find(merged, "coordinates");
            if (clock != null) clock.options.clock24Hour = loaded.general.clock24Hour;
            if (coordinates != null) coordinates.options.coordinatePrecision = loaded.general.coordinatePrecision;
        }
        if (loaded.format < 6) {
            for (Element element : merged) {
                if (element.appearance == null) element.appearance = new Appearance();
                element.appearance.primaryColor = element.color;
                element.appearance.colorMode = element.chroma ? 2 : 0;
                element.appearance.chromaSpeed = element.chromaSpeed;
                element.appearance.backgroundColor = element.background | 0xFF000000;
                element.appearance.backgroundOpacity = element.showBackground ? Math.max(1, loaded.general.backgroundOpacity) : 0;
                element.appearance.textShadow = loaded.general.textShadow;
            }
        }
        loaded.format = 6;
        return loaded;
    }

    private static void sanitizeTheme(InterfaceTheme value) {
        value.accentMode = clamp(value.accentMode, 0, 2); value.accentSpeed = clamp(value.accentSpeed, 1, 10);
        value.panelOpacity = clamp(value.panelOpacity, 60, 100);
        value.cardDensity = value.cardDensity >= 75 ? (value.cardDensity >= 115 ? 2 : value.cardDensity <= 85 ? 0 : 1) : clamp(value.cardDensity, 0, 2);
        value.iconSize = clamp(value.iconSize, 48, 96); value.focusStrength = clamp(value.focusStrength, 50, 150);
        value.backdropStyle = clamp(value.backdropStyle, 0, 2);
    }

    private static void sanitizeAppearance(Appearance value, boolean fillDefaults) {
        if (value == null) return;
        Appearance defaults = Appearance.defaults();
        if (fillDefaults) mergeMissing(value, defaults);
        value.colorMode = boxedClamp(value.colorMode, 0, 2); value.opacity = boxedClamp(value.opacity, 0, 100);
        value.gradientAngle = boxedClamp(value.gradientAngle, 0, 359); value.chromaDirection = boxedClamp(value.chromaDirection, 0, 3);
        value.chromaSpeed = boxedClamp(value.chromaSpeed, 1, 10); value.chromaSpread = boxedClamp(value.chromaSpread, 1, 100);
        value.chromaSaturation = boxedClamp(value.chromaSaturation, 0, 100); value.chromaBrightness = boxedClamp(value.chromaBrightness, 10, 100);
        value.animationPhase = boxedClamp(value.animationPhase, 0, 359); value.backgroundOpacity = boxedClamp(value.backgroundOpacity, 0, 100);
        value.borderOpacity = boxedClamp(value.borderOpacity, 0, 100); value.borderWidth = boxedClamp(value.borderWidth, 0, 5);
        value.paddingX = boxedClamp(value.paddingX, 0, 16); value.paddingY = boxedClamp(value.paddingY, 0, 16);
        value.itemGap = boxedClamp(value.itemGap, 0, 16); value.alignment = boxedClamp(value.alignment, 0, 2);
        value.textScale = boxedClamp(value.textScale, 50, 200); value.casing = boxedClamp(value.casing, 0, 2);
        value.shadowOffset = boxedClamp(value.shadowOffset, 0, 4); value.shadowOpacity = boxedClamp(value.shadowOpacity, 0, 100);
        value.transition = boxedClamp(value.transition, 0, 4); value.transitionMillis = boxedClamp(value.transitionMillis, 0, 1000);
    }

    private static Integer boxedClamp(Integer value, int min, int max) { return value == null ? null : clamp(value, min, max); }
    private static void mergeMissing(Appearance target, Appearance fallback) {
        try {
            for (Field field : Appearance.class.getDeclaredFields())
                if (field.get(target) == null) field.set(target, field.get(fallback));
        } catch (ReflectiveOperationException error) { throw new IllegalStateException(error); }
    }

    private static void mergePresent(Appearance target, Appearance overrides) {
        if (overrides == null) return;
        try {
            for (Field field : Appearance.class.getDeclaredFields()) {
                Object value = field.get(overrides);
                if (value != null) field.set(target, value);
            }
        } catch (ReflectiveOperationException error) { throw new IllegalStateException(error); }
    }

    private static Element find(List<Element> elements, String id) {
        for (Element element : elements) if (id.equals(element.id)) return element;
        return null;
    }

    private static boolean validCpsWindow(int value) { return value == 500 || value == 1000 || value == 2000; }
    private static void sanitizeBindings(Bindings value) {
        if (value.openMenu == null) value.openMenu = "key.keyboard.right.shift";
        if (value.hostManager == null) value.hostManager = "key.keyboard.unknown";
        if (value.stopwatchToggle == null) value.stopwatchToggle = "key.keyboard.unknown";
        if (value.stopwatchReset == null) value.stopwatchReset = "key.keyboard.unknown";
        if (value.toggleSprint == null) value.toggleSprint = "key.keyboard.left.control";
        if (value.toggleSneak == null) value.toggleSneak = "key.keyboard.left.shift";
        if (value.fullbrightToggle == null) value.fullbrightToggle = "key.keyboard.unknown";
        if (value.zoom == null) value.zoom = "key.keyboard.c";
    }

    private static void sanitizeVisuals(VisualSettings value) {
        value.fullbrightMode = clamp(value.fullbrightMode, 0, 3);
        value.fullbrightIntensity = clamp(value.fullbrightIntensity, 0, 100);
        value.fullbrightCustomGamma = clamp(value.fullbrightCustomGamma, 1, 32);
        value.fullbrightTransitionMillis = clamp(value.fullbrightTransitionMillis, 0, 2000);
        value.fullbrightDimensions = clamp(value.fullbrightDimensions, 1, 7);
        value.zoomMode = clamp(value.zoomMode, 0, 1);
        value.zoomFov = clamp(value.zoomFov, 10, 70);
        value.zoomSensitivity = clamp(value.zoomSensitivity, 10, 100);
        value.zoomMinFov = clamp(value.zoomMinFov, 5, 70); value.zoomMaxFov = clamp(value.zoomMaxFov, value.zoomMinFov, 110);
        value.zoomScrollStep = clamp(value.zoomScrollStep, 1, 10); value.zoomEasing = clamp(value.zoomEasing, 0, 3);
        value.zoomDurationMillis = clamp(value.zoomDurationMillis, 0, 2000);
        value.crosshairMode = clamp(value.crosshairMode, 0, 3);
        value.crosshairSize = clamp(value.crosshairSize, 2, 20);
        value.crosshairGap = clamp(value.crosshairGap, 0, 12);
        value.crosshairThickness = clamp(value.crosshairThickness, 1, 4);
        value.crosshairOpacity = clamp(value.crosshairOpacity, 15, 100);
        value.crosshairRotation = Math.floorMod(value.crosshairRotation, 360); value.crosshairExpansion = clamp(value.crosshairExpansion, 0, 16);
        value.blockOutlineOpacity = clamp(value.blockOutlineOpacity, 10, 100);
        value.blockOutlineWidth = clamp(value.blockOutlineWidth, 1, 8);
        value.blockOutlinePulse = clamp(value.blockOutlinePulse, 0, 100); value.blockFaceOpacity = clamp(value.blockFaceOpacity, 0, 75);
        value.lowFireHeight = clamp(value.lowFireHeight, 20, 100);
        value.lowFireOpacity = clamp(value.lowFireOpacity, 25, 100);
        value.lowFireX = clamp(value.lowFireX, -100, 100); value.lowFireScale = clamp(value.lowFireScale, 50, 150);
        value.lowFireTransitionMillis = clamp(value.lowFireTransitionMillis, 0, 1000); value.lowFireSafetyMinimum = clamp(value.lowFireSafetyMinimum, 10, 50);
        value.lowShieldHeight = clamp(value.lowShieldHeight, 20, 100);
        value.lowShieldOpacity = clamp(value.lowShieldOpacity, 25, 100);
        value.lowShieldX = clamp(value.lowShieldX, -100, 100); value.lowShieldScale = clamp(value.lowShieldScale, 50, 150);
        value.lowShieldTransitionMillis = clamp(value.lowShieldTransitionMillis, 0, 1000); value.lowShieldSafetyMinimum = clamp(value.lowShieldSafetyMinimum, 10, 50);
        value.damageIntensity = clamp(value.damageIntensity, value.damageSafetyMinimum ? 10 : 0, 100);
        value.damageStyle = clamp(value.damageStyle, 0, 1); value.damageCurve = clamp(value.damageCurve, 0, 3);
        value.damageTiltReduction = clamp(value.damageTiltReduction, 0, 100);
        value.localTimeMode = clamp(value.localTimeMode, 0, 3);
        value.fixedTime = Math.floorMod(value.fixedTime, 24000);
        value.realTimeOffsetMinutes = clamp(value.realTimeOffsetMinutes, -720, 840); value.localTimeCycleMinutes = clamp(value.localTimeCycleMinutes, 1, 240);
        value.localTimeTransitionMillis = clamp(value.localTimeTransitionMillis, 0, 5000); value.localTimeDimensions = clamp(value.localTimeDimensions, 1, 7);
        value.localWeatherMode = clamp(value.localWeatherMode, 0, 3);
        value.weatherVolume = clamp(value.weatherVolume, 0, 100);
        value.weatherSplashDensity = clamp(value.weatherSplashDensity, 0, 100); value.weatherOpacity = clamp(value.weatherOpacity, 10, 100);
        value.weatherSoundVolume = clamp(value.weatherSoundVolume, 0, 100); value.weatherTransitionMillis = clamp(value.weatherTransitionMillis, 0, 5000);
        value.weatherDimensions = clamp(value.weatherDimensions, 1, 7);
        value.fogDensity = clamp(value.fogDensity, 25, 200);
        value.fogColorMode = clamp(value.fogColorMode, 0, 4);
        value.fogStart = clamp(value.fogStart, 0, 200); value.fogEnd = clamp(value.fogEnd, value.fogStart + 1, 300);
        value.fogBiomeBlend = clamp(value.fogBiomeBlend, 0, 100); value.fogTransitionMillis = clamp(value.fogTransitionMillis, 0, 5000);
        value.fogDimensions = clamp(value.fogDimensions, 1, 7);
    }

    private static boolean validRatio(float value) { return Float.isFinite(value) && value >= 0.0f && value <= 1.0f; }
    private static boolean validSnap(int value) { return value == 0 || value == 1 || value == 2 || value == 4 || value == 8; }
    private static int clamp(int value, int min, int max) { return Math.max(min, Math.min(max, value)); }
    private static float clamp(float value, float min, float max) { return Math.max(min, Math.min(max, value)); }

    Element element(String id) {
        for (Element element : elements) if (element.id.equals(id)) return element;
        return null;
    }

    void resetPlacement(String id) {
        Element element = element(id);
        if (element == null) return;
        for (Element value : defaults()) if (value.id.equals(id)) {
            element.x = value.x;
            element.y = value.y;
            element.xRatio = value.xRatio;
            element.yRatio = value.yRatio;
            return;
        }
    }

    Appearance resolvedAppearance(Element element) {
        Appearance value = new Appearance();
        mergePresent(value, appearanceDefaults);
        mergePresent(value, element == null ? null : element.appearance);
        return value;
    }

    Appearance resolvedAppearance(String id) { return resolvedAppearance(element(id)); }

    void clearAppearanceOverrides(String id) {
        Element element = element(id);
        if (element != null) element.appearance = new Appearance();
    }

    AppearancePreset captureAppearancePreset(String name) {
        AppearancePreset preset = new AppearancePreset();
        preset.name = name == null || name.isBlank() ? "Preset" : name.trim().substring(0, Math.min(32, name.trim().length()));
        preset.interfaceTheme = cloneValue(interfaceTheme, InterfaceTheme.class);
        preset.defaults = cloneValue(appearanceDefaults, Appearance.class);
        for (Element element : elements) if (element.appearance != null)
            preset.modules.put(element.id, cloneValue(element.appearance, Appearance.class));
        return preset;
    }

    void applyAppearancePreset(AppearancePreset preset, PresetScope scope, Set<String> selected) {
        if (preset == null) return;
        if (scope == PresetScope.ALL) {
            interfaceTheme = cloneValue(preset.interfaceTheme, InterfaceTheme.class);
            appearanceDefaults = cloneValue(preset.defaults, Appearance.class);
        }
        for (Element element : elements) {
            ModuleRegistry.Module module = ModuleRegistry.byId(element.id);
            boolean applies = switch (scope) {
                case ALL -> true;
                case HUD -> module != null && module.draggable();
                case VISUAL -> module != null && module.kind() == ModuleRegistry.Kind.VISUAL;
                case SELECTED -> selected != null && selected.contains(element.id);
            };
            if (applies && preset.modules.containsKey(element.id))
                element.appearance = cloneValue(preset.modules.get(element.id), Appearance.class);
        }
    }

    LayoutPreset captureLayoutPreset(String name) {
        LayoutPreset preset = new LayoutPreset();
        String clean = name == null ? "" : name.trim();
        preset.name = clean.isBlank() ? "Layout" : clean.substring(0, Math.min(32, clean.length()));
        for (Element element : elements) {
            ModuleRegistry.Module module = ModuleRegistry.byId(element.id);
            if (module == null || !module.draggable()) continue;
            LayoutEntry entry = new LayoutEntry();
            entry.xRatio = validRatio(element.xRatio) ? element.xRatio : 0.0f;
            entry.yRatio = validRatio(element.yRatio) ? element.yRatio : 0.0f;
            entry.scale = element.scale;
            entry.enabled = element.enabled;
            preset.modules.put(element.id, entry);
        }
        return preset;
    }

    void applyLayoutPreset(LayoutPreset preset) {
        if (preset == null || preset.modules == null) return;
        for (Element element : elements) {
            ModuleRegistry.Module module = ModuleRegistry.byId(element.id);
            LayoutEntry entry = preset.modules.get(element.id);
            if (module == null || !module.draggable() || entry == null) continue;
            element.xRatio = validRatio(entry.xRatio) ? entry.xRatio : element.xRatio;
            element.yRatio = validRatio(entry.yRatio) ? entry.yRatio : element.yRatio;
            element.scale = clamp(entry.scale, 0.5f, 2.5f);
            element.enabled = entry.enabled;
        }
    }

    private static <T> T cloneValue(T value, Class<T> type) {
        return value == null ? null : GSON.fromJson(GSON.toJson(value), type);
    }

    String snapshot() { return GSON.toJson(this); }

    void restore(String snapshot) {
        HudConfig value = sanitize(GSON.fromJson(snapshot, HudConfig.class));
        format = value.format; elements = value.elements; favorites = value.favorites; general = value.general;
        bindings = value.bindings; visuals = value.visuals; interfaceTheme = value.interfaceTheme;
        appearanceDefaults = value.appearanceDefaults; appearancePresets = value.appearancePresets;
        layoutPresets = value.layoutPresets;
        zoom = value.zoom; zoomFov = value.zoomFov;
    }

    int screenX(Element element, int screenWidth, int elementWidth) {
        int room = Math.max(0, screenWidth - elementWidth);
        return clamp(element.xRatio >= 0 ? Math.round(element.xRatio * room) : element.x, 0, room);
    }

    int screenY(Element element, int screenHeight, int elementHeight) {
        int room = Math.max(0, screenHeight - elementHeight);
        return clamp(element.yRatio >= 0 ? Math.round(element.yRatio * room) : element.y, 0, room);
    }

    void place(Element element, int x, int y, int screenWidth, int screenHeight, int elementWidth, int elementHeight) {
        int maxX = Math.max(0, screenWidth - elementWidth);
        int minY = 0;
        int maxY = Math.max(0, screenHeight - elementHeight);
        element.x = clamp(x, 0, maxX);
        element.y = clamp(y, minY, maxY);
        element.xRatio = maxX == 0 ? 0 : element.x / (float) maxX;
        element.yRatio = maxY == minY ? 0 : (element.y - minY) / (float) (maxY - minY);
    }

    void normalize(int screenWidth, int screenHeight, HudConfigMetrics metrics) {
        for (Element element : elements) {
            int elementWidth = metrics.width(element);
            int elementHeight = metrics.height(element);
            place(element, screenX(element, screenWidth, elementWidth), screenY(element, screenHeight, elementHeight),
                screenWidth, screenHeight, elementWidth, elementHeight);
        }
    }

    interface HudConfigMetrics {
        int width(Element element);
        int height(Element element);
    }

    void save() { save(file()); }

    void save(Path target) {
        try {
            Files.createDirectories(target.getParent());
            Path temporary = target.resolveSibling(target.getFileName() + ".tmp");
            JsonObject root = GSON.toJsonTree(this).getAsJsonObject();
            if (unknownRoot != null) for (var entry : unknownRoot.entrySet())
                if (!root.has(entry.getKey())) root.add(entry.getKey(), entry.getValue());
            Files.writeString(temporary, GSON.toJson(root), StandardCharsets.UTF_8);
            if (Files.exists(target)) Files.copy(target, target.resolveSibling(target.getFileName() + ".bak"), StandardCopyOption.REPLACE_EXISTING);
            try { Files.move(temporary, target, StandardCopyOption.REPLACE_EXISTING, StandardCopyOption.ATOMIC_MOVE); }
            catch (Exception ignored) { Files.move(temporary, target, StandardCopyOption.REPLACE_EXISTING); }
        } catch (Exception ignored) {}
    }
}
