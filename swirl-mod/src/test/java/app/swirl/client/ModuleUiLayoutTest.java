package app.swirl.client;

import org.junit.jupiter.api.Test;

import static org.junit.jupiter.api.Assertions.*;

final class ModuleUiLayoutTest {
    @Test
    void cardsFitSupportedViewportShapesAndMenuScales() {
        int[][] viewports = { {854, 480}, {1920, 1080}, {3440, 1440}, {1280, 720} };
        int[] scales = {80, 100, 120};
        for (int[] viewport : viewports) for (int scale : scales) {
            int panelWidth = Math.min(1120, viewport[0] - 24);
            int panelHeight = Math.min(720, viewport[1] - 24);
            int columns = SwirlScreen.moduleColumns(panelWidth, scale);
            int gap = 8;
            int cardWidth = (panelWidth - 28 - gap * (columns - 1)) / columns;
            int cardHeight = SwirlScreen.moduleCardHeight(scale);
            int contentTop = 44 + (panelWidth < 700 ? 57 : 32);
            int contentBottom = panelHeight - 14;
            int visibleRows = Math.max(1, (contentBottom - contentTop + gap) / (cardHeight + gap));
            int lastBottom = contentTop + (visibleRows - 1) * (cardHeight + gap) + cardHeight;

            assertTrue(columns >= 1 && columns <= 4);
            assertTrue(cardWidth >= 150, viewport[0] + "x" + viewport[1] + " at " + scale + "%");
            assertTrue(cardHeight >= 142);
            assertTrue(lastBottom <= contentBottom, viewport[0] + "x" + viewport[1] + " cards overflow vertically");
        }
    }

    @Test void densityModesRemainOrderedAndUsable() {
        for (int scale : new int[] {80, 100, 120}) {
            int compact = SwirlScreen.moduleCardHeight(scale, 0);
            int comfortable = SwirlScreen.moduleCardHeight(scale, 1);
            int spacious = SwirlScreen.moduleCardHeight(scale, 2);
            assertTrue(compact <= comfortable && comfortable <= spacious);
            assertTrue(compact >= 142);
        }
    }
}
