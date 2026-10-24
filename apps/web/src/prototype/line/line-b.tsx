// PROTOTYPE, throwaway. Line variant B, "Work map": hierarchy and dependencies first, not stations. The line is an
// outline of top-level work, top to bottom. A concept, or a parent whose work spans repos, opens as a large panel:
// destination and progress, then a map with a lane per repo and one for decisions, tasks placed left to right by
// what they wait on, arrows between them, ending in the end-to-end check; then decisions, open questions, threads.
// Sub-issues of a smaller parent nest under it; everything else is one row with a mini step track.

import { useState } from 'react';
import { ListTree } from 'lucide-react';
import { STATUSES, byFlowOrder, platformOf, shortAgo } from '@mux-factory/shared';
import type { BoardData, IssueRef, Item, Status } from '@mux-factory/shared';
import { StatusGlyph, platformColor } from '../chrome.tsx';
import { ItemTitle, SliceBar, StepTrack, refText } from '../item-bits.tsx';
import type { Pick } from '../list-sidebar.tsx';
import type { LineProps } from './line-data.ts';
import { ConceptPanel, isBig, workOf } from './line-b-map.tsx';

export const NAME = 'Work map';
/** Queued to Ready to merge, with Needs you between. */
const ON_LINE: readonly Status[] = STATUSES.slice(1, 9);

function ItemRow({ item, data, now, pick, nested }: { item: Item; data: BoardData; now: number; pick: Pick; nested?: boolean }) {
  return (
    <button type="button" onClick={() => pick.set(item.id)} title={`${refText(item)} ${item.title}`}
      className={`grid w-full grid-cols-[auto_minmax(0,1fr)_auto] items-center gap-3 px-3 py-2 text-left hover:bg-(--accent) ${nested ? 'pl-9' : ''} ${pick.id === item.id ? 'bg-(--accent) shadow-[inset_2px_0_0_var(--primary)]' : ''}`}>
      <StatusGlyph status={item.status} />
      <span className="grid min-w-0 gap-0.5">
        <span className="truncate text-[13px] font-medium"><ItemTitle item={item} /></span>
        <span className="flex items-center gap-1.5 truncate text-xs text-(--muted-foreground)">
          <span className="size-1.5 shrink-0 rounded-full" style={{ background: platformColor(platformOf(item, data.repos)) }} />
          {platformOf(item, data.repos)} · {item.status} · {shortAgo(item.updatedAt, now)}
          {item.blockedBy > 0 && <span className="rounded bg-(--error-surface) px-1 text-(--error-foreground)">blocked by {item.blockedBy}</span>}
          {item.linkedPrs.length > 0 && <span>· {item.linkedPrs.length} PR</span>}
        </span>
      </span>
      <span className="grid w-36 gap-1.5 sm:w-44">
        <StepTrack status={item.status} />
        <SliceBar item={item} />
      </span>
    </button>
  );
}

interface Group { parent: IssueRef; head: Item | undefined; items: Item[] }

export function LineB({ items, data, now, pick }: LineProps) {
  const [closed, setClosed] = useState<Set<string>>(new Set());
  const big = items.filter((i) => isBig(i) && i.status !== 'Done' && i.status !== 'List').sort(byFlowOrder);
  const held = new Set(big.flatMap((h) => workOf(h, data).members.map((m) => m.id)));
  const rest = items.filter((i) => ON_LINE.includes(i.status) && !big.includes(i) && !held.has(i.id)).sort(byFlowOrder);
  const groups = new Map<string, Group>();
  for (const i of rest) {
    if (!i.parent) continue;
    const key = `${i.parent.repo}#${i.parent.number}`;
    const g = groups.get(key) ?? { parent: i.parent, head: data.items.find((h) => h.repo === i.parent!.repo && h.number === i.parent!.number), items: [] };
    g.items.push(i);
    groups.set(key, g);
  }
  const heads = new Set([...groups.values()].flatMap((g) => (g.head ? [g.head.id] : [])));
  const singles = rest.filter((i) => !i.parent && !heads.has(i.id));
  const toggle = (id: string) => setClosed((s) => { const n = new Set(s); if (!n.delete(id)) n.add(id); return n; });
  return (
    <div className="grid gap-4">
      {big.map((h) => <ConceptPanel key={h.id} head={h} data={data} now={now} pick={pick} open={!closed.has(h.id)} onToggle={() => toggle(h.id)} />)}
      {(groups.size > 0 || singles.length > 0) && (
        <div className="divide-y divide-(--border) overflow-hidden rounded-xl border border-(--border) bg-(--card)">
          {[...groups.values()].map((g) => (
            <div key={`${g.parent.repo}#${g.parent.number}`} className="grid">
              {g.head && ON_LINE.includes(g.head.status)
                ? <ItemRow item={g.head} data={data} now={now} pick={pick} />
                : (
                  <div className="flex items-center gap-3 px-3 py-2 text-[13px]">
                    <ListTree className="size-3.5 shrink-0 text-(--muted-foreground)" />
                    <span className="min-w-0 flex-1 truncate font-medium"><span className="font-normal text-(--muted-foreground) tabular-nums">#{g.parent.number}</span> {g.parent.title}</span>
                    <span className="shrink-0 text-xs text-(--muted-foreground)">parent · {g.items.length} on the line</span>
                  </div>
                )}
              <div className="relative before:absolute before:bottom-3 before:left-[18px] before:top-0 before:w-px before:bg-(--border)">
                {g.items.map((i) => <ItemRow key={i.id} item={i} data={data} now={now} pick={pick} nested />)}
              </div>
            </div>
          ))}
          {singles.map((i) => <ItemRow key={i.id} item={i} data={data} now={now} pick={pick} />)}
        </div>
      )}
      {!big.length && !rest.length && <p className="m-0 rounded-xl border border-dashed border-(--input) p-6 text-center text-(--muted-foreground)">Nothing in flight.</p>}
    </div>
  );
}
