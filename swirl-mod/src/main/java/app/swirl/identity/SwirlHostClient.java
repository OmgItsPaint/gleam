package app.swirl.identity;

import com.google.gson.Gson;
import com.google.gson.JsonObject;
import net.fabricmc.fabric.api.client.networking.v1.ClientPlayConnectionEvents;
import net.fabricmc.fabric.api.client.networking.v1.ClientPlayNetworking;
import net.minecraft.client.Minecraft;

import java.net.URI;
import java.net.http.HttpClient;
import java.net.http.HttpRequest;
import java.net.http.HttpResponse;
import java.nio.charset.StandardCharsets;
import java.time.Duration;
import java.util.Base64;
import java.util.Map;
import java.util.UUID;
import java.util.concurrent.CompletableFuture;
import java.util.concurrent.ConcurrentHashMap;
import java.util.concurrent.atomic.AtomicLong;
import java.util.function.Consumer;

public final class SwirlHostClient {
    private static final Gson GSON = new Gson();
    private static final byte[] PREFIX = "SWIRL-MANAGE-1\0".getBytes(StandardCharsets.UTF_8);
    private static final HttpClient HTTP = HttpClient.newBuilder().connectTimeout(Duration.ofSeconds(3)).build();
    private static final AtomicLong COUNTER = new AtomicLong();
    private static final Map<String, Consumer<JsonObject>> PENDING = new ConcurrentHashMap<>();
    private static volatile JsonObject capabilities;

    private SwirlHostClient() {}

    public static void initialize() {
        HostProtocol.register();
        ClientPlayNetworking.registerGlobalReceiver(HostProtocol.Response.TYPE, (payload, context) -> receive(payload.json()));
        ClientPlayConnectionEvents.JOIN.register((handler, sender, client) -> discover());
        ClientPlayConnectionEvents.DISCONNECT.register((handler, client) -> {
            capabilities = null;
            PENDING.clear();
            COUNTER.set(0);
        });
    }

    public static boolean available() { return capabilities != null; }
    public static JsonObject capabilities() { return capabilities == null ? null : capabilities.deepCopy(); }

    public static void discover() { request("capabilities", new JsonObject(), value -> capabilities = value); }

    public static void request(String operation, JsonObject payload, Consumer<JsonObject> callback) {
        if (!ClientPlayNetworking.canSend(HostProtocol.Request.TYPE)) return;
        String requestId = UUID.randomUUID().toString();
        long counter = COUNTER.incrementAndGet();
        JsonObject unsigned = new JsonObject();
        unsigned.addProperty("format", HostProtocol.FORMAT);
        unsigned.addProperty("requestId", requestId);
        unsigned.addProperty("counter", counter);
        unsigned.addProperty("operation", operation);
        unsigned.add("payload", payload == null ? new JsonObject() : payload);
        CompletableFuture.supplyAsync(() -> sign(unsigned.toString())).thenAccept(signature -> {
            if (signature == null) return;
            unsigned.addProperty("signature", signature);
            PENDING.put(requestId, callback);
            Minecraft.getInstance().execute(() -> ClientPlayNetworking.send(new HostProtocol.Request(unsigned.toString())));
        });
    }

    private static String sign(String body) {
        try {
            int port = Integer.parseInt(System.getProperty("swirl.identity.port", "0"));
            String token = System.getProperty("swirl.identity.token", "");
            if (port < 1 || token.isBlank()) return null;
            byte[] bytes = body.getBytes(StandardCharsets.UTF_8);
            byte[] message = new byte[PREFIX.length + bytes.length];
            System.arraycopy(PREFIX, 0, message, 0, PREFIX.length);
            System.arraycopy(bytes, 0, message, PREFIX.length, bytes.length);
            HttpRequest request = HttpRequest.newBuilder(URI.create("http://127.0.0.1:" + port + "/sign"))
                .timeout(Duration.ofSeconds(5)).header("Authorization", "Bearer " + token)
                .POST(HttpRequest.BodyPublishers.ofString(Base64.getEncoder().encodeToString(message))).build();
            HttpResponse<String> result = HTTP.send(request, HttpResponse.BodyHandlers.ofString(StandardCharsets.UTF_8));
            if (result.statusCode() != 200) return null;
            String[] values = result.body().split("\n", -1);
            return values.length == 5 ? values[3] : null;
        } catch (Exception ignored) { return null; }
    }

    private static void receive(String json) {
        try {
            JsonObject response = GSON.fromJson(json, JsonObject.class);
            String requestId = response.get("requestId").getAsString();
            Consumer<JsonObject> callback = PENDING.remove(requestId);
            if (callback != null) callback.accept(response);
        } catch (Exception ignored) { }
    }
}
