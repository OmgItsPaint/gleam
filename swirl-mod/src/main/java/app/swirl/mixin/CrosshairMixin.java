package app.swirl.mixin;

import app.swirl.client.VisualModuleService;
import net.minecraft.client.DeltaTracker;
import net.minecraft.client.gui.GuiGraphicsExtractor;
import org.spongepowered.asm.mixin.Mixin;
import org.spongepowered.asm.mixin.Pseudo;
import org.spongepowered.asm.mixin.injection.At;
import org.spongepowered.asm.mixin.injection.Inject;
import org.spongepowered.asm.mixin.injection.callback.CallbackInfo;

@Pseudo
@Mixin(targets = { "net.minecraft.client.gui.Gui", "net.minecraft.client.gui.Hud" })
abstract class CrosshairMixin {
    @Inject(method = "extractCrosshair", at = @At("HEAD"), cancellable = true, require = 0)
    private void swirl$customCrosshair(GuiGraphicsExtractor graphics, DeltaTracker delta, CallbackInfo callback) {
        if (VisualModuleService.customCrosshair()) callback.cancel();
    }
}
