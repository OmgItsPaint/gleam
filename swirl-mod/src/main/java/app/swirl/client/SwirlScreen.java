package app.swirl.client;

import app.swirl.screen.SmoothScrollState;

import net.minecraft.client.gui.GuiGraphicsExtractor;
import net.minecraft.client.gui.components.EditBox;
import net.minecraft.client.gui.components.AbstractWidget;
import net.minecraft.client.gui.screens.ConfirmScreen;
import net.minecraft.client.gui.screens.Screen;
import net.minecraft.client.input.MouseButtonEvent;
import net.minecraft.client.input.KeyEvent;
import net.minecraft.network.chat.Component;
import org.lwjgl.glfw.GLFW;

import java.util.ArrayList;
import java.util.List;
import java.util.Locale;
import java.util.Set;
import app.swirl.identity.SwirlHostClient;

final class SwirlScreen extends Screen {
    private enum Page { MODULES, SETTINGS }
    private enum SettingsPage { INTERFACE, HUD_DEFAULTS, PRESETS }
    private static final class Card {
        final ModuleRegistry.Module module; final int x, contentY, width, height;
        final SwirlButton favorite, options, toggle;
        Card(ModuleRegistry.Module module, int x, int contentY, int width, int height,
             SwirlButton favorite, SwirlButton options, SwirlButton toggle) {
            this.module = module; this.x = x; this.contentY = contentY; this.width = width; this.height = height;
            this.favorite = favorite; this.options = options; this.toggle = toggle;
        }
    }
    private record Setting(String title, String description, String value, int x, int y, int width, int height, boolean compact) {}
    private record ScrollBinding(AbstractWidget widget, int baseY) {}

    private final Screen parent;
    private final List<Card> cards = new ArrayList<>();
    private final List<Setting> settings = new ArrayList<>();
    private final List<ScrollBinding> settingWidgets = new ArrayList<>();
    private Page page = Page.MODULES;
    private SettingsPage settingsPage = SettingsPage.INTERFACE;
    private final CustomizationHistory history = new CustomizationHistory(SwirlHud.config());
    private String filter = "RECOMMENDED";
    private String query = "";
    private final SmoothScrollState catalogScroll = new SmoothScrollState();
    private int panelLeft;
    private int panelTop;
    private int panelWidth;
    private int panelHeight;
    private int columns;
    private int visibleRows;
    private int totalRows;
    private int moduleContentTop, moduleContentBottom, moduleRowStep;
    private long lastRenderNanos;
    private boolean draggingScrollbar;
    private double scrollbarGrab;
    private boolean focusSearch;
    private boolean compactSettings;
    private final SmoothScrollState settingsScroll = new SmoothScrollState();
    private int settingsContentHeight;

    SwirlScreen(Screen parent) {
        super(Component.literal("Gleam modules"));
        this.parent = parent;
    }

    @Override
    protected void init() {
        cards.clear();
        settings.clear();
        settingWidgets.clear();
        panelWidth = Math.min(1120, width - 24);
        panelHeight = Math.min(720, height - 24);
        panelLeft = (width - panelWidth) / 2;
        panelTop = (height - panelHeight) / 2;

        int x = panelLeft + 14;
        int y = panelTop + 12;
        boolean compactHeader = panelWidth < 500;
        int tabWidth = compactHeader ? 64 : 96;
        int tabGap = compactHeader ? 6 : 6;
        int backWidth = compactHeader ? 40 : 54;
        int backX = compactHeader ? panelLeft + panelWidth - 88 : panelLeft + panelWidth - 102;
        addRenderableWidget(new SwirlButton(x, y, tabWidth, 22, Component.literal(compactHeader ? "MODS" : "MODULES"), () -> switchPage(Page.MODULES)).selected(page == Page.MODULES));
        addRenderableWidget(new SwirlButton(x + tabWidth + tabGap, y, tabWidth, 22, Component.literal(compactHeader ? "SET" : "SETTINGS"), () -> switchPage(Page.SETTINGS)).selected(page == Page.SETTINGS));
        if (SwirlHostClient.available()) addRenderableWidget(new SwirlButton(x + (tabWidth + tabGap) * 2, y, tabWidth, 22,
            Component.literal("SERVER"), () -> ScreenBridge.show(minecraft, new HostManagerScreen(this))).selected(false));
        addRenderableWidget(new SwirlButton(backX, y, backWidth, 22, Component.literal("BACK"), this::onClose));
        addRenderableWidget(new SwirlButton(panelLeft + panelWidth - 42, y, 28, 22, Component.literal("X"), this::closeAll).danger(true));

        if (page == Page.MODULES) initModules();
        else initSettings();
    }

    private void switchPage(Page next) { page = next; catalogScroll.moveTo(0, true); settingsScroll.moveTo(0, true); rebuildWidgets(); }

    private void initModules() {
        int top = panelTop + 44;
        boolean narrow = panelWidth < 700;
        int searchX = narrow ? panelLeft + 14 : panelLeft + panelWidth - 230;
        int searchWidth = narrow ? panelWidth - 28 : 216;
        EditBox search = new EditBox(font, searchX, top, searchWidth, 20, Component.literal("Search modules"));
        search.setHint(Component.literal("Search modules..."));
        search.setMaxLength(40);
        search.setValue(query);
        search.setResponder(value -> {
            if (value.equals(query)) return;
            query = value;
            catalogScroll.moveTo(0, true);
            focusSearch = true;
            rebuildWidgets();
        });
        addRenderableWidget(search);
        if (focusSearch) setInitialFocus(search);

        String[] filters = { "RECOMMENDED", "ALL", "ENABLED", "HUD", "VISUAL", "WORLD", "SYSTEM", "FAVORITES" };
        int fx = panelLeft + 14;
        int filterY = narrow ? top + 27 : top;
        for (String value : filters) {
            int buttonWidth = narrow ? (panelWidth - 28 - 5 * (filters.length - 1)) / filters.length : value.equals("RECOMMENDED") ? 94 : value.equals("FAVORITES") ? 84 : value.equals("ENABLED") || value.equals("VISUAL") ? 70 : 58;
            String label = narrow && value.equals("RECOMMENDED") ? "START" : narrow && value.equals("FAVORITES") ? "FAVS" : narrow && value.equals("ENABLED") ? "ON" : value;
            addRenderableWidget(new SwirlButton(fx, filterY, buttonWidth, 20, Component.literal(label), () -> {
                filter = value; catalogScroll.moveTo(0, true); focusSearch = false; rebuildWidgets();
            }).selected(filter.equals(value)));
            fx += buttonWidth + 5;
        }

        int contentTop = top + (narrow ? 57 : 32);
        int contentBottom = panelTop + panelHeight - 14;
        moduleContentTop = contentTop; moduleContentBottom = contentBottom;
        int gap = 8;
        columns = moduleColumns(panelWidth, SwirlHud.config().general.menuScale);
        int cardWidth = (panelWidth - 28 - gap * (columns - 1)) / columns;
        int cardHeight = moduleCardHeight(SwirlHud.config().general.menuScale, SwirlHud.config().interfaceTheme.cardDensity);
        visibleRows = Math.max(1, (contentBottom - contentTop + gap) / (cardHeight + gap));
        moduleRowStep = cardHeight + gap;

        List<ModuleRegistry.Module> modules = filteredModules();
        totalRows = (modules.size() + columns - 1) / columns;
        catalogScroll.maximum(Math.max(0, totalRows * moduleRowStep - gap - (contentBottom - contentTop)));
        for (int index = 0; index < modules.size(); index++) {
            int cx = panelLeft + 14 + (index % columns) * (cardWidth + gap);
            int contentY = (index / columns) * moduleRowStep;
            int cy = contentTop + contentY - catalogScroll.rounded();
            ModuleRegistry.Module module = modules.get(index);
            HudConfig.Element element = SwirlHud.config().element(module.id());
            int optionsY = cy + cardHeight - 43;
            int toggleY = cy + cardHeight - 22;
            SwirlButton favorite = new SwirlButton(cx + cardWidth - 29, cy + 6, 21, 17,
                Component.literal("♥"), () -> toggleFavorite(module.id()))
                .selected(SwirlHud.config().favorites.contains(module.id()))
                .narration(Component.literal("Favorite " + module.title()));
            SwirlButton options = new SwirlButton(cx + 8, optionsY, cardWidth - 16, 18,
                Component.literal("OPTIONS   ⚙"), () -> openOptions(module.id()))
                .narration(Component.literal("Open options for " + module.title()));
            SwirlButton toggle = new SwirlButton(cx + 8, toggleY, cardWidth - 16, 18,
                Component.literal(element != null && element.enabled ? "ENABLED" : "DISABLED"), () -> toggleModule(module.id()))
                .selected(element != null && element.enabled)
                .narration(Component.literal("Toggle " + module.title() + ", " + (element != null && element.enabled ? "enabled" : "disabled")));
            addRenderableWidget(favorite); addRenderableWidget(options); addRenderableWidget(toggle);
            cards.add(new Card(module, cx, contentY, cardWidth, cardHeight, favorite, options, toggle));
        }
    }

    private List<ModuleRegistry.Module> filteredModules() {
        String needle = query.trim().toLowerCase(Locale.ROOT);
        List<ModuleRegistry.Module> result = new ArrayList<>();
        for (ModuleRegistry.Module module : ModuleRegistry.MODULES) {
            HudConfig.Element element = SwirlHud.config().element(module.id());
            boolean category = filter.equals("ALL") || (filter.equals("RECOMMENDED") && ModuleRegistry.recommended(module.id())) || filter.equals(module.category().name()) ||
                (filter.equals("ENABLED") && element != null && element.enabled) ||
                (filter.equals("FAVORITES") && SwirlHud.config().favorites.contains(module.id()));
            boolean search = needle.isEmpty() || module.title().toLowerCase(Locale.ROOT).contains(needle) ||
                module.description().toLowerCase(Locale.ROOT).contains(needle) || ModuleRegistry.searchTerms(module.id()).contains(needle);
            if (category && search) result.add(module);
        }
        return result;
    }

    private void toggleModule(String id) {
        HudConfig.Element element = SwirlHud.config().element(id);
        ModuleRegistry.Module module = ModuleRegistry.byId(id);
        if (element != null && (module == null || module.kind() != ModuleRegistry.Kind.VISUAL ||
            VisualModuleService.compatibility(id) == ModuleRegistry.Compatibility.AVAILABLE)) element.enabled = !element.enabled;
        focusSearch = false; rebuildWidgets();
    }

    private void toggleFavorite(String id) {
        if (!SwirlHud.config().favorites.add(id)) SwirlHud.config().favorites.remove(id);
        focusSearch = false; rebuildWidgets();
    }

    private void openOptions(String id) {
        SwirlHud.config().save();
        ScreenBridge.show(minecraft, new ModuleSettingsScreen(this, id));
    }

    private void initSettings() {
        HudConfig.General general = SwirlHud.config().general;
        HudConfig.InterfaceTheme theme = SwirlHud.config().interfaceTheme;
        HudConfig.Appearance appearance = SwirlHud.config().appearanceDefaults;
        compactSettings = panelWidth < 540;
        int tabY = panelTop + 45;
        int tabWidth = Math.max(74, Math.min(112, (panelWidth - 38) / 3));
        int tabX = panelLeft + 14;
        for (SettingsPage candidate : SettingsPage.values()) {
            String label = candidate == SettingsPage.HUD_DEFAULTS ? "HUD DEFAULTS" : candidate.name();
            addRenderableWidget(new SwirlButton(tabX, tabY, tabWidth, 20, Component.literal(label), () -> {
                settingsPage = candidate; settingsScroll.moveTo(0, true); rebuildWidgets();
            }).selected(settingsPage == candidate));
            tabX += tabWidth + 5;
        }
        int top = panelTop + 84;
        int gap = 5;
        int columnWidth = panelWidth - 28;
        int resetX = panelWidth < 500 ? panelLeft + 150 : panelLeft + panelWidth - 196;
        int resetWidth = panelWidth < 500 ? Math.min(90, Math.max(42, panelLeft + panelWidth - 94 - resetX)) : 88;
        addRenderableWidget(new SwirlButton(resetX, panelTop + 12, resetWidth, 22,
            Component.literal(panelWidth < 500 ? "RESET" : "RESET ALL"), this::confirmReset).danger(true).narration(Component.literal("Reset all Gleam HUD data")));
        int rows = switch (settingsPage) {
            case INTERFACE -> initInterfaceSettings(general, theme, top, columnWidth, gap);
            case HUD_DEFAULTS -> initHudDefaultSettings(appearance, top, columnWidth, gap);
            case PRESETS -> initPresetSettings(top, columnWidth, gap);
        };
        settingsContentHeight = rows * (compactSettings ? 40 : 45);
        settingsScroll.maximum(Math.max(0, settingsContentHeight - (panelHeight - 128)));
    }

    private int initInterfaceSettings(HudConfig.General general, HudConfig.InterfaceTheme theme, int top, int width, int gap) {
        int i = 0;
        addSetting("ACCENT MODE", "Static, two-color midpoint, or animated chroma interface accent.", switch (theme.accentMode) { case 1 -> "GRADIENT"; case 2 -> "CHROMA"; default -> "STATIC"; }, i++, () -> theme.accentMode = (theme.accentMode + 1) % 3, top, width, gap);
        addSetting("PRIMARY ACCENT", "Choose the main focus and border color.", "PICK", i++, () -> ScreenBridge.show(minecraft, new ColorPickerScreen(this, () -> theme.accentColor, v -> theme.accentColor = v)), top, width, gap);
        addSetting("SECONDARY ACCENT", "Second gradient endpoint and chroma seed.", "PICK", i++, () -> ScreenBridge.show(minecraft, new ColorPickerScreen(this, () -> theme.secondaryAccent, v -> theme.secondaryAccent = v)), top, width, gap);
        addSliderSetting("MENU SCALE", "Scale the complete Gleam menu.", 70, 140, 5, () -> general.menuScale, v -> general.menuScale = v, "%", i++, top, width);
        addSliderSetting("ICON SIZE", "Catalog icon size while preserving aspect ratio.", 48, 96, 4, () -> theme.iconSize, v -> theme.iconSize = v, " PX", i++, top, width);
        addSliderSetting("PANEL OPACITY", "Opacity of near-black menu surfaces.", 45, 100, 1, () -> theme.panelOpacity, v -> theme.panelOpacity = v, "%", i++, top, width);
        addSliderSetting("WORLD DIM", "Darkness behind Gleam screens.", 0, 95, 1, () -> general.dimStrength, v -> general.dimStrength = v, "%", i++, top, width);
        addSliderSetting("FOCUS STRENGTH", "Brightness of keyboard focus outlines.", 25, 100, 5, () -> theme.focusStrength, v -> theme.focusStrength = v, "%", i++, top, width);
        addSetting("CARD DENSITY", "Compact, comfortable, or spacious module cards.", switch (theme.cardDensity) { case 0 -> "COMPACT"; case 2 -> "SPACIOUS"; default -> "COMFORTABLE"; }, i++, () -> theme.cardDensity = (theme.cardDensity + 1) % 3, top, width, gap);
        addSetting("BACKDROP", "Flat black, soft veil, or world blur-ready presentation.", switch (theme.backdropStyle) { case 1 -> "VEIL"; case 2 -> "BLUR"; default -> "FLAT"; }, i++, () -> theme.backdropStyle = (theme.backdropStyle + 1) % 3, top, width, gap);
        addSetting("REDUCED MOTION", "Suppress nonessential interface and HUD transitions.", onOff(general.reducedMotion), i++, () -> general.reducedMotion = !general.reducedMotion, top, width, gap);
        addSetting("OPEN GLEAM KEY", "Managed here rather than vanilla Controls.", SwirlBindings.key(SwirlHud.config().bindings.openMenu).getDisplayName().getString(), i++, () -> ScreenBridge.show(minecraft, new BindingEditorScreen(this, "Open Gleam", () -> SwirlHud.config().bindings.openMenu, v -> SwirlHud.config().bindings.openMenu = v)), top, width, gap);
        addSetting("HOST MANAGER KEY", "Optional direct key while connected as a server manager.", SwirlBindings.key(SwirlHud.config().bindings.hostManager).getDisplayName().getString(), i++, () -> ScreenBridge.show(minecraft, new BindingEditorScreen(this, "Host Manager", () -> SwirlHud.config().bindings.hostManager, v -> SwirlHud.config().bindings.hostManager = v)), top, width, gap);
        return i;
    }

    private int initHudDefaultSettings(HudConfig.Appearance a, int top, int width, int gap) {
        int i = 0;
        addSetting("COLOR MODE", "Default static, gradient, or spatial chroma treatment.", switch (a.colorMode) { case 1 -> "GRADIENT"; case 2 -> "CHROMA"; default -> "STATIC"; }, i++, () -> a.colorMode = (a.colorMode + 1) % 3, top, width, gap);
        addSetting("PRIMARY COLOR", "Default label and value color.", "PICK", i++, () -> ScreenBridge.show(minecraft, new ColorPickerScreen(this, () -> a.primaryColor, v -> a.primaryColor = v)), top, width, gap);
        addSetting("GRADIENT COLOR", "Default second color stop.", "PICK", i++, () -> ScreenBridge.show(minecraft, new ColorPickerScreen(this, () -> a.secondaryColor, v -> a.secondaryColor = v)), top, width, gap);
        addSliderSetting("HUD OPACITY", "Overall module opacity.", 10, 100, 1, () -> a.opacity, v -> a.opacity = v, "%", i++, top, width);
        addSliderSetting("GRADIENT ANGLE", "Direction of two-stop gradients.", 0, 359, 1, () -> a.gradientAngle, v -> a.gradientAngle = v, "°", i++, top, width);
        addSliderSetting("CHROMA SPEED", "Rainbow animation speed.", 1, 400, 1, () -> a.chromaSpeed, v -> a.chromaSpeed = v, "%", i++, top, width);
        addSliderSetting("CHROMA SPREAD", "Spatial hue distance across each widget.", 1, 400, 1, () -> a.chromaSpread, v -> a.chromaSpread = v, "%", i++, top, width);
        addSliderSetting("BACKGROUND OPACITY", "Default near-black widget background.", 0, 100, 1, () -> a.backgroundOpacity, v -> a.backgroundOpacity = v, "%", i++, top, width);
        addSliderSetting("BORDER WIDTH", "Default HUD border thickness.", 0, 8, 1, () -> a.borderWidth, v -> a.borderWidth = v, " PX", i++, top, width);
        addSliderSetting("HORIZONTAL PADDING", "Space to the left and right of HUD content.", 0, 24, 1, () -> a.paddingX, v -> a.paddingX = v, " PX", i++, top, width);
        addSliderSetting("VERTICAL PADDING", "Space above and below HUD content.", 0, 24, 1, () -> a.paddingY, v -> a.paddingY = v, " PX", i++, top, width);
        addSliderSetting("TEXT SCALE", "Independent default text scale.", 50, 200, 5, () -> a.textScale, v -> a.textScale = v, "%", i++, top, width);
        addSetting("TEXT SHADOW", "Default contrast shadow for HUD text.", onOff(a.textShadow), i++, () -> a.textShadow = !a.textShadow, top, width, gap);
        addSetting("SHOW DURING F3", "Per-module overrides may replace this default.", onOff(!a.hideInDebug), i++, () -> a.hideInDebug = !a.hideInDebug, top, width, gap);
        return i;
    }

    private int initPresetSettings(int top, int width, int gap) {
        int i = 0;
        addSetting("SAVE HUD LAYOUT", "Name the current enabled HUD modules, positions, and scales.", "SAVE", i++, () -> {
            String suggested = "Layout " + (SwirlHud.config().layoutPresets.size() + 1);
            ScreenBridge.show(minecraft, new TextEditScreen(this, "Layout name", () -> suggested,
                name -> SwirlHud.config().layoutPresets.add(SwirlHud.config().captureLayoutPreset(name))));
        }, top, width, gap);
        for (HudConfig.LayoutPreset preset : List.copyOf(SwirlHud.config().layoutPresets)) {
            addSetting(preset.name.toUpperCase(Locale.ROOT), "Apply HUD module visibility, scale, and placement without changing appearance or behavior.", "APPLY", i++, () -> {
                history.remember();
                SwirlHud.config().applyLayoutPreset(preset);
            }, top, width, gap);
        }
        addSetting("SAVE CURRENT APPEARANCE", "Stores theme and appearance only; module state and positions are excluded.", "SAVE", i++, () -> {
            String name = "Appearance " + (SwirlHud.config().appearancePresets.size() + 1);
            SwirlHud.config().appearancePresets.add(SwirlHud.config().captureAppearancePreset(name));
        }, top, width, gap);
        addSetting("PASTE PRESET", "Import validated versioned JSON from the clipboard (64 KiB maximum).", "PASTE", i++, this::pasteAppearancePreset, top, width, gap);
        for (HudConfig.AppearancePreset preset : List.copyOf(SwirlHud.config().appearancePresets)) {
            addSetting(preset.name.toUpperCase(Locale.ROOT), "Apply globally with preview and session undo.", "APPLY", i++, () -> { history.remember(); SwirlHud.config().applyAppearancePreset(preset, HudConfig.PresetScope.ALL, Set.of()); }, top, width, gap);
        }
        return i;
    }

    private void addSliderSetting(String title, String description, int min, int max, int step, java.util.function.IntSupplier getter,
                                  java.util.function.IntConsumer setter, String suffix, int index, int top, int width) {
        int y = top + index * (compactSettings ? 40 : 45);
        settings.add(new Setting(title, description, "", panelLeft + 14, y, width, compactSettings ? 35 : 40, compactSettings));
        int sliderWidth = Math.min(190, Math.max(100, width / 3));
        int x = panelLeft + 14 + width - sliderWidth - 56;
        SwirlSlider slider = new SwirlSlider(x, y + 9, sliderWidth, 22, min, max, step, getter::getAsInt,
            value -> setter.accept((int)Math.round(value)), value -> (int)Math.round(value) + suffix, history::remember);
        SwirlButton edit = new SwirlButton(x + sliderWidth + 5, y + 9, 43, 22, Component.literal("EDIT"), () ->
            ScreenBridge.show(minecraft, new NumericEditScreen(this, title, min, max, getter, setter)));
        addRenderableWidget(slider); addRenderableWidget(edit);
        settingWidgets.add(new ScrollBinding(slider, y + 9)); settingWidgets.add(new ScrollBinding(edit, y + 9));
    }

    private void pasteAppearancePreset() {
        try {
            HudConfig.AppearancePreset preset = AppearancePresetCodec.decode(minecraft.keyboardHandler.getClipboard());
            SwirlHud.config().appearancePresets.add(preset);
        } catch (IllegalArgumentException ignored) { }
    }

    private void addSetting(String title, String description, String value, int index, Runnable action, int top, int columnWidth, int gap) {
        int x = panelLeft + 14;
        int rowStep = compactSettings ? 40 : 45;
        int boxHeight = compactSettings ? 35 : 40;
        int y = top + index * rowStep;
        settings.add(new Setting(title, description, value, x, y, columnWidth, boxHeight, compactSettings));
        int buttonWidth = compactSettings ? 76 : 100;
        int buttonHeight = compactSettings ? 16 : 22;
        int buttonY = y + (compactSettings ? 15 : 9);
        SwirlButton button = new SwirlButton(x + columnWidth - buttonWidth - 8, buttonY, buttonWidth, buttonHeight, Component.literal(value), () -> {
            focusSearch = false; action.run(); rebuildWidgets();
        }).selected(value.equals("ON")).narration(Component.literal(title + ": " + value));
        addRenderableWidget(button); settingWidgets.add(new ScrollBinding(button, buttonY));
    }

    private void confirmReset() {
        ConfirmScreen confirmation = new ConfirmScreen(result -> {
            if (result) SwirlHud.reset();
            page = Page.SETTINGS;
            ScreenBridge.show(minecraft, this);
        }, Component.literal("Reset all Gleam HUD data?"),
            Component.literal("Every module, layout position, favorite, color, and general setting will return to its default."));
        ScreenBridge.show(minecraft, confirmation);
    }

    private static int cycle(int current, int[] values) {
        for (int index = 0; index < values.length; index++) if (values[index] == current) return values[(index + 1) % values.length];
        return values[0];
    }

    static int moduleColumns(int availableWidth, int menuScale) {
        int gap = 8;
        int scaledMinimum = Math.round(210 * menuScale / 100.0f);
        return Math.max(1, Math.min(4, (availableWidth - 20 + gap) / (scaledMinimum + gap)));
    }

    static int moduleCardHeight(int menuScale) {
        return moduleCardHeight(menuScale, 1);
    }

    static int moduleCardHeight(int menuScale, int density) {
        int base = density == 0 ? 150 : density == 2 ? 184 : 166;
        return Math.max(142, Math.round(base * menuScale / 100.0f));
    }

    private static String onOff(boolean value) { return value ? "ON" : "OFF"; }

    @Override
    public boolean mouseScrolled(double mouseX, double mouseY, double scrollX, double scrollY) {
        if (page == Page.SETTINGS) {
            if (!settingsScroll.contains(mouseX, mouseY, panelLeft + 8, panelTop + 82, panelLeft + panelWidth - 8, panelTop + panelHeight - 38)) return false;
            settingsScroll.wheel(scrollY, 48.0); return true;
        }
        if (catalogScroll.maximum() <= 0 || !catalogScroll.contains(mouseX, mouseY, panelLeft + 8, moduleContentTop, panelLeft + panelWidth - 8, moduleContentBottom))
            return super.mouseScrolled(mouseX, mouseY, scrollX, scrollY);
        catalogScroll.wheel(scrollY, 52.0);
        return true;
    }

    @Override
    public void extractRenderState(GuiGraphicsExtractor graphics, int mouseX, int mouseY, float delta) {
        long now = System.nanoTime();
        double seconds = lastRenderNanos == 0 ? 1.0 / 60.0 : Math.min(0.05, (now - lastRenderNanos) / 1_000_000_000.0);
        lastRenderNanos = now;
        if (page == Page.MODULES) catalogScroll.update(seconds, SwirlHud.config().general.reducedMotion);
        else settingsScroll.update(seconds, SwirlHud.config().general.reducedMotion);
        updateCardWidgets();
        updateSettingWidgets();
        int alpha = Math.round(SwirlHud.config().general.dimStrength * 255.0f / 100.0f);
        graphics.fill(0, 0, width, height, alpha << 24);
        graphics.fill(panelLeft + 6, panelTop + 6, panelLeft + panelWidth + 6, panelTop + panelHeight + 6, 0xCC000000);
        graphics.fill(panelLeft, panelTop, panelLeft + panelWidth, panelTop + panelHeight, SwirlTheme.SURFACE);
        graphics.outline(panelLeft, panelTop, panelWidth, panelHeight, SwirlTheme.BORDER_STRONG);
        graphics.horizontalLine(panelLeft, panelLeft + panelWidth, panelTop + 40, SwirlTheme.PLUM);

        if (page == Page.MODULES) renderModules(graphics, mouseX, mouseY);
        else renderSettings(graphics);
        super.extractRenderState(graphics, mouseX, mouseY, delta);
    }

    private void renderModules(GuiGraphicsExtractor graphics, int mouseX, int mouseY) {
        graphics.enableScissor(panelLeft + 8, moduleContentTop, panelLeft + panelWidth - 8, moduleContentBottom);
        for (Card card : cards) {
            int cardY = cardY(card);
            if (cardY >= moduleContentBottom || cardY + card.height <= moduleContentTop) continue;
            HudConfig.Element element = SwirlHud.config().element(card.module.id());
            boolean enabled = element != null && element.enabled;
            graphics.fill(card.x, cardY, card.x + card.width, cardY + card.height, SwirlTheme.RAISED);
            graphics.outline(card.x, cardY, card.width, card.height, enabled ? SwirlTheme.PLUM : SwirlTheme.BORDER);
            boolean bannerHovered = mouseX >= card.x && mouseX < card.x + card.width && mouseY >= Math.max(moduleContentTop, cardY) && mouseY < Math.min(moduleContentBottom, cardY + card.height - 48);
            if (bannerHovered) graphics.outline(card.x + 3, cardY + 3, card.width - 6, card.height - 54, SwirlTheme.PLUM_BRIGHT);
            graphics.text(font, trim(card.module.title().toUpperCase(Locale.ROOT), card.width - 45), card.x + 8, cardY + 9, enabled ? SwirlTheme.TEXT : SwirlTheme.MUTED, true);
            if (card.module.kind() == ModuleRegistry.Kind.VISUAL && VisualModuleService.compatibility(card.module.id()) != ModuleRegistry.Compatibility.AVAILABLE)
                graphics.text(font, VisualModuleService.compatibilityLabel(card.module.id()), card.x + 8, cardY + 20, 0xFFFF6476, false);
            int configuredIconSize = SwirlHud.config().interfaceTheme.iconSize;
            int imageSize = Math.min(Math.max(48, configuredIconSize), Math.min(card.width - 34, card.height - 90));
            int imageX = card.x + (card.width - imageSize) / 2;
            int imageY = cardY + 28;
            graphics.blit(ModuleSettingsScreen.moduleImage(card.module.id()), imageX, imageY, imageX + imageSize, imageY + imageSize, 0.0f, 1.0f, 0.0f, 1.0f);
            int descriptionY = imageY + imageSize + 3;
            if (!bannerHovered && descriptionY < cardY + card.height - 48)
                graphics.centeredText(font, trim(card.module.description(), card.width - 16), card.x + card.width / 2, descriptionY, SwirlTheme.MUTED);
            if (bannerHovered) graphics.centeredText(font, "CLICK FOR SETTINGS", card.x + card.width / 2, descriptionY, SwirlTheme.PLUM_BRIGHT);
        }
        graphics.disableScissor();
        if (cards.isEmpty()) graphics.centeredText(font, "No modules match this view.", panelLeft + panelWidth / 2, panelTop + panelHeight / 2, SwirlTheme.MUTED);
        if (catalogScroll.maximum() > 0) {
            int trackTop = moduleContentTop;
            int trackHeight = moduleContentBottom - moduleContentTop;
            int contentHeight = trackHeight + (int)Math.ceil(catalogScroll.maximum());
            int thumbHeight = Math.max(18, trackHeight * trackHeight / Math.max(1, contentHeight));
            int thumbY = trackTop + (int)Math.round((trackHeight - thumbHeight) * catalogScroll.position() / catalogScroll.maximum());
            graphics.fill(panelLeft + panelWidth - 5, trackTop, panelLeft + panelWidth - 2, trackTop + trackHeight, SwirlTheme.SOFT);
            graphics.fill(panelLeft + panelWidth - 5, thumbY, panelLeft + panelWidth - 2, thumbY + thumbHeight, SwirlTheme.PLUM_BRIGHT);
        }
    }

    @Override
    public boolean mouseClicked(MouseButtonEvent event, boolean doubled) {
        if (page == Page.MODULES || page == Page.SETTINGS) {
            SmoothScrollState state = page == Page.MODULES ? catalogScroll : settingsScroll;
            int trackTop = page == Page.MODULES ? moduleContentTop : panelTop + 82;
            int trackBottom = page == Page.MODULES ? moduleContentBottom : panelTop + panelHeight - 38;
            int track = trackBottom - trackTop;
            int content = track + (int)Math.ceil(state.maximum());
            int thumb = state.thumbSize(track, content);
            int thumbY = trackTop + state.thumbOffset(track, thumb);
            if (state.maximum() > 0 && event.button() == 0 && event.x() >= panelLeft + panelWidth - 14 && event.x() <= panelLeft + panelWidth && event.y() >= trackTop && event.y() <= trackBottom) {
                draggingScrollbar = true;
                scrollbarGrab = event.y() >= thumbY && event.y() <= thumbY + thumb ? event.y() - thumbY : thumb / 2.0;
                state.dragThumb(event.y(), trackTop, scrollbarGrab, track, thumb, true);
                return true;
            }
        }
        if (super.mouseClicked(event, doubled)) return true;
        if (page == Page.MODULES && event.button() == 0) {
            for (Card card : cards) {
                int cardY = cardY(card);
                if (event.x() >= card.x && event.x() < card.x + card.width && event.y() >= Math.max(moduleContentTop, cardY) &&
                    event.y() < Math.min(moduleContentBottom, cardY + card.height - 48)) {
                    openOptions(card.module.id());
                    return true;
                }
            }
        }
        return false;
    }

    @Override public boolean mouseDragged(MouseButtonEvent event, double dx, double dy) {
        if (draggingScrollbar) {
            SmoothScrollState state = page == Page.MODULES ? catalogScroll : settingsScroll;
            int trackTop = page == Page.MODULES ? moduleContentTop : panelTop + 82;
            int trackBottom = page == Page.MODULES ? moduleContentBottom : panelTop + panelHeight - 38;
            int track = trackBottom - trackTop;
            int thumb = state.thumbSize(track, track + (int)Math.ceil(state.maximum()));
            state.dragThumb(event.y(), trackTop, scrollbarGrab, track, thumb, true); return true;
        }
        return super.mouseDragged(event, dx, dy);
    }

    @Override public boolean mouseReleased(MouseButtonEvent event) {
        draggingScrollbar = false; return super.mouseReleased(event);
    }

    private int cardY(Card card) { return moduleContentTop + card.contentY - catalogScroll.rounded(); }
    private void updateCardWidgets() {
        if (page != Page.MODULES) return;
        for (Card card : cards) {
            int y = cardY(card);
            card.favorite.setY(y + 6); card.options.setY(y + card.height - 43); card.toggle.setY(y + card.height - 22);
            boolean fullyVisible = y >= moduleContentTop && y + card.height <= moduleContentBottom;
            card.favorite.visible = fullyVisible; card.options.visible = fullyVisible; card.toggle.visible = fullyVisible;
        }
    }

    private void renderSettings(GuiGraphicsExtractor graphics) {
        graphics.text(font, settingsPage == SettingsPage.HUD_DEFAULTS ? "GLOBAL HUD APPEARANCE" : settingsPage.name().replace('_', ' '), panelLeft + 14, panelTop + 68, SwirlTheme.PLUM_BRIGHT, true);
        graphics.enableScissor(panelLeft + 8, panelTop + 82, panelLeft + panelWidth - 8, panelTop + panelHeight - 38);
        for (Setting setting : settings) {
            int y = setting.y() - settingsScroll.rounded();
            if (y >= panelTop + panelHeight - 38 || y + setting.height() <= panelTop + 82) continue;
            graphics.fill(setting.x(), y, setting.x() + setting.width(), y + setting.height(), SwirlTheme.RAISED);
            graphics.outline(setting.x(), y, setting.width(), setting.height(), SwirlTheme.BORDER);
            graphics.text(font, setting.title(), setting.x() + 8, y + (setting.compact() ? 4 : 8), SwirlTheme.TEXT, true);
            if (!setting.compact()) graphics.text(font, trim(setting.description(), setting.width() - 126), setting.x() + 8, y + 23, SwirlTheme.MUTED, false);
        }
        graphics.disableScissor();
        if (!compactSettings) graphics.text(font, "Changes preview immediately and save when you leave Gleam.", panelLeft + 14,
            panelTop + panelHeight - 24, SwirlTheme.MUTED, false);
        if (settingsScroll.maximum() > 0) {
            int trackTop = panelTop + 82, trackHeight = panelHeight - 120;
            int thumb = settingsScroll.thumbSize(trackHeight, trackHeight + (int)Math.ceil(settingsScroll.maximum()));
            int y = trackTop + settingsScroll.thumbOffset(trackHeight, thumb);
            graphics.fill(panelLeft + panelWidth - 5, trackTop, panelLeft + panelWidth - 2, trackTop + trackHeight, SwirlTheme.SOFT);
            graphics.fill(panelLeft + panelWidth - 5, y, panelLeft + panelWidth - 2, y + thumb, SwirlTheme.PLUM_BRIGHT);
        }
    }

    private void updateSettingWidgets() {
        if (page != Page.SETTINGS) return;
        int top = panelTop + 82, bottom = panelTop + panelHeight - 38;
        for (ScrollBinding binding : settingWidgets) {
            int y = binding.baseY() - settingsScroll.rounded();
            binding.widget().setY(y);
            binding.widget().visible = y >= top && y + binding.widget().getHeight() <= bottom;
        }
    }

    @Override
    public boolean keyPressed(KeyEvent event) {
        if ((event.modifiers() & GLFW.GLFW_MOD_CONTROL) != 0 && event.key() == GLFW.GLFW_KEY_Z) {
            if (history.undo()) rebuildWidgets();
            return true;
        }
        if ((event.modifiers() & GLFW.GLFW_MOD_CONTROL) != 0 && event.key() == GLFW.GLFW_KEY_Y) {
            if (history.redo()) rebuildWidgets();
            return true;
        }
        if (getFocused() instanceof EditBox) return super.keyPressed(event);
        SmoothScrollState activeScroll = page == Page.MODULES ? catalogScroll : settingsScroll;
        if (event.key() == GLFW.GLFW_KEY_HOME) { activeScroll.moveTo(0, SwirlHud.config().general.reducedMotion); return true; }
        if (event.key() == GLFW.GLFW_KEY_END) { activeScroll.moveTo(activeScroll.maximum(), SwirlHud.config().general.reducedMotion); return true; }
        if (event.key() == GLFW.GLFW_KEY_PAGE_UP || event.key() == GLFW.GLFW_KEY_PAGE_DOWN) {
            double amount = panelHeight - 120;
            activeScroll.moveTo(activeScroll.target() + (event.key() == GLFW.GLFW_KEY_PAGE_DOWN ? amount : -amount), SwirlHud.config().general.reducedMotion); return true;
        }
        return super.keyPressed(event);
    }

    private String trim(String value, int maxWidth) {
        if (font.width(value) <= maxWidth) return value;
        String suffix = "...";
        while (!value.isEmpty() && font.width(value + suffix) > maxWidth) value = value.substring(0, value.length() - 1);
        return value + suffix;
    }

    private static String initials(String title) {
        StringBuilder value = new StringBuilder();
        for (String part : title.split(" ")) if (!part.isEmpty()) value.append(Character.toUpperCase(part.charAt(0)));
        return value.substring(0, Math.min(3, value.length()));
    }

    private void closeAll() { SwirlHud.config().save(); ScreenBridge.show(minecraft, null); }

    @Override public boolean isPauseScreen() { return false; }

    @Override
    public void onClose() {
        SwirlHud.config().save();
        ScreenBridge.show(minecraft, parent);
    }
}
