// The left sidebar, on T3 Code's sidebar component and copied in layout from T3's: the brand beside the window controls, search with Add item, the
// List by repository, and Settings and the update button at its foot. Above the missing-t3 notice there's no List to
// search or add to, so only the brand and Settings show. In Settings the section list takes the List's place, hiding
// the List rather than closing it, so Back finds it as it was.

import { useState, type CSSProperties, type ReactNode } from 'react';
import { Search, X } from 'lucide-react';
import { boardApp } from '@mux-factory/shared';
import { Sidebar as T3Sidebar, SidebarProvider } from '@mux-factory/ui/sidebar';
import { Tooltip, TooltipPopup, TooltipTrigger } from '@mux-factory/ui/tooltip';
import { AddItem } from '../add-item/add-item.tsx';
import { SettingsButton, SettingsNav } from '../settings/settings.tsx';
import { useSettingsStore } from '../settings/settings-store.ts';
import { UpdateButton } from '../updates/UpdateButton.tsx';
import { UpdateStatusIcon } from '../updates/UpdateStatusIcon.tsx';
import { ListGroups } from './list-groups.tsx';
import { useSidebarStore } from './sidebar-store.ts';
import { Brand, useBrandLeft } from './window-controls.tsx';

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

/** T3's SidebarProvider around the page, at the board's 300 px. The sidebar store holds open, so the title bar, the
 *  app and ⌘B read one value. */
export function SidebarLayout({ className, children }: { className?: string; children: ReactNode }) {
  const open = useSidebarStore((state) => state.open);
  const setOpen = useSidebarStore((state) => state.setOpen);
  return (
    <SidebarProvider open={open} onOpenChange={setOpen} className={className} style={{ '--sidebar-width': '300px' } as CSSProperties}>
      {children}
    </SidebarProvider>
  );
}

/** T3's offcanvas sidebar: closed, it slides away rather than unmounts, so Add item keeps its ⌘N and its draft, and
 *  the search and the groups' collapse survive. Below 768 px it is T3's sheet. */
export function Sidebar({ board = true }: { board?: boolean }) {
  const [query, setQuery] = useState('');
  const settings = useSettingsStore((state) => state.open);
  const brandLeft = useBrandLeft();
  return (
    <T3Sidebar collapsible="offcanvas" className="sidebar border-(--sidebar-border) text-(--sidebar-foreground)">
      <div className={`flex h-13 shrink-0 items-center pr-3 ${brandLeft} [-webkit-app-region:drag]`}><Brand /></div>
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
        <div className="sidebar-foot flex items-center justify-between px-2 py-2">
          <SettingsButton />
          {board && <Update />}
        </div>
      )}
    </T3Sidebar>
  );
}
