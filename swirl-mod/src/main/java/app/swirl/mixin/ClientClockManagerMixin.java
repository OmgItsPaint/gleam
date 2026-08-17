package app.swirl.mixin;

import app.swirl.client.VisualModuleService;
import net.minecraft.client.ClientClockManager;
import net.minecraft.core.Holder;
import net.minecraft.world.clock.WorldClock;
import org.spongepowered.asm.mixin.Mixin;
import org.spongepowered.asm.mixin.injection.At;
import org.spongepowered.asm.mixin.injection.Inject;
import org.spongepowered.asm.mixin.injection.callback.CallbackInfoReturnable;

@Mixin(ClientClockManager.class)
abstract class ClientClockManagerMixin {
    @Inject(method = "getTotalTicks", at = @At("RETURN"), cancellable = true)
    private void swirl$localTime(Holder<WorldClock> clock, CallbackInfoReturnable<Long> callback) {
        callback.setReturnValue(VisualModuleService.localTime(callback.getReturnValue()));
    }
}
