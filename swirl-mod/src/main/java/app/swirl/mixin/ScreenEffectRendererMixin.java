package app.swirl.mixin;

import app.swirl.client.VisualModuleService;
import com.mojang.blaze3d.vertex.PoseStack;
import net.minecraft.client.renderer.ScreenEffectRenderer;
import org.spongepowered.asm.mixin.injection.Coerce;
import org.spongepowered.asm.mixin.Mixin;
import org.spongepowered.asm.mixin.injection.At;
import org.spongepowered.asm.mixin.injection.Constant;
import org.spongepowered.asm.mixin.injection.Inject;
import org.spongepowered.asm.mixin.injection.ModifyConstant;
import org.spongepowered.asm.mixin.injection.callback.CallbackInfo;

@Mixin(ScreenEffectRenderer.class)
abstract class ScreenEffectRendererMixin {
    @Inject(method = { "renderFire", "submitFire" }, at = @At("HEAD"), require = 0)
    private static void swirl$lowerFireHead(PoseStack poses, @Coerce Object buffers, @Coerce Object sprite, CallbackInfo callback) {
        if (VisualModuleService.lowFireActive()) {
            poses.pushPose();
            poses.translate(VisualModuleService.lowFireX(), -VisualModuleService.lowFireOffset(), 0.0f);
            poses.scale(VisualModuleService.lowFireScale(), VisualModuleService.lowFireScale(), 1.0f);
        }
    }

    @Inject(method = { "renderFire", "submitFire" }, at = @At("RETURN"), require = 0)
    private static void swirl$lowerFireReturn(PoseStack poses, @Coerce Object buffers, @Coerce Object sprite, CallbackInfo callback) {
        if (VisualModuleService.lowFireActive()) poses.popPose();
    }

    @ModifyConstant(method = { "renderFire", "submitFire", "lambda$submitFire$0" }, constant = @Constant(floatValue = 0.9f), require = 0)
    private static float swirl$fireOpacity(float vanilla) { return VisualModuleService.lowFireOpacity(vanilla); }
}
