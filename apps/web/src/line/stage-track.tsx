// The line's rows, shared by the in-flight table and the dossiers: one grid for every row, so the stage and agent
// columns line up down the page, the six-stage track, the agent figures, a build's slices, and the row itself.

import { useState } from 'react';
import type { ReactNode } from 'react';
import { ChevronDown, ChevronRight } from 'lucide-react';
import { duration, formatTokens, formatUsd, openBlockers, platformOf, ref, shortAgo, slug } from '@lar-factory/shared';
import type { BoardData, Item, ItemStats, Status } from '@lar-factory/shared';
import { useItemDialogStore } from '../item-dialog/item-dialog-store.ts';
import { ItemTitle, SliceBar, SliceList } from '../items/item-parts.tsx';
import { STATUS_COLOR, StatusGlyph, TwoStatusesMark } from '../items/status-glyph.tsx';

const STAGES: { name: string; short: string; statuses: Status[] }[] = [
  { name: 'Refining', short: 'Refine', statuses: ['Shaping', 'Needs you'] },
  { name: 'Ready', short: 'Ready', statuses: ['Ready'] },
  { name: 'Building', short: 'Build', statuses: ['In progress'] },
  { name: 'Review', short: 'Review', statuses: ['Review'] },
  { name: 'Verify', short: 'Verify', statuses: ['Verify', 'Ready to merge'] },
  { name: 'Done', short: 'Done', statuses: ['Done'] },
];
/** The status's stage on the track, or -1 for List and Queued, which sit before it. */
export const stageOf = (s: Status) => STAGES.findIndex((st) => st.statuses.includes(s));
/**
 * One grid for every row, in the table and in each dossier, so the stage and agent columns line up down the page.
 * Below the line's @2xl width, as at the app's 840 px minimum, the Agent column drops and the track narrows, so the
 * titles keep room to read.
 */
export const GRID = 'grid grid-cols-[minmax(0,1fr)_11rem_8rem] items-center gap-x-4 px-3 @2xl:grid-cols-[minmax(0,1fr)_13rem_6rem_8rem] @3xl:grid-cols-[minmax(0,1fr)_18rem_7rem_11rem]';
/** The Agent column's cells, hidden while the grid leaves it out. */
const AGENT = 'hidden @2xl:grid';
export const picked = (on: boolean) => (on ? 'bg-(--accent) ring-2 ring-inset ring-(--primary)' : '');
const PAST = 'color-mix(in srgb, var(--foreground) 28%, transparent)';

/** The desk's statuses the line takes no action on. Ready is on the desk too, but keeps Start build on the line. */
export const YOURS: Status[] = ['Needs you', 'Verify', 'Ready to merge'];

/** What an item's thread is doing at each status where one is at work, or about to be. */
export const THREAD_TEXT: Partial<Record<Status, string>> = {
  Shaping: 'shaping thread running', Ready: 'build starts on Start', 'In progress': 'build thread running', Review: 'reviewers running',
};

/** Where to act on an item that waits on you. */
export function OnYourDesk({ status }: { status: Status }) {
  return <span className="inline-flex items-center gap-1 text-(--warning-foreground)"><StatusGlyph status={status} className="size-3" />on your desk</span>;
}

export const statsOf = (item: Item): ItemStats | null => (item.stats && item.stats !== 'unavailable' ? item.stats : null);

/** Agent time over tokens and cost; a dash before any thread has worked on it. */
export function AgentCell({ s }: { s: ItemStats | null }) {
  if (!s) return <span className={`${AGENT} text-right text-[11px] text-(--muted-foreground)`}>–</span>;
  return (
    <span className={`${AGENT} text-right text-[11px] leading-tight tabular-nums text-(--muted-foreground)`} title={s.frozen ? 'As it stood at merge' : 'Agent time · tokens · cost'}>
      <span className="font-medium text-(--foreground)">{duration(s.agentMs)}</span>
      <span>{formatTokens(s.tokens)} · {s.costUsd !== undefined ? formatUsd(s.costUsd) : '–'}</span>
    </span>
  );
}

/** Six stage cells: the stages behind filled, the current one coloured up to its glyph, the rest faint. */
export function Track({ status, waiting }: { status: Status; waiting?: boolean }) {
  const at = stageOf(status);
  return (
    <ol className="m-0 grid list-none grid-cols-6 gap-px p-0" title={`${status}${waiting ? ', waiting' : ''}`}>
      {STAGES.map((st, n) => (
        <li key={st.name} className="relative flex h-5 items-center justify-center">
          <span className={`absolute inset-x-0 h-1.5 ${n === 0 ? 'rounded-l-full' : ''} ${n === STAGES.length - 1 ? 'rounded-r-full' : ''}`}
            style={{ background: n < at ? PAST : 'var(--soft)' }} />
          {n === at && (
            <>
              <span className={`absolute left-0 right-1/2 h-1.5 ${n === 0 ? 'rounded-l-full' : ''}`} style={{ background: STATUS_COLOR[status], opacity: waiting ? 0.35 : 1 }} />
              <span className={`relative grid size-5 place-items-center rounded-full bg-(--card) ${waiting ? 'border border-dashed border-(--muted-foreground)' : ''}`}><StatusGlyph status={status} /></span>
            </>
          )}
        </li>
      ))}
    </ol>
  );
}

/** The column header over a run of rows: `label`, the stage names, Agent and `side`. */
export function StageHeader({ label, side }: { label: ReactNode; side: ReactNode }) {
  return (
    <div className={`${GRID} border-b border-(--border) py-1.5 text-[11px] text-(--muted-foreground)`}>
      <span className="truncate font-medium">{label}</span>
      <ol className="m-0 grid list-none grid-cols-6 gap-px p-0 text-center">
        {STAGES.map((st) => <li key={st.name} title={st.statuses.join(', ')} className="truncate"><span className="@3xl:hidden">{st.short}</span><span className="hidden @3xl:inline">{st.name}</span></li>)}
      </ol>
      <span className={`${AGENT} text-right`}>Agent</span>
      <span className="truncate text-right">{side}</span>
    </div>
  );
}

/** A build's slices at a glance: the bar across the title column, the count, and the slices that are moving or stuck. */
function SliceSummary({ item, open, onToggle }: { item: Item; open: boolean; onToggle: () => void }) {
  const done = item.slices.filter((s) => s.progress === 'done').length;
  const active = item.slices.filter((s) => s.progress === 'active');
  const blocked = item.slices.filter((s) => s.progress === 'blocked');
  const named = [...blocked.map((s) => ({ s, tone: 'text-(--st-review)', word: 'blocked' })), ...active.map((s) => ({ s, tone: 'text-(--st-now)', word: 'active' }))];
  return (
    <span className="grid gap-1">
      <SliceBar item={item} />
      <button type="button" aria-expanded={open} onClick={(e) => { e.stopPropagation(); onToggle(); }} className="flex min-w-0 items-center gap-1 text-left text-[11px] text-(--muted-foreground) hover:text-(--foreground)">
        {open ? <ChevronDown className="size-3 shrink-0" /> : <ChevronRight className="size-3 shrink-0" />}
        <span className="shrink-0 font-medium tabular-nums text-(--foreground)">{done}/{item.slices.length} slices</span>
        {named.length > 0 && <span className="min-w-0 truncate">· {named.map(({ s, tone, word }, n) => <span key={s.number}>{n > 0 && ', '}<span className={tone}>{word}</span> #{s.number} {s.title}</span>)}</span>}
      </button>
    </span>
  );
}

/**
 * One piece of work on the track; the whole row opens it in the item dialog, and a build's slices unfold under it.
 * `children` sit under the row, for what its side action has to say.
 */
export function Row({ item, data, now, side, waiting, nested, children }: {
  item: Item; data: BoardData; now: number; side: ReactNode; waiting?: boolean; nested?: boolean; children?: ReactNode;
}) {
  const [slices, setSlices] = useState(false);
  const isPicked = useItemDialogStore((state) => state.itemId === item.id);
  const platform = platformOf(item, data.repos);
  const blocked = openBlockers(item).length;
  return (
    <div className="border-b border-(--border) last:border-b-0">
      <div onClick={() => useItemDialogStore.getState().open(item.id)} data-item={item.id} className={`${GRID} cursor-pointer py-2 hover:bg-(--accent) ${picked(isPicked)}`}>
        <span title={`${ref(item)} ${item.title}`} className="flex min-w-0 items-start gap-2 text-left">
          {nested && <span className="mb-auto ml-1 h-3 w-2.5 shrink-0 rounded-bl border-b border-l border-(--input)" />}
          <span className={`plat-${slug(platform)} mt-1.5 size-1.5 shrink-0 rounded-full bg-[var(--k,var(--muted-foreground))]`} />
          <span className="grid min-w-0 flex-1 grid-cols-[minmax(0,1fr)] gap-1">
            <span className="truncate text-[13px]"><ItemTitle item={item} /></span>
            <span className="flex min-w-0 items-center gap-1.5 text-[11px] text-(--muted-foreground)">
              <TwoStatusesMark item={item} className="size-3" />
              <span className="truncate">{item.status} · {platform} · {shortAgo(item.updatedAt, now)}</span>
              {blocked > 0 && <span className="shrink-0 rounded bg-(--error-surface) px-1 text-(--error-foreground)">blocked by {blocked}</span>}
            </span>
            {item.slices.length > 0 && <SliceSummary item={item} open={slices} onToggle={() => setSlices(!slices)} />}
          </span>
        </span>
        <Track status={item.status} waiting={waiting} />
        <AgentCell s={statsOf(item)} />
        <div className="flex min-w-0 flex-wrap items-center justify-end gap-x-2 gap-y-1 text-right text-[11px] text-(--muted-foreground)">{side}</div>
      </div>
      {children}
      {slices && <div className={`pb-2 ${nested ? 'pl-12' : 'pl-7'} pr-3`}><SliceList item={item} /></div>}
    </div>
  );
}
