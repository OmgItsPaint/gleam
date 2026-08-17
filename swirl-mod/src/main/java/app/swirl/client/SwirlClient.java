package app.swirl.client;

import net.fabricmc.api.ClientModInitializer;
public final class SwirlClient implements ClientModInitializer {
    @Override
    public void onInitializeClient() {
        SwirlRuntime.initializeClient();
    }
}
