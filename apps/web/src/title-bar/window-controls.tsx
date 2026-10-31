// The window's top-left corner, from T3 Code: the traffic lights, with the title bar starting past them. In the Mac
// app the lights are macOS's own (apps/desktop/src/window/WindowTitleBar.ts puts them 16 px in, centred in the 52 px
// bar) and the brand sits 90 px in, past them; in a browser, grey stand-ins hold their place so the layout reads like
// the app. In the Mac app's full screen macOS hides the lights, so the brand moves to the title bar's own padding.

import { useSyncExternalStore } from 'react';
import { boardApp, inMacApp } from '@lar-factory/shared';

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
const useLightsHidden = () => useSyncExternalStore(subscribeToFullscreen, readFullscreen);

/** The title bar's padding past the traffic lights or their stand-ins: with the copied TitleBar's own 16 px, the
 *  brand starts 90 px in. None while full screen hides the lights. */
export const useWindowControlsInset = () => (useLightsHidden() ? '' : 'pl-[74px]');

/** In a browser, the traffic lights' grey stand-ins; in the Mac app, nothing, since macOS draws them. */
export function TrafficLights() {
  if (inMacApp()) return null;
  return (
    <div className="browser-window-controls pointer-events-none fixed left-0 top-0 z-50 flex h-13 items-center">
      <span className="traffic-lights absolute left-4 flex gap-2" aria-hidden="true">
        {['close', 'minimize', 'zoom'].map((light) => <span key={light} className="size-3 rounded-full bg-(--traffic-stand-in)" />)}
      </span>
    </div>
  );
}
