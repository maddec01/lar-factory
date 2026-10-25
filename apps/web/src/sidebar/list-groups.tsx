// The sidebar's List: items not yet queued, in T3's thread list at T3's own size. Each repository is a project group
// (36 px header, a gap between groups) with its List items, the first six then "Show N more"; items with no repository
// get a Draft group. A row is T3's thread row type: the title alone on one line, its ref and age on a smaller line
// under it, about 42 px tall. Searching opens every group that matches. A group's name scopes the main area to
// its repository, and a row opens the item dialog.

import { useState } from 'react';
import { ChevronDown, ChevronRight, Plus } from 'lucide-react';
import { boardSections, ref, shortAgo, slug } from '@mux-factory/shared';
import type { Item } from '@mux-factory/shared';
import { useBoardStore } from '../board/board-store.ts';
import { useItemDialogStore } from '../item-dialog/item-dialog-store.ts';
import { StatusGlyph } from '../items/status-glyph.tsx';
import { useSidebarStore } from './sidebar-store.ts';

const PREVIEW = 6;
const matches = (item: Item, q: string) => !q || `${item.title} ${ref(item)}`.toLowerCase().includes(q);

function Row({ item, now }: { item: Item; now: number }) {
  const on = useItemDialogStore((state) => state.itemId === item.id);
  return (
    <button type="button" onClick={() => useItemDialogStore.getState().open(item.id)} data-item={item.id} title={item.title}
      className={`flex w-full items-center gap-2 rounded-md py-1 pl-6 pr-2 text-left hover:bg-(--sidebar-row-hover) ${on ? 'bg-(--sidebar-row-selected) text-(--sidebar-foreground)' : 'text-(--sidebar-foreground)/80'}`}>
      <StatusGlyph status={item.status} />
      <span className="min-w-0 flex-1">
        <span className="block truncate text-sm font-medium leading-[18px]">{item.title}</span>
        <span className="block truncate text-xs leading-4 tabular-nums text-(--sidebar-muted-foreground)">{ref(item)} · {shortAgo(item.updatedAt, now)}</span>
      </span>
    </button>
  );
}

function Group({ platform, repo, items, now, q }: { platform: string; repo: string | undefined; items: Item[]; now: number; q: string }) {
  const [shut, setShut] = useState(false);
  const [all, setAll] = useState(false);
  const { scope, setScope } = useSidebarStore();
  const scoped = scope === platform;
  const open = q ? true : !shut;
  const shown = q || all ? items : items.slice(0, PREVIEW);
  return (
    <section className="list-group" data-platform={platform}>
      <div className={`flex h-9 items-center gap-1.5 rounded-md px-1.5 hover:bg-(--sidebar-row-hover) ${scoped ? 'bg-(--sidebar-row-selected)' : ''}`}>
        <button type="button" aria-label={open ? `Collapse ${platform}` : `Expand ${platform}`} aria-expanded={open} onClick={() => setShut(!shut)}
          className="grid size-5 place-items-center text-(--sidebar-muted-foreground)">
          {open ? <ChevronDown className="size-3.5" /> : <ChevronRight className="size-3.5" />}
        </button>
        <button type="button" aria-pressed={scoped} onClick={() => setScope(scoped ? null : platform)} className="scope flex min-w-0 flex-1 items-center gap-2 text-left">
          <span className={`plat-${slug(platform)} grid size-5 shrink-0 place-items-center rounded-md bg-[var(--k,var(--muted-foreground))] text-[10px] font-bold text-white`} aria-hidden="true">{platform[0]}</span>
          <span className="truncate text-sm font-medium text-(--sidebar-foreground)">{platform}</span>
          {repo && <span className="truncate text-[11px] text-(--sidebar-muted-foreground)">{repo.split('/')[1]}</span>}
        </button>
        <span className="count shrink-0 pr-1 text-[11px] tabular-nums text-(--sidebar-muted-foreground)">{items.length}</span>
      </div>
      {open && (
        <div className="mt-0.5 flex flex-col gap-px">
          {shown.map((i) => <Row key={i.id} item={i} now={now} />)}
          {!items.length && <p className="m-0 flex h-9 items-center pl-6 text-[13px] text-(--sidebar-muted-foreground)">Nothing in List</p>}
          {!q && !all && items.length > PREVIEW && (
            <button type="button" onClick={() => setAll(true)}
              className="flex h-9 w-full items-center gap-2 rounded-md pl-6 pr-2 text-left text-sm text-(--sidebar-muted-foreground)/70 hover:bg-(--sidebar-row-hover) hover:text-(--sidebar-foreground)">
              <Plus className="size-3.5 shrink-0" />Show {items.length - PREVIEW} more
            </button>
          )}
        </div>
      )}
    </section>
  );
}

/** `query` is the search, lower case and trimmed. */
export function ListGroups({ query: q }: { query: string }) {
  const { data, now } = useBoardStore();
  const groups = boardSections(data, now).listGroups
    .map((group) => ({ ...group, items: group.items.filter((i) => matches(i, q)) }))
    .filter((group) => !q || group.items.length);
  return (
    <nav className="flex min-h-0 flex-1 flex-col gap-4 overflow-y-auto px-2 pb-3 pt-1" aria-label="List">
      {groups.map(({ platform, items }) => (
        <Group key={platform} platform={platform} repo={data.repos.find((r) => r.platform === platform)?.repo} items={items} now={now} q={q} />
      ))}
      {q && !groups.length && <p className="m-0 px-2 text-[13px] text-(--sidebar-muted-foreground)">Nothing in List matches.</p>}
    </nav>
  );
}
