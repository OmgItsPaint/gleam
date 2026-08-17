package app.swirl.identity;

import net.fabricmc.fabric.api.networking.v1.PayloadTypeRegistry;
import net.minecraft.network.RegistryFriendlyByteBuf;
import net.minecraft.network.protocol.common.custom.CustomPacketPayload;
import net.minecraft.resources.Identifier;

public final class HostProtocol {
    public static final int FORMAT = 1;
    public static final int MAX_JSON = 64 * 1024;
    private static boolean registered;

    private HostProtocol() {}

    public record Request(String json) implements CustomPacketPayload {
        public static final Type<Request> TYPE = new Type<>(Identifier.fromNamespaceAndPath("swirl_client", "host_request"));
        @Override public Type<Request> type() { return TYPE; }
    }

    public record Response(String json) implements CustomPacketPayload {
        public static final Type<Response> TYPE = new Type<>(Identifier.fromNamespaceAndPath("swirl_client", "host_response"));
        @Override public Type<Response> type() { return TYPE; }
    }

    public static synchronized void register() {
        if (registered) return;
        registered = true;
        PayloadTypeRegistry.serverboundPlay().register(Request.TYPE,
            CustomPacketPayload.codec((value, buffer) -> buffer.writeUtf(value.json(), MAX_JSON),
                buffer -> new Request(buffer.readUtf(MAX_JSON))));
        PayloadTypeRegistry.clientboundPlay().register(Response.TYPE,
            CustomPacketPayload.codec((value, buffer) -> buffer.writeUtf(value.json(), MAX_JSON),
                buffer -> new Response(buffer.readUtf(MAX_JSON))));
    }
}
