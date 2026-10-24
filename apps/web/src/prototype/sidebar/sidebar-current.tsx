// PROTOTYPE, throwaway. Sidebar variant "current": repos as T3 project groups, each listing its live items (not
// List, not Done) as 28 px rows. Kept to compare against.

import { useState } from 'react';
import { ChevronDown, ChevronRight } from 'lucide-react';
import { platformOf, shortAgo } from '@mux-factory/shared';
import type { Item, Status } from '@mux-factory/shared';
import { StatusGlyph, platformColor } from '../chrome.tsx';
import { ItemTitle, refText } from '../item-bits.tsx';
import { matches } from './sidebar-data.ts';
import type { Pick, SidebarProps } from './sidebar-data.ts';

export const NAME = 'Current';
const YOURS: Status[] = ['Needs you', 'Verify', 'Ready to merge'];

function Repo({ platform, repo, items, now, scoped, onScope, pick }: { platform: string; repo: string; items: Item[]; now: number; scoped: boolean; onScope: () => void; pick: Pick }) {
  const [open, setOpen] = useState(true);
  const live = items.filter((i) => i.status !== 'List' && i.status !== 'Done');
  const you = items.filter((i) => YOURS.includes(i.status)).length;
  return (
    <div className="mb-1">
      <div className={`flex h-8 items-center gap-1.5 rounded-md px-1.5 hover:bg-(--row-hover) ${scoped ? 'bg-(--row-active)' : ''}`}>
        <button type="button" onClick={() => setOpen(!open)} className="grid size-4 place-items-center text-(--muted-foreground)">{open ? <ChevronDown className="size-3" /> : <ChevronRight className="size-3" />}</button>
        <button type="button" onClick={onScope} className="flex min-w-0 flex-1 items-center gap-2 text-left">
          <span className="grid size-5 place-items-center rounded-md text-[10px] font-bold text-white" style={{ background: platformColor(platform) }}>{platform[0]}</span>
          <span className="truncate font-medium">{platform}</span>
          <span className="truncate text-[11px] text-(--muted-foreground)">{repo.split('/')[1]}</span>
        </button>
        {you > 0 && <span className="rounded-full bg-(--warning) px-1.5 text-[10px] font-semibold text-black">{you}</span>}
      </div>
      {open && (
        <div className="flex flex-col gap-px">
          {live.map((i) => (
            <button key={i.id} type="button" onClick={() => pick.set(i.id)}
              className={`flex h-7 w-full items-center gap-2 rounded-md pl-8 pr-2 text-left hover:bg-(--row-hover) ${pick.id === i.id ? 'bg-(--row-active) font-medium' : ''}`}>
              <StatusGlyph status={i.status} className="size-3" />
              <span className={`min-w-0 flex-1 truncate ${pick.id === i.id ? '' : 'text-(--muted-foreground)'}`}><ItemTitle item={i} /></span>
              <span className="shrink-0 whitespace-nowrap text-[11px] tabular-nums text-(--muted-foreground)">{shortAgo(i.updatedAt, now)}</span>
            </button>
          ))}
        </div>
      )}
    </div>
  );
}

export function SidebarCurrent({ data, now, query: q, platform, onScope, pick }: SidebarProps) {
  return (
    <nav className="min-h-0 flex-1 overflow-y-auto px-2">
      {data.repos.map((r) => {
        const items = data.items.filter((i) => platformOf(i, data.repos) === r.platform && matches(i, q, refText(i)));
        if (q && !items.some((i) => i.status !== 'List' && i.status !== 'Done')) return null;
        return <Repo key={r.repo} platform={r.platform} repo={r.repo} now={now} pick={pick} scoped={platform === r.platform}
          items={items} onScope={() => onScope(platform === r.platform ? null : r.platform)} />;
      })}
    </nav>
  );
}
