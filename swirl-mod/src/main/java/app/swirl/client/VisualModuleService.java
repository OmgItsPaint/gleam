package app.swirl.client;

import net.fabricmc.fabric.api.client.rendering.v1.hud.HudElementRegistry;
import net.fabricmc.loader.api.FabricLoader;
import net.minecraft.client.DeltaTracker;
import net.minecraft.client.Minecraft;
import net.minecraft.client.OptionInstance;
import net.minecraft.client.gui.GuiGraphicsExtractor;
import net.minecraft.resources.Identifier;
import net.minecraft.world.effect.MobEffects;
import net.minecraft.world.level.material.FogType;
import net.minecraft.client.renderer.fog.FogData;
import org.joml.Vector4f;

import java.time.LocalTime;

public final class VisualModuleService {
    private static final Identifier HUD_ID = Identifier.fromNamespaceAndPath("swirl_client", "visual_overlays");
    private static boolean fullbrightToggled = true;
    private static boolean zoomHeld;
    private static boolean zoomToggled;
    private static float currentZoomFov = 70;
    private static double requestedZoomFov = Double.NaN;
    private static float vanillaZoomFov = 70;
    private static boolean zoomWasActive;
    private static double currentGamma = 1.0;

    private VisualModuleService() {}

    static void initialize() {
        HudElementRegistry.addLast(HUD_ID, VisualModuleService::renderOverlays);
    }

    static void tick(Minecraft client) {
        boolean active = zoomActive();
        if (!active) requestedZoomFov = settings().zoomFov;
        if (active && !zoomWasActive) {
            vanillaZoomFov = client.options == null ? 70 : client.options.fov().get();
            if (!Double.isFinite(requestedZoomFov)) requestedZoomFov = settings().zoomFov;
            currentZoomFov = vanillaZoomFov;
        }
        float target = active ? (float)requestedFov() : vanillaZoomFov;
        boolean immediate = SwirlHud.config().general.reducedMotion || !settings().zoomSmooth || settings().zoomDurationMillis == 0;
        currentZoomFov = (float)approachZoom(currentZoomFov, target, 0.05, settings().zoomDurationMillis, settings().zoomEasing, immediate);
        if (Math.abs(currentZoomFov - target) < 0.05f) currentZoomFov = target;
        zoomWasActive = active;
        double gammaTarget = fullbrightActive() ? fullbrightTarget() : (client.options == null ? 1.0 : rawGamma(client));
        if (settings().fullbrightTransitionMillis == 0) currentGamma = gammaTarget;
        else currentGamma += (gammaTarget - currentGamma) * Math.min(1.0, 50.0 / settings().fullbrightTransitionMillis);
    }

    public static boolean enabled(String id) {
        HudConfig.Element element = SwirlHud.config().element(id);
        return element != null && element.enabled;
    }

    public static ModuleRegistry.Compatibility compatibility(String id) {
        if ((id.equals("fullbright") || id.equals("fog")) && shaderPipelinePresent())
            return ModuleRegistry.Compatibility.SHADER_CONFLICT;
        return ModuleRegistry.Compatibility.AVAILABLE;
    }

    static String compatibilityLabel(String id) {
        return switch (compatibility(id)) {
            case AVAILABLE -> "AVAILABLE";
            case SHADER_CONFLICT -> "SHADER CONFLICT";
            case RESOURCE_PACK_CONFLICT -> "PACK CONFLICT";
            case UNSUPPORTED_VERSION -> "UNSUPPORTED";
            case TEMPORARILY_DISABLED -> "UNAVAILABLE";
        };
    }

    private static boolean shaderPipelinePresent() {
        FabricLoader loader = FabricLoader.getInstance();
        return loader.isModLoaded("iris") || loader.isModLoaded("oculus") || loader.isModLoaded("optifabric");
    }

    public static Object optionValue(OptionInstance<?> option, Object original) {
        Minecraft client = Minecraft.getInstance();
        if (client == null || client.options == null) return original;
        if (option == client.options.gamma() && fullbrightActive() && original instanceof Double value) {
            return Math.max(value, currentGamma);
        }
        if (option == client.options.fov() && zoomPresenting() && original instanceof Integer)
            return Math.max(5, Math.min(110, Math.round(currentZoomFov)));
        if (option == client.options.sensitivity() && zoomPresenting() && original instanceof Double value) {
            double fovRatio = Math.max(0.1, Math.min(1.0, currentZoomFov / Math.max(1.0, vanillaZoomFov)));
            return value * settings().zoomSensitivity / 100.0 * fovRatio;
        }
        return original;
    }

    private static boolean fullbrightActive() {
        if (!enabled("fullbright") || !fullbrightToggled || compatibility("fullbright") != ModuleRegistry.Compatibility.AVAILABLE || !dimensionEnabled(settings().fullbrightDimensions)) return false;
        Minecraft client = Minecraft.getInstance();
        if (settings().preserveDarkness && client.player != null &&
            (client.player.hasEffect(MobEffects.DARKNESS) || client.player.hasEffect(MobEffects.BLINDNESS))) return false;
        return true;
    }

    private static double fullbrightTarget() {
        double mode = switch (settings().fullbrightMode) { case 0 -> 1.0; case 2 -> 16.0; case 3 -> settings().fullbrightCustomGamma; default -> 4.0; };
        return 1.0 + (mode - 1.0) * settings().fullbrightIntensity / 100.0;
    }

    private static double rawGamma(Minecraft client) { return 1.0; }

    private static boolean dimensionEnabled(int mask) {
        Minecraft client = Minecraft.getInstance();
        if (client.level == null) return true;
        int bit = client.level.dimension().equals(net.minecraft.world.level.Level.NETHER) ? 2 :
            client.level.dimension().equals(net.minecraft.world.level.Level.END) ? 4 : 1;
        return (mask & bit) != 0;
    }

    public static boolean customCrosshair() {
        return enabled("crosshair") && settings().crosshairMode != 0 &&
            (!settings().crosshairHideThirdPerson || Minecraft.getInstance().options.getCameraType().isFirstPerson());
    }

    private static void renderOverlays(GuiGraphicsExtractor graphics, DeltaTracker delta) {
        Minecraft client = Minecraft.getInstance();
        if (client.player == null || ScreenBridge.hasOpenUi(client)) return;
        if (customCrosshair()) renderCrosshair(graphics);
        if (enabled("damage_overlay") && client.player.hurtTime > 0) {
            int intensity = settings().damageIntensity;
            if (settings().damageSafetyMinimum) intensity = Math.max(10, intensity);
            int alpha = Math.round(120 * intensity / 100.0f * client.player.hurtTime / Math.max(1.0f, client.player.hurtDuration));
            graphics.fill(0, 0, graphics.guiWidth(), graphics.guiHeight(), (Math.min(180, alpha) << 24) | (settings().damageColor & 0xFFFFFF));
        }
    }

    private static void renderCrosshair(GuiGraphicsExtractor graphics) {
        HudConfig.VisualSettings value = settings();
        int cx = graphics.guiWidth() / 2;
        int cy = graphics.guiHeight() / 2;
        int color = visualColor(value.crosshairColor, value.crosshairOpacity, value.crosshairChroma);
        int outline = (value.crosshairOpacity * 255 / 100 << 24);
        int size = value.crosshairSize;
        int expansion = 0;
        Minecraft client = Minecraft.getInstance();
        if (value.crosshairExpansion > 0 && client.player != null) {
            boolean moving = client.player.getDeltaMovement().horizontalDistanceSqr() > 0.0025;
            boolean attacking = client.options.keyAttack.isDown() || client.options.keyUse.isDown();
            if (moving || attacking) expansion = value.crosshairExpansion;
        }
        int gap = value.crosshairGap + expansion;
        int thickness = value.crosshairThickness;
        if (value.crosshairMode == 2) {
            if (value.crosshairOutline) graphics.fill(cx - thickness, cy - thickness, cx + thickness + 1, cy + thickness + 1, outline);
            graphics.fill(cx - Math.max(1, thickness - 1), cy - Math.max(1, thickness - 1), cx + thickness, cy + thickness, color);
            return;
        }
        if (value.crosshairMode == 3) {
            int radius = Math.max(2, size);
            for (int x = -radius; x <= radius; x++) {
                int y = Math.round((float) Math.sqrt(Math.max(0, radius * radius - x * x)));
                graphics.fill(cx + x, cy - y, cx + x + thickness, cy - y + thickness, color);
                graphics.fill(cx + x, cy + y, cx + x + thickness, cy + y + thickness, color);
            }
            if (value.crosshairCenterDot) graphics.fill(cx - thickness, cy - thickness, cx + thickness + 1, cy + thickness + 1, color);
            return;
        }
        if (value.crosshairOutline) {
            graphics.fill(cx - thickness - 1, cy - gap - size - 1, cx + thickness + 2, cy - gap + 1, outline);
            graphics.fill(cx - thickness - 1, cy + gap, cx + thickness + 2, cy + gap + size + 1, outline);
            graphics.fill(cx - gap - size - 1, cy - thickness - 1, cx - gap + 1, cy + thickness + 2, outline);
            graphics.fill(cx + gap, cy - thickness - 1, cx + gap + size + 1, cy + thickness + 2, outline);
        }
        graphics.fill(cx - thickness, cy - gap - size, cx + thickness + 1, cy - gap, color);
        graphics.fill(cx - thickness, cy + gap + 1, cx + thickness + 1, cy + gap + size + 1, color);
        graphics.fill(cx - gap - size, cy - thickness, cx - gap, cy + thickness + 1, color);
        graphics.fill(cx + gap + 1, cy - thickness, cx + gap + size + 1, cy + thickness + 1, color);
        if (value.crosshairCenterDot) graphics.fill(cx - thickness, cy - thickness, cx + thickness + 1, cy + thickness + 1, color);
    }

    public static int blockOutlineColor() {
        int opacity = settings().blockOutlineOpacity;
        if (settings().blockOutlinePulse > 0) {
            double wave = (Math.sin(System.nanoTime() / 350_000_000.0) + 1.0) * 0.5;
            opacity = Math.max(5, (int)Math.round(opacity * (1.0f - settings().blockOutlinePulse / 200.0f + wave * settings().blockOutlinePulse / 200.0f)));
        }
        return visualColor(settings().blockOutlineColor, opacity, settings().blockOutlineChroma);
    }

    public static float blockOutlineWidth(float vanilla) {
        return enabled("block_outline") ? settings().blockOutlineWidth : vanilla;
    }

    public static boolean lowFireActive() { return enabled("low_fire"); }
    public static float lowFireOffset() { return settings().lowFireHeight / 100.0f; }
    public static float lowFireX() { return settings().lowFireX / 100.0f; }
    public static float lowFireScale() { return settings().lowFireScale / 100.0f; }
    public static float lowFireOpacity(float vanilla) {
        return enabled("low_fire") ? vanilla * Math.max(settings().lowFireSafetyMinimum, settings().lowFireOpacity) / 100.0f : vanilla;
    }
    public static boolean lowShieldActive(net.minecraft.world.item.ItemStack stack) {
        Minecraft client = Minecraft.getInstance();
        return enabled("low_shield") && client.player != null && client.player.isUsingItem() &&
            stack != null && stack.is(net.minecraft.world.item.Items.SHIELD);
    }
    public static float lowShieldOffset() { return settings().lowShieldHeight / 100.0f; }
    public static float lowShieldX() { return settings().lowShieldX / 100.0f; }
    public static float lowShieldScale() { return settings().lowShieldScale / 100.0f; }

    private static int visualColor(int base, int opacity, boolean chroma) {
        int rgb = base & 0xFFFFFF;
        if (chroma) {
            float hue = (float) ((System.nanoTime() / 1_000_000_000.0 * 0.16) % 1.0);
            rgb = HudColors.hsvToRgb(hue, 0.82f, 1.0f) & 0xFFFFFF;
        }
        return (opacity * 255 / 100 << 24) | rgb;
    }

    public static void adjustFog(FogData fog, net.minecraft.client.Camera camera) {
        if (!enabled("fog") || compatibility("fog") != ModuleRegistry.Compatibility.AVAILABLE || fog == null || !dimensionEnabled(settings().fogDimensions)) return;
        FogType type = camera.getFluidInCamera();
        if (type == FogType.LAVA || type == FogType.POWDER_SNOW || type == FogType.WATER) return;
        Minecraft client = Minecraft.getInstance();
        if (client.player != null && (client.player.hasEffect(MobEffects.DARKNESS) || client.player.hasEffect(MobEffects.BLINDNESS))) return;
        float factor = settings().fogDensity / 100.0f;
        fog.environmentalStart *= factor;
        fog.renderDistanceStart *= factor;
        fog.environmentalEnd *= factor;
        fog.renderDistanceEnd *= factor;
        float span = Math.max(1.0f, fog.renderDistanceEnd - fog.renderDistanceStart);
        fog.renderDistanceStart += span * settings().fogStart / 200.0f;
        fog.environmentalStart += span * settings().fogStart / 200.0f;
        fog.renderDistanceEnd = fog.renderDistanceStart + span * settings().fogEnd / 100.0f;
        fog.environmentalEnd = fog.environmentalStart + span * settings().fogEnd / 100.0f;
        Vector4f color = fog.color;
        if (color != null && settings().fogColorMode != 0) {
            float red = color.x, green = color.y, blue = color.z;
            switch (settings().fogColorMode) {
                case 1 -> { red = 0.70f; green = 0.72f; blue = 0.78f; }
                case 2 -> { red = 0.72f; green = 0.57f; blue = 0.46f; }
                case 3 -> { red = 0.45f; green = 0.58f; blue = 0.72f; }
                case 4 -> { red = ((settings().fogColor >> 16) & 255) / 255.0f; green = ((settings().fogColor >> 8) & 255) / 255.0f; blue = (settings().fogColor & 255) / 255.0f; }
                default -> { }
            }
            float custom = 1.0f - settings().fogBiomeBlend / 100.0f;
            color.set(color.x + (red - color.x) * custom, color.y + (green - color.y) * custom, color.z + (blue - color.z) * custom, color.w);
        }
    }

    public static long localTime(long serverTicks) {
        if (!enabled("local_time") || !dimensionEnabled(settings().localTimeDimensions)) return serverTicks;
        return switch (settings().localTimeMode) {
            case 1 -> settings().fixedTime;
            case 2 -> {
                LocalTime now = LocalTime.now().plusMinutes(settings().realTimeOffsetMinutes);
                yield Math.floorMod((now.getHour() * 1000L + now.getMinute() * 1000L / 60L) - 6000L, 24000L);
            }
            case 3 -> Math.floorMod(System.currentTimeMillis() * 24000L / Math.max(1L, settings().localTimeCycleMinutes * 60_000L), 24000L);
            default -> serverTicks;
        };
    }

    public static Float localRain(float server) {
        if (!enabled("local_weather") || !dimensionEnabled(settings().weatherDimensions)) return null;
        return switch (settings().localWeatherMode) {
            case 1 -> 0.0f;
            case 2, 3 -> settings().weatherVolume / 100.0f;
            default -> null;
        };
    }

    public static boolean forceSnow() {
        return enabled("local_weather") && settings().localWeatherMode == 3;
    }

    public static void fullbrightKey(boolean pressed) {
        if (pressed && enabled("fullbright")) fullbrightToggled = !fullbrightToggled;
    }

    public static void zoomKey(boolean pressed) {
        if (!enabled("zoom")) { zoomHeld = false; zoomToggled = false; return; }
        if (settings().zoomMode == 0) zoomHeld = pressed;
        else if (pressed) zoomToggled = !zoomToggled;
    }

    public static boolean zoomScroll(double amount) {
        Minecraft client = Minecraft.getInstance();
        if (!zoomActive() || !settings().zoomScroll || amount == 0 || !Double.isFinite(amount) || ScreenBridge.hasOpenUi(client)) return false;
        double direction = settings().zoomReverseScroll ? 1.0 : -1.0;
        requestedZoomFov = clamp(requestedFov() + amount * direction * settings().zoomScrollStep,
            settings().zoomMinFov, settings().zoomMaxFov);
        settings().zoomFov = (int)Math.round(requestedZoomFov);
        return true;
    }

    static void reset(String id) {
        HudConfig.VisualSettings value = settings();
        HudConfig.VisualSettings defaults = new HudConfig.VisualSettings();
        switch (id) {
            case "fullbright" -> { value.fullbrightMode = defaults.fullbrightMode; value.fullbrightIntensity = defaults.fullbrightIntensity; value.preserveDarkness = defaults.preserveDarkness; }
            case "zoom" -> { value.zoomMode = defaults.zoomMode; value.zoomFov = defaults.zoomFov; value.zoomSmooth = defaults.zoomSmooth; value.zoomSensitivity = defaults.zoomSensitivity; value.zoomScroll = defaults.zoomScroll; zoomHeld = false; zoomToggled = false; requestedZoomFov = defaults.zoomFov; }
            case "crosshair" -> { value.crosshairMode = defaults.crosshairMode; value.crosshairSize = defaults.crosshairSize; value.crosshairGap = defaults.crosshairGap; value.crosshairThickness = defaults.crosshairThickness; value.crosshairOutline = defaults.crosshairOutline; value.crosshairOpacity = defaults.crosshairOpacity; value.crosshairColor = defaults.crosshairColor; value.crosshairChroma = defaults.crosshairChroma; value.crosshairHideThirdPerson = defaults.crosshairHideThirdPerson; }
            case "block_outline" -> { value.blockOutlineColor = defaults.blockOutlineColor; value.blockOutlineOpacity = defaults.blockOutlineOpacity; value.blockOutlineWidth = defaults.blockOutlineWidth; value.blockOutlineChroma = defaults.blockOutlineChroma; }
            case "low_fire" -> { value.lowFireHeight = defaults.lowFireHeight; value.lowFireOpacity = defaults.lowFireOpacity; }
            case "low_shield" -> { value.lowShieldHeight = defaults.lowShieldHeight; value.lowShieldOpacity = defaults.lowShieldOpacity; }
            case "damage_overlay" -> { value.damageColor = defaults.damageColor; value.damageIntensity = defaults.damageIntensity; value.damageSafetyMinimum = defaults.damageSafetyMinimum; }
            case "local_time" -> { value.localTimeMode = defaults.localTimeMode; value.fixedTime = defaults.fixedTime; }
            case "local_weather" -> { value.localWeatherMode = defaults.localWeatherMode; value.weatherVolume = defaults.weatherVolume; }
            case "fog" -> { value.fogDensity = defaults.fogDensity; value.fogColorMode = defaults.fogColorMode; }
            default -> { }
        }
    }

    private static boolean zoomActive() {
        Minecraft client = Minecraft.getInstance();
        return client != null && client.level != null && client.player != null && enabled("zoom") &&
            (settings().zoomMode == 0 ? zoomHeld : zoomToggled);
    }
    private static boolean zoomPresenting() { return zoomActive() || Math.abs(currentZoomFov - vanillaZoomFov) > 0.05f; }
    private static double requestedFov() {
        if (!Double.isFinite(requestedZoomFov)) requestedZoomFov = settings().zoomFov;
        return clamp(requestedZoomFov, settings().zoomMinFov, settings().zoomMaxFov);
    }
    static double approachZoom(double current, double target, double seconds, int durationMillis, int easing, boolean immediate) {
        if (immediate || durationMillis <= 0) return target;
        double progress = Math.max(0.0, Math.min(1.0, seconds * 1000.0 / durationMillis));
        double eased = switch (easing) {
            case 0 -> progress;
            case 2 -> progress * progress * (3.0 - 2.0 * progress);
            case 3 -> 1.0 - Math.pow(1.0 - progress, 3.0);
            default -> 1.0 - Math.pow(1.0 - progress, 2.0);
        };
        return current + (target - current) * eased;
    }
    private static double clamp(double value, double min, double max) { return Math.max(min, Math.min(max, value)); }
    private static HudConfig.VisualSettings settings() { return SwirlHud.config().visuals; }
}
