// The left sidebar, copied in layout from T3 Code's: the brand beside the window controls, search with Add item, the
// List by repository, and Settings and the update button at its foot. Above the missing-t3 notice there's no List to
// search or add to, so only the brand and Settings show.

import { useState } from 'react';
import { Search, X } from 'lucide-react';
import { boardApp } from '@mux-factory/shared';
import { Tooltip, TooltipPopup, TooltipTrigger } from '@mux-factory/ui/tooltip';
import { AddItem } from '../add-item/add-item.tsx';
import { Settings } from '../settings/settings.tsx';
import { UpdateButton } from '../updates/UpdateButton.tsx';
import { UpdateStatusIcon } from '../updates/UpdateStatusIcon.tsx';
import { ListGroups } from './list-groups.tsx';
import { BRAND_LEFT, Brand } from './window-controls.tsx';

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

/** Closed, the sidebar hides rather than unmounts, so Add item keeps its ⌘N and its draft, and the search and the
 *  groups' collapse survive. */
export function Sidebar({ board = true, open = true }: { board?: boolean; open?: boolean }) {
  const [query, setQuery] = useState('');
  return (
    <aside hidden={!open} className="sidebar relative flex w-75 shrink-0 flex-col border-r border-(--sidebar-border) bg-(--sidebar) text-(--sidebar-foreground)">
      <div className={`flex h-13 shrink-0 items-center pr-3 ${BRAND_LEFT} [-webkit-app-region:drag]`}><Brand /></div>
      {board ? (
        <>
          <div className="px-2 pb-2"><SearchRow query={query} onQuery={setQuery} /></div>
          <ListGroups query={query.trim().toLowerCase()} />
        </>
      ) : <div className="flex-1" />}
      <div className="sidebar-foot flex items-center justify-between px-2 py-2">
        <Settings />
        {board && <Update />}
      </div>
    </aside>
  );
}
