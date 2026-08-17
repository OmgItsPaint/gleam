package app.swirl.mixin;

import com.mojang.blaze3d.platform.InputConstants;
import net.minecraft.client.KeyMapping;
import net.minecraft.client.Minecraft;
import app.swirl.client.ScreenBridge;
import app.swirl.client.SwirlHud;
import org.spongepowered.asm.mixin.Mixin;
import org.spongepowered.asm.mixin.injection.At;
import org.spongepowered.asm.mixin.injection.Inject;
import org.spongepowered.asm.mixin.injection.callback.CallbackInfo;

@Mixin(KeyMapping.class)
abstract class KeyMappingMixin {
    @Inject(method = "click", at = @At("HEAD"))
    private static void swirl$recordClick(InputConstants.Key key, CallbackInfo callback) {
        Minecraft client = Minecraft.getInstance();
        if (client.player == null || ScreenBridge.hasOpenUi(client) || !client.isWindowActive()) return;
        if (client.options.keyAttack.saveString().equals(key.getName())) SwirlHud.recordLeftClick();
        if (client.options.keyUse.saveString().equals(key.getName())) SwirlHud.recordRightClick();
    }
}
