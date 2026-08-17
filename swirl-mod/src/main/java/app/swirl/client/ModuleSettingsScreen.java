package app.swirl.client;

import app.swirl.screen.SmoothScrollState;

import com.mojang.blaze3d.platform.InputConstants;
import net.minecraft.client.gui.GuiGraphicsExtractor;
import net.minecraft.client.gui.components.EditBox;
import net.minecraft.client.gui.components.AbstractWidget;
import net.minecraft.client.gui.screens.Screen;
import net.minecraft.client.input.KeyEvent;
import net.minecraft.client.input.MouseButtonEvent;
import net.minecraft.network.chat.Component;
import net.minecraft.resources.Identifier;
import org.lwjgl.glfw.GLFW;

import java.util.ArrayList;
import java.util.List;
import java.util.Locale;
import java.util.function.Consumer;
import java.util.function.Supplier;
import java.util.function.IntConsumer;
import java.util.function.IntSupplier;

final class ModuleSettingsScreen extends Screen {
    private enum Page { ESSENTIALS, ADVANCED }
    private record Row(String title, String description, String warning, int y) {}
    private record ScrollBinding(AbstractWidget widget, int baseY) {}
    private final Screen parent;
    private final String moduleId;
    private final List<Row> rows = new ArrayList<>();
    private final List<ScrollBinding> rowWidgets = new ArrayList<>();
    private final SmoothScrollState scroll = new SmoothScrollState();
    private int left, top, panelWidth, panelHeight, contentHeight;
    private String capturing;
    private Consumer<String> captureSetter;
    private Page page = Page.ESSENTIALS;
    private final CustomizationHistory history;
    private String notice = "";
    private String query = "";
    private boolean focusSearch;
    private long lastRenderNanos;
    private boolean draggingScrollbar;
    private double scrollbarGrab;

    ModuleSettingsScreen(Screen parent, String moduleId) {
        super(Component.literal("Gleam module settings")); this.parent = parent; this.moduleId = moduleId;
        history = new CustomizationHistory(SwirlHud.config());
    }

    @Override protected void init() {
        rows.clear(); rowWidgets.clear(); contentHeight = 0;
        panelWidth = Math.min(680, width - 24); panelHeight = Math.min(600, height - 24);
        left = (width - panelWidth) / 2; top = (height - panelHeight) / 2;
        HudConfig.Element element = element();
        if (element == null) { onClose(); return; }
        ModuleRegistry.Module module = ModuleRegistry.byId(moduleId);
        addRenderableWidget(new SwirlButton(left + 12, top + 11, 58, 22, Component.literal("BACK"), this::onClose));
        addRenderableWidget(new SwirlButton(left + panelWidth - 112, top + 11, 72, 22,
            Component.literal(element.enabled ? "ENABLED" : "DISABLED"), () -> {
                history.remember();
                if (module == null || module.kind() != ModuleRegistry.Kind.VISUAL || VisualModuleService.compatibility(moduleId) == ModuleRegistry.Compatibility.AVAILABLE)
                    element.enabled = !element.enabled;
                rebuildWidgets();
            }).selected(element.enabled));
        addRenderableWidget(new SwirlButton(left + panelWidth - 34, top + 11, 22, 22, Component.literal("X"), this::closeAll).danger(true));

        addRenderableWidget(new SwirlButton(left + 14, top + 47, Math.min(150, panelWidth - 28), 20,
            Component.literal(page == Page.ADVANCED ? "← ESSENTIALS" : "ADVANCED"), () -> {
                page = page == Page.ESSENTIALS ? Page.ADVANCED : Page.ESSENTIALS;
                scroll.moveTo(0, true); rebuildWidgets();
            }).selected(page == Page.ADVANCED));

        EditBox search = new EditBox(font, left + 96, top + 122, Math.max(100, panelWidth - 210), 19, Component.literal("Search settings"));
        search.setHint(Component.literal("Search this module..."));
        search.setMaxLength(48);
        search.setValue(query);
        search.setResponder(value -> {
            if (value.equals(query)) return;
            query = value; scroll.moveTo(0, true); focusSearch = true; rebuildWidgets();
        });
        addRenderableWidget(search);
        if (focusSearch) setInitialFocus(search);

        HudConfig.Options o = element.options;
        if (page == Page.ESSENTIALS) {
            addAction("MODULE", "Turn this feature on or off.", element.enabled ? "ENABLED" : "DISABLED", () -> element.enabled = !element.enabled);
            if (module != null && module.draggable()) {
                HudConfig.Appearance resolved = SwirlHud.config().resolvedAppearance(element);
                addColor("PRIMARY COLOR", () -> resolvedColor(element.appearance.primaryColor, resolved.primaryColor), color -> element.appearance.primaryColor = color);
                addSlider("HUD SIZE", "Make this HUD element smaller or larger.", 50, 250, 5, () -> Math.round(element.scale * 100), n -> element.scale = n / 100.0f, "%");
            }
            if (hasBindings()) initInput();
        }
        if (page == Page.ESSENTIALS) switch (moduleId) {
            case "fps" -> { addToggle("FPS SUFFIX", "Show FPS after the value.", o.showSuffix, () -> o.showSuffix = !o.showSuffix); addToggle("BRACKETS", "Wrap the value in brackets.", o.showBrackets, () -> o.showBrackets = !o.showBrackets); addToggle("STATIC WIDTH", "Keep the background width stable.", o.staticWidth, () -> o.staticWidth = !o.staticWidth); addRefresh(o); }
            case "cps" -> { addToggle("LEFT CPS", "Show attack clicks.", o.showLeftCps, () -> o.showLeftCps = !o.showLeftCps); addToggle("RIGHT CPS", "Show use clicks.", o.showRightCps, () -> o.showRightCps = !o.showRightCps); addToggle("CPS LABEL", "Show the CPS suffix.", o.showCpsLabel, () -> o.showCpsLabel = !o.showCpsLabel); addCycle("ROLLING WINDOW", "Count presses within this duration.", o.cpsWindowMillis + " MS", () -> o.cpsWindowMillis = o.cpsWindowMillis == 500 ? 1000 : o.cpsWindowMillis == 1000 ? 2000 : 500); }
            case "keystrokes" -> { addToggle("MOVEMENT KEYS", "Show movement inputs.", o.showMovement, () -> o.showMovement = !o.showMovement); addToggle("MOUSE BUTTONS", "Show attack and use inputs.", o.showMouse, () -> o.showMouse = !o.showMouse); addToggle("MOUSE CPS", "Show exact CPS inside mouse keys.", o.showMouseCps, () -> o.showMouseCps = !o.showMouseCps); addToggle("SPACE BAR", "Show jump input.", o.showSpace, () -> o.showSpace = !o.showSpace); addToggle("ARROW LABELS", "Replace WASD with arrow marks.", o.useArrows, () -> o.useArrows = !o.useArrows); addCycle("FADE DURATION", "Pressed-key fade duration; zero disables it.", o.keyFadeMillis + " MS", () -> o.keyFadeMillis = o.keyFadeMillis == 0 ? 80 : o.keyFadeMillis == 80 ? 120 : o.keyFadeMillis == 120 ? 200 : 0); addCycle("BORDER", "Key border thickness.", o.borderWidth + " PX", () -> o.borderWidth = o.borderWidth % 3 + 1); }
            case "coordinates" -> { addCycle("PRECISION", "Digits after the decimal.", Integer.toString(o.coordinatePrecision), () -> o.coordinatePrecision = (o.coordinatePrecision + 1) % 4); addToggle("COMPACT", "Use comma-separated values without XYZ.", o.compactCoordinates, () -> o.compactCoordinates = !o.compactCoordinates); addToggle("NETHER CONVERSION", "Show the corresponding Overworld or Nether X/Z.", o.showNetherConversion, () -> o.showNetherConversion = !o.showNetherConversion); addToggle("MOVEMENT SIGNS", "Show whether each axis is increasing or decreasing.", o.showMovementSigns, () -> o.showMovementSigns = !o.showMovementSigns); }
            case "direction" -> { addToggle("COMPASS RIBBON", "Use a scrolling compass instead of compact text.", o.compassRibbon, () -> o.compassRibbon = !o.compassRibbon); addToggle("INTERCARDINAL", "Include NE, SE, SW, and NW.", o.showIntercardinal, () -> o.showIntercardinal = !o.showIntercardinal); addToggle("DEGREES", "Show numeric yaw.", o.showDegrees, () -> o.showDegrees = !o.showDegrees); }
            case "armor" -> { addToggle("HORIZONTAL", "Lay items out in a row.", o.horizontal, () -> o.horizontal = !o.horizontal); addToggle("REVERSE ORDER", "Reverse the compact non-empty item order.", o.reverseOrder, () -> o.reverseOrder = !o.reverseOrder); addDurabilityMode(o); addThreshold(o); }
            case "potions" -> { addToggle("HORIZONTAL", "Arrange effects in a row.", o.horizontal, () -> o.horizontal = !o.horizontal); addToggle("COLOR ICONS", "Show a colored effect marker.", o.showPotionIcons, () -> o.showPotionIcons = !o.showPotionIcons); addToggle("NAMES", "Show effect names.", o.showPotionNames, () -> o.showPotionNames = !o.showPotionNames); addToggle("AMPLIFIERS", "Show effect levels.", o.showPotionAmplifiers, () -> o.showPotionAmplifiers = !o.showPotionAmplifiers); addToggle("TIMERS", "Show remaining effect time.", o.showPotionTimers, () -> o.showPotionTimers = !o.showPotionTimers); addToggle("SORT BY NAME", "Sort alphabetically instead of by duration.", o.sortEffectsByName, () -> o.sortEffectsByName = !o.sortEffectsByName); }
            case "ping" -> { addRefresh(o); addToggle("SUFFIX", "Show ms after latency.", o.showSuffix, () -> o.showSuffix = !o.showSuffix); addToggle("QUALITY COLORS", "Use connection quality thresholds instead of HUD color.", o.qualityColors, () -> o.qualityColors = !o.qualityColors); }
            case "server" -> { addToggle("SHOW PORT", "Include the server port.", o.showPort, () -> o.showPort = !o.showPort); addToggle("HIDE SINGLEPLAYER", "Hide this HUD outside multiplayer.", o.hideSingleplayer, () -> o.hideSingleplayer = !o.hideSingleplayer); addToggle("PRIVACY MASK", "Mask the address for streaming.", o.privacyMask, () -> o.privacyMask = !o.privacyMask); addToggle("LABEL", "Prefix the value with Server.", o.showLabel, () -> o.showLabel = !o.showLabel); }
            case "clock" -> { addToggle("24 HOUR", "Use 24-hour rather than 12-hour time.", o.clock24Hour, () -> o.clock24Hour = !o.clock24Hour); addToggle("SECONDS", "Show clock seconds.", o.showSeconds, () -> o.showSeconds = !o.showSeconds); addToggle("DATE", "Show the current date.", o.showDate, () -> o.showDate = !o.showDate); addToggle("UTC", "Use UTC rather than local time.", o.utcTime, () -> o.utcTime = !o.utcTime); }
            case "stopwatch" -> { addCycle("FORMAT", "Choose M:SS, H:MM:SS, or seconds.", switch (o.stopwatchFormat) { case 1 -> "H:MM:SS"; case 2 -> "SECONDS"; default -> "M:SS"; }, () -> o.stopwatchFormat = (o.stopwatchFormat + 1) % 3); addToggle("TENTHS", "Show tenths of a second.", o.stopwatchTenths, () -> o.stopwatchTenths = !o.stopwatchTenths); addText("PREFIX", "Text displayed before elapsed time.", () -> o.prefix, v -> o.prefix = v); addAction("TIMER", "Start or pause the stopwatch now.", SwirlHud.stopwatchRunning() ? "PAUSE" : "START", SwirlHud::toggleStopwatch); addAction("RESET TIMER", "Clear elapsed time now.", "RESET", SwirlHud::resetStopwatch); }
            case "memory" -> { addCycle("DISPLAY", "Percent, used, or used of maximum.", switch (o.memoryMode) { case 1 -> "USED"; case 2 -> "USED / MAX"; default -> "PERCENT"; }, () -> o.memoryMode = (o.memoryMode + 1) % 3); addToggle("GIB UNITS", "Use GiB instead of MiB.", o.memoryGib, () -> o.memoryGib = !o.memoryGib); addRefresh(o); }
            case "durability" -> { addCycle("HANDS", "Main hand, offhand, or both.", switch (o.handMode) { case 1 -> "BOTH"; case 2 -> "OFFHAND"; default -> "MAIN"; }, () -> o.handMode = (o.handMode + 1) % 3); addToggle("ITEM NAME", "Show the held item name.", o.showItemName, () -> o.showItemName = !o.showItemName); addToggle("DAMAGEABLE ONLY", "Hide blocks and other non-damageable items.", o.damageableOnly, () -> o.damageableOnly = !o.damageableOnly); addDurabilityMode(o); addThreshold(o); }
            case "speed" -> { addCycle("MOVEMENT", "Measure horizontal movement or full 3D movement.", o.speedMode == 1 ? "3D" : "HORIZONTAL", () -> o.speedMode = 1 - o.speedMode); addCycle("UNIT", "Blocks per second or kilometres per hour.", o.speedUnit == 1 ? "KM/H" : "B/S", () -> o.speedUnit = 1 - o.speedUnit); addCycle("PRECISION", "Digits after the decimal.", Integer.toString(o.precision), () -> o.precision = (o.precision + 1) % 4); addCycle("SMOOTHING", "Movement samples used for smoothing.", o.smoothingTicks + " TICKS", () -> o.smoothingTicks = o.smoothingTicks == 1 ? 5 : o.smoothingTicks == 5 ? 10 : 1); }
            case "biome" -> { addToggle("RESOURCE ID", "Show the registry ID instead of a friendly name.", o.resourceId, () -> o.resourceId = !o.resourceId); addToggle("NAMESPACE", "Include minecraft: or a mod namespace.", o.showNamespace, () -> o.showNamespace = !o.showNamespace); addToggle("LABEL", "Prefix the value with Biome.", o.showLabel, () -> o.showLabel = !o.showLabel); addRefresh(o); }
            case "players" -> { addToggle("SHOW MAX", "Show the server maximum when known.", o.showMaxPlayers, () -> o.showMaxPlayers = !o.showMaxPlayers); addToggle("HIDE SINGLEPLAYER", "Hide when no multiplayer connection exists.", o.hideSingleplayer, () -> o.hideSingleplayer = !o.hideSingleplayer); addToggle("LABEL", "Prefix the value with Players.", o.showLabel, () -> o.showLabel = !o.showLabel); }
            case "world_time" -> { addToggle("DAY", "Show the world day.", o.showDay, () -> o.showDay = !o.showDay); addToggle("CLOCK", "Show the world clock.", o.showWorldClock, () -> o.showWorldClock = !o.showWorldClock); addToggle("DAY STARTS AT 1", "Use Day 1 rather than Day 0 for a new world.", o.dayStartsAtOne, () -> o.dayStartsAtOne = !o.dayStartsAtOne); addToggle("24 HOUR", "Use a 24-hour world clock.", o.clock24Hour, () -> o.clock24Hour = !o.clock24Hour); }
            case "target_block" -> { addToggle("RESOURCE ID", "Show the block registry ID.", o.resourceId, () -> o.resourceId = !o.resourceId); addToggle("COORDINATES", "Show the targeted block position.", o.showTargetCoordinates, () -> o.showTargetCoordinates = !o.showTargetCoordinates); addToggle("DISTANCE", "Show distance to the block.", o.showTargetDistance, () -> o.showTargetDistance = !o.showTargetDistance); addToggle("LABEL", "Prefix the value with Target.", o.showLabel, () -> o.showLabel = !o.showLabel); }
            case "light" -> { addCycle("LIGHT TYPE", "Combined, block, or sky light.", switch (o.lightMode) { case 1 -> "BLOCK"; case 2 -> "SKY"; default -> "COMBINED"; }, () -> o.lightMode = (o.lightMode + 1) % 3); addToggle("LABEL", "Show the selected light type.", o.showLabel, () -> o.showLabel = !o.showLabel); }
            case "toggle_sprint" -> {
                addCycle("HUD MODE", "Text, icon, or hidden status.", switch (o.toggleHudMode) { case 1 -> "ICON"; case 2 -> "HIDDEN"; default -> "TEXT"; }, () -> o.toggleHudMode = (o.toggleHudMode + 1) % 3);
                if (o.toggleHudMode != 2) addToggle("ACTIVE ONLY", "Hide status while neither toggle is active.", o.activeOnly, () -> o.activeOnly = !o.activeOnly);
                if (o.toggleHudMode == 0) addText("SPRINT TEXT", "Text shown while sprint is toggled.", () -> o.sprintText, v -> o.sprintText = v);
                if (o.toggleHudMode == 0) addText("FLYING TEXT", "Text shown while flying.", () -> o.flyingText, v -> o.flyingText = v);
            }
            case "toggle_sneak" -> {
                addCycle("HUD MODE", "Text, icon, or hidden status.", switch (o.toggleHudMode) { case 1 -> "ICON"; case 2 -> "HIDDEN"; default -> "TEXT"; }, () -> o.toggleHudMode = (o.toggleHudMode + 1) % 3);
                if (o.toggleHudMode != 2) addToggle("ACTIVE ONLY", "Hide status while sneak is inactive.", o.activeOnly, () -> o.activeOnly = !o.activeOnly);
                if (o.toggleHudMode == 0) addText("SNEAK TEXT", "Text shown while sneak is toggled.", () -> o.sneakText, v -> o.sneakText = v);
            }
            case "fullbright" -> {
                addCycle("MODE", "Soft, bright, full, or custom local light curve.", switch (visuals().fullbrightMode) { case 0 -> "SOFT"; case 2 -> "FULL"; case 3 -> "CUSTOM"; default -> "BRIGHT"; }, () -> visuals().fullbrightMode = (visuals().fullbrightMode + 1) % 4);
                addSlider("INTENSITY", "Blend the selected curve with vanilla lighting.", 0, 100, 1, () -> visuals().fullbrightIntensity, n -> visuals().fullbrightIntensity = n, "%");
                if (visuals().fullbrightMode == 3) addSlider("CUSTOM GAMMA", "Custom presentation-only gamma target.", 1, 32, 1, () -> visuals().fullbrightCustomGamma, n -> visuals().fullbrightCustomGamma = n, "");
                addSlider("TRANSITION", "Ease lighting changes instead of flashing.", 0, 2000, 25, () -> visuals().fullbrightTransitionMillis, n -> visuals().fullbrightTransitionMillis = n, " MS");
                addDimensionMask("DIMENSIONS", () -> visuals().fullbrightDimensions, n -> visuals().fullbrightDimensions = n);
                addToggle("PRESERVE DARKNESS", "Let Darkness and Blindness override Fullbright.", visuals().preserveDarkness, () -> visuals().preserveDarkness = !visuals().preserveDarkness);
            }
            case "zoom" -> {
                addCycle("BEHAVIOR", "Hold the key or press once to toggle.", visuals().zoomMode == 0 ? "HOLD" : "TOGGLE", () -> visuals().zoomMode = 1 - visuals().zoomMode);
                addSlider("ZOOM FOV", "Smaller values zoom farther without changing reach.", 5, 70, 1, () -> visuals().zoomFov, n -> visuals().zoomFov = n, " DEG");
                addToggle("SMOOTH TRANSITION", "Ease into and out of zoom.", visuals().zoomSmooth, () -> visuals().zoomSmooth = !visuals().zoomSmooth);
                if (visuals().zoomSmooth) addSlider("TRANSITION TIME", "Zoom interpolation duration.", 0, 2000, 10, () -> visuals().zoomDurationMillis, n -> visuals().zoomDurationMillis = n, " MS");
                addSlider("SENSITIVITY", "Scale mouse sensitivity while zoomed.", 10, 100, 1, () -> visuals().zoomSensitivity, n -> visuals().zoomSensitivity = n, "%");
                addToggle("SCROLL ADJUST", "Use the wheel to adjust FOV while zoomed.", visuals().zoomScroll, () -> visuals().zoomScroll = !visuals().zoomScroll);
                if (visuals().zoomScroll) {
                    addSlider("MINIMUM FOV", "Farthest scroll zoom.", 5, 70, 1, () -> visuals().zoomMinFov, n -> visuals().zoomMinFov = Math.min(n, visuals().zoomMaxFov), " DEG");
                    addSlider("MAXIMUM FOV", "Nearest scroll zoom.", 5, 110, 1, () -> visuals().zoomMaxFov, n -> visuals().zoomMaxFov = Math.max(n, visuals().zoomMinFov), " DEG");
                    addSlider("SCROLL STEP", "FOV degrees per wheel step.", 1, 10, 1, () -> visuals().zoomScrollStep, n -> visuals().zoomScrollStep = n, " DEG");
                    addToggle("REVERSE SCROLL", "Reverse wheel zoom direction.", visuals().zoomReverseScroll, () -> visuals().zoomReverseScroll = !visuals().zoomReverseScroll);
                }
            }
            case "crosshair" -> {
                addCycle("STYLE", "Vanilla, cross, dot, or circle.", switch (visuals().crosshairMode) { case 1 -> "CROSS"; case 2 -> "DOT"; case 3 -> "CIRCLE"; default -> "VANILLA"; }, () -> visuals().crosshairMode = (visuals().crosshairMode + 1) % 4);
                addSlider("SIZE", "Crosshair arm length or circle radius.", 2, 20, 1, () -> visuals().crosshairSize, n -> visuals().crosshairSize = n, " PX");
                addSlider("GAP", "Distance from the center.", 0, 12, 1, () -> visuals().crosshairGap, n -> visuals().crosshairGap = n, " PX");
                addSlider("THICKNESS", "Stroke thickness.", 1, 4, 1, () -> visuals().crosshairThickness, n -> visuals().crosshairThickness = n, " PX");
                addToggle("CENTER DOT", "Draw a center point independently of the arms.", visuals().crosshairCenterDot, () -> visuals().crosshairCenterDot = !visuals().crosshairCenterDot);
                addSlider("DYNAMIC EXPANSION", "Expand during movement and attacks; rendering only.", 0, 16, 1, () -> visuals().crosshairExpansion, n -> visuals().crosshairExpansion = n, " PX");
                addToggle("OUTLINE", "Add a dark contrast outline.", visuals().crosshairOutline, () -> visuals().crosshairOutline = !visuals().crosshairOutline);
                addSlider("OPACITY", "Crosshair transparency.", 15, 100, 1, () -> visuals().crosshairOpacity, n -> visuals().crosshairOpacity = n, "%");
                addVisualColor("COLOR", () -> visuals().crosshairColor, value -> visuals().crosshairColor = value);
                addToggle("CHROMA", "Animate the crosshair color.", visuals().crosshairChroma, () -> visuals().crosshairChroma = !visuals().crosshairChroma);
                addToggle("HIDE IN THIRD PERSON", "Show the custom crosshair only in first person.", visuals().crosshairHideThirdPerson, () -> visuals().crosshairHideThirdPerson = !visuals().crosshairHideThirdPerson);
            }
            case "block_outline" -> {
                addVisualColor("OUTLINE COLOR", () -> visuals().blockOutlineColor, value -> visuals().blockOutlineColor = value);
                addSlider("OPACITY", "Targeted-block outline transparency.", 10, 100, 1, () -> visuals().blockOutlineOpacity, n -> visuals().blockOutlineOpacity = n, "%");
                addSlider("WIDTH", "Targeted-block line width.", 1, 8, 1, () -> visuals().blockOutlineWidth, n -> visuals().blockOutlineWidth = n, " PX");
                addSlider("PULSE", "Animated outline opacity; zero disables.", 0, 100, 1, () -> visuals().blockOutlinePulse, n -> visuals().blockOutlinePulse = n, "%");
                addToggle("CHROMA", "Animate the targeted-block outline.", visuals().blockOutlineChroma, () -> visuals().blockOutlineChroma = !visuals().blockOutlineChroma);
            }
            case "low_fire" -> {
                addSlider("X OFFSET", "Horizontal fire-overlay position.", -100, 100, 1, () -> visuals().lowFireX, n -> visuals().lowFireX = n, "%");
                addSlider("Y OFFSET", "Move the first-person fire overlay downward.", 20, 100, 1, () -> visuals().lowFireHeight, n -> visuals().lowFireHeight = n, "%");
                addSlider("SCALE", "Fire-overlay scale.", 50, 150, 1, () -> visuals().lowFireScale, n -> visuals().lowFireScale = n, "%");
                addSlider("OPACITY", "Keep the burning state visible while reducing obstruction.", 25, 100, 1, () -> visuals().lowFireOpacity, n -> visuals().lowFireOpacity = n, "%");
                addSlider("SAFETY MINIMUM", "Lowest allowed burning indicator opacity.", 10, 50, 1, () -> visuals().lowFireSafetyMinimum, n -> visuals().lowFireSafetyMinimum = n, "%");
            }
            case "low_shield" -> {
                addSlider("X OFFSET", "Horizontal shield position.", -100, 100, 1, () -> visuals().lowShieldX, n -> visuals().lowShieldX = n, "%");
                addSlider("Y OFFSET", "Move the blocking shield downward.", 20, 100, 1, () -> visuals().lowShieldHeight, n -> visuals().lowShieldHeight = n, "%");
                addSlider("SCALE", "Blocking-shield scale.", 50, 150, 1, () -> visuals().lowShieldScale, n -> visuals().lowShieldScale = n, "%");
            }
            case "damage_overlay" -> {
                addSlider("INTENSITY", "Strength of the local hurt flash.", 0, 100, 1, () -> visuals().damageIntensity, n -> visuals().damageIntensity = n, "%");
                addVisualColor("FLASH COLOR", () -> visuals().damageColor, value -> visuals().damageColor = value);
                addCycle("STYLE", "Full-screen flash or edge vignette.", visuals().damageStyle == 0 ? "FULL" : "VIGNETTE", () -> visuals().damageStyle = 1 - visuals().damageStyle);
                addCycle("DURATION CURVE", "Linear, ease-out, sharp, or soft decay.", switch (visuals().damageCurve) { case 1 -> "EASE OUT"; case 2 -> "SHARP"; case 3 -> "SOFT"; default -> "LINEAR"; }, () -> visuals().damageCurve = (visuals().damageCurve + 1) % 4);
                addToggle("SAFETY MINIMUM", "Keep a visible damage warning; disabling permits zero.", visuals().damageSafetyMinimum, () -> visuals().damageSafetyMinimum = !visuals().damageSafetyMinimum);
            }
            case "local_time" -> {
                addCycle("PRESENTATION", "Cosmetic only; mechanics keep server time.", switch (visuals().localTimeMode) { case 1 -> "FIXED"; case 2 -> "REAL WORLD"; case 3 -> "SMOOTH CYCLE"; default -> "SERVER"; }, () -> visuals().localTimeMode = (visuals().localTimeMode + 1) % 4);
                if (visuals().localTimeMode == 1) addSlider("FIXED TIME", "Continuous cosmetic world-time tick.", 0, 23999, 100, () -> visuals().fixedTime, n -> visuals().fixedTime = n, " T");
                if (visuals().localTimeMode == 2) addSlider("REAL-TIME OFFSET", "Offset from local real-world time.", -720, 840, 15, () -> visuals().realTimeOffsetMinutes, n -> visuals().realTimeOffsetMinutes = n, " MIN");
                if (visuals().localTimeMode == 3) addSlider("CYCLE DURATION", "Real minutes per cosmetic day.", 1, 240, 1, () -> visuals().localTimeCycleMinutes, n -> visuals().localTimeCycleMinutes = n, " MIN");
                addDimensionMask("DIMENSIONS", () -> visuals().localTimeDimensions, n -> visuals().localTimeDimensions = n);
            }
            case "local_weather" -> {
                addCycle("PRESENTATION", "Cosmetic particles only; server weather is unchanged.", switch (visuals().localWeatherMode) { case 1 -> "CLEAR"; case 2 -> "RAIN"; case 3 -> "SNOW"; default -> "SERVER"; }, () -> visuals().localWeatherMode = (visuals().localWeatherMode + 1) % 4);
                addSlider("PARTICLE DENSITY", "Locally presented precipitation amount.", 0, 100, 1, () -> visuals().weatherVolume, n -> visuals().weatherVolume = n, "%");
                addDimensionMask("DIMENSIONS", () -> visuals().weatherDimensions, n -> visuals().weatherDimensions = n);
            }
            case "fog" -> {
                addSlider("DENSITY", "Atmospheric fog only; hazard fog is preserved.", 25, 200, 1, () -> visuals().fogDensity, n -> visuals().fogDensity = n, "%");
                addSlider("START", "Fog start within normal rendered terrain.", 0, 200, 1, () -> visuals().fogStart, n -> visuals().fogStart = Math.min(n, visuals().fogEnd - 1), "%");
                addSlider("END", "Fog end within normal loaded view distance.", 1, 300, 1, () -> visuals().fogEnd, n -> visuals().fogEnd = Math.max(n, visuals().fogStart + 1), "%");
                addCycle("COLOR", "Vanilla, neutral, warm, cool, or custom.", switch (visuals().fogColorMode) { case 1 -> "NEUTRAL"; case 2 -> "WARM"; case 3 -> "COOL"; case 4 -> "CUSTOM"; default -> "VANILLA"; }, () -> visuals().fogColorMode = (visuals().fogColorMode + 1) % 5);
                if (visuals().fogColorMode == 4) addVisualColor("CUSTOM COLOR", () -> visuals().fogColor, value -> visuals().fogColor = value);
                addSlider("BIOME BLEND", "Blend custom atmosphere with the biome color.", 0, 100, 1, () -> visuals().fogBiomeBlend, n -> visuals().fogBiomeBlend = n, "%");
                addDimensionMask("DIMENSIONS", () -> visuals().fogDimensions, n -> visuals().fogDimensions = n);
            }
            default -> { }
        }
        if (page == Page.ADVANCED || !query.isBlank()) {
            initAppearance(element);
            if (module != null && module.draggable()) initLayout(element);
            if (module != null && module.kind() == ModuleRegistry.Kind.VISUAL && VisualModuleService.compatibility(moduleId) != ModuleRegistry.Compatibility.AVAILABLE)
                initCompatibility(module);
            if (switch (moduleId) { case "low_shield", "block_outline", "local_weather", "damage_overlay" -> true; default -> false; })
                addInfo("VERSION-SAFE OPTIONS", "Gleam only shows controls proven reliable on both supported Minecraft versions.");
            addAction("RESET MODULE", "Restore this module's behavior and appearance defaults.", "RESET", () -> resetEverything(element));
        }
        contentHeight = rows.size() * 45;
        scroll.maximum(Math.max(0, contentHeight - (panelHeight - 166)));
    }

    private boolean hasBindings() {
        return switch (moduleId) { case "stopwatch", "toggle_sprint", "toggle_sneak", "fullbright", "zoom" -> true; default -> false; };
    }

    private void initAppearance(HudConfig.Element element) {
        HudConfig.Appearance resolved = SwirlHud.config().resolvedAppearance(element);
        HudConfig.Appearance value = element.appearance;
        addAction("INHERIT GLOBAL STYLE", "Clear every per-module appearance override.", hasAppearanceOverrides(value) ? "RESET" : "INHERITED", () -> SwirlHud.config().clearAppearanceOverrides(moduleId));
        addAction("COPY APPEARANCE", "Copy a validated appearance-only preset to the clipboard.", "COPY", () -> {
            minecraft.keyboardHandler.setClipboard(AppearancePresetCodec.encode(SwirlHud.config().captureAppearancePreset(moduleId)));
            notice = "Appearance copied";
        });
        addAction("PASTE APPEARANCE", "Apply this module's appearance from a Gleam preset code.", "PASTE", () -> {
            try {
                HudConfig.AppearancePreset preset = AppearancePresetCodec.decode(minecraft.keyboardHandler.getClipboard());
                SwirlHud.config().applyAppearancePreset(preset, HudConfig.PresetScope.SELECTED, java.util.Set.of(moduleId));
                notice = "Appearance pasted";
            } catch (RuntimeException error) { notice = "Invalid appearance preset"; }
        });
        addCycle("COLOR MODE", "Static, two-color gradient, or spatial chroma.", switch (resolved.colorMode) { case 1 -> "GRADIENT"; case 2 -> "CHROMA"; default -> "STATIC"; }, () -> value.colorMode = (resolved.colorMode + 1) % 3);
        addColor("PRIMARY COLOR", () -> resolvedColor(value.primaryColor, resolved.primaryColor), color -> value.primaryColor = color);
        if (resolved.colorMode != 0) addColor("SECONDARY COLOR", () -> resolvedColor(value.secondaryColor, resolved.secondaryColor), color -> value.secondaryColor = color);
        addSlider("HUD OPACITY", "Opacity of the complete module.", 0, 100, 1, () -> resolvedInt(value.opacity, resolved.opacity), n -> value.opacity = n, "%");
        if (resolved.colorMode == 1) addSlider("GRADIENT ANGLE", "Direction of the two-color gradient.", 0, 359, 1, () -> resolvedInt(value.gradientAngle, resolved.gradientAngle), n -> value.gradientAngle = n, " DEG");
        if (resolved.colorMode == 2) {
            addSlider("CHROMA SPEED", "Rainbow animation speed.", 1, 10, 1, () -> resolvedInt(value.chromaSpeed, resolved.chromaSpeed), n -> value.chromaSpeed = n, "");
            addSlider("CHROMA SPREAD", "Spatial distance between hues.", 1, 100, 1, () -> resolvedInt(value.chromaSpread, resolved.chromaSpread), n -> value.chromaSpread = n, "%");
            addSlider("SATURATION", "Chroma color saturation.", 0, 100, 1, () -> resolvedInt(value.chromaSaturation, resolved.chromaSaturation), n -> value.chromaSaturation = n, "%");
            addSlider("BRIGHTNESS", "Chroma color brightness.", 10, 100, 1, () -> resolvedInt(value.chromaBrightness, resolved.chromaBrightness), n -> value.chromaBrightness = n, "%");
        }
        addColor("BACKGROUND", () -> resolvedColor(value.backgroundColor, resolved.backgroundColor), color -> value.backgroundColor = color);
        addSlider("BACKGROUND OPACITY", "Module backdrop opacity.", 0, 100, 1, () -> resolvedInt(value.backgroundOpacity, resolved.backgroundOpacity), n -> value.backgroundOpacity = n, "%");
        addColor("BORDER COLOR", () -> resolvedColor(value.borderColor, resolved.borderColor), color -> value.borderColor = color);
        addSlider("BORDER OPACITY", "Outline opacity; zero hides it.", 0, 100, 1, () -> resolvedInt(value.borderOpacity, resolved.borderOpacity), n -> value.borderOpacity = n, "%");
        addSlider("BORDER WIDTH", "Outline thickness.", 0, 5, 1, () -> resolvedInt(value.borderWidth, resolved.borderWidth), n -> value.borderWidth = n, " PX");
        addToggle("TEXT SHADOW", "Per-module shadow override.", resolved.textShadow, () -> value.textShadow = !resolved.textShadow);
        addSlider("TEXT SCALE", "Text size inside this module.", 50, 200, 5, () -> resolvedInt(value.textScale, resolved.textScale), n -> value.textScale = n, "%");
    }

    private void initLayout(HudConfig.Element element) {
        HudConfig.Appearance resolved = SwirlHud.config().resolvedAppearance(element);
        HudConfig.Appearance value = element.appearance;
        addSlider("MODULE SCALE", "Resize the entire HUD module.", 50, 250, 5, () -> Math.round(element.scale * 100), n -> element.scale = n / 100.0f, "%");
        addSlider("HORIZONTAL PADDING", "Space to the left and right of content.", 0, 16, 1, () -> resolvedInt(value.paddingX, resolved.paddingX), n -> value.paddingX = n, " PX");
        addSlider("VERTICAL PADDING", "Space above and below content.", 0, 16, 1, () -> resolvedInt(value.paddingY, resolved.paddingY), n -> value.paddingY = n, " PX");
        addAction("RESET POSITION", "Return this module to its default normalized position.", "RESET", () -> {
            HudConfig fresh = new HudConfig(); HudConfig.Element source = fresh.element(moduleId);
            element.x = source.x; element.y = source.y; element.xRatio = source.xRatio; element.yRatio = source.yRatio;
        });
    }

    private void initInput() {
        switch (moduleId) {
            case "stopwatch" -> {
                addBinding("START / PAUSE KEY", "Start, pause, or resume.", "Stopwatch", () -> SwirlHud.config().bindings.stopwatchToggle, v -> SwirlHud.config().bindings.stopwatchToggle = v);
                addBinding("RESET KEY", "Clear elapsed time.", "Reset stopwatch", () -> SwirlHud.config().bindings.stopwatchReset, v -> SwirlHud.config().bindings.stopwatchReset = v);
            }
            case "toggle_sprint" -> addBinding("SPRINT KEY", "Toggle sprint while preserving vanilla hold controls.", "Toggle sprint", () -> SwirlHud.config().bindings.toggleSprint, v -> SwirlHud.config().bindings.toggleSprint = v);
            case "toggle_sneak" -> addBinding("SNEAK KEY", "Toggle sneak without creating a UI Shift modifier.", "Toggle sneak", () -> SwirlHud.config().bindings.toggleSneak, v -> SwirlHud.config().bindings.toggleSneak = v);
            case "fullbright" -> addBinding("TOGGLE KEY", "Temporarily toggle Fullbright.", "Fullbright", () -> SwirlHud.config().bindings.fullbrightToggle, v -> SwirlHud.config().bindings.fullbrightToggle = v);
            case "zoom" -> addBinding("ZOOM KEY", "Hold or toggle Zoom.", "Zoom", () -> SwirlHud.config().bindings.zoom, v -> SwirlHud.config().bindings.zoom = v);
            default -> { }
        }
    }

    private void initCompatibility(ModuleRegistry.Module module) {
        addAction("STATUS", "Live compatibility state for the current renderer.", VisualModuleService.compatibilityLabel(moduleId), () -> { });
        addAction("RUNTIME HOOK", "Version-isolated subsystem used by this module.", module.runtimeHook().name(), () -> { });
        addAction("SAFETY", "Client presentation only; never changes packets, reach, or server state.", "LOCAL ONLY", () -> { });
        if (VisualModuleService.compatibility(moduleId) != ModuleRegistry.Compatibility.AVAILABLE)
            addAction("AUTO DISABLE", "Gleam disables this module rather than risking corruption or a crash.", "ACTIVE", () -> { });
    }

    private static int resolvedInt(Integer override, Integer fallback) { return override == null ? fallback : override; }
    private static int resolvedColor(Integer override, Integer fallback) { return override == null ? fallback : override; }
    private static String transitionName(int value) { return switch (value) { case 1 -> "FADE"; case 2 -> "SLIDE"; case 3 -> "SCALE"; case 4 -> "PULSE"; default -> "OFF"; }; }
    private static boolean hasAppearanceOverrides(HudConfig.Appearance value) {
        if (value == null) return false;
        try { for (var field : HudConfig.Appearance.class.getDeclaredFields()) if (field.get(value) != null) return true; }
        catch (ReflectiveOperationException ignored) { }
        return false;
    }

    private void addRefresh(HudConfig.Options o) { addCycle("REFRESH", "How frequently the displayed value updates.", o.refreshMillis == 0 ? "LIVE" : o.refreshMillis + " MS", () -> o.refreshMillis = o.refreshMillis == 0 ? 250 : o.refreshMillis == 250 ? 500 : o.refreshMillis == 500 ? 1000 : 0); }
    private void addThreshold(HudConfig.Options o) { addCycle("WARNING AT", "Use the warning color at or below this durability.", o.warningThreshold + "%", () -> o.warningThreshold = o.warningThreshold == 5 ? 10 : o.warningThreshold == 10 ? 15 : o.warningThreshold == 15 ? 25 : 5); }
    private void addDurabilityMode(HudConfig.Options o) { addCycle("DURABILITY", "Hide it or show percent, remaining, or a bar.", switch (o.durabilityMode) { case 0 -> "OFF"; case 2 -> "REMAINING"; case 3 -> "BAR"; default -> "PERCENT"; }, () -> { o.durabilityMode = (o.durabilityMode + 1) % 4; o.showDurability = o.durabilityMode != 0; }); }
    private void addToggle(String t, String d, boolean v, Runnable a) { addAction(t, d, v ? "ON" : "OFF", a); }
    private void addCycle(String t, String d, String v, Runnable a) { addAction(t, d, v, a); }
    private void addDimensionMask(String title, IntSupplier getter, IntConsumer setter) {
        int current = Math.max(1, Math.min(7, getter.getAsInt()));
        String label = switch (current) {
            case 1 -> "OVERWORLD";
            case 2 -> "NETHER";
            case 3 -> "OVERWORLD + NETHER";
            case 4 -> "END";
            case 5 -> "OVERWORLD + END";
            case 6 -> "NETHER + END";
            default -> "ALL";
        };
        addCycle(title, "Choose the dimensions where this cosmetic presentation applies.", label,
            () -> setter.accept(current == 7 ? 1 : current + 1));
    }
    private void addAction(String title, String description, String value, Runnable action) {
        if (!matchesQuery(title, description)) return;
        int y = rowY(rows.size()); rows.add(new Row(title, description, "", y));
        SwirlButton button = new SwirlButton(left + panelWidth - 116, y + 9, 96, 22, Component.literal(value), () -> {
            history.remember(); focusSearch = false; action.run(); rebuildWidgets();
        }).selected(value.equals("ON") || value.equals("PAUSE") || value.equals("ENABLED"));
        addRenderableWidget(button); rowWidgets.add(new ScrollBinding(button, y + 9));
    }
    private void addInfo(String title, String description) {
        if (!matchesQuery(title, description)) return;
        int y = rowY(rows.size()); rows.add(new Row(title, description, "", y));
    }

    private void addSlider(String title, String description, int min, int max, int step,
                           IntSupplier getter, IntConsumer setter, String suffix) {
        if (!matchesQuery(title, description)) return;
        int y = rowY(rows.size()); rows.add(new Row(title, description + " Right arrow keys adjust; Edit accepts an exact value.", "", y));
        int sliderWidth = Math.min(174, Math.max(92, panelWidth / 3));
        SwirlSlider slider = new SwirlSlider(left + panelWidth - sliderWidth - 64, y + 9, sliderWidth, 22,
            min, max, step, getter::getAsInt, value -> setter.accept((int)Math.round(value)),
            value -> Integer.toString((int)Math.round(value)) + suffix, history::remember);
        SwirlButton edit = new SwirlButton(left + panelWidth - 58, y + 9, 38, 22, Component.literal("EDIT"), () -> {
            history.remember();
            ScreenBridge.show(minecraft, new NumericEditScreen(this, title, min, max, getter, setter));
        });
        addRenderableWidget(slider); addRenderableWidget(edit);
        rowWidgets.add(new ScrollBinding(slider, y + 9)); rowWidgets.add(new ScrollBinding(edit, y + 9));
    }

    private void addColor(String title, IntSupplier getter, IntConsumer setter) {
        addAction(title, "HSV square, hue strip, live preview, and exact hex entry.", "PICK",
            () -> ScreenBridge.show(minecraft, new ColorPickerScreen(this, getter, setter)));
    }
    private void addBinding(String title, String description, String action, Supplier<String> getter, Consumer<String> setter) {
        if (!matchesQuery(title, description)) return;
        String serialized = getter.get(); String conflict = SwirlBindings.conflict(action, serialized);
        int y = rowY(rows.size()); rows.add(new Row(title, description, conflict.isEmpty() ? "" : "Already used by " + conflict, y));
        Component message = capturing != null && capturing.equals(action) ? Component.literal("PRESS A KEY...") : SwirlBindings.key(serialized).getDisplayName();
        SwirlButton button = new SwirlButton(left + panelWidth - 166, y + 9, 146, 22,
            message, () -> { focusSearch = false; capturing = action; captureSetter = setter; rebuildWidgets(); }).danger(!conflict.isEmpty());
        addRenderableWidget(button); rowWidgets.add(new ScrollBinding(button, y + 9));
    }
    private void addText(String title, String description, Supplier<String> getter, Consumer<String> setter) {
        addAction(title, description, "EDIT", () -> ScreenBridge.show(minecraft, new TextEditScreen(this, title, getter, setter)));
    }
    private void addVisualColor(String title, java.util.function.IntSupplier getter, java.util.function.IntConsumer setter) {
        addAction(title, "Open the HSV square, hue strip, and hex editor.", "PICK", () -> ScreenBridge.show(minecraft, new ColorPickerScreen(this, getter, setter)));
    }
    private static int cycle(int current, int... values) { for (int i = 0; i < values.length; i++) if (current == values[i]) return values[(i + 1) % values.length]; return values[0]; }
    private boolean matchesQuery(String title, String description) {
        String needle = query.trim().toLowerCase(Locale.ROOT);
        return needle.isEmpty() || title.toLowerCase(Locale.ROOT).contains(needle) || description.toLowerCase(Locale.ROOT).contains(needle);
    }
    private HudConfig.VisualSettings visuals() { return SwirlHud.config().visuals; }
    private int rowY(int index) { return top + 152 + index * 45; }
    private HudConfig.Element element() { return SwirlHud.config().element(moduleId); }
    private void resetBehavior(HudConfig.Element e) {
        if (ModuleRegistry.byId(moduleId) != null && ModuleRegistry.byId(moduleId).kind() == ModuleRegistry.Kind.VISUAL) VisualModuleService.reset(moduleId);
        else e.options = new HudConfig.Options();
        rebuildWidgets();
    }
    private void resetEverything(HudConfig.Element e) { resetBehavior(e); e.appearance = new HudConfig.Appearance(); e.scale = 1.0f; }

    @Override public boolean keyPressed(KeyEvent event) {
        if (capturing != null) {
            if (event.key() == GLFW.GLFW_KEY_ESCAPE) { capturing = null; captureSetter = null; rebuildWidgets(); return true; }
            if (event.key() == GLFW.GLFW_KEY_DELETE || event.key() == GLFW.GLFW_KEY_BACKSPACE) bind(InputConstants.UNKNOWN);
            else bind(InputConstants.getKey(event));
            return true;
        }
        if ((event.modifiers() & GLFW.GLFW_MOD_CONTROL) != 0 && event.key() == GLFW.GLFW_KEY_Z) {
            if (history.undo()) rebuildWidgets(); return true;
        }
        if ((event.modifiers() & GLFW.GLFW_MOD_CONTROL) != 0 && event.key() == GLFW.GLFW_KEY_Y) {
            if (history.redo()) rebuildWidgets(); return true;
        }
        if (getFocused() instanceof EditBox) return super.keyPressed(event);
        if (event.key() == GLFW.GLFW_KEY_HOME) { scroll.moveTo(0, SwirlHud.config().general.reducedMotion); return true; }
        if (event.key() == GLFW.GLFW_KEY_END) { scroll.moveTo(scroll.maximum(), SwirlHud.config().general.reducedMotion); return true; }
        if (event.key() == GLFW.GLFW_KEY_PAGE_UP || event.key() == GLFW.GLFW_KEY_PAGE_DOWN) {
            double amount = panelHeight - 190;
            scroll.moveTo(scroll.target() + (event.key() == GLFW.GLFW_KEY_PAGE_DOWN ? amount : -amount), SwirlHud.config().general.reducedMotion); return true;
        }
        return super.keyPressed(event);
    }
    @Override public boolean mouseClicked(MouseButtonEvent event, boolean doubled) {
        if (capturing != null) { bind(InputConstants.Type.MOUSE.getOrCreate(event.button())); return true; }
        int trackTop = top + 148, trackHeight = panelHeight - 162;
        int thumb = scroll.thumbSize(trackHeight, trackHeight + (int)Math.ceil(scroll.maximum()));
        int thumbY = trackTop + scroll.thumbOffset(trackHeight, thumb);
        if (scroll.maximum() > 0 && event.button() == 0 && event.x() >= left + panelWidth - 14 && event.x() <= left + panelWidth && event.y() >= trackTop && event.y() <= trackTop + trackHeight) {
            draggingScrollbar = true;
            scrollbarGrab = event.y() >= thumbY && event.y() <= thumbY + thumb ? event.y() - thumbY : thumb / 2.0;
            scroll.dragThumb(event.y(), trackTop, scrollbarGrab, trackHeight, thumb, true); return true;
        }
        return super.mouseClicked(event, doubled);
    }
    @Override public boolean mouseDragged(MouseButtonEvent event, double dx, double dy) {
        if (draggingScrollbar) {
            int trackTop = top + 148, trackHeight = panelHeight - 162;
            int thumb = scroll.thumbSize(trackHeight, trackHeight + (int)Math.ceil(scroll.maximum()));
            scroll.dragThumb(event.y(), trackTop, scrollbarGrab, trackHeight, thumb, true); return true;
        }
        return super.mouseDragged(event, dx, dy);
    }
    @Override public boolean mouseReleased(MouseButtonEvent event) { draggingScrollbar = false; return super.mouseReleased(event); }
    private void bind(InputConstants.Key key) { history.remember(); captureSetter.accept(key.getName()); capturing = null; captureSetter = null; rebuildWidgets(); }
    @Override public boolean mouseScrolled(double x, double y, double sx, double sy) {
        if (!scroll.contains(x, y, left + 8, top + 148, left + panelWidth - 8, top + panelHeight - 14)) return super.mouseScrolled(x, y, sx, sy);
        scroll.wheel(sy, 48.0); return true;
    }

    @Override public void extractRenderState(GuiGraphicsExtractor g, int mouseX, int mouseY, float delta) {
        long now = System.nanoTime();
        double seconds = lastRenderNanos == 0 ? 1.0 / 60.0 : Math.min(0.05, (now - lastRenderNanos) / 1_000_000_000.0);
        lastRenderNanos = now;
        scroll.update(seconds, SwirlHud.config().general.reducedMotion);
        updateRowWidgets();
        int alpha = Math.round(SwirlHud.config().general.dimStrength * 255.0f / 100.0f);
        g.fill(0, 0, width, height, alpha << 24); g.fill(left, top, left + panelWidth, top + panelHeight, SwirlTheme.SURFACE);
        g.outline(left, top, panelWidth, panelHeight, SwirlTheme.BORDER_STRONG); g.horizontalLine(left, left + panelWidth, top + 43, SwirlTheme.PLUM);
        ModuleRegistry.Module module = ModuleRegistry.byId(moduleId); String title = module == null ? moduleId : module.title();
        g.centeredText(font, title.toUpperCase(Locale.ROOT), left + panelWidth / 2, top + 17, SwirlTheme.TEXT);
        g.fill(left + 14, top + 73, left + 62, top + 121, SwirlTheme.RAISED); g.outline(left + 14, top + 73, 48, 48, SwirlTheme.PLUM);
        g.blit(moduleImage(moduleId), left + 18, top + 77, left + 58, top + 117, 0.0f, 1.0f, 0.0f, 1.0f);
        if (module != null) g.text(font, trim(module.description(), panelWidth - 118), left + 96, top + 88, SwirlTheme.TEXT, true);
        g.text(font, page == Page.ESSENTIALS ? "ESSENTIALS" : "ADVANCED", left + 96, top + 105, SwirlTheme.PLUM_BRIGHT, true);
        if (!notice.isBlank()) g.text(font, notice, left + 185, top + 105, SwirlTheme.MUTED, false);
        g.enableScissor(left + 8, top + 148, left + panelWidth - 8, top + panelHeight - 14);
        for (Row row : rows) {
            int y = row.y - scroll.rounded();
            if (y >= top + panelHeight - 14 || y + 40 <= top + 148) continue;
            g.fill(left + 14, y, left + panelWidth - 14, y + 40, SwirlTheme.RAISED); g.outline(left + 14, y, panelWidth - 28, 40, row.warning.isEmpty() ? SwirlTheme.BORDER : 0xFFFF4058);
            g.text(font, row.title, left + 23, y + 7, SwirlTheme.TEXT, true);
            g.text(font, trim(row.warning.isEmpty() ? row.description : row.warning, panelWidth - 205), left + 23, y + 23, row.warning.isEmpty() ? SwirlTheme.MUTED : 0xFFFF6476, false);
        }
        g.disableScissor();
        if (scroll.maximum() > 0) {
            int trackTop = top + 148, trackHeight = panelHeight - 162;
            int thumb = scroll.thumbSize(trackHeight, trackHeight + (int)Math.ceil(scroll.maximum()));
            int y = trackTop + scroll.thumbOffset(trackHeight, thumb);
            g.fill(left + panelWidth - 5, trackTop, left + panelWidth - 2, trackTop + trackHeight, SwirlTheme.SOFT);
            g.fill(left + panelWidth - 5, y, left + panelWidth - 2, y + thumb, SwirlTheme.PLUM_BRIGHT);
        }
        super.extractRenderState(g, mouseX, mouseY, delta);
    }
    private void updateRowWidgets() {
        int clipTop = top + 148, clipBottom = top + panelHeight - 14;
        for (ScrollBinding binding : rowWidgets) {
            int y = binding.baseY - scroll.rounded(); binding.widget.setY(y);
            binding.widget.visible = y >= clipTop && y + binding.widget.getHeight() <= clipBottom;
        }
    }
    private String initials(String title) { StringBuilder v = new StringBuilder(); for (String p : title.split(" ")) if (!p.isEmpty()) v.append(Character.toUpperCase(p.charAt(0))); return v.substring(0, Math.min(3, v.length())); }
    static Identifier moduleImage(String id) { return Identifier.fromNamespaceAndPath("swirl_client", "textures/gui/modules/" + id + ".png"); }
    private String trim(String value, int max) { if (font.width(value) <= max) return value; while (!value.isEmpty() && font.width(value + "...") > max) value = value.substring(0, value.length() - 1); return value + "..."; }
    private void closeAll() { SwirlHud.config().save(); ScreenBridge.show(minecraft, null); }
    @Override public boolean isPauseScreen() { return false; }
    @Override public void onClose() { SwirlHud.config().save(); ScreenBridge.show(minecraft, parent); }
}
