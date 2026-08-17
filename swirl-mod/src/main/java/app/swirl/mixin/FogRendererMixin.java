package app.swirl.mixin;

import app.swirl.client.VisualModuleService;
import net.minecraft.client.Camera;
import net.minecraft.client.DeltaTracker;
import net.minecraft.client.multiplayer.ClientLevel;
import net.minecraft.client.renderer.fog.FogData;
import net.minecraft.client.renderer.fog.FogRenderer;
import org.spongepowered.asm.mixin.Mixin;
import org.spongepowered.asm.mixin.injection.At;
import org.spongepowered.asm.mixin.injection.Inject;
import org.spongepowered.asm.mixin.injection.callback.CallbackInfoReturnable;

@Mixin(FogRenderer.class)
abstract class FogRendererMixin {
    @Inject(method = "setupFog", at = @At("RETURN"))
    private static void swirl$adjustFog(Camera camera, int renderDistance, DeltaTracker delta, float darkenWorldAmount,
                                        ClientLevel level, CallbackInfoReturnable<FogData> callback) {
        VisualModuleService.adjustFog(callback.getReturnValue(), camera);
    }
}
