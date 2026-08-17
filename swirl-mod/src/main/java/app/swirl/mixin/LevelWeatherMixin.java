package app.swirl.mixin;

import app.swirl.client.VisualModuleService;
import net.minecraft.client.multiplayer.ClientLevel;
import net.minecraft.world.level.Level;
import org.spongepowered.asm.mixin.Mixin;
import org.spongepowered.asm.mixin.injection.At;
import org.spongepowered.asm.mixin.injection.Inject;
import org.spongepowered.asm.mixin.injection.callback.CallbackInfoReturnable;

@Mixin(Level.class)
abstract class LevelWeatherMixin {
    @Inject(method = "getRainLevel", at = @At("RETURN"), cancellable = true)
    private void swirl$localRain(float partialTick, CallbackInfoReturnable<Float> callback) {
        if ((Object)this instanceof ClientLevel) {
            Float value = VisualModuleService.localRain(callback.getReturnValue());
            if (value != null) callback.setReturnValue(value);
        }
    }

    @Inject(method = "getThunderLevel", at = @At("RETURN"), cancellable = true)
    private void swirl$localThunder(float partialTick, CallbackInfoReturnable<Float> callback) {
        if ((Object)this instanceof ClientLevel && VisualModuleService.localRain(0) != null) callback.setReturnValue(0.0f);
    }
}
