package app.swirl.mixin;

import app.swirl.client.VisualModuleService;
import net.minecraft.client.renderer.LevelRenderer;
import org.spongepowered.asm.mixin.Mixin;
import org.spongepowered.asm.mixin.injection.At;
import org.spongepowered.asm.mixin.injection.ModifyVariable;

@Mixin(LevelRenderer.class)
abstract class LevelRendererMixin {
    @ModifyVariable(method = "renderHitOutline", at = @At("HEAD"), argsOnly = true, ordinal = 0, require = 0)
    private int swirl$outlineColor(int vanilla) {
        return VisualModuleService.enabled("block_outline") ? VisualModuleService.blockOutlineColor() : vanilla;
    }

    @ModifyVariable(method = "renderHitOutline", at = @At("HEAD"), argsOnly = true, ordinal = 0, require = 0)
    private float swirl$outlineWidth(float vanilla) { return VisualModuleService.blockOutlineWidth(vanilla); }
}
