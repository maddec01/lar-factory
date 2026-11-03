// The board's one work row, in Queue, Shaping, Ready to build and Build alike: a single line in columns that line up down
// the whole board. One button opens the item's details; the slice count and the row's action sit beside that button as
// their own focus stops. A build's count unfolds its slices under the row.

import { useState } from 'react';
import { ChevronDown, ChevronRight, GitPullRequest } from 'lucide-react';
import { blockedText, canRetryBuild, currentBuildThread, itemName, prLabel, shortAgo } from '@lar-factory/shared';
import type { BoardData, Item } from '@lar-factory/shared';
import { Badge } from '@lar-factory/ui/design-system/Badge';
import { useBoardStore } from '../board/board-store.ts';
import { useItemDialogStore } from '../item-dialog/item-dialog-store.ts';
import { ActivityFeedback, AzureFields, ItemTitle, KindMarker, SliceBar, SliceList, useActivityFeedback, useActivityUnavailable, useShownStatus } from '../items/item-parts.tsx';
import { OpenThread, hasLiveThread } from '../items/open-thread.tsx';
import { StartAfterError, StartOrAfter } from '../items/start-after.tsx';
import { StartBuild } from '../items/start-build.tsx';
import { StartMessage } from '../items/start-control.tsx';
import { StatusGlyph } from '../items/status-glyph.tsx';
import { Figures, ROW_COLUMNS, figuresOf } from './columns.tsx';
import { threadAtWork, threadsOf } from './dossier-parts.ts';
import { RowKind, RowSource } from './row-identity.tsx';
import { OnYourDesk, YOURS, ROW_OPENS, picked, threadText } from './stage-track.tsx';
import type { StageRow as Row } from './stage-rows.ts';

/** The one thing a status asks next, or where to act on an item that waits on you. */
function Side({ item, data }: { item: Item; data: BoardData }) {
  const { working } = useShownStatus(item);
  if (working) return <OpenThread item={item} data={data} threadId={currentBuildThread(item)?.id} />;
  if (YOURS.includes(item.status)) return <OnYourDesk />;
  switch (item.status) {
    case 'Queued': return hasLiveThread(item) ? <OpenThread item={item} data={data} /> : <StartOrAfter item={item} data={data} label="Shape issue" namesBlocker={false} />;
    case 'Ready': return <StartBuild item={item} data={data} namesBlocker={false} />;
    case 'In progress': if (canRetryBuild(item)) return <StartBuild item={item} data={data} namesBlocker={false} />; return <OpenThread item={item} data={data} />;
    case 'Shaping': case 'Review': return <OpenThread item={item} data={data} />;
    default: return null;
  }
}

/** The blocked slices, then the active ones. */
const sliceNote = (item: Item) => {
  const b = item.slices.filter((s) => s.progress === 'blocked');
  const a = item.slices.filter((s) => s.progress === 'active');
  return [...b.map((s) => ({ s, word: 'blocked', tone: 'text-(--st-review)' })), ...a.map((s) => ({ s, word: 'active', tone: 'text-(--st-now)' }))];
};

/** Which concept or parent the row's work belongs to. */
function PartOf({ concept }: { concept: Item }) {
  const text = `${concept.kind === 'concept' ? 'Concept' : 'Part of'}: ${concept.title}`;
  return <span data-concept title={text} className="min-w-0 max-w-44 shrink-[100] truncate rounded bg-(--muted) px-1.5 text-[11px] text-(--muted-foreground)">{text}</span>;
}

/** The row's state, once: Working for a run known to be running, whatever telemetry it lacks, and a start's progress only where the row's action doesn't say it. */
function stateText(item: Item, word: string, label: string, runKnown: boolean): string {
  if (label === 'Activity unavailable') return runKnown ? 'Working' : word;
  if (label === word || label === 'Working') return label;
  if ((label === 'Starting' || label === 'May have started') && ['Queued', 'Ready', 'In progress'].includes(item.status)) return word;
  return `${word} · ${label}`;
}

/** `n` is a Queue row's place in the Queue, which it shows in the glyph's place, with its age as its state. */
export function StageRow({ row: { item, concept }, data, n }: { row: Row; data: BoardData; n?: number }) {
  const feedback = useActivityFeedback(item);
  const shown = useShownStatus(item);
  const now = useBoardStore((state) => state.now);
  const unavailable = useActivityUnavailable();
  const [slices, setSlices] = useState(false);
  const isPicked = useItemDialogStore((state) => state.itemId === item.id);
  const done = item.slices.filter((s) => s.progress === 'done').length;
  const note = sliceNote(item);
  const blocked = blockedText(item);
  const runKnown = !unavailable && threadsOf(item).some(threadAtWork);
  const state = shown.working ? 'Working' : stateText(item, shown.word, feedback.label, runKnown);
  return (
    <li data-item={item.id} className="@container border-b border-(--border) last:border-b-0">
      <div className={`flex items-center gap-2 pr-2 hover:bg-(--accent) ${picked(isPicked)}`}>
        <button type="button" data-row-open data-meta onClick={() => useItemDialogStore.getState().open(item.id)}
          className={`grid h-8 min-w-0 flex-1 ${ROW_COLUMNS} items-center gap-x-2 pl-1.5 text-left text-[11px] text-(--muted-foreground) ${ROW_OPENS}`}>
          {n === undefined
            ? <span className="grid size-6 place-items-center" data-glyph><StatusGlyph status={shown.glyph} /></span>
            : <span className="queue-n text-center font-medium tabular-nums">{n + 1}</span>}
          <RowSource item={item} />
          <span className="flex min-w-0" data-kind><RowKind item={item} /></span>
          <span className="flex min-w-0 items-center gap-2">
            <span className="min-w-0 truncate text-[13px] font-medium text-(--foreground)" title={itemName(item)} data-title><ItemTitle item={item} /></span>
            {concept && <PartOf concept={concept} />}
          </span>
          <span className="flex min-w-0 items-center gap-1.5 overflow-hidden" data-col="state">
            {n === undefined
              ? <span className="shrink-0" title={threadText(item, shown.working)} data-state>{state}</span>
              : <span className="queue-age shrink-0" data-state>{shortAgo(item.updatedAt, now)}</span>}
            {blocked && <Badge tone="danger" className="min-w-0" title={blocked} data-blocked><span className="truncate">{blocked}</span></Badge>}
            {note[0] && (
              <span data-col="next" className="min-w-0 truncate" title={note.map(({ s, word }) => `${word} ${itemName(s)}`).join('\n')}>
                <span className={`font-medium ${note[0].tone}`}>{note[0].word}</span> {note[0].s.title}{note.length > 1 && ` +${note.length - 1} more`}
              </span>
            )}
            <KindMarker item={item} />
            <AzureFields azure={item.azure} />
          </span>
          <span data-col="bar">{item.slices.length > 0 ? <SliceBar item={item} /> : feedback.running && <ActivityFeedback feedback={feedback} />}</span>
          <span data-col="pr" className="min-w-0 truncate">{item.linkedPrs[0] && <span className="inline-flex items-center gap-1"><GitPullRequest className="size-3 shrink-0 text-(--st-done)" />{prLabel(item.linkedPrs[0])}</span>}</span>
          <span data-col="figures" className="hidden min-w-0 @6xl:grid"><Figures s={figuresOf(item, data)} /></span>
        </button>
        {item.slices.length > 0
          ? <button type="button" aria-expanded={slices} aria-label={slices ? 'Hide slices' : 'Show slices'} onClick={() => setSlices(!slices)} data-col="count"
              className={`flex h-6 w-12 shrink-0 items-center justify-end gap-0.5 rounded px-1 text-[11px] tabular-nums text-(--muted-foreground) hover:bg-(--soft) hover:text-(--foreground) ${ROW_OPENS}`}>
              {done}/{item.slices.length}{slices ? <ChevronDown className="size-3" /> : <ChevronRight className="size-3" />}
            </button>
          : <span className="w-12 shrink-0" />}
        <span data-col="side" className="flex w-40 shrink-0 flex-wrap items-center justify-end gap-x-2 gap-y-1 py-0.5 text-right text-[11px] text-(--muted-foreground)"><Side item={item} data={data} /></span>
      </div>
      {['Queued', 'Ready', 'In progress'].includes(item.status) && <div className="pb-2 pl-9 pr-2 empty:hidden"><StartMessage item={item} kind={item.status === 'Queued' ? 'refine' : 'build'} /><StartAfterError item={item} data={data} /></div>}
      {slices && <div className="pb-2 pl-7 pr-2" data-slices><SliceList item={item} /></div>}
    </li>
  );
}
