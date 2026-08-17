package app.swirl.mixin;

import app.swirl.client.VisualModuleService;
import net.minecraft.client.OptionInstance;
import org.spongepowered.asm.mixin.Mixin;
import org.spongepowered.asm.mixin.injection.At;
import org.spongepowered.asm.mixin.injection.Inject;
import org.spongepowered.asm.mixin.injection.callback.CallbackInfoReturnable;

@Mixin(OptionInstance.class)
abstract class OptionInstanceMixin<T> {
    @Inject(method = "get", at = @At("RETURN"), cancellable = true)
    private void swirl$temporaryVisualOption(CallbackInfoReturnable<T> callback) {
        @SuppressWarnings("unchecked") T value = (T) VisualModuleService.optionValue((OptionInstance<?>)(Object)this, callback.getReturnValue());
        callback.setReturnValue(value);
    }
}
