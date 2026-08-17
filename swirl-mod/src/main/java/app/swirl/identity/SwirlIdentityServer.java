package app.swirl.identity;

import com.google.gson.Gson;
import com.google.gson.GsonBuilder;
import io.netty.buffer.Unpooled;
import net.fabricmc.api.ModInitializer;
import net.fabricmc.fabric.api.networking.v1.ServerLoginConnectionEvents;
import net.fabricmc.fabric.api.networking.v1.ServerLoginNetworking;
import net.minecraft.network.FriendlyByteBuf;
import net.minecraft.network.chat.Component;
import net.minecraft.resources.Identifier;
import net.minecraft.server.network.ServerLoginPacketListenerImpl;

import java.nio.charset.StandardCharsets;
import java.nio.file.Files;
import java.nio.file.Path;
import java.nio.file.StandardCopyOption;
import java.security.KeyFactory;
import java.security.MessageDigest;
import java.security.PublicKey;
import java.security.Signature;
import java.security.spec.X509EncodedKeySpec;
import java.time.Instant;
import java.util.ArrayList;
import java.util.Base64;
import java.util.Collections;
import java.util.IdentityHashMap;
import java.util.List;
import java.util.Map;
import java.util.concurrent.ConcurrentHashMap;

public final class SwirlIdentityServer implements ModInitializer {
    private static final Identifier CHANNEL = Identifier.fromNamespaceAndPath("swirl_client", "identity");
    private static final byte[] PREFIX = "SWIRL-AUTH-1\0".getBytes(StandardCharsets.UTF_8);
    private static final Gson GSON = new GsonBuilder().setPrettyPrinting().create();
    private static final Map<ServerLoginPacketListenerImpl, byte[]> CHALLENGES = Collections.synchronizedMap(new IdentityHashMap<>());
    private static final Object FILE_LOCK = new Object();
    static final Map<String, VerifiedIdentity> VERIFIED = new ConcurrentHashMap<>();

    @Override
    public void onInitialize() {
        ServerLoginNetworking.registerGlobalReceiver(CHANNEL, (server, listener, understood, input, synchronizer, sender) -> {
            byte[] nonce = CHALLENGES.remove(listener);
            if (!understood || nonce == null) { listener.disconnect(Component.literal("This server requires the Gleam launcher identity check.")); return; }
            try {
                String name = input.readUtf(16);
                String publicKey = input.readUtf(512);
                String fingerprint = input.readUtf(64);
                String signature = input.readUtf(256);
                String enrollment = input.readUtf(128);
                String loginName = listener.getUserName();
                if (!name.equals(loginName) || !name.matches("[A-Za-z0-9_]{3,16}")) throw new SecurityException("Player name mismatch.");
                byte[] publicDer = Base64.getDecoder().decode(publicKey);
                if (!hex(MessageDigest.getInstance("SHA-256").digest(publicDer)).equals(fingerprint)) throw new SecurityException("Player key fingerprint mismatch.");
                PublicKey key = KeyFactory.getInstance("Ed25519").generatePublic(new X509EncodedKeySpec(publicDer));
                Signature verifier = Signature.getInstance("Ed25519"); verifier.initVerify(key); verifier.update(message(serverId(), name, nonce));
                if (!verifier.verify(Base64.getDecoder().decode(signature))) throw new SecurityException("Player signature was invalid.");
                synchronized (FILE_LOCK) {
                    IdentityDatabase database = readDatabase();
                    IdentityRecord approved = database.approved.stream().filter(item -> item.fingerprint.equals(fingerprint)).findFirst().orElse(null);
                    if (approved != null) {
                        if (!approved.name.equalsIgnoreCase(name) || !approved.publicKey.equals(publicKey)) throw new SecurityException("This key is approved for a different player name.");
                        VERIFIED.put(name.toLowerCase(java.util.Locale.ROOT), new VerifiedIdentity(name, fingerprint, publicKey));
                        return;
                    }
                    if (!consumeEnrollment(enrollment)) throw new SecurityException("This invite is expired or has already been used. Ask the host for a fresh invite.");
                    database.pending.removeIf(item -> item.fingerprint.equals(fingerprint) || item.name.equalsIgnoreCase(name));
                    database.pending.add(new IdentityRecord(name, fingerprint, publicKey, Instant.now().toString(), ""));
                    writeDatabase(database);
                }
                listener.disconnect(Component.literal("Approval requested. Ask the host to open Players, check your key fingerprint, and approve you."));
            } catch (SecurityException error) { listener.disconnect(Component.literal(error.getMessage())); }
            catch (Exception error) { listener.disconnect(Component.literal("Gleam could not verify this player identity.")); }
        });
        ServerLoginConnectionEvents.QUERY_START.register((listener, server, sender, synchronizer) -> {
            if (!identityRequired()) return;
            byte[] nonce = new byte[32]; new java.security.SecureRandom().nextBytes(nonce); CHALLENGES.put(listener, nonce);
            FriendlyByteBuf output = new FriendlyByteBuf(Unpooled.buffer()); output.writeUtf(serverId(), 64); output.writeByteArray(nonce); sender.sendPacket(CHANNEL, output);
        });
        ServerLoginConnectionEvents.DISCONNECT.register((listener, server) -> CHALLENGES.remove(listener));
        SwirlHostServer.initialize();
    }

    private static byte[] message(String serverId, String name, byte[] nonce) {
        byte[] body = (serverId + "\0" + name + "\0" + Base64.getEncoder().encodeToString(nonce)).getBytes(StandardCharsets.UTF_8);
        byte[] result = new byte[PREFIX.length + body.length]; System.arraycopy(PREFIX, 0, result, 0, PREFIX.length); System.arraycopy(body, 0, result, PREFIX.length, body.length); return result;
    }
    private static String hex(byte[] bytes) { StringBuilder value = new StringBuilder(bytes.length * 2); for (byte item : bytes) value.append(String.format("%02x", item)); return value.toString(); }
    private static Config config() { try { return GSON.fromJson(Files.readString(Path.of("swirl-server-identity.json")), Config.class); } catch (Exception ignored) { return new Config(); } }
    private static String serverId() { String value = config().serverId; return value == null ? "" : value; }
    private static boolean identityRequired() { return config().requireIdentity; }
    private static IdentityDatabase readDatabase() { try { IdentityDatabase value = GSON.fromJson(Files.readString(Path.of("swirl-identities.json")), IdentityDatabase.class); if (value != null) { if (value.approved == null) value.approved = new ArrayList<>(); if (value.pending == null) value.pending = new ArrayList<>(); return value; } } catch (Exception ignored) {} return new IdentityDatabase(); }
    private static void writeDatabase(IdentityDatabase value) throws Exception { atomicWrite(Path.of("swirl-identities.json"), GSON.toJson(value)); }
    private static boolean consumeEnrollment(String token) throws Exception {
        if (token == null || token.isBlank()) return false;
        Path file = Path.of("swirl-enrollment-tokens.json"); EnrollmentToken[] values; try { values = GSON.fromJson(Files.readString(file), EnrollmentToken[].class); } catch (Exception ignored) { values = new EnrollmentToken[0]; }
        String digest = hex(MessageDigest.getInstance("SHA-256").digest(token.getBytes(StandardCharsets.UTF_8))); boolean found = false; long now = System.currentTimeMillis();
        for (EnrollmentToken value : values) if (!value.used && value.expiresAt > now && MessageDigest.isEqual(digest.getBytes(StandardCharsets.US_ASCII), String.valueOf(value.digest).getBytes(StandardCharsets.US_ASCII))) { value.used = true; found = true; break; }
        if (found) atomicWrite(file, GSON.toJson(values)); return found;
    }
    private static void atomicWrite(Path file, String value) throws Exception { Path temporary = file.resolveSibling(file.getFileName() + ".tmp"); Files.writeString(temporary, value, StandardCharsets.UTF_8); try { Files.move(temporary, file, StandardCopyOption.REPLACE_EXISTING, StandardCopyOption.ATOMIC_MOVE); } catch (Exception ignored) { Files.move(temporary, file, StandardCopyOption.REPLACE_EXISTING); } }

    private static final class Config { int format = 1; String serverId = ""; boolean requireIdentity = false; }
    private static final class IdentityDatabase { int format = 1; List<IdentityRecord> approved = new ArrayList<>(); List<IdentityRecord> pending = new ArrayList<>(); }
    private static final class IdentityRecord { String name; String fingerprint; String publicKey; String requestedAt; String approvedAt; IdentityRecord(String name, String fingerprint, String publicKey, String requestedAt, String approvedAt) { this.name = name; this.fingerprint = fingerprint; this.publicKey = publicKey; this.requestedAt = requestedAt; this.approvedAt = approvedAt; } }
    private static final class EnrollmentToken { String digest = ""; long createdAt; long expiresAt; boolean used; }
    record VerifiedIdentity(String name, String fingerprint, String publicKey) {}
}
