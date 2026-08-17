package app.swirl.client;

import org.junit.jupiter.api.Test;

import javax.imageio.ImageIO;
import java.awt.image.BufferedImage;
import java.io.InputStream;
import java.util.HashSet;
import java.util.Set;

import static org.junit.jupiter.api.Assertions.*;

final class ModuleAssetTest {
    @Test
    void everyModuleHasAUniqueCleanSquarePreview() throws Exception {
        Set<Integer> imageHashes = new HashSet<>();
        for (ModuleRegistry.Module module : ModuleRegistry.MODULES) {
            assertFalse(ModuleRegistry.searchTerms(module.id()).isBlank(), "Missing search metadata for " + module.id());
            String path = "/assets/swirl_client/textures/gui/modules/" + module.id() + ".png";
            byte[] bytes;
            try (InputStream input = getClass().getResourceAsStream(path)) {
                assertNotNull(input, "Missing preview for " + module.id());
                bytes = input.readAllBytes();
            }
            assertTrue(imageHashes.add(java.util.Arrays.hashCode(bytes)), "Duplicate preview for " + module.id());
            BufferedImage image = ImageIO.read(new java.io.ByteArrayInputStream(bytes));
            assertNotNull(image, "Unreadable preview for " + module.id());
            assertEquals(256, image.getWidth(), module.id());
            assertEquals(256, image.getHeight(), module.id());
            assertTrue(image.getColorModel().hasAlpha(), "Icon must be transparent: " + module.id());

            int left = 256, top = 256, right = -1, bottom = -1, visible = 0;
            for (int y = 0; y < 256; y++) for (int x = 0; x < 256; x++) {
                int argb = image.getRGB(x, y);
                int alpha = argb >>> 24;
                if (alpha == 0) continue;
                visible++;
                assertEquals(0xFFFFFF, argb & 0xFFFFFF, "Non-white icon pixel in " + module.id());
                left = Math.min(left, x); right = Math.max(right, x);
                top = Math.min(top, y); bottom = Math.max(bottom, y);
            }
            assertTrue(visible > 300, "Icon lacks visible artwork for " + module.id());
            int artWidth = right - left + 1, artHeight = bottom - top + 1;
            int longest = Math.max(artWidth, artHeight);
            assertTrue(longest >= 180 && longest <= 224, "Icon bounds outside 72-86% target: " + module.id());
            assertTrue(Math.abs((left + right) / 2.0 - 127.5) <= 10, "Icon is not horizontally centered: " + module.id());
            assertTrue(Math.abs((top + bottom) / 2.0 - 127.5) <= 10, "Icon is not vertically centered: " + module.id());
            for (int point = 0; point < 256; point++) {
                assertEquals(0, image.getRGB(point, 0) >>> 24, module.id() + " top edge bleed");
                assertEquals(0, image.getRGB(point, 255) >>> 24, module.id() + " bottom edge bleed");
                assertEquals(0, image.getRGB(0, point) >>> 24, module.id() + " left edge bleed");
                assertEquals(0, image.getRGB(255, point) >>> 24, module.id() + " right edge bleed");
            }
        }
    }
}
