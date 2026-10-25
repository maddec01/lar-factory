// The window's top-left corner, from T3 Code: the traffic lights, the sidebar toggle 8 px past them and the brand
// 6 px past the toggle. In the Mac app the lights are macOS's own (apps/desktop/src/window/WindowTitleBar.ts puts
// them 16 px in, centred in the 52 px bar); in a browser, grey stand-ins hold their place so the layout reads like
// the app. In the Mac app's full screen macOS hides the lights, so the toggle moves to 12 px in. ⌘B toggles the
// sidebar too.

import { useEffect, useSyncExternalStore } from 'react';
import { PanelLeft, PanelLeftClose } from 'lucide-react';
import { BRAND_MARK_PATH, BRAND_MARK_VIEWBOX, boardApp, inMacApp } from '@mux-factory/shared';
import { Badge } from '@mux-factory/ui/badge';
import { Button } from '@mux-factory/ui/button';
import { Tooltip, TooltipPopup, TooltipTrigger } from '@mux-factory/ui/tooltip';
import { T3Wordmark } from './T3Wordmark.tsx';
import { useSidebarStore } from './sidebar-store.ts';

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

/** Where the brand starts, and the title bar while the sidebar is closed: the toggle, its 28 px, and a 6 px gap. The
 *  toggle is at 76 px, or 12 px while the traffic lights are hidden. */
export const useBrandLeft = () => (useLightsHidden() ? 'pl-11.5' : 'pl-27.5');

function TrafficLights() {
  if (inMacApp()) return null;
  return (
    <span className="traffic-lights absolute left-4 flex gap-2" aria-hidden="true">
      {['close', 'minimize', 'zoom'].map((light) => <span key={light} className="size-3 rounded-full bg-(--traffic-stand-in)" />)}
    </span>
  );
}

/** The board app's brand: the Mux mark on the baseline with the µ's tail hanging below, a grey "Factory", and its
 *  "for T3 Code" pill with T3's own wordmark. Screen readers skip it: the page's hidden h1 names the page. */
export function Brand() {
  return (
    <span className="brand inline-flex items-center gap-2" aria-hidden="true">
      <span className="inline-flex items-baseline gap-1 text-sm font-medium tracking-tight">
        <svg className="relative top-[calc(--spacing(3.125)*8.75/32)] h-[--spacing(3.125)] w-5.5 shrink-0" viewBox={BRAND_MARK_VIEWBOX} fill="none">
          <path d={BRAND_MARK_PATH} stroke="currentColor" strokeWidth="5.5" strokeLinecap="round" strokeLinejoin="round" />
        </svg>
        <span className="text-(--muted-foreground)">Factory</span>
      </span>
      <Badge variant="secondary" size="sm" className="ml-1 gap-1 bg-accent">
        for<T3Wordmark className="h-[1cap] w-auto shrink-0" />Code
      </Badge>
    </span>
  );
}

/** Fixed to the window's top left, so the toggle stays put while the sidebar slides away. */
export function WindowControls() {
  const { open, toggle } = useSidebarStore();
  const left = useLightsHidden() ? 'left-3' : 'left-19';
  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      if (event.metaKey && !event.altKey && !event.shiftKey && event.key.toLowerCase() === 'b') {
        event.preventDefault();
        useSidebarStore.getState().toggle();
      }
    };
    addEventListener('keydown', onKey);
    return () => removeEventListener('keydown', onKey);
  }, []);
  return (
    <div className="pointer-events-none fixed left-0 top-0 z-50 flex h-13 items-center">
      <TrafficLights />
      <Tooltip>
        <TooltipTrigger render={
          <Button variant="ghost" size="icon" aria-label="Toggle main sidebar" aria-pressed={open} aria-keyshortcuts="Meta+B" onClick={toggle}
            className={`sidebar-toggle pointer-events-auto absolute ${left} size-7! [-webkit-app-region:no-drag]`} />
        }>
          {open ? <PanelLeftClose className="size-4" /> : <PanelLeft className="size-4" />}
        </TooltipTrigger>
        <TooltipPopup side="bottom">Toggle main sidebar (⌘B)</TooltipPopup>
      </Tooltip>
    </div>
  );
}
