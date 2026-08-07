package app.swirl.client;

import net.fabricmc.api.ClientModInitializer;
import net.fabricmc.fabric.api.client.event.lifecycle.v1.ClientTickEvents;
import net.fabricmc.fabric.api.client.keymapping.v1.KeyMappingHelper;
import net.minecraft.client.KeyMapping;
import net.minecraft.client.Minecraft;
import net.minecraft.network.chat.Component;
import net.minecraft.resources.Identifier;
import org.lwjgl.glfw.GLFW;

public final class SwirlClient implements ClientModInitializer {
    private static final KeyMapping.Category CATEGORY = KeyMapping.Category.register(
        Identifier.fromNamespaceAndPath("swirl_client", "menu")
    );
    private KeyMapping openMenu;

    @Override
    public void onInitializeClient() {
        SwirlIdentityClient.initialize();
        openMenu = KeyMappingHelper.registerKeyMapping(new KeyMapping(
            "key.swirl_client.open_menu",
            GLFW.GLFW_KEY_RIGHT_SHIFT,
            CATEGORY
        ));
        ClientTickEvents.END_CLIENT_TICK.register(client -> {
            while (openMenu.consumeClick()) {
                if (client.level != null) ScreenBridge.show(client, new SwirlScreen());
            }
        });
    }
}
