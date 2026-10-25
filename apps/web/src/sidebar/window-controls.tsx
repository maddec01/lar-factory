// The window's top-left corner, from T3 Code: the traffic lights, the sidebar toggle at T3's --workspace-controls-left
// and the brand T3's gap past the toggle. In the Mac app the lights are macOS's own (apps/desktop/src/window/
// WindowTitleBar.ts puts them 16 px in, centred in the 52 px bar) and the toggle sits 90 px in, past them; in a
// browser, grey stand-ins hold their place so the layout reads like the app. In the Mac app's full screen macOS hides
// the lights, so the toggle moves to the stylesheet's 12 px in. ⌘B toggles the sidebar too.

import { useEffect, useSyncExternalStore, type CSSProperties } from 'react';
import { BRAND_MARK_PATH, BRAND_MARK_VIEWBOX, boardApp, inMacApp } from '@mux-factory/shared';
import { Badge } from '@mux-factory/ui/badge';
import { SidebarTrigger, useSidebar, useSidebarVisibility } from '@mux-factory/ui/sidebar';
import { Tooltip, TooltipPopup, TooltipTrigger } from '@mux-factory/ui/tooltip';
import { T3Wordmark } from './T3Wordmark.tsx';

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

const MACOS_TRAFFIC_LIGHTS_LEFT_INSET = 'var(--desktop-window-controls-inset, 90px)';

/** T3's windowControlsInsetStyle: the toggle's left edge, 90 px in past the traffic lights or their stand-ins, or the
 *  stylesheet's 12 px while full screen hides them. */
export function useWindowControlsInsetStyle(): CSSProperties {
  return (useLightsHidden() ? {} : { '--workspace-controls-left': MACOS_TRAFFIC_LIGHTS_LEFT_INSET }) as CSSProperties;
}

/** The left padding of the title bar and the Settings header: T3's gap past the toggle while the sidebar is hidden. It
 *  follows the sidebar's visibility, not the store's open, which stays true below 768 px while the sheet is closed. */
export const useTitlebarInset = () => (useSidebarVisibility() ? 'pl-4' : 'pl-[var(--workspace-titlebar-content-left)]');

function TrafficLights() {
  if (inMacApp()) return null;
  return (
    <div className="pointer-events-none fixed left-0 top-0 z-50 flex h-13 items-center">
      <span className="traffic-lights absolute left-4 flex gap-2" aria-hidden="true">
        {['close', 'minimize', 'zoom'].map((light) => <span key={light} className="size-3 rounded-full bg-(--traffic-stand-in)" />)}
      </span>
    </div>
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

/** Fixed to the window's top left: T3's SidebarControl, which stays put while the sidebar slides away, and the
 *  traffic lights' stand-ins. The toggle and ⌘B go through T3's SidebarProvider, which sets the sidebar store, or
 *  opens the sheet below 768 px. */
export function SidebarControl() {
  const { toggleSidebar } = useSidebar();
  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      if (event.metaKey && !event.altKey && !event.shiftKey && event.key.toLowerCase() === 'b') {
        event.preventDefault();
        // The provider writes its cookie after it sets the store; where there's no Cookie Store API that write
        // rejects, and the board never reads the cookie.
        Promise.resolve(toggleSidebar()).catch(() => {});
      }
    };
    addEventListener('keydown', onKey);
    return () => removeEventListener('keydown', onKey);
  }, [toggleSidebar]);
  return (
    <>
      <TrafficLights />
      <div className="pointer-events-none fixed left-[var(--workspace-controls-left)] top-[var(--workspace-controls-top)] z-50 ml-px flex h-[var(--workspace-topbar-height)] items-center" data-sidebar-control="">
        <Tooltip>
          <TooltipTrigger render={
            <SidebarTrigger className="sidebar-toggle pointer-events-auto" aria-label="Toggle main sidebar" aria-keyshortcuts="Meta+B" />
          } />
          <TooltipPopup side="bottom">Toggle main sidebar (⌘B)</TooltipPopup>
        </Tooltip>
      </div>
    </>
  );
}
