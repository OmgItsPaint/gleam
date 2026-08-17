package app.swirl.mixin;

import net.minecraft.client.player.KeyboardInput;
import net.minecraft.world.entity.player.Input;
import app.swirl.client.SwirlBindings;
import org.spongepowered.asm.mixin.Mixin;
import org.spongepowered.asm.mixin.injection.At;
import org.spongepowered.asm.mixin.injection.Inject;
import org.spongepowered.asm.mixin.injection.callback.CallbackInfo;

@Mixin(KeyboardInput.class)
abstract class KeyboardInputMixin {
    @Inject(method = "tick", at = @At("TAIL"))
    private void swirl$applyToggles(CallbackInfo callback) {
        KeyboardInput input = (KeyboardInput) (Object) this;
        Input vanilla = input.keyPresses;
        input.keyPresses = new Input(vanilla.forward(), vanilla.backward(), vanilla.left(), vanilla.right(), vanilla.jump(),
            vanilla.shift() || SwirlBindings.applySneak(), vanilla.sprint() || SwirlBindings.applySprint());
    }
}
