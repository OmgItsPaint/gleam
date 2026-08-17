package app.swirl.mixin;

import app.swirl.client.VisualModuleService;
import net.minecraft.client.multiplayer.ClientLevel;
import net.minecraft.core.BlockPos;
import net.minecraft.world.level.biome.Biome;
import org.spongepowered.asm.mixin.Mixin;
import org.spongepowered.asm.mixin.injection.At;
import org.spongepowered.asm.mixin.injection.Inject;
import org.spongepowered.asm.mixin.injection.callback.CallbackInfoReturnable;

@Mixin(ClientLevel.class)
abstract class ClientLevelWeatherMixin {
    @Inject(method = { "getPrecipitationAt", "precipitationAt" }, at = @At("RETURN"), cancellable = true, require = 0)
    private void swirl$localSnow(BlockPos position, CallbackInfoReturnable<Biome.Precipitation> callback) {
        if (VisualModuleService.forceSnow()) callback.setReturnValue(Biome.Precipitation.SNOW);
    }
}
