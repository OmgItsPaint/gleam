package app.swirl.mixin;

import net.minecraft.client.MouseHandler;
import net.minecraft.client.input.MouseButtonInfo;
import app.swirl.client.SwirlBindings;
import app.swirl.client.VisualModuleService;
import org.spongepowered.asm.mixin.Mixin;
import org.spongepowered.asm.mixin.injection.At;
import org.spongepowered.asm.mixin.injection.Inject;
import org.spongepowered.asm.mixin.injection.callback.CallbackInfo;

@Mixin(MouseHandler.class)
abstract class MouseHandlerMixin {
    @Inject(method = "onButton", at = @At("HEAD"))
    private void swirl$mouseButton(long window, MouseButtonInfo button, int action, CallbackInfo callback) {
        SwirlBindings.mouse(button, action);
    }

    @Inject(method = "onScroll", at = @At("HEAD"), cancellable = true)
    private void swirl$zoomScroll(long window, double horizontal, double vertical, CallbackInfo callback) {
        if (VisualModuleService.zoomScroll(vertical)) callback.cancel();
    }
}
