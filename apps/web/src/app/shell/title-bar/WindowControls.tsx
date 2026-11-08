// The window's top-left corner, from T3 Code: the traffic lights, with the title bar starting past them. In the Mac
// app the lights are macOS's own (apps/desktop/src/window/WindowTitleBar.ts puts them 16 px in, centred in the 52 px
// bar) and the brand sits 90 px in, past them; a browser window has no traffic lights, so the bar draws none and keeps
// its own padding. In the Mac app's full screen macOS hides the lights, so the brand moves to that padding too.

import { boardApp, inMacApp } from '@lar-factory/shared';
import { useSyncExternalStore } from 'react';

// The window's full screen, as T3 Code's apps/web/src/components/AppSidebarLayout.tsx reads it: the bridge's
// synchronous read, cached until a subscription follows the changes.
let fullscreenSnapshot: boolean | null = null;

function subscribeToFullscreen(onChange: () => void): () => void {
    const bridge = inMacApp() ? boardApp() : undefined;

    if (!bridge) return () => {};

    const unsubscribe = bridge.onWindowFullscreenStateChange((fullscreen) => {
        fullscreenSnapshot = fullscreen;
        onChange();
    });

    // The window may have changed state between the first render and this subscription.
    fullscreenSnapshot = bridge.getWindowFullscreenState();

    return () => {
        unsubscribe();
        fullscreenSnapshot = null;
    };
}

function readFullscreen(): boolean {
    fullscreenSnapshot ??= inMacApp() ? (boardApp()?.getWindowFullscreenState() ?? false) : false;

    return fullscreenSnapshot;
}

/** Whether macOS full screen hides the traffic lights; false outside the Mac app. */
export const useLightsHidden = () => useSyncExternalStore(subscribeToFullscreen, readFullscreen);
