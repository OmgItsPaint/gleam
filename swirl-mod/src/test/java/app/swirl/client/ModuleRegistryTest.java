package app.swirl.client;

import org.junit.jupiter.api.Test;

import java.util.HashSet;

import static org.junit.jupiter.api.Assertions.*;

final class ModuleRegistryTest {
    @Test void descriptorsAreUniqueAndKindAware() {
        var ids = new HashSet<String>();
        assertEquals(31, ModuleRegistry.MODULES.size());
        for (ModuleRegistry.Module module : ModuleRegistry.MODULES) {
            assertTrue(ids.add(module.id()), module.id());
            assertFalse(module.searchTerms().isBlank(), module.id());
            assertNotNull(module.newSettings(), module.id());
            if (module.kind() == ModuleRegistry.Kind.VISUAL) {
                assertEquals(ModuleRegistry.Category.VISUAL, module.category());
                assertFalse(module.draggable(), module.id());
                assertNotEquals(ModuleRegistry.RuntimeHook.HUD, module.runtimeHook());
            }
        }
        assertEquals(ModuleRegistry.Kind.CONTROL, ModuleRegistry.byId("toggle_sprint").kind());
        assertEquals(ModuleRegistry.Kind.CONTROL, ModuleRegistry.byId("toggle_sneak").kind());
        assertEquals(13, ModuleRegistry.MODULES.stream().filter(module -> ModuleRegistry.recommended(module.id())).count());
        assertTrue(ModuleRegistry.recommended("zoom"));
        assertFalse(ModuleRegistry.recommended("fog"));
    }
}
