package app.swirl.mixin;

import app.swirl.client.VisualModuleService;
import org.spongepowered.asm.mixin.Final;
import org.spongepowered.asm.mixin.Mixin;
import org.spongepowered.asm.mixin.Mutable;
import org.spongepowered.asm.mixin.Pseudo;
import org.spongepowered.asm.mixin.Shadow;
import org.spongepowered.asm.mixin.injection.At;
import org.spongepowered.asm.mixin.injection.Inject;
import org.spongepowered.asm.mixin.injection.callback.CallbackInfo;

@Pseudo
@Mixin(targets = "net.minecraft.client.renderer.feature.ShapeOutlineFeatureRenderer$Submit")
abstract class BlockOutlineSubmitMixin {
    @Shadow @Final @Mutable private int color;
    @Shadow @Final @Mutable private float width;

    @Inject(method = "<init>", at = @At("RETURN"), require = 0)
    private void swirl$targetOutline(CallbackInfo callback) {
        if (VisualModuleService.enabled("block_outline")) {
            this.color = VisualModuleService.blockOutlineColor();
            this.width = VisualModuleService.blockOutlineWidth(width);
        }
    }
}
