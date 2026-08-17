package app.swirl.mixin;

import app.swirl.client.VisualModuleService;
import com.mojang.blaze3d.vertex.PoseStack;
import net.minecraft.client.player.AbstractClientPlayer;
import net.minecraft.client.renderer.ItemInHandRenderer;
import net.minecraft.client.renderer.SubmitNodeCollector;
import net.minecraft.world.InteractionHand;
import net.minecraft.world.item.ItemStack;
import org.spongepowered.asm.mixin.Mixin;
import org.spongepowered.asm.mixin.injection.At;
import org.spongepowered.asm.mixin.injection.Inject;
import org.spongepowered.asm.mixin.injection.callback.CallbackInfo;

@Mixin(ItemInHandRenderer.class)
abstract class ItemInHandRendererMixin {
    @Inject(method = { "renderArmWithItem", "submitArmWithItem" }, at = @At("HEAD"), require = 0)
    private void swirl$lowerShieldHead(AbstractClientPlayer player, float partialTick, float pitch, InteractionHand hand,
                                       float swing, ItemStack stack, float equip, PoseStack poses,
                                       SubmitNodeCollector submitter, int light, CallbackInfo callback) {
        if (VisualModuleService.lowShieldActive(stack)) {
            poses.pushPose();
            poses.translate(VisualModuleService.lowShieldX(), -VisualModuleService.lowShieldOffset(), 0.0f);
            poses.scale(VisualModuleService.lowShieldScale(), VisualModuleService.lowShieldScale(), VisualModuleService.lowShieldScale());
        }
    }

    @Inject(method = { "renderArmWithItem", "submitArmWithItem" }, at = @At("RETURN"), require = 0)
    private void swirl$lowerShieldReturn(AbstractClientPlayer player, float partialTick, float pitch, InteractionHand hand,
                                         float swing, ItemStack stack, float equip, PoseStack poses,
                                         SubmitNodeCollector submitter, int light, CallbackInfo callback) {
        if (VisualModuleService.lowShieldActive(stack)) poses.popPose();
    }
}
