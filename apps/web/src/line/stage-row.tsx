// The board's one work row, in Queue, Shaping, Ready to build and Build alike: a single line in columns that line up down
// the whole board, one button that opens the item's details with the row's action beside it. A row with slices or a run
// at work adds a progress line under it, with a long bar and the slice count, which unfolds its slices, as its own focus
// stop, and the phase and current delegated task or first blocked or active slice.

import { useState } from 'react';
import { ChevronDown, ChevronRight, GitPullRequest } from 'lucide-react';
import { blockedText, canRetryBuild, currentBuildThread, isStale, itemName, prLabel, shortAgo } from '@lar-factory/shared';
import type { BoardData, Item } from '@lar-factory/shared';
import { Badge } from '@lar-factory/ui/design-system/Badge';
import { useBoardStore } from '../board/board-store.ts';
import { useItemDialogStore } from '../item-dialog/item-dialog-store.ts';
import { ActivityFeedback, AzureFields, ItemTitle, KindMarker, SliceBar, SliceList, hasFigures, useActivityFeedback, useActivityUnavailable, useShownStatus } from '../items/item-parts.tsx';
import { OpenThread, hasLiveThread } from '../items/open-thread.tsx';
import { StartAfterError, StartOrAfter } from '../items/start-after.tsx';
import { StartBuild } from '../items/start-build.tsx';
import { StartMessage } from '../items/start-control.tsx';
import { StatusGlyph } from '../items/status-glyph.tsx';
import { AutoBuildNote } from './auto-build-note.tsx';
import { FIGURES_COLUMN, Figures, LINK_COLUMN, ROW_ACTION, ROW_COLUMNS, figuresOf } from './columns.tsx';
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

/** The row's state, once: Working for a run known to be running, whatever telemetry it lacks; a running phase and a start's progress only where nothing else on the row says them. */
function stateText(item: Item, word: string, { label, running }: { label: string; running: boolean }, runKnown: boolean): string {
  if (label === 'Activity unavailable') return runKnown ? 'Working' : word;
  if (label === word || label === 'Working') return label;
  if (running) return word;
  if ((label === 'Starting' || label === 'May have started') && ['Queued', 'Ready', 'In progress'].includes(item.status)) return word;
  return `${word} · ${label}`;
}

/** `n` is a Queue row's place in the Queue, which it shows in the glyph's place, with its age as its state. */
export function StageRow({ row: { item, concept }, data, n }: { row: Row; data: BoardData; n?: number }) {
  const feedback = useActivityFeedback(item);
  const shown = useShownStatus(item);
  const now = useBoardStore((state) => state.now);
  const disconnected = useBoardStore((state) => !!state.clientError);
  const unavailable = useActivityUnavailable();
  const [slices, setSlices] = useState(false);
  const isPicked = useItemDialogStore((state) => state.itemId === item.id);
  const done = item.slices.filter((s) => s.progress === 'done').length;
  const implemented = item.slices.length > 0 && done === item.slices.length;
  const note = sliceNote(item);
  const blocked = blockedText(item);
  const runKnown = !unavailable && threadsOf(item).some(threadAtWork);
  const state = shown.working ? 'Working' : stateText(item, shown.word, feedback, runKnown);
  const working = feedback.running || state === 'Working';
  // Fresh T3 tasks need not wait for unrelated repositories to finish their first read.
  const childActivity = !disconnected && !isStale(data, now) && !item.paused && !item.archived
    ? currentBuildThread(item)?.childActivity : undefined;
  const phase = feedback.running && feedback.label !== state ? feedback.label : null;
  const figures = figuresOf(item, data);
  const pr = item.linkedPrs[0];
  return (
    <li data-item={item.id} className={`@container border-b border-(--border) last:border-b-0 hover:bg-(--accent) ${picked(isPicked)}`}>
      <div className="flex items-center gap-3 pr-3">
        <button type="button" data-row-open data-meta onClick={() => useItemDialogStore.getState().open(item.id)}
          className={`grid h-12 min-w-0 flex-1 ${ROW_COLUMNS} items-center gap-x-3 pl-3 text-left text-[11px] text-(--muted-foreground) ${ROW_OPENS}`}>
          {n === undefined
            ? <span className="grid size-6 place-items-center" data-glyph><StatusGlyph status={shown.glyph} /></span>
            : <span className="queue-n text-center font-medium tabular-nums">{n + 1}</span>}
          <RowSource item={item} />
          <span className="flex min-w-0 items-center" data-kind><RowKind item={item} /></span>
          <span className="flex min-w-0 items-center gap-3">
            <span className="flex min-w-0 flex-1 items-center gap-2">
              <span className="min-w-0 truncate text-[13px] font-medium text-(--foreground)" title={itemName(item)} data-title><ItemTitle item={item} /></span>
              {concept && <PartOf concept={concept} />}
            </span>
            {(pr || (figures && hasFigures(figures))) && <>
              {pr && <span data-col="pr" className={`${LINK_COLUMN} truncate`}><span className="inline-flex items-center gap-1"><GitPullRequest className="size-3 shrink-0 text-(--st-done)" />{prLabel(pr)}</span></span>}
              <span data-col="figures" className={FIGURES_COLUMN}><Figures s={figures} /></span>
            </>}
          </span>
          <span className="flex min-w-0 items-center gap-1.5 overflow-hidden" data-col="state">
            {n === undefined
              ? <span className="shrink-0" title={threadText(item, shown.working)} data-state>{state}</span>
              : <span className="queue-age shrink-0" data-state>{shortAgo(item.updatedAt, now)}</span>}
            {blocked && <Badge tone="danger" className="min-w-0" title={blocked} data-blocked><span className="truncate">{blocked}</span></Badge>}
            <KindMarker item={item} />
            <AzureFields azure={item.azure} />
          </span>
        </button>
        <span data-col="side" className={`${ROW_ACTION} w-40 shrink-0`}><Side item={item} data={data} /></span>
      </div>
      {(item.slices.length > 0 || working || childActivity) && (
        <div data-progress className="grid grid-cols-[20rem_auto_minmax(0,1fr)] items-center gap-x-3 pb-2.5 pl-12 pr-3 text-[12px] text-(--muted-foreground)">
          <span data-col="bar">{item.slices.length > 0 ? <SliceBar item={item} /> : <ActivityFeedback feedback={{ ...feedback, running: true }} />}</span>
          {item.slices.length > 0
            ? <button type="button" aria-expanded={slices} aria-label={slices ? 'Hide slices' : 'Show slices'} onClick={() => setSlices(!slices)} data-col="count"
                className={`flex h-5 items-center gap-0.5 rounded px-1 tabular-nums hover:bg-(--soft) hover:text-(--foreground) ${ROW_OPENS}`}>
                {done}/{item.slices.length} slices{slices ? <ChevronDown className="size-3" /> : <ChevronRight className="size-3" />}
              </button>
            : <span />}
          <span data-col="next" className="min-w-0 truncate" title={childActivity?.titles.join('\n') || note.map(({ s, word }) => `${word} ${itemName(s)}`).join('\n') || undefined}>
            {phase && <span data-phase>{phase}{(childActivity || note[0] || implemented) && ' · '}</span>}
            {childActivity
              ? <span data-child-activity className="text-(--foreground)">{childActivity.titles[0]}{childActivity.count > 1 && ` +${childActivity.count - 1} more`}</span>
              : <>{note[0] && <><span className={`font-medium ${note[0].tone}`}>{note[0].word}</span> <span className="text-(--foreground)">{note[0].s.title}</span>{note.length > 1 && ` +${note.length - 1} more`}</>}
                {implemented && <span>All slices implemented</span>}</>}
          </span>
        </div>
      )}
      {['Queued', 'Ready', 'In progress'].includes(item.status) && <div className="pb-2.5 pl-12 pr-3 empty:hidden"><StartMessage item={item} kind={item.status === 'Queued' ? 'refine' : 'build'} /><StartAfterError item={item} data={data} /><AutoBuildNote item={item} data={data} /></div>}
      {slices && <div className="pb-2.5 pl-10 pr-3" data-slices><SliceList item={item} /></div>}
    </li>
  );
}
