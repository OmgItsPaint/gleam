package app.swirl.client;

import org.junit.jupiter.api.Test;

import java.nio.file.Files;
import java.nio.file.Path;

import static org.junit.jupiter.api.Assertions.*;

final class VisibleSettingAuditTest {
    @Test void unverifiedRendererControlsAreNotExposed() throws Exception {
        String screen = Files.readString(Path.of("src/main/java/app/swirl/client/ModuleSettingsScreen.java"));
        for (String field : new String[] {"blockFaceOpacity", "lowShieldOpacity", "weatherSplashDensity",
            "weatherOpacity", "weatherSoundVolume", "damageTiltReduction", "labelColor", "valueColor"})
            assertFalse(screen.contains(field), "Unverified setting is visible: " + field);
    }

    @Test void newlyVisibleCrosshairAndFogControlsHaveRuntimeConsumers() throws Exception {
        String runtime = Files.readString(Path.of("src/main/java/app/swirl/client/VisualModuleService.java"));
        for (String field : new String[] {"crosshairCenterDot", "crosshairExpansion", "fogBiomeBlend"})
            assertTrue(runtime.contains(field), "Visible setting lacks a runtime consumer: " + field);
    }
}
