// The left sidebar, on T3 Code's sidebar component and copied in layout from T3's: the brand T3's gap past the toggle, search with Add item, the
// List by repository, and T3's footer row with Settings left and the update button right. Above the missing-t3 notice there's no List to
// search or add to, so only the brand and Settings show. In Settings the section list takes the List's place, hiding
// the List rather than closing it, so Back finds it as it was. Its right edge is T3's drag handle, with T3's width
// rules (threadSidebarWidth.ts) as T3 Code's apps/web/src/components/AppSidebarLayout.tsx applies them at d53873b.

import { useState, useSyncExternalStore, type ComponentProps, type CSSProperties, type ReactNode } from 'react';
import { Search, X } from 'lucide-react';
import { boardApp } from '@mux-factory/shared';
import { Sidebar as T3Sidebar, SidebarFooter, SidebarMenu, SidebarMenuItem, SidebarProvider, SidebarRail, useSidebar } from '@mux-factory/ui/sidebar';
import { Tooltip, TooltipPopup, TooltipTrigger } from '@mux-factory/ui/tooltip';
import { AddItem } from '../add-item/add-item.tsx';
import { SettingsButton, SettingsNav } from '../settings/settings.tsx';
import { useSettingsStore } from '../settings/settings-store.ts';
import { UpdateButton } from '../updates/UpdateButton.tsx';
import { UpdateStatusIcon } from '../updates/UpdateStatusIcon.tsx';
import { ListGroups } from './list-groups.tsx';
import { useSidebarStore } from './sidebar-store.ts';
import {
  clampThreadSidebarWidth,
  resolveInitialThreadSidebarWidth,
  resolveThreadSidebarMaximumWidth,
  resolveThreadSidebarMinimumWidth,
  THREAD_MAIN_CONTENT_MIN_WIDTH,
  THREAD_SIDEBAR_WIDTH_STORAGE_KEY,
} from './threadSidebarWidth.ts';
import { Brand, SidebarControl, useWindowControlsInsetStyle } from './window-controls.tsx';

/** T3's search field over the thread list, with its new-thread button, here Add item, on the right. Search filters List items only. */
function SearchRow({ query, onQuery }: { query: string; onQuery: (q: string) => void }) {
  return (
    <div className="flex items-center gap-1">
      <label className="flex h-8 min-w-0 flex-1 items-center gap-2 rounded-(--control-radius) px-2 py-1.5 text-sm font-medium text-(--sidebar-muted-foreground) hover:bg-(--sidebar-row-hover) hover:text-(--sidebar-foreground)">
        <Search className="size-4 shrink-0 text-(--sidebar-icon-color)" />
        <input type="search" value={query} onChange={(e) => onQuery(e.target.value)} placeholder="Search List" aria-label="Search List items"
          className="min-w-0 flex-1 bg-transparent font-medium text-(--sidebar-foreground) outline-none placeholder:text-(--sidebar-muted-foreground) [&::-webkit-search-cancel-button]:hidden" />
        {query && <button type="button" aria-label="Clear search" onClick={() => onQuery('')} className="grid size-5 place-items-center rounded-sm text-(--muted-foreground) hover:bg-(--accent)"><X className="size-3" /></button>}
      </label>
      <AddItem />
    </div>
  );
}

/** The board app's update button, T3's update pill; in a browser, where the app can't update, a still stand-in. */
function Update() {
  if (boardApp()) return <UpdateButton />;
  return (
    <Tooltip>
      <TooltipTrigger render={<button type="button" aria-label="Check for updates" aria-disabled="true" className="update-stand-in inline-flex size-8 items-center justify-center rounded-full text-(--sidebar-icon-color) hover:bg-(--update-hover) hover:text-(--foreground)" />}>
        <UpdateStatusIcon status="idle" />
      </TooltipTrigger>
      <TooltipPopup side="top">Check for updates</TooltipPopup>
    </Tooltip>
  );
}

/** The inset past the toggle, as SidebarProvider sets it on the page. Below 768 px the sidebar's sheet portals out of
 *  the provider, so the sidebar sets it again, where the brand reads it. */
const TITLEBAR_CONTENT_LEFT = { '--workspace-titlebar-content-left': 'calc(var(--workspace-controls-left) + var(--workspace-titlebar-control-size) + var(--workspace-titlebar-control-gap))' } as CSSProperties;

function subscribeToViewportWidth(onChange: () => void): () => void {
  window.addEventListener('resize', onChange);
  return () => window.removeEventListener('resize', onChange);
}

function readViewportWidth(): number {
  return window.innerWidth;
}

/** The width the drag handle stored, as T3's rail writes it: a JSON number. */
function readStoredWidth(): number | null {
  const stored = localStorage.getItem(THREAD_SIDEBAR_WIDTH_STORAGE_KEY);
  if (stored === null) return null;
  const width: unknown = JSON.parse(stored);
  if (typeof width !== 'number' || !Number.isFinite(width)) throw new Error(`not a width: ${stored}`);
  return width;
}

function readInitialThreadSidebarWidth(): number {
  try {
    return resolveInitialThreadSidebarWidth(readStoredWidth(), window.innerWidth);
  } catch (error) {
    console.error('Could not read persisted thread sidebar width.', error);
    return resolveInitialThreadSidebarWidth(null, window.innerWidth);
  }
}

/** T3's: an invisible copy of the brand row, with its inset past the toggle, pr-3 and the sidebar's border, whose
 *  width is the sidebar's narrowest. */
function SidebarBrandWidthProbe({ onWidthChange }: { onWidthChange: (width: number) => void }) {
  const observeWidth = (probe: HTMLDivElement) => {
    if (typeof ResizeObserver === 'undefined') return;
    const observer = new ResizeObserver(([entry]) => {
      if (entry) onWidthChange(entry.borderBoxSize[0]?.inlineSize ?? probe.offsetWidth);
    });
    observer.observe(probe);
    return () => observer.disconnect();
  };
  return (
    <div aria-hidden="true" className="pointer-events-none invisible fixed top-0 left-0 flex w-max border-r border-transparent pr-3" ref={observeWidth}>
      <div className="ml-[var(--workspace-titlebar-content-left)] flex"><Brand /></div>
    </div>
  );
}

type SidebarResizable = NonNullable<ComponentProps<typeof T3Sidebar>['resizable']>;

/** T3's SidebarProvider around the page, at the width the drag handle last left, with the toggle's inset, holding
 *  the toggle, the sidebar and then the page. The sidebar store holds open, so the title bar, the app and ⌘B read
 *  one value; only the width persists. `board` is the sidebar's. */
export function SidebarLayout({ className, board, children }: { className?: string; board: boolean; children: ReactNode }) {
  const open = useSidebarStore((state) => state.open);
  const setOpen = useSidebarStore((state) => state.setOpen);
  const windowControlsInsetStyle = useWindowControlsInsetStyle();
  const [sidebarWidth, setSidebarWidth] = useState(readInitialThreadSidebarWidth);
  // Subscribed, as in T3: the clamp tracks the live window size.
  const viewportWidth = useSyncExternalStore(subscribeToViewportWidth, readViewportWidth);
  const [brandWidth, setBrandWidth] = useState(0);
  const sidebarMinimumWidth = resolveThreadSidebarMinimumWidth(brandWidth);
  const sidebarMaximumWidth = resolveThreadSidebarMaximumWidth(viewportWidth, sidebarMinimumWidth);
  const resetSidebarWidth = () => {
    try {
      localStorage.removeItem(THREAD_SIDEBAR_WIDTH_STORAGE_KEY);
    } catch (error) {
      console.error('Could not clear persisted thread sidebar width.', error);
    }
    setSidebarWidth(resolveInitialThreadSidebarWidth(null, viewportWidth));
  };
  const resizable: SidebarResizable = {
    maxWidth: sidebarMaximumWidth,
    minWidth: sidebarMinimumWidth,
    shouldAcceptWidth: ({ currentWidth, nextWidth, wrapper }) => nextWidth <= currentWidth || wrapper.clientWidth - nextWidth >= THREAD_MAIN_CONTENT_MIN_WIDTH,
    storageKey: THREAD_SIDEBAR_WIDTH_STORAGE_KEY,
    onResize: setSidebarWidth,
  };
  const sidebarProviderStyle = {
    '--sidebar-width': `${clampThreadSidebarWidth(sidebarWidth, sidebarMinimumWidth, sidebarMaximumWidth)}px`,
    ...windowControlsInsetStyle,
  } as CSSProperties;
  return (
    <SidebarProvider open={open} onOpenChange={setOpen} className={className} style={sidebarProviderStyle}>
      <SidebarBrandWidthProbe onWidthChange={setBrandWidth} />
      <SidebarControl />
      <Sidebar board={board} resizable={resizable} onResetWidth={resetSidebarWidth} />
      {children}
    </SidebarProvider>
  );
}

/** T3's offcanvas sidebar: closed, it slides away rather than unmounts, so Add item keeps its ⌘N and its draft, and
 *  the search and the groups' collapse survive. Its drag handle resizes it and a double-click resets the width.
 *  Below 768 px it is T3's sheet. */
function Sidebar({ board, resizable, onResetWidth }: { board: boolean; resizable: SidebarResizable; onResetWidth: () => void }) {
  const [query, setQuery] = useState('');
  const settings = useSettingsStore((state) => state.open);
  const windowControlsInsetStyle = useWindowControlsInsetStyle();
  const { isMobile } = useSidebar();
  return (
    <T3Sidebar collapsible="offcanvas" resizable={resizable} className="sidebar border-(--sidebar-border) text-(--sidebar-foreground)" style={{ ...windowControlsInsetStyle, ...TITLEBAR_CONTENT_LEFT }}>
      <div className="flex h-13 shrink-0 items-center pr-3 pl-[var(--workspace-titlebar-content-left)] [-webkit-app-region:drag]"><Brand /></div>
      <div className="contents" hidden={settings}>
        {board ? (
          <>
            <div className="px-2 pb-2"><SearchRow query={query} onQuery={setQuery} /></div>
            <ListGroups query={query.trim().toLowerCase()} />
          </>
        ) : <div className="flex-1" />}
      </div>
      {settings ? (
        <>
          <SettingsNav />
          {board && <span className="absolute bottom-2 right-2"><Update /></span>}
        </>
      ) : (
        <SidebarFooter className="sidebar-foot">
          <SidebarMenu className="flex-row items-center">
            <SidebarMenuItem className="shrink-0"><SettingsButton /></SidebarMenuItem>
            {board && <SidebarMenuItem className="ml-auto shrink-0"><Update /></SidebarMenuItem>}
          </SidebarMenu>
        </SidebarFooter>
      )}
      {/* The sheet below 768 px doesn't resize, so it has no drag handle. */}
      {!isMobile && <SidebarRail onDoubleClick={onResetWidth} />}
    </T3Sidebar>
  );
}
