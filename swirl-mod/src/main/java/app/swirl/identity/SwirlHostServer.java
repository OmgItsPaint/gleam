package app.swirl.identity;

import com.google.gson.Gson;
import com.google.gson.JsonArray;
import com.google.gson.JsonObject;
import net.fabricmc.fabric.api.networking.v1.ServerPlayConnectionEvents;
import net.fabricmc.fabric.api.networking.v1.ServerPlayNetworking;
import net.minecraft.server.MinecraftServer;
import net.minecraft.server.level.ServerPlayer;

import java.net.URI;
import java.net.http.HttpClient;
import java.net.http.HttpRequest;
import java.net.http.HttpResponse;
import java.nio.charset.StandardCharsets;
import java.nio.file.Files;
import java.nio.file.Path;
import java.security.KeyFactory;
import java.security.Signature;
import java.security.spec.X509EncodedKeySpec;
import java.time.Duration;
import java.util.ArrayDeque;
import java.util.Base64;
import java.util.HashMap;
import java.util.Locale;
import java.util.Map;
import java.util.Set;
import java.util.concurrent.CompletableFuture;

final class SwirlHostServer {
    private static final Gson GSON = new Gson();
    private static final byte[] PREFIX = "SWIRL-MANAGE-1\0".getBytes(StandardCharsets.UTF_8);
    private static final HttpClient HTTP = HttpClient.newBuilder().connectTimeout(Duration.ofSeconds(3)).build();
    private static final Map<String, Long> COUNTERS = new HashMap<>();
    private static final Map<String, ArrayDeque<Long>> RATES = new HashMap<>();
    private static final Map<String, Set<String>> PERMISSIONS = Map.of(
        "owner", Set.of("*"),
        "admin", Set.of("dashboard.read", "players.read", "players.manage", "console.read", "console.write", "settings.read", "settings.write", "backups.read", "backups.write", "mods.read", "mods.write", "automation.read", "automation.write", "diagnostics.read", "lifecycle.restart", "lifecycle.stop"),
        "moderator", Set.of("dashboard.read", "players.read", "players.manage", "console.read", "announcements.write", "diagnostics.read"),
        "viewer", Set.of("dashboard.read", "players.read", "diagnostics.read")
    );

    private SwirlHostServer() {}

    static void initialize() {
        HostProtocol.register();
        ServerPlayNetworking.registerGlobalReceiver(HostProtocol.Request.TYPE,
            (payload, context) -> handle(context.server(), context.player(), payload.json()));
        ServerPlayConnectionEvents.DISCONNECT.register((handler, server) -> {
            String name = handler.getPlayer().getName().getString().toLowerCase(Locale.ROOT);
            SwirlIdentityServer.VERIFIED.remove(name);
        });
    }

    private static void handle(MinecraftServer server, ServerPlayer player, String json) {
        String requestId = "";
        try {
            if (json.length() > HostProtocol.MAX_JSON) throw new SecurityException("Management request was too large.");
            JsonObject request = GSON.fromJson(json, JsonObject.class);
            requestId = text(request, "requestId", 64);
            if (request.get("format").getAsInt() != HostProtocol.FORMAT) throw new SecurityException("Unsupported management protocol.");
            String operation = text(request, "operation", 80);
            long counter = request.get("counter").getAsLong();
            String signature = text(request, "signature", 256);
            request.remove("signature");
            SwirlIdentityServer.VerifiedIdentity identity = SwirlIdentityServer.VERIFIED.get(player.getName().getString().toLowerCase(Locale.ROOT));
            if (identity == null) throw new SecurityException("This connection has no verified Gleam identity.");
            verify(identity, request.toString(), signature, counter);
            String role = role(identity.fingerprint());
            if (role == null) throw new SecurityException("Your identity has no Host Manager role.");
            checkRate(identity.fingerprint());
            String permission = permission(operation);
            if (!can(role, permission)) throw new SecurityException("Your Host Manager role cannot perform that action.");
            JsonObject input = request.has("payload") && request.get("payload").isJsonObject()
                ? request.getAsJsonObject("payload") : new JsonObject();
            if (operation.startsWith("host.")) {
                String finalRequestId = requestId;
                CompletableFuture.supplyAsync(() -> host(operation.substring(5), input)).thenAccept(result ->
                    server.execute(() -> send(player, finalRequestId, true, result, ""))
                );
                return;
            }
            JsonObject result = direct(server, player, operation, input, role);
            audit(identity.fingerprint(), role, operation, "allowed", "");
            send(player, requestId, true, result, "");
        } catch (Exception error) {
            send(player, requestId, false, new JsonObject(), error.getMessage() == null ? "Management request failed." : error.getMessage());
        }
    }

    private static JsonObject direct(MinecraftServer server, ServerPlayer player, String operation, JsonObject input, String role) {
        JsonObject result = new JsonObject();
        if (operation.equals("capabilities")) {
            result.addProperty("format", 1); result.addProperty("role", role);
            result.addProperty("bridgeAvailable", hostAvailable());
            JsonArray allowed = new JsonArray(); PERMISSIONS.getOrDefault(role, Set.of()).forEach(allowed::add); result.add("permissions", allowed);
            return result;
        }
        if (operation.equals("dashboard")) {
            Runtime runtime = Runtime.getRuntime();
            result.addProperty("players", server.getPlayerCount());
            result.addProperty("maxPlayers", server.getPlayerList().getMaxPlayers());
            result.addProperty("tickMs", server.getAverageTickTimeNanos() / 1_000_000.0);
            result.addProperty("tps", Math.min(20.0, 1000.0 / Math.max(50.0, server.getAverageTickTimeNanos() / 1_000_000.0)));
            result.addProperty("uptimeSeconds", server.getTickCount() / 20L);
            result.addProperty("memoryUsed", runtime.totalMemory() - runtime.freeMemory());
            result.addProperty("memoryMax", runtime.maxMemory());
            result.addProperty("bridgeAvailable", hostAvailable());
            return result;
        }
        if (operation.equals("players")) {
            JsonArray players = new JsonArray();
            for (ServerPlayer online : server.getPlayerList().getPlayers()) {
                JsonObject item = new JsonObject(); item.addProperty("name", online.getName().getString());
                item.addProperty("operator", server.getPlayerList().isOp(online.nameAndId())); players.add(item);
            }
            result.add("players", players); return result;
        }
        if (operation.equals("console.command")) {
            String command = text(input, "command", 500);
            if (command.contains("\n") || command.contains("\r")) throw new SecurityException("Enter one command.");
            server.getCommands().performPrefixedCommand(player.createCommandSourceStack(), command);
            result.addProperty("accepted", true); return result;
        }
        throw new SecurityException("That live management operation is unavailable.");
    }

    private static String permission(String operation) {
        return switch (operation) {
            case "capabilities", "dashboard" -> "dashboard.read";
            case "players" -> "players.read";
            case "console.command" -> "console.write";
            case "host.status", "host.console.tail" -> "console.read";
            case "host.backups.list" -> "backups.read";
            case "host.backups.schedule" -> "backups.write";
            case "host.mods.list", "host.mods.plan" -> "mods.read";
            case "host.diagnostics" -> "diagnostics.read";
            case "host.lifecycle.restart" -> "lifecycle.restart";
            case "host.lifecycle.stop" -> "lifecycle.stop";
            default -> "unknown";
        };
    }

    private static boolean can(String role, String permission) {
        Set<String> values = PERMISSIONS.getOrDefault(role, Set.of());
        return values.contains("*") || values.contains(permission);
    }

    private static void verify(SwirlIdentityServer.VerifiedIdentity identity, String unsigned, String signature, long counter) throws Exception {
        long previous = COUNTERS.getOrDefault(identity.fingerprint(), 0L);
        if (counter <= previous || counter > previous + 10_000) throw new SecurityException("Rejected replayed management request.");
        byte[] body = unsigned.getBytes(StandardCharsets.UTF_8); byte[] message = new byte[PREFIX.length + body.length];
        System.arraycopy(PREFIX, 0, message, 0, PREFIX.length); System.arraycopy(body, 0, message, PREFIX.length, body.length);
        Signature verifier = Signature.getInstance("Ed25519");
        verifier.initVerify(KeyFactory.getInstance("Ed25519").generatePublic(new X509EncodedKeySpec(Base64.getDecoder().decode(identity.publicKey()))));
        verifier.update(message);
        if (!verifier.verify(Base64.getDecoder().decode(signature))) throw new SecurityException("Management signature was invalid.");
        COUNTERS.put(identity.fingerprint(), counter);
    }

    private static void checkRate(String fingerprint) {
        long now = System.currentTimeMillis(); ArrayDeque<Long> values = RATES.computeIfAbsent(fingerprint, ignored -> new ArrayDeque<>());
        while (!values.isEmpty() && now - values.peekFirst() > 5_000) values.removeFirst();
        if (values.size() >= 30) throw new SecurityException("Too many management requests."); values.addLast(now);
    }

    private static String role(String fingerprint) {
        try {
            JsonObject file = GSON.fromJson(Files.readString(Path.of("swirl-admin-roles.json")), JsonObject.class);
            for (var item : file.getAsJsonArray("assignments")) {
                JsonObject value = item.getAsJsonObject();
                if (fingerprint.equals(value.get("fingerprint").getAsString())) return value.get("role").getAsString();
            }
        } catch (Exception ignored) { }
        return null;
    }

    private static boolean hostAvailable() { return Integer.getInteger("swirl.hostAgent.port", 0) > 0 && !System.getProperty("swirl.hostAgent.token", "").isBlank(); }

    private static JsonObject host(String operation, JsonObject payload) {
        try {
            int port = Integer.getInteger("swirl.hostAgent.port", 0); String token = System.getProperty("swirl.hostAgent.token", "");
            String serverId = System.getProperty("swirl.hostAgent.serverId", ""); if (port < 1 || token.isBlank()) throw new IllegalStateException("The host launcher bridge is unavailable.");
            JsonObject body = new JsonObject(); body.addProperty("operation", operation); body.add("payload", payload);
            HttpRequest request = HttpRequest.newBuilder(URI.create("http://127.0.0.1:" + port + "/v1/request"))
                .timeout(Duration.ofSeconds(30)).header("Authorization", "Bearer " + token).header("X-Swirl-Server", serverId)
                .POST(HttpRequest.BodyPublishers.ofString(body.toString())).build();
            HttpResponse<String> response = HTTP.send(request, HttpResponse.BodyHandlers.ofString(StandardCharsets.UTF_8));
            JsonObject result = GSON.fromJson(response.body(), JsonObject.class);
            if (response.statusCode() != 200 || !result.get("ok").getAsBoolean()) throw new IllegalStateException(result.has("error") ? result.get("error").getAsString() : "Host operation failed.");
            return result.getAsJsonObject("result");
        } catch (Exception error) { throw new RuntimeException(error.getMessage(), error); }
    }

    private static String text(JsonObject object, String field, int maximum) {
        if (!object.has(field)) throw new SecurityException("Missing " + field + "."); String value = object.get(field).getAsString();
        if (value.isBlank() || value.length() > maximum) throw new SecurityException("Invalid " + field + "."); return value;
    }

    private static void send(ServerPlayer player, String requestId, boolean ok, JsonObject result, String error) {
        JsonObject response = new JsonObject(); response.addProperty("format", 1); response.addProperty("requestId", requestId);
        response.addProperty("ok", ok); response.add("result", result); if (!ok) response.addProperty("error", error.substring(0, Math.min(300, error.length())));
        ServerPlayNetworking.send(player, new HostProtocol.Response(response.toString()));
    }

    private static void audit(String fingerprint, String role, String operation, String result, String detail) {
        try {
            Files.createDirectories(Path.of("logs")); JsonObject entry = new JsonObject(); entry.addProperty("at", java.time.Instant.now().toString());
            entry.addProperty("fingerprint", fingerprint); entry.addProperty("role", role); entry.addProperty("operation", operation);
            entry.addProperty("result", result); entry.addProperty("detail", detail); Files.writeString(Path.of("logs", "swirl-admin-audit.jsonl"), entry + "\n", StandardCharsets.UTF_8, java.nio.file.StandardOpenOption.CREATE, java.nio.file.StandardOpenOption.APPEND);
        } catch (Exception ignored) { }
    }
}
