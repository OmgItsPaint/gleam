package app.swirl.client;

import io.netty.buffer.Unpooled;
import net.fabricmc.fabric.api.client.networking.v1.ClientLoginNetworking;
import net.minecraft.network.FriendlyByteBuf;
import net.minecraft.resources.Identifier;

import java.net.URI;
import java.net.http.HttpClient;
import java.net.http.HttpRequest;
import java.net.http.HttpResponse;
import java.nio.charset.StandardCharsets;
import java.time.Duration;
import java.util.Base64;
import java.util.concurrent.CompletableFuture;

final class SwirlIdentityClient {
    private static final Identifier CHANNEL = Identifier.fromNamespaceAndPath("swirl_client", "identity");
    private static final byte[] PREFIX = "SWIRL-AUTH-1\0".getBytes(StandardCharsets.UTF_8);
    private static final HttpClient HTTP = HttpClient.newBuilder().connectTimeout(Duration.ofSeconds(3)).build();

    private SwirlIdentityClient() {}

    static void initialize() {
        ClientLoginNetworking.registerGlobalReceiver(CHANNEL, (client, listener, input, callbacks) -> {
            String serverId = input.readUtf(64);
            byte[] nonce = input.readByteArray(64);
            return CompletableFuture.supplyAsync(() -> respond(serverId, nonce));
        });
    }

    private static FriendlyByteBuf respond(String serverId, byte[] nonce) {
        try {
            String name = System.getProperty("swirl.identity.playerName", "");
            int port = Integer.parseInt(System.getProperty("swirl.identity.port", "0"));
            String token = System.getProperty("swirl.identity.token", "");
            if (port < 1 || token.isBlank() || !name.matches("[A-Za-z0-9_]{3,16}")) return null;
            byte[] message = message(serverId, name, nonce);
            HttpRequest request = HttpRequest.newBuilder(URI.create("http://127.0.0.1:" + port + "/sign"))
                .timeout(Duration.ofSeconds(5))
                .header("Authorization", "Bearer " + token)
                .header("Content-Type", "text/plain; charset=utf-8")
                .POST(HttpRequest.BodyPublishers.ofString(Base64.getEncoder().encodeToString(message)))
                .build();
            HttpResponse<String> result = HTTP.send(request, HttpResponse.BodyHandlers.ofString(StandardCharsets.UTF_8));
            if (result.statusCode() != 200) return null;
            String[] values = result.body().split("\\n", -1);
            if (values.length != 5 || !values[0].equals(name)) return null;
            FriendlyByteBuf output = new FriendlyByteBuf(Unpooled.buffer());
            output.writeUtf(values[0], 16);
            output.writeUtf(values[1], 512);
            output.writeUtf(values[2], 64);
            output.writeUtf(values[3], 256);
            output.writeUtf(values[4], 128);
            return output;
        } catch (Exception ignored) {
            return null;
        }
    }

    static byte[] message(String serverId, String name, byte[] nonce) {
        byte[] body = (serverId + "\0" + name + "\0" + Base64.getEncoder().encodeToString(nonce)).getBytes(StandardCharsets.UTF_8);
        byte[] result = new byte[PREFIX.length + body.length];
        System.arraycopy(PREFIX, 0, result, 0, PREFIX.length);
        System.arraycopy(body, 0, result, PREFIX.length, body.length);
        return result;
    }
}
