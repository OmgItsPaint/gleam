package app.swirl.client;

import app.swirl.input.ClickTracker;

import net.fabricmc.fabric.api.client.rendering.v1.hud.HudElementRegistry;
import net.minecraft.client.DeltaTracker;
import net.minecraft.client.Minecraft;
import net.minecraft.client.gui.Font;
import net.minecraft.client.gui.GuiGraphicsExtractor;
import net.minecraft.client.multiplayer.PlayerInfo;
import net.minecraft.core.BlockPos;
import net.minecraft.network.chat.Component;
import net.minecraft.resources.Identifier;
import net.minecraft.world.effect.MobEffectInstance;
import net.minecraft.world.entity.EquipmentSlot;
import net.minecraft.world.item.ItemStack;
import net.minecraft.world.level.LightLayer;
import net.minecraft.world.phys.BlockHitResult;
import net.minecraft.world.phys.HitResult;

import java.time.LocalTime;
import java.time.format.DateTimeFormatter;
import java.util.ArrayList;
import java.util.Comparator;
import java.util.List;
import java.util.Locale;
import java.util.HashMap;
import java.util.Map;
import java.util.function.Supplier;

public final class SwirlHud {
    record Size(int width, int height) {}

    private static final Identifier ID = Identifier.fromNamespaceAndPath("swirl_client", "hud");
    private static final ClickTracker CLICKS = new ClickTracker();
    private static final EquipmentSlot[] ARMOR = { EquipmentSlot.HEAD, EquipmentSlot.CHEST, EquipmentSlot.LEGS, EquipmentSlot.FEET };
    private static HudConfig config = HudConfig.load();
    private static long stopwatchStarted;
    private static long stopwatchElapsed;
    private static boolean hadPosition;
    private static double previousX;
    private static double previousY;
    private static double previousZ;
    private static double speed;
    private static double verticalSpeed;
    private static double deltaX, deltaY, deltaZ;
    private static final Map<String, String> VALUE_CACHE = new HashMap<>();
    private static final Map<String, Long> CACHE_TIME = new HashMap<>();

    private SwirlHud() {}
    static void initialize() { HudElementRegistry.addLast(ID, SwirlHud::render); }
    static HudConfig config() { return config; }
    static void reload() { config = HudConfig.load(); }
    static void reset() { config = new HudConfig(); }

    static void tick(Minecraft client) {
        if (client.player == null) {
            hadPosition = false;
            speed = 0;
        } else {
            double x = client.player.getX();
            double z = client.player.getZ();
            double y = client.player.getY();
            if (hadPosition) {
                deltaX = x - previousX; deltaY = y - previousY; deltaZ = z - previousZ;
                double instant = Math.sqrt(square(deltaX) + square(deltaZ)) * 20.0;
                HudConfig.Element speedElement = config.element("speed");
                int smoothing = speedElement == null ? 1 : Math.max(1, speedElement.options.smoothingTicks);
                speed += (instant - speed) / smoothing;
                verticalSpeed += (deltaY * 20.0 - verticalSpeed) / smoothing;
            }
            previousX = x;
            previousY = y;
            previousZ = z;
            hadPosition = true;
        }
    }

    private static double square(double value) { return value * value; }
    static void recordClick(ClickTracker.Button button) { CLICKS.record(button, System.nanoTime()); }
    public static void recordLeftClick() { recordClick(ClickTracker.Button.LEFT); }
    public static void recordRightClick() { recordClick(ClickTracker.Button.RIGHT); }
    private static int clicks(ClickTracker.Button button, HudConfig.Options options) {
        return CLICKS.count(button, System.nanoTime(), options.cpsWindowMillis);
    }

    static void toggleStopwatch() {
        if (stopwatchStarted == 0) stopwatchStarted = System.currentTimeMillis();
        else { stopwatchElapsed += System.currentTimeMillis() - stopwatchStarted; stopwatchStarted = 0; }
    }
    static void resetStopwatch() { stopwatchStarted = 0; stopwatchElapsed = 0; }
    static boolean stopwatchRunning() { return stopwatchStarted != 0; }

    private static void render(GuiGraphicsExtractor graphics, DeltaTracker delta) {
        Minecraft client = Minecraft.getInstance();
        if (client.player == null) return;
        renderElements(graphics, client, false);
    }

    static void renderEditor(GuiGraphicsExtractor graphics) { renderElements(graphics, Minecraft.getInstance(), true); }

    private static void renderElements(GuiGraphicsExtractor graphics, Minecraft client, boolean editor) {
        for (HudConfig.Element element : config.elements) {
            if (!element.enabled) continue;
            ModuleRegistry.Module module = ModuleRegistry.byId(element.id);
            if (module == null || !module.draggable()) continue;
            HudConfig.Appearance appearance = config.resolvedAppearance(element);
            if (!editor && ((appearance.hideInDebug && client.getDebugOverlay().showDebugScreen()) ||
                (appearance.hideInScreens && ScreenBridge.hasOpenUi(client)) ||
                (appearance.hideInSpectator && client.player != null && client.player.isSpectator()))) continue;
            Size raw = rawSize(element, client, editor);
            if (raw.width <= 0 || raw.height <= 0) continue;
            float scale = scale(element);
            int scaledWidth = Math.max(1, Math.round(raw.width * scale));
            int scaledHeight = Math.max(1, Math.round(raw.height * scale));
            int x = config.screenX(element, graphics.guiWidth(), scaledWidth);
            int y = config.screenY(element, graphics.guiHeight(), scaledHeight);
            graphics.pose().pushMatrix();
            graphics.pose().translate(x, y);
            graphics.pose().scale(scale);
            if (appearance.backgroundOpacity > 0) graphics.fill(0, 0, raw.width, raw.height, background(appearance));
            if (appearance.borderWidth > 0 && appearance.borderOpacity > 0) {
                int border = Math.round(appearance.borderOpacity * 255 / 100.0f) << 24 | appearance.borderColor & 0xFFFFFF;
                for (int line = 0; line < appearance.borderWidth; line++) graphics.outline(line, line, raw.width - line * 2, raw.height - line * 2, border);
            }
            graphics.pose().pushMatrix();
            graphics.pose().translate(appearance.paddingX - 4, appearance.paddingY - 4);
            renderContent(graphics, element, client, editor, raw);
            graphics.pose().popMatrix();
            graphics.pose().popMatrix();
        }
    }

    static int renderedWidth(HudConfig.Element element, Minecraft client, boolean sample) {
        return Math.max(1, Math.round(rawSize(element, client, sample).width * scale(element)));
    }
    static int renderedHeight(HudConfig.Element element) {
        return Math.max(1, Math.round(rawSize(element, Minecraft.getInstance(), true).height * scale(element)));
    }
    private static float scale(HudConfig.Element element) {
        HudConfig.Appearance appearance = config.resolvedAppearance(element);
        return Math.max(0.5f, Math.min(4.0f, element.scale * appearance.textScale / 100.0f));
    }

    private static Size rawSize(HudConfig.Element element, Minecraft client, boolean sample) {
        Font font = client.font;
        Size base = switch (element.id) {
            case "keystrokes" -> keystrokeSize(element.options);
            case "potions" -> !sample && client.player != null && client.player.getActiveEffects().isEmpty() ? new Size(0, 0) : potionSize(font, client, sample, element.options);
            case "armor" -> armorSize(client, sample, element.options);
            case "direction" -> element.options.compassRibbon ? new Size(122, 23)
                : new Size(Math.max(24, font.width(text(element.id, client, sample)) + 8), 17);
            case "durability" -> !sample && heldItems(client, element.options).isEmpty() ? new Size(0, 0)
                : new Size(Math.max(48, font.width(text(element.id, client, sample)) + 28), 24 * Math.max(1, heldItems(client, element.options).size()));
            case "target_block" -> !sample && noTarget(client) ? new Size(0, 0) : new Size(Math.max(24, font.width(text(element.id, client, sample)) + 8), 17);
            case "toggle_sprint", "toggle_sneak" -> !sample && text(element.id, client, false).isBlank() ? new Size(0, 0) : new Size(Math.max(24, font.width(text(element.id, client, sample)) + 8), 17);
            default -> textSize(font, element, client, sample);
        };
        HudConfig.Appearance appearance = config.resolvedAppearance(element);
        return new Size(Math.max(1, base.width + (appearance.paddingX - 4) * 2), Math.max(1, base.height + (appearance.paddingY - 4) * 2));
    }
    private static Size textSize(Font font, HudConfig.Element element, Minecraft client, boolean sample) {
        String value = text(element.id, client, sample);
        if (!sample && value.isBlank()) return new Size(0, 0);
        if (element.id.equals("fps") && element.options.staticWidth) value = sample("fps");
        return new Size(Math.max(24, font.width(value) + 8), 17);
    }

    private static Size keystrokeSize(HudConfig.Options options) {
        int height = options.showMovement ? 42 : 0;
        if (options.showMouse) height += 22;
        if (options.showSpace) height += 10;
        return new Size(68, height);
    }

    private static Size potionSize(Font font, Minecraft client, boolean sample, HudConfig.Options options) {
        List<String> lines = potionLines(client, sample, options);
        if (options.horizontal) {
            String joined = String.join("  |  ", lines);
            return new Size(Math.max(78, font.width(joined) + 8), 17);
        }
        int width = 78;
        for (String line : lines) width = Math.max(width, font.width(line) + (options.showPotionIcons ? 18 : 8));
        return new Size(width, Math.max(17, lines.size() * 12 + 4));
    }

    private static Size armorSize(Minecraft client, boolean sample, HudConfig.Options options) {
        int count = sample || client.player == null ? 4 : armorItems(client).size();
        if (count == 0) return new Size(0, 0);
        return options.horizontal ? new Size(count * 19 + 3, options.showDurability ? 34 : 22)
            : new Size(options.showDurability ? 50 : 22, count * 19 + 3);
    }

    private static void renderContent(GuiGraphicsExtractor graphics, HudConfig.Element element, Minecraft client, boolean sample, Size size) {
        switch (element.id) {
            case "keystrokes" -> renderKeystrokes(graphics, client, element);
            case "potions" -> renderPotions(graphics, client, element, sample);
            case "armor" -> renderArmor(graphics, client, element, sample);
            case "direction" -> {
                if (element.options.compassRibbon) renderCompass(graphics, client, element, sample);
                else drawHudText(graphics, client.font, text(element.id, client, sample), 4, 4, element);
            }
            case "durability" -> renderDurability(graphics, client, element, sample);
            case "ping" -> {
                int color = accent(element, 4, 4);
                if (element.options.qualityColors) {
                    int value = ping(client); color = value <= element.options.pingGood ? 0xFF71E596 : value <= element.options.pingWarn ? 0xFFFFD37A : 0xFFFF6476;
                }
                if (element.options.qualityColors) graphics.text(client.font, text(element.id, client, sample), 4, 4, color, config.general.textShadow);
                else drawHudText(graphics, client.font, text(element.id, client, sample), 4, 4, element);
            }
            default -> drawHudText(graphics, client.font, text(element.id, client, sample), 4, 4, element);
        }
    }

    private static void renderKeystrokes(GuiGraphicsExtractor graphics, Minecraft client, HudConfig.Element element) {
        HudConfig.Options options = element.options;
        String up = options.useArrows ? "^" : "W";
        String left = options.useArrows ? "<" : "A";
        String down = options.useArrows ? "v" : "S";
        String right = options.useArrows ? ">" : "D";
        int color = accent(element, 0, 0);
        if (options.showMovement) {
            drawKey(graphics, client, 24, 0, 20, 20, up, client.player != null && client.options.keyUp.isDown(), color, options);
            drawKey(graphics, client, 2, 22, 20, 20, left, client.player != null && client.options.keyLeft.isDown(), color, options);
            drawKey(graphics, client, 24, 22, 20, 20, down, client.player != null && client.options.keyDown.isDown(), color, options);
            drawKey(graphics, client, 46, 22, 20, 20, right, client.player != null && client.options.keyRight.isDown(), color, options);
        }
        int y = options.showMovement ? 44 : 0;
        if (options.showMouse) {
            String l = options.showMouseCps ? "LMB\n" + clicks(ClickTracker.Button.LEFT, options) + " CPS" : "LMB";
            String r = options.showMouseCps ? "RMB\n" + clicks(ClickTracker.Button.RIGHT, options) + " CPS" : "RMB";
            drawKey(graphics, client, 2, y, 31, 20, l, client.player != null && client.options.keyAttack.isDown(), color, options);
            drawKey(graphics, client, 35, y, 31, 20, r, client.player != null && client.options.keyUse.isDown(), color, options);
            y += 22;
        }
        if (options.showSpace) drawKey(graphics, client, 2, y, 64, 8, "", client.player != null && client.options.keyJump.isDown(), color, options);
    }

    private static void drawKey(GuiGraphicsExtractor graphics, Minecraft client, int x, int y, int width, int height, String label, boolean down, int color, HudConfig.Options options) {
        graphics.fill(x, y, x + width, y + height, down ? (0xB8000000 | options.pressedColor & 0xFFFFFF) : 0xA81B181C);
        graphics.outline(x, y, width, height, down ? color : 0xFF736B74);
        String[] lines = label.split("\\n", -1);
        for (int index = 0; index < lines.length; index++) {
            int textY = y + Math.max(1, (height - lines.length * 8) / 2) + index * 8;
            graphics.centeredText(client.font, lines[index], x + width / 2, textY, color);
        }
        if (label.isEmpty()) graphics.fill(x + 18, y + height / 2, x + width - 18, y + height / 2 + 1, color);
    }

    private static void renderPotions(GuiGraphicsExtractor graphics, Minecraft client, HudConfig.Element element, boolean sample) {
        List<String> lines = potionLines(client, sample, element.options);
        if (element.options.horizontal) {
            drawHudText(graphics, client.font, String.join("  |  ", lines), 4, 4, element);
            return;
        }
        int y = 3;
        List<MobEffectInstance> effects = client.player == null ? List.of() : new ArrayList<>(client.player.getActiveEffects());
        int index = 0;
        for (String line : lines) {
            int textX = 4;
            if (element.options.showPotionIcons) {
                int iconColor = index < effects.size() ? 0xFF000000 | effects.get(index).getEffect().value().getColor() : accent(element, 4, y);
                graphics.fill(4, y, 12, y + 8, iconColor); graphics.outline(4, y, 8, 8, 0xFFFFFFFF); textX = 16;
            }
            drawHudText(graphics, client.font, line, textX, y, element); y += 12; index++;
        }
    }

    private static List<String> potionLines(Minecraft client, boolean sample, HudConfig.Options options) {
        if (client.player == null || (sample && client.player.getActiveEffects().isEmpty())) return List.of("Speed II  1:24", "Regeneration  0:18");
        List<MobEffectInstance> effects = new ArrayList<>(client.player.getActiveEffects());
        if (options.sortEffectsByDuration) effects.sort(Comparator.comparingInt(MobEffectInstance::getDuration));
        List<String> lines = new ArrayList<>();
        for (MobEffectInstance effect : effects) {
            String name = Component.translatable(effect.getDescriptionId()).getString();
            if (options.showPotionAmplifiers && effect.getAmplifier() > 0) name += " " + roman(effect.getAmplifier() + 1);
            String time = effect.isInfiniteDuration() ? "∞" : duration(effect.getDuration() * 50L);
            String line = options.showPotionNames ? name : "Effect";
            if (options.showPotionTimers) line += "  " + time;
            lines.add(line);
        }
        if (options.sortEffectsByName) lines.sort(String.CASE_INSENSITIVE_ORDER);
        return lines.isEmpty() ? List.of() : lines;
    }

    private static String roman(int value) {
        return switch (value) { case 2 -> "II"; case 3 -> "III"; case 4 -> "IV"; case 5 -> "V"; default -> Integer.toString(value); };
    }

    private static void renderArmor(GuiGraphicsExtractor graphics, Minecraft client, HudConfig.Element element, boolean sample) {
        List<ItemStack> items = client.player == null ? List.of() : armorItems(client);
        if (sample && items.isEmpty()) items = List.of(ItemStack.EMPTY, ItemStack.EMPTY, ItemStack.EMPTY, ItemStack.EMPTY);
        if (element.options.reverseOrder) items = new ArrayList<>(items.reversed());
        for (int index = 0; index < items.size(); index++) {
            int x = element.options.horizontal ? 2 + index * 19 : 2;
            int y = element.options.horizontal ? 2 : 2 + index * 19;
            ItemStack stack = items.get(index);
            if (!stack.isEmpty()) {
                graphics.item(stack, x, y);
                graphics.itemDecorations(client.font, stack, x, y);
                if (element.options.showDurability && element.options.durabilityMode != 0 && stack.isDamageableItem()) {
                    String percent = durabilityValue(stack, element.options.durabilityMode);
                    int tx = element.options.horizontal ? x : x + 20;
                    int ty = element.options.horizontal ? 21 : y + 4;
                    if (element.options.durabilityMode == 3) drawDurabilityBar(graphics, stack, tx, ty, element);
                    else if (durabilityPercent(stack) <= element.options.warningThreshold) graphics.text(client.font, percent, tx, ty, durabilityColor(stack, element), config.general.textShadow);
                    else drawHudText(graphics, client.font, percent, tx, ty, element);
                }
            } else if (sample) graphics.outline(x, y, 17, 17, 0x886B636C);
        }
    }

    private static void renderDurability(GuiGraphicsExtractor graphics, Minecraft client, HudConfig.Element element, boolean sample) {
        List<ItemStack> stacks = heldItems(client, element.options);
        if (sample && stacks.isEmpty()) stacks = List.of(ItemStack.EMPTY);
        for (int index = 0; index < stacks.size(); index++) {
            ItemStack stack = stacks.get(index);
            int y = index * 24;
            if (!stack.isEmpty()) { graphics.item(stack, 4, y + 4); graphics.itemDecorations(client.font, stack, 4, y + 4); }
            else graphics.outline(4, y + 4, 17, 17, 0x886B636C);
            String value = stack.isEmpty() ? sample("durability") : heldValue(stack, element.options);
            if (!stack.isEmpty() && stack.isDamageableItem() && durabilityPercent(stack) <= element.options.warningThreshold)
                graphics.text(client.font, value, 25, y + 8, durabilityColor(stack, element), config.general.textShadow);
            else drawHudText(graphics, client.font, value, 25, y + 8, element);
            if (!stack.isEmpty() && stack.isDamageableItem() && element.options.durabilityMode == 3) drawDurabilityBar(graphics, stack, 25, y + 18, element);
        }
    }

    private static void renderCompass(GuiGraphicsExtractor graphics, Minecraft client, HudConfig.Element element, boolean sample) {
        String[] directions = element.options.showIntercardinal
            ? new String[] { "N", "NE", "E", "SE", "S", "SW", "W", "NW" }
            : new String[] { "N", "E", "S", "W" };
        float step = 360.0f / directions.length;
        int center = sample && client.player == null ? 0
            : Math.floorMod(Math.round((client.player.getYRot() % 360) / step), directions.length);
        for (int offset = -2; offset <= 2; offset++) {
            String label = directions[Math.floorMod(center + offset, directions.length)];
            int x = 61 + offset * 23;
            graphics.centeredText(client.font, label, x, 6, offset == 0 ? accent(element, x, 6) : 0xFF8B848C);
        }
        graphics.fill(60, 1, 62, 4, accent(element, 60, 1));
        graphics.fill(8, 18, 114, 19, 0x885F575F);
    }

    private static int background(HudConfig.Appearance appearance) {
        int alpha = Math.round(appearance.backgroundOpacity * appearance.opacity * 255.0f / 10000.0f);
        return (alpha << 24) | (appearance.backgroundColor & 0x00FFFFFF);
    }

    static String text(String id, Minecraft client, boolean sample) {
        if (sample && client.player == null) return sample(id);
        if (client.player == null) return "";
        if (sample && id.equals("target_block") && noTarget(client)) return sample(id);
        if (sample && id.equals("toggle_sprint") && !SwirlBindings.sprintToggled()) return sample(id);
        if (sample && id.equals("toggle_sneak") && !SwirlBindings.sneakToggled()) return sample(id);
        HudConfig.Element element = config.element(id);
        HudConfig.Options options = element == null ? new HudConfig.Options() : element.options;
        return switch (id) {
            case "fps" -> cached("fps", options.refreshMillis, () -> decorateNumber(Integer.toString(client.getFps()), options, "FPS"));
            case "cps" -> cpsText(options);
            case "keystrokes" -> "W A S D";
            case "coordinates" -> coordinates(client);
            case "direction" -> direction(client, options);
            case "armor" -> "Armor";
            case "potions" -> "Effects";
            case "ping" -> cached("ping", options.refreshMillis, () -> ping(client) + (options.showSuffix ? " ms" : ""));
            case "server" -> server(client, options);
            case "clock" -> clock(options);
            case "stopwatch" -> stopwatch(options);
            case "memory" -> cached("memory", options.refreshMillis, () -> memory(options));
            case "durability" -> durability(client.player.getMainHandItem(), options.showItemName);
            case "speed" -> speedText(options);
            case "biome" -> cached("biome", options.refreshMillis, () -> biome(client, options));
            case "players" -> players(client, options);
            case "world_time" -> worldTime(client, options);
            case "target_block" -> targetBlock(client, options);
            case "light" -> light(client, options);
            case "toggle_sprint" -> toggleText(client, options, true);
            case "toggle_sneak" -> toggleText(client, options, false);
            default -> "";
        };
    }

    private static String sample(String id) {
        return switch (id) {
            case "fps" -> "144 FPS"; case "cps" -> "L 7 | R 3 CPS"; case "keystrokes" -> "W A S D";
            case "coordinates" -> "XYZ 128.0 / 64.0 / -32.0"; case "direction" -> "NORTH"; case "armor" -> "Armor";
            case "potions" -> "Effects"; case "ping" -> "32 ms"; case "server" -> "friends.local:25565";
            case "clock" -> "12:34:56"; case "stopwatch" -> "Timer 02:17"; case "memory" -> "Memory 42%";
            case "durability" -> "Diamond Pickaxe 81%";
            case "speed" -> "Speed 5.6 b/s"; case "biome" -> "Biome Plains"; case "players" -> "Players 12";
            case "world_time" -> "Day 18  08:32"; case "target_block" -> "Target Stone"; case "light" -> "Light 12";
            case "toggle_sprint" -> "Sprinting (Toggled)"; case "toggle_sneak" -> "Sneaking (Toggled)";
            default -> id;
        };
    }

    private static String coordinates(Minecraft client) {
        HudConfig.Options options = config.element("coordinates").options;
        int precision = options.coordinatePrecision;
        String pattern = "XYZ %." + precision + "f / %." + precision + "f / %." + precision + "f";
        String value = String.format(Locale.ROOT, pattern, client.player.getX(), client.player.getY(), client.player.getZ());
        if (options.compactCoordinates) value = value.substring(4).replace(" / ", ", ");
        if (options.showMovementSigns) value += String.format(Locale.ROOT, "  %sX %sY %sZ", sign(deltaX), sign(deltaY), sign(deltaZ));
        if (options.showNetherConversion) {
            boolean nether = client.level.dimension().equals(net.minecraft.world.level.Level.NETHER);
            double factor = nether ? 8.0 : 0.125;
            value += String.format(Locale.ROOT, "  [%s %.0f, %.0f]", nether ? "OW" : "N", client.player.getX() * factor, client.player.getZ() * factor);
        }
        return value;
    }
    private static String sign(double value) { return value > 0.0001 ? "+" : value < -0.0001 ? "-" : "="; }

    private static String durability(ItemStack stack, boolean name) {
        if (stack.isEmpty()) return "No held item";
        String prefix = name ? stack.getHoverName().getString() + " " : "";
        return stack.isDamageableItem() ? prefix + durabilityPercent(stack) + "%" : prefix.stripTrailing();
    }
    private static String heldValue(ItemStack stack, HudConfig.Options options) {
        String name = options.showItemName ? stack.getHoverName().getString() : "";
        if (!stack.isDamageableItem() || options.durabilityMode == 0 || options.durabilityMode == 3) return name;
        return (name.isEmpty() ? "" : name + " ") + durabilityValue(stack, options.durabilityMode);
    }
    private static String durabilityValue(ItemStack stack, int mode) {
        int remaining = Math.max(0, stack.getMaxDamage() - stack.getDamageValue());
        return mode == 2 ? remaining + "/" + stack.getMaxDamage() : durabilityPercent(stack) + "%";
    }
    private static void drawDurabilityBar(GuiGraphicsExtractor graphics, ItemStack stack, int x, int y, HudConfig.Element element) {
        int width = 24; int filled = Math.round(width * durabilityPercent(stack) / 100.0f);
        graphics.fill(x, y, x + width, y + 3, 0xFF312D31); graphics.fill(x, y, x + filled, y + 3, durabilityColor(stack, element));
    }

    private static int durabilityPercent(ItemStack stack) {
        int remaining = Math.max(0, stack.getMaxDamage() - stack.getDamageValue());
        return Math.round(remaining * 100.0f / Math.max(1, stack.getMaxDamage()));
    }
    private static int durabilityColor(ItemStack stack, HudConfig.Element element) {
        int percent = durabilityPercent(stack);
        return percent <= element.options.warningThreshold ? element.options.warningColor : accent(element, 0, 0);
    }

    private static String biome(Minecraft client, HudConfig.Options options) {
        return client.level.getBiome(client.player.blockPosition()).unwrapKey().map(key -> {
            String id = (options.showNamespace ? key.identifier().toString() : key.identifier().getPath());
            String value = options.resourceId ? id : title(key.identifier().getPath());
            return (options.showLabel ? "Biome " : "") + value;
        }).orElse(options.showLabel ? "Biome Unknown" : "Unknown");
    }
    private static String worldTime(Minecraft client, HudConfig.Options options) {
        long clock = client.level.getOverworldClockTime();
        long ticks = Math.floorMod(clock, 24000L);
        long day = Math.floorDiv(clock, 24000L) + (options.dayStartsAtOne ? 1 : 0);
        long hours = (ticks / 1000L + 6L) % 24L;
        long minutes = (ticks % 1000L) * 60L / 1000L;
        List<String> parts = new ArrayList<>();
        if (options.showDay) parts.add("Day " + day);
        if (options.showWorldClock) {
            if (options.clock24Hour) parts.add(String.format(Locale.ROOT, "%02d:%02d", hours, minutes));
            else { long h = hours % 12; if (h == 0) h = 12; parts.add(String.format(Locale.ROOT, "%d:%02d %s", h, minutes, hours < 12 ? "AM" : "PM")); }
        }
        return String.join("  ", parts);
    }
    private static String targetBlock(Minecraft client, HudConfig.Options options) {
        if (!(client.hitResult instanceof BlockHitResult hit) || hit.getType() != HitResult.Type.BLOCK) return "";
        BlockPos position = hit.getBlockPos();
        var block = client.level.getBlockState(position).getBlock();
        String value = options.resourceId ? net.minecraft.core.registries.BuiltInRegistries.BLOCK.getKey(block).toString() : block.getName().getString();
        if (options.showTargetCoordinates) value += " @ " + position.getX() + ", " + position.getY() + ", " + position.getZ();
        if (options.showTargetDistance) value += String.format(Locale.ROOT, " %.1fm", Math.sqrt(client.player.distanceToSqr(position.getX() + 0.5, position.getY() + 0.5, position.getZ() + 0.5)));
        return (options.showLabel ? "Target " : "") + value;
    }
    private static String title(String value) {
        String[] parts = value.replace('-', '_').split("_");
        StringBuilder result = new StringBuilder();
        for (String part : parts) { if (!part.isEmpty()) { if (!result.isEmpty()) result.append(' '); result.append(Character.toUpperCase(part.charAt(0))).append(part.substring(1)); } }
        return result.toString();
    }
    private static long stopwatchMillis() { return stopwatchElapsed + (stopwatchStarted == 0 ? 0 : System.currentTimeMillis() - stopwatchStarted); }
    private static int ping(Minecraft client) { PlayerInfo info = client.getConnection() == null ? null : client.getConnection().getPlayerInfo(client.player.getUUID()); return info == null ? 0 : info.getLatency(); }
    private static String memory(HudConfig.Options options) {
        Runtime runtime = Runtime.getRuntime(); long used = runtime.totalMemory() - runtime.freeMemory();
        if (options.memoryMode == 0) return "Memory " + Math.round(used * 100.0 / runtime.maxMemory()) + "%";
        double unit = options.memoryGib ? 1024.0 * 1024 * 1024 : 1024.0 * 1024;
        String suffix = options.memoryGib ? " GiB" : " MiB";
        if (options.memoryMode == 1) return String.format(Locale.ROOT, "Memory %.1f%s", used / unit, suffix);
        return String.format(Locale.ROOT, "Memory %.1f / %.1f%s", used / unit, runtime.maxMemory() / unit, suffix);
    }
    private static String duration(long millis) { long seconds = Math.max(0, millis / 1000); return String.format(Locale.ROOT, "%d:%02d", seconds / 60, seconds % 60); }

    private static int accent(HudConfig.Element element, int x, int y) { return HudColors.color(element, x, y); }
    private static void drawHudText(GuiGraphicsExtractor graphics, Font font, String value, int x, int y, HudConfig.Element element) {
        HudConfig.Appearance appearance = config.resolvedAppearance(element);
        value = switch (appearance.casing) { case 1 -> value.toUpperCase(Locale.ROOT); case 2 -> value.toLowerCase(Locale.ROOT); default -> value; };
        if (appearance.colorMode == 0) { graphics.text(font, value, x, y, accent(element, x, y), appearance.textShadow); return; }
        int cursor = x;
        for (int offset = 0; offset < value.length();) {
            int codePoint = value.codePointAt(offset);
            String character = new String(Character.toChars(codePoint));
            graphics.text(font, character, cursor, y, accent(element, cursor, y), appearance.textShadow);
            cursor += font.width(character); offset += Character.charCount(codePoint);
        }
    }

    private static String cpsText(HudConfig.Options options) {
        String suffix = options.showCpsLabel ? " CPS" : "";
        String separator = options.separatorStyle == 1 ? " / " : options.separatorStyle == 2 ? "  " : " | ";
        List<String> parts = new ArrayList<>();
        if (options.showLeftCps) parts.add("L " + clicks(ClickTracker.Button.LEFT, options));
        if (options.showRightCps) parts.add("R " + clicks(ClickTracker.Button.RIGHT, options));
        return String.join(separator, parts) + suffix;
    }

    private static String clock(HudConfig.Options options) {
        LocalTime value = options.utcTime ? LocalTime.now(java.time.ZoneOffset.UTC) : LocalTime.now();
        DateTimeFormatter format;
        if (options.clock24Hour) format = DateTimeFormatter.ofPattern(options.showSeconds ? "HH:mm:ss" : "HH:mm");
        else format = DateTimeFormatter.ofPattern(options.showSeconds ? "hh:mm:ss a" : "hh:mm a");
        String result = value.format(format);
        if (options.showDate) result = java.time.LocalDate.now(options.utcTime ? java.time.ZoneOffset.UTC : java.time.ZoneId.systemDefault()) + "  " + result;
        return result;
    }

    private static String stopwatch(HudConfig.Options options) {
        long millis = stopwatchMillis();
        String value;
        if (options.stopwatchFormat == 2) value = String.format(Locale.ROOT, "%.1fs", millis / 1000.0);
        else if (options.stopwatchFormat == 1) {
            long seconds = millis / 1000;
            value = String.format(Locale.ROOT, "%d:%02d:%02d", seconds / 3600, seconds / 60 % 60, seconds % 60);
        } else value = duration(millis);
        if (options.stopwatchTenths && options.stopwatchFormat != 2) value += "." + (millis / 100 % 10);
        return (options.prefix == null || options.prefix.isBlank() ? "Timer" : options.prefix) + " " + value;
    }

    private static String speedText(HudConfig.Options options) {
        double measured = options.speedMode == 1 ? Math.sqrt(speed * speed + verticalSpeed * verticalSpeed) : speed;
        double value = options.speedUnit == 1 ? measured * 3.6 : measured;
        return String.format(Locale.ROOT, "Speed %." + options.precision + "f %s", value, options.speedUnit == 1 ? "km/h" : "b/s");
    }

    private static String light(Minecraft client, HudConfig.Options options) {
        BlockPos pos = client.player.blockPosition();
        int value = options.lightMode == 1 ? client.level.getBrightness(LightLayer.BLOCK, pos)
            : options.lightMode == 2 ? client.level.getBrightness(LightLayer.SKY, pos)
            : client.level.getMaxLocalRawBrightness(pos);
        String type = options.lightMode == 1 ? "Block" : options.lightMode == 2 ? "Sky" : "Light";
        return (options.showLabel ? type + " " : "") + value;
    }

    private static String toggleText(Minecraft client, HudConfig.Options options, boolean sprint) {
        if (options.toggleHudMode == 2) return "";
        List<String> states = new ArrayList<>();
        if (sprint && SwirlBindings.sprintToggled()) states.add(options.sprintText);
        if (!sprint && SwirlBindings.sneakToggled()) states.add(options.sneakText);
        if (sprint && client.player != null && client.player.getAbilities().flying) states.add(options.flyingText);
        if (states.isEmpty()) return options.activeOnly ? "" : (options.toggleHudMode == 1 ? "W" : sprint ? "Walking" : "Standing");
        if (options.toggleHudMode == 1) {
            List<String> icons = new ArrayList<>();
            if (sprint && SwirlBindings.sprintToggled()) icons.add("S");
            if (!sprint && SwirlBindings.sneakToggled()) icons.add("C");
            if (sprint && client.player != null && client.player.getAbilities().flying) icons.add("F");
            return String.join(" ", icons);
        }
        return String.join(" / ", states);
    }

    private static List<ItemStack> armorItems(Minecraft client) {
        List<ItemStack> items = new ArrayList<>();
        if (client.player == null) return items;
        for (EquipmentSlot slot : ARMOR) {
            ItemStack stack = client.player.getItemBySlot(slot);
            if (!stack.isEmpty()) items.add(stack);
        }
        return items;
    }

    private static List<ItemStack> heldItems(Minecraft client, HudConfig.Options options) {
        List<ItemStack> items = new ArrayList<>();
        if (client.player == null) return items;
        if (options.handMode != 2) addHeld(items, client.player.getMainHandItem(), options);
        if (options.handMode != 0) addHeld(items, client.player.getOffhandItem(), options);
        return items;
    }
    private static void addHeld(List<ItemStack> items, ItemStack stack, HudConfig.Options options) {
        if (!stack.isEmpty() && (!options.damageableOnly || stack.isDamageableItem())) items.add(stack);
    }
    private static boolean noTarget(Minecraft client) {
        return !(client.hitResult instanceof BlockHitResult hit) || hit.getType() != HitResult.Type.BLOCK;
    }

    private static String decorateNumber(String value, HudConfig.Options options, String suffix) {
        String result = value + (options.showSuffix ? " " + suffix : "");
        return options.showBrackets ? "[" + result + "]" : result;
    }
    private static String cached(String id, int refreshMillis, Supplier<String> supplier) {
        if (refreshMillis <= 0) return supplier.get();
        long now = System.currentTimeMillis();
        if (!VALUE_CACHE.containsKey(id) || now - CACHE_TIME.getOrDefault(id, 0L) >= refreshMillis) {
            VALUE_CACHE.put(id, supplier.get()); CACHE_TIME.put(id, now);
        }
        return VALUE_CACHE.get(id);
    }
    private static String direction(Minecraft client, HudConfig.Options options) {
        String value = client.player.getDirection().getName().toUpperCase(Locale.ROOT);
        if (options.showDegrees) value += " " + Math.floorMod(Math.round(client.player.getYRot()), 360) + "°";
        return value;
    }
    private static String server(Minecraft client, HudConfig.Options options) {
        if (client.getCurrentServer() == null) return options.hideSingleplayer ? "" : (options.showLabel ? "Server Singleplayer" : "Singleplayer");
        String value = client.getCurrentServer().ip;
        if (!options.showPort && value.lastIndexOf(':') > value.lastIndexOf(']')) value = value.substring(0, value.lastIndexOf(':'));
        if (options.privacyMask) value = "••••••••";
        return (options.showLabel ? "Server " : "") + value;
    }
    private static String players(Minecraft client, HudConfig.Options options) {
        if (client.getConnection() == null) return options.hideSingleplayer ? "" : (options.showLabel ? "Players 1" : "1");
        int online = client.getConnection().getOnlinePlayers().size();
        String value = Integer.toString(online);
        if (options.showMaxPlayers && client.getCurrentServer() != null && client.getCurrentServer().players != null)
            value += "/" + client.getCurrentServer().players.max();
        return (options.showLabel ? "Players " : "") + value;
    }
}
