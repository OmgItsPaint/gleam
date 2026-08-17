package app.swirl.client;

import app.swirl.identity.SwirlIdentityClient;
import app.swirl.identity.SwirlHostClient;
import net.fabricmc.fabric.api.client.event.lifecycle.v1.ClientTickEvents;

/**
 * Narrow initialization facade for Swirl's internal packages. Fabric entrypoints and mixins use
 * this boundary instead of making HUD, configuration, screen, and visual internals public.
 */
public final class SwirlRuntime {
    private static boolean initialized;

    private SwirlRuntime() {}

    public static synchronized void initializeClient() {
        if (initialized) return;
        initialized = true;
        SwirlIdentityClient.initialize();
        SwirlHostClient.initialize();
        SwirlHud.initialize();
        VisualModuleService.initialize();
        ClientTickEvents.END_CLIENT_TICK.register(client -> {
            SwirlHud.tick(client);
            VisualModuleService.tick(client);
        });
    }
}
