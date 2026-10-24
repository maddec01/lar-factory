// PROTOTYPE, throwaway. The left sidebar holds the List: items not yet queued, in T3's thread list at T3's own size.
// Each repo is a project group (36 px header, 36 px rows, a gap between groups) with its List items, the first six
// then "Show N more"; items with no repo get a Draft group. Once queued, an item leaves the sidebar for the
// dashboard. Searching opens every group that matches.

import { useState } from 'react';
import { ChevronDown, ChevronRight, Plus } from 'lucide-react';
import { platformOf, shortAgo } from '@mux-factory/shared';
import type { BoardData, Item } from '@mux-factory/shared';
import { StatusGlyph, platformColor } from './chrome.tsx';
import { ItemTitle, refText } from './item-bits.tsx';

/** The item open in the details dialog, and how to open another. */
export type Pick = { id: string | null; set: (id: string) => void };

const PREVIEW = 6;
const Chevron = ({ open }: { open: boolean }) => (open ? <ChevronDown className="size-3.5" /> : <ChevronRight className="size-3.5" />);
const matches = (item: Item, q: string) => !q || `${item.title} ${refText(item)}`.toLowerCase().includes(q);

function Row({ item, now, pick }: { item: Item; now: number; pick: Pick }) {
  const on = pick.id === item.id;
  return (
    <button type="button" onClick={() => pick.set(item.id)}
      className={`flex h-9 w-full items-center gap-2.5 rounded-md pl-8 pr-2.5 text-left text-sm hover:bg-(--row-hover) ${on ? 'bg-(--row-active) font-medium text-(--sidebar-fg)' : 'text-(--sidebar-fg)/80'}`}>
      <StatusGlyph status={item.status} />
      <span className="min-w-0 flex-1 truncate"><ItemTitle item={item} /></span>
      <span className="shrink-0 whitespace-nowrap text-[11px] tabular-nums text-(--sidebar-muted)">{shortAgo(item.updatedAt, now)}</span>
    </button>
  );
}

function Repo({ platform, repo, items, now, q, scoped, onScope, pick }: { platform: string; repo: string | null; items: Item[]; now: number; q: string; scoped: boolean; onScope: () => void; pick: Pick }) {
  const [shut, setShut] = useState(false);
  const [all, setAll] = useState(false);
  const open = q ? true : !shut;
  const shown = q || all ? items : items.slice(0, PREVIEW);
  return (
    <section>
      <div className={`flex h-9 items-center gap-1.5 rounded-md px-1.5 hover:bg-(--row-hover) ${scoped ? 'bg-(--row-active)' : ''}`}>
        <button type="button" aria-label={open ? `Collapse ${platform}` : `Expand ${platform}`} onClick={() => setShut(!shut)} className="grid size-5 place-items-center text-(--sidebar-muted)"><Chevron open={open} /></button>
        <button type="button" onClick={onScope} className="flex min-w-0 flex-1 items-center gap-2 text-left">
          <span className="grid size-5 shrink-0 place-items-center rounded-md text-[10px] font-bold text-white" style={{ background: platformColor(platform) }}>{platform[0]}</span>
          <span className="truncate text-sm font-medium text-(--sidebar-fg)">{platform}</span>
          {repo && <span className="truncate text-[11px] text-(--sidebar-muted)">{repo.split('/')[1]}</span>}
        </button>
        <span className="shrink-0 pr-1 text-[11px] tabular-nums text-(--sidebar-muted)">{items.length}</span>
      </div>
      {open && (
        <div className="mt-0.5 flex flex-col gap-px">
          {shown.map((i) => <Row key={i.id} item={i} now={now} pick={pick} />)}
          {!items.length && <p className="m-0 flex h-9 items-center pl-8 text-[13px] text-(--sidebar-muted)">Nothing in List</p>}
          {!q && !all && items.length > PREVIEW && (
            <button type="button" onClick={() => setAll(true)} className="flex h-9 w-full items-center gap-2.5 rounded-md pl-8 pr-2.5 text-left text-sm text-(--sidebar-muted)/70 hover:bg-(--row-hover) hover:text-(--sidebar-fg)">
              <Plus className="size-3.5 shrink-0" />Show {items.length - PREVIEW} more
            </button>
          )}
        </div>
      )}
    </section>
  );
}

export function ListSidebar({ data, now, query: q, platform, onScope, pick }: {
  data: BoardData; now: number; query: string; platform: string | null; onScope: (platform: string | null) => void; pick: Pick;
}) {
  const list = data.items.filter((i) => i.status === 'List' && matches(i, q));
  const known = data.repos.map((r) => ({ platform: r.platform, repo: r.repo as string | null }));
  const extra = [...new Set(list.map((i) => platformOf(i, data.repos)))].filter((p) => !known.some((k) => k.platform === p)).map((p) => ({ platform: p, repo: null }));
  return (
    <nav className="flex min-h-0 flex-1 flex-col gap-4 overflow-y-auto px-2 pb-3 pt-1">
      {[...known, ...extra].map((r) => {
        const items = list.filter((i) => platformOf(i, data.repos) === r.platform);
        if ((q || !r.repo) && !items.length) return null;
        return <Repo key={r.platform} platform={r.platform} repo={r.repo} items={items} now={now} q={q} pick={pick} scoped={platform === r.platform}
          onScope={() => onScope(platform === r.platform ? null : r.platform)} />;
      })}
      {q && !list.length && <p className="m-0 px-2 text-[13px] text-(--sidebar-muted)">Nothing in List matches.</p>}
    </nav>
  );
}
