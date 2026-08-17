package app.swirl.client;

import app.swirl.identity.SwirlHostClient;
import com.google.gson.JsonArray;
import com.google.gson.JsonObject;
import net.minecraft.client.gui.GuiGraphicsExtractor;
import net.minecraft.client.gui.components.EditBox;
import net.minecraft.client.gui.screens.Screen;
import net.minecraft.network.chat.Component;

import java.util.ArrayList;
import java.util.List;
import java.util.Locale;

final class HostManagerScreen extends Screen {
    private enum Page { DASHBOARD, PLAYERS, CONSOLE, BACKUPS, MODS, DIAGNOSTICS, APPEARANCE }
    private final Screen parent;
    private Page page = Page.DASHBOARD;
    private JsonObject response;
    private String error = "";
    private boolean loading;
    private int left, top, panelWidth, panelHeight;
    private EditBox console;

    HostManagerScreen(Screen parent) {
        super(Component.literal("Gleam Host Manager"));
        this.parent = parent;
    }

    @Override protected void init() {
        clearWidgets();
        panelWidth = Math.min(1040, width - 24); panelHeight = Math.min(680, height - 24);
        left = (width - panelWidth) / 2; top = (height - panelHeight) / 2;
        addRenderableWidget(new SwirlButton(left + panelWidth - 64, top + 12, 50, 22, Component.literal("BACK"), this::onClose));
        int x = left + 14, y = top + 45;
        int buttonWidth = Math.max(54, Math.min(92, (panelWidth - 28 - (Page.values().length - 1) * 5) / Page.values().length));
        for (Page value : Page.values()) {
            String label = panelWidth < 650 ? value.name().substring(0, Math.min(4, value.name().length())) : value.name();
            addRenderableWidget(new SwirlButton(x, y, buttonWidth, 20, Component.literal(label), () -> switchPage(value)).selected(page == value));
            x += buttonWidth + 5;
        }
        if (page == Page.CONSOLE) {
            console = new EditBox(font, left + 18, top + panelHeight - 45, panelWidth - 126, 22, Component.literal("Server command"));
            console.setMaxLength(500); console.setHint(Component.literal("Command without slash")); addRenderableWidget(console);
            addRenderableWidget(new SwirlButton(left + panelWidth - 100, top + panelHeight - 45, 82, 22, Component.literal("SEND"), this::sendCommand));
        }
        if (page == Page.BACKUPS) {
            addRenderableWidget(new SwirlButton(left + 18, top + panelHeight - 45, 88, 22, Component.literal("HOURLY"), () -> schedule("hourly")));
            addRenderableWidget(new SwirlButton(left + 112, top + panelHeight - 45, 88, 22, Component.literal("DAILY"), () -> schedule("daily")));
            addRenderableWidget(new SwirlButton(left + 206, top + panelHeight - 45, 70, 22, Component.literal("OFF"), () -> schedule("off")));
        }
        if (page == Page.APPEARANCE) {
            addRenderableWidget(new SwirlButton(left + 18, top + 112, 130, 22, Component.literal("ACCENT COLOR"), () ->
                ScreenBridge.show(minecraft, new ColorPickerScreen(this, () -> SwirlHud.config().interfaceTheme.accentColor,
                    value -> SwirlHud.config().interfaceTheme.accentColor = value))));
            addRenderableWidget(new SwirlButton(left + 154, top + 112, 130, 22, Component.literal("ACCENT MODE"), () -> {
                SwirlHud.config().interfaceTheme.accentMode = (SwirlHud.config().interfaceTheme.accentMode + 1) % 3; SwirlHud.config().save();
            }));
            addRenderableWidget(new SwirlButton(left + 290, top + 112, 140, 22, Component.literal("REDUCED MOTION"), () -> {
                SwirlHud.config().general.reducedMotion = !SwirlHud.config().general.reducedMotion; SwirlHud.config().save();
            }));
        }
        refresh();
    }

    private void switchPage(Page value) { page = value; response = null; error = ""; rebuildWidgets(); }

    private void refresh() {
        if (page == Page.APPEARANCE) return;
        String operation = switch (page) {
            case DASHBOARD -> "dashboard"; case PLAYERS -> "players"; case CONSOLE -> "host.console.tail";
            case BACKUPS -> "host.backups.list"; case MODS -> "host.mods.list"; case DIAGNOSTICS -> "host.diagnostics";
            default -> "capabilities";
        };
        loading = true; error = "";
        SwirlHostClient.request(operation, new JsonObject(), value -> {
            loading = false;
            if (!value.get("ok").getAsBoolean()) { error = value.get("error").getAsString(); response = null; }
            else response = value.getAsJsonObject("result");
        });
    }

    private void sendCommand() {
        if (console == null || console.getValue().trim().isEmpty()) return;
        JsonObject payload = new JsonObject(); payload.addProperty("command", console.getValue().trim());
        SwirlHostClient.request("console.command", payload, value -> {
            if (!value.get("ok").getAsBoolean()) error = value.get("error").getAsString();
            else { console.setValue(""); error = "Command accepted."; }
        });
    }

    private void schedule(String value) {
        JsonObject payload = new JsonObject(); payload.addProperty("schedule", value);
        SwirlHostClient.request("host.backups.schedule", payload, result -> {
            error = result.get("ok").getAsBoolean() ? "Backup schedule changed to " + value + "." : result.get("error").getAsString(); refresh();
        });
    }

    @Override public void extractRenderState(GuiGraphicsExtractor graphics, int mouseX, int mouseY, float delta) {
        SwirlTheme.sync();
        int alpha = Math.round(SwirlHud.config().general.dimStrength * 255.0f / 100.0f);
        graphics.fill(0, 0, width, height, alpha << 24);
        graphics.fill(left, top, left + panelWidth, top + panelHeight, SwirlTheme.SURFACE);
        graphics.outline(left, top, panelWidth, panelHeight, SwirlTheme.BORDER_STRONG);
        graphics.horizontalLine(left, left + panelWidth, top + 39, SwirlTheme.PLUM);
        graphics.text(font, "GLEAM HOST MANAGER", left + 14, top + 17, SwirlTheme.TEXT, true);
        graphics.text(font, page.name().replace('_', ' '), left + 18, top + 82, SwirlTheme.PLUM_BRIGHT, true);
        int y = top + 104;
        if (page == Page.APPEARANCE) {
            graphics.text(font, "Personal to this isolated profile. It never changes another administrator's screen.", left + 18, y, SwirlTheme.MUTED, false);
            graphics.text(font, "Host Manager inherits Gleam's accent, panel opacity, scale, focus, and reduced-motion settings.", left + 18, y + 52, SwirlTheme.MUTED, false);
        } else if (loading) graphics.text(font, "Loading secure server data...", left + 18, y, SwirlTheme.MUTED, false);
        else if (!error.isEmpty() && response == null) graphics.text(font, trim(error, panelWidth - 36), left + 18, y, SwirlTheme.DANGER, false);
        else if (response != null) {
            for (String line : lines(response)) { graphics.text(font, trim(line, panelWidth - 36), left + 18, y, SwirlTheme.TEXT, false); y += 15; if (y > top + panelHeight - 70) break; }
        }
        if (!error.isEmpty() && response != null) graphics.text(font, trim(error, panelWidth - 36), left + 18, top + panelHeight - 64, SwirlTheme.MUTED, false);
        super.extractRenderState(graphics, mouseX, mouseY, delta);
    }

    private List<String> lines(JsonObject value) {
        List<String> result = new ArrayList<>();
        if (page == Page.DASHBOARD) {
            result.add(String.format(Locale.ROOT, "Players  %d / %d", number(value, "players"), number(value, "maxPlayers")));
            result.add(String.format(Locale.ROOT, "TPS  %.1f    Tick  %.2f ms", decimal(value, "tps"), decimal(value, "tickMs")));
            result.add("Uptime  " + duration(number(value, "uptimeSeconds")));
            result.add("Memory  " + mib(number(value, "memoryUsed")) + " / " + mib(number(value, "memoryMax")) + " MiB");
            result.add("Launcher bridge  " + (value.has("bridgeAvailable") && value.get("bridgeAvailable").getAsBoolean() ? "AVAILABLE" : "UNAVAILABLE"));
        } else if (page == Page.PLAYERS && value.has("players")) {
            for (var item : value.getAsJsonArray("players")) { JsonObject player = item.getAsJsonObject(); result.add(player.get("name").getAsString() + (player.get("operator").getAsBoolean() ? "  OPERATOR" : "")); }
            if (result.isEmpty()) result.add("No players are online.");
        } else if (page == Page.CONSOLE) {
            String text = value.has("text") ? value.get("text").getAsString() : "No console output.";
            String[] all = text.split("\\R"); for (int i = Math.max(0, all.length - 26); i < all.length; i++) result.add(all[i]);
        } else if (page == Page.BACKUPS && value.has("backups")) {
            JsonArray items = value.getAsJsonArray("backups"); result.add(items.size() + " verified backup" + (items.size() == 1 ? "" : "s"));
            for (var item : items) { JsonObject backup = item.getAsJsonObject(); result.add(backup.get("modifiedAt").getAsString() + "  " + mib(backup.get("size").getAsLong()) + " MiB"); }
        } else if (page == Page.MODS && value.has("mods")) {
            JsonArray items = value.getAsJsonArray("mods"); result.add(items.size() + " managed server mod" + (items.size() == 1 ? "" : "s"));
            for (var item : items) result.add(item.getAsJsonObject().get("name").getAsString());
        } else if (page == Page.DIAGNOSTICS && value.has("checks")) {
            for (var item : value.getAsJsonArray("checks")) { JsonObject check = item.getAsJsonObject(); result.add(check.get("level").getAsString().toUpperCase(Locale.ROOT) + "  " + check.get("title").getAsString() + " - " + check.get("detail").getAsString()); }
        } else for (var entry : value.entrySet()) result.add(entry.getKey() + "  " + entry.getValue());
        return result;
    }

    private long number(JsonObject value, String key) { return value.has(key) ? value.get(key).getAsLong() : 0; }
    private double decimal(JsonObject value, String key) { return value.has(key) ? value.get(key).getAsDouble() : 0; }
    private long mib(long bytes) { return Math.max(0, bytes / 1024 / 1024); }
    private String duration(long seconds) { return String.format(Locale.ROOT, "%dh %02dm", seconds / 3600, seconds / 60 % 60); }
    private String trim(String value, int maximum) { return font.width(value) <= maximum ? value : font.plainSubstrByWidth(value, Math.max(1, maximum - font.width("..."))) + "..."; }
    @Override public boolean isPauseScreen() { return false; }
    @Override public void onClose() { ScreenBridge.show(minecraft, parent); }
}
