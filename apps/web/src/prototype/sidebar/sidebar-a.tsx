// PROTOTYPE, throwaway. Sidebar variant A "Roomy projects": T3's thread list at T3's own size. Each repo is a
// project group (36 px header, 36 px rows, a gap between groups) listing its live items, the first six then
// "Show N more"; under them a quieter "List" subgroup, closed by default, holds the items not yet queued. Items with
// no repo get a Draft group. Done is hidden. Searching opens every group and subgroup that matches.

import { useState } from 'react';
import { ChevronDown, ChevronRight, Plus } from 'lucide-react';
import { platformOf, shortAgo } from '@mux-factory/shared';
import type { Item, Status } from '@mux-factory/shared';
import { StatusGlyph, platformColor } from '../chrome.tsx';
import { ItemTitle, refText } from '../item-bits.tsx';
import { matches } from './sidebar-data.ts';
import type { Pick, SidebarProps } from './sidebar-data.ts';

export const NAME = 'Roomy projects';
const YOURS: Status[] = ['Needs you', 'Verify', 'Ready to merge'];
const PREVIEW = 6;
const Chevron = ({ open }: { open: boolean }) => (open ? <ChevronDown className="size-3.5" /> : <ChevronRight className="size-3.5" />);

function Row({ item, now, pick, quiet }: { item: Item; now: number; pick: Pick; quiet?: boolean }) {
  const on = pick.id === item.id;
  return (
    <button type="button" onClick={() => pick.set(item.id)}
      className={`flex w-full items-center gap-2.5 rounded-md pl-8 pr-2.5 text-left hover:bg-(--row-hover) ${quiet ? 'h-8 text-[13px]' : 'h-9 text-sm'} ${on ? 'bg-(--row-active) font-medium text-(--sidebar-fg)' : quiet ? 'text-(--sidebar-muted)' : 'text-(--sidebar-fg)/80'}`}>
      <StatusGlyph status={item.status} className={quiet ? 'size-3' : 'size-3.5'} />
      <span className="min-w-0 flex-1 truncate"><ItemTitle item={item} /></span>
      {!quiet && <span className="shrink-0 whitespace-nowrap text-[11px] tabular-nums text-(--sidebar-muted)">{shortAgo(item.updatedAt, now)}</span>}
    </button>
  );
}

function Repo({ platform, repo, items, now, q, scoped, onScope, pick }: { platform: string; repo: string | null; items: Item[]; now: number; q: string; scoped: boolean; onScope: () => void; pick: Pick }) {
  const [shut, setShut] = useState(false);
  const [listOpen, setListOpen] = useState(false);
  const [all, setAll] = useState(false);
  const live = items.filter((i) => i.status !== 'List' && i.status !== 'Done');
  const list = items.filter((i) => i.status === 'List');
  const you = items.filter((i) => YOURS.includes(i.status)).length;
  const open = q ? true : !shut;
  const showList = q ? list.length > 0 : listOpen;
  const shown = q || all ? live : live.slice(0, PREVIEW);
  return (
    <section>
      <div className={`flex h-9 items-center gap-1.5 rounded-md px-1.5 hover:bg-(--row-hover) ${scoped ? 'bg-(--row-active)' : ''}`}>
        <button type="button" aria-label={open ? `Collapse ${platform}` : `Expand ${platform}`} onClick={() => setShut(!shut)} className="grid size-5 place-items-center text-(--sidebar-muted)"><Chevron open={open} /></button>
        <button type="button" onClick={onScope} className="flex min-w-0 flex-1 items-center gap-2 text-left">
          <span className="grid size-5 shrink-0 place-items-center rounded-md text-[10px] font-bold text-white" style={{ background: platformColor(platform) }}>{platform[0]}</span>
          <span className="truncate text-sm font-medium text-(--sidebar-fg)">{platform}</span>
          {repo && <span className="truncate text-[11px] text-(--sidebar-muted)">{repo.split('/')[1]}</span>}
        </button>
        {you > 0 && <span className="shrink-0 rounded-full bg-(--warning) px-1.5 text-[10px] font-semibold text-black">{you}</span>}
      </div>
      {open && (
        <div className="mt-0.5 flex flex-col gap-px">
          {shown.map((i) => <Row key={i.id} item={i} now={now} pick={pick} />)}
          {!q && !all && live.length > PREVIEW && (
            <button type="button" onClick={() => setAll(true)} className="flex h-9 w-full items-center gap-2.5 rounded-md pl-8 pr-2.5 text-left text-sm text-(--sidebar-muted)/70 hover:bg-(--row-hover) hover:text-(--sidebar-fg)">
              <Plus className="size-3.5 shrink-0" />Show {live.length - PREVIEW} more
            </button>
          )}
          {list.length > 0 && (
            <>
              <button type="button" onClick={() => setListOpen(!listOpen)} className="mt-1 flex h-8 w-full items-center gap-2 rounded-md pl-8 pr-2.5 text-left text-xs text-(--sidebar-muted) hover:bg-(--row-hover)">
                <Chevron open={showList} /><span className="flex-1 font-medium">List</span><span className="tabular-nums">{list.length}</span>
              </button>
              {showList && list.map((i) => <Row key={i.id} item={i} now={now} pick={pick} quiet />)}
            </>
          )}
        </div>
      )}
    </section>
  );
}

export function SidebarA({ data, now, query: q, platform, onScope, pick }: SidebarProps) {
  const known = data.repos.map((r) => ({ platform: r.platform, repo: r.repo as string | null }));
  const extra = [...new Set(data.items.map((i) => platformOf(i, data.repos)))].filter((p) => !known.some((k) => k.platform === p)).map((p) => ({ platform: p, repo: null }));
  return (
    <nav className="flex min-h-0 flex-1 flex-col gap-4 overflow-y-auto px-2 pb-3 pt-1">
      {[...known, ...extra].map((r) => {
        const items = data.items.filter((i) => i.status !== 'Done' && platformOf(i, data.repos) === r.platform && matches(i, q, refText(i)));
        if ((q || !r.repo) && !items.length) return null;
        return <Repo key={r.platform} platform={r.platform} repo={r.repo} items={items} now={now} q={q} pick={pick} scoped={platform === r.platform}
          onScope={() => onScope(platform === r.platform ? null : r.platform)} />;
      })}
    </nav>
  );
}
