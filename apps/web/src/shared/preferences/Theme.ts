// The board's light/dark preference: the design system's one theme controller, as Lar's other apps keep it. The board
// is a desktop app, so with nothing stored it follows the system until the reader picks Light or Dark in Settings ›
// General › Preferences. The Mac app's own chrome has no bridge for the preference yet, so it keeps following the system.

import { createThemeController } from '@lar-works/design-system';

/** Lar Factory's light/dark preference, kept in localStorage under `lar-factory-theme`. */
export const { initialize: initializeTheme, useTheme } = createThemeController('lar-factory-theme', {
    fallback: 'system',
});
