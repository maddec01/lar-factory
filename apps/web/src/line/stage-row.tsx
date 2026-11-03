// A row of the Shaping or Build pane, on two lines. The title and a line of what's known about the item open its
// details from one button; the slice count and the row's action sit beside that button as their own focus stops. A
// build's count unfolds its slices under the row.

import { useState } from 'react';
import { ChevronDown, ChevronRight, GitPullRequest } from 'lucide-react';
import { blockedText, canRetryBuild, currentBuildThread, itemName, openBlockers, prLabel } from '@lar-factory/shared';
import type { BoardData, Item } from '@lar-factory/shared';
import { Badge } from '@lar-factory/ui/design-system/Badge';
import { useItemDialogStore } from '../item-dialog/item-dialog-store.ts';
import { ActivityFeedback, AzureFields, ItemTitle, KindMarker, RepoCell, SliceBar, SliceList, useActivityFeedback, useShownStatus } from '../items/item-parts.tsx';
import { OpenThread } from '../items/open-thread.tsx';
import { StartAfterError, StartOrAfter } from '../items/start-after.tsx';
import { StartBuild } from '../items/start-build.tsx';
import { StartMessage } from '../items/start-control.tsx';
import { SourceIcon } from '../items/source-icon.tsx';
import { StatusGlyph } from '../items/status-glyph.tsx';
import { Figures, figuresOf } from './columns.tsx';
import { OnYourDesk, YOURS, ROW_OPENS, picked, threadText } from './stage-track.tsx';
import type { StageRow as Row } from './stage-rows.ts';

/** The one thing a status asks next, or where to act on an item that waits on you. */
function Side({ item, data }: { item: Item; data: BoardData }) {
  const { working } = useShownStatus(item);
  if (working) return <OpenThread item={item} data={data} threadId={currentBuildThread(item)?.id} />;
  if (YOURS.includes(item.status)) return <OnYourDesk status={item.status} />;
  switch (item.status) {
    case 'Queued': return <StartOrAfter item={item} data={data} label="Shape issue" />;
    case 'Ready': return <StartBuild item={item} data={data} />;
    case 'In progress': if (canRetryBuild(item)) return <StartBuild item={item} data={data} />; return <OpenThread item={item} data={data} />;
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
  return <span data-concept title={text} className="min-w-0 max-w-44 shrink-[100] truncate rounded bg-(--muted) px-1.5">{text}</span>;
}

/** What the activity adds to the status, leaving out what repeats it and telemetry the board can't read. */
const activityNote = (label: string, word: string) => (label === word || label === 'Activity unavailable' ? null : label);

export function StageRow({ row: { item, concept }, data }: { row: Row; data: BoardData }) {
  const feedback = useActivityFeedback(item);
  const shown = useShownStatus(item);
  const [slices, setSlices] = useState(false);
  const isPicked = useItemDialogStore((state) => state.itemId === item.id);
  const done = item.slices.filter((s) => s.progress === 'done').length;
  const note = sliceNote(item);
  const blocked = openBlockers(item).length;
  const activity = activityNote(feedback.label, shown.word);
  return (
    <li data-item={item.id} className="border-b border-(--border) last:border-b-0">
      <div className={`flex items-center gap-2 pr-2 hover:bg-(--accent) ${picked(isPicked)}`}>
        <button type="button" data-row-open onClick={() => useItemDialogStore.getState().open(item.id)}
          className={`grid min-w-0 flex-1 grid-cols-[auto_minmax(0,1fr)] items-center gap-x-2 gap-y-0.5 py-1.5 pl-3 text-left ${ROW_OPENS}`}>
          <span className="grid size-4 place-items-center" data-glyph><StatusGlyph status={shown.glyph} /></span>
          <span className="truncate text-[13px] font-medium" title={itemName(item)} data-title><ItemTitle item={item} /></span>
          <span className="col-start-2 flex min-w-0 items-center gap-1.5 overflow-hidden text-[11px] text-(--muted-foreground)" data-meta>
            <SourceIcon item={item} />
            <RepoCell item={item} />
            <span className="shrink-0" title={threadText(item, shown.working)} data-state>{shown.word}{activity && ` · ${activity}`}</span>
            {item.slices.length > 0
              ? <span className="w-14 shrink-0" data-col="bar"><SliceBar item={item} /></span>
              : feedback.running && <span className="w-14 shrink-0" data-col="bar"><ActivityFeedback feedback={feedback} /></span>}
            {note[0] && (
              <span data-col="next" className="min-w-0 shrink-[100] truncate" title={note.map(({ s, word }) => `${word} ${itemName(s)}`).join('\n')}>
                <span className={`font-medium ${note[0].tone}`}>{note[0].word}</span> {note[0].s.title}{note.length > 1 && ` +${note.length - 1} more`}
              </span>
            )}
            {item.linkedPrs[0] && <span className="inline-flex shrink-0 items-center gap-1"><GitPullRequest className="size-3 text-(--st-done)" />{prLabel(item.linkedPrs[0])}</span>}
            {blocked > 0 && <Badge tone="danger" className="shrink-0" title={blockedText(item) ?? undefined}>blocked by {blocked}<span className="sr-only">. {blockedText(item)}</span></Badge>}
            {concept && <PartOf concept={concept} />}
            <KindMarker item={item} />
            <AzureFields azure={item.azure} />
            <span data-col="figures" className="ml-auto grid min-w-0 shrink-[1000]"><Figures s={figuresOf(item, data)} /></span>
          </span>
        </button>
        {item.slices.length > 0 && (
          <button type="button" aria-expanded={slices} aria-label={slices ? 'Hide slices' : 'Show slices'} onClick={() => setSlices(!slices)} data-col="count"
            className={`flex h-6 shrink-0 items-center gap-0.5 rounded px-1 text-[11px] tabular-nums text-(--muted-foreground) hover:bg-(--soft) hover:text-(--foreground) ${ROW_OPENS}`}>
            {done}/{item.slices.length}{slices ? <ChevronDown className="size-3" /> : <ChevronRight className="size-3" />}
          </button>
        )}
        <span data-col="side" className="flex min-w-0 max-w-[45%] shrink-0 flex-wrap items-center justify-end gap-x-2 gap-y-1 text-right text-[11px] text-(--muted-foreground) empty:hidden"><Side item={item} data={data} /></span>
      </div>
      {['Queued', 'Ready', 'In progress'].includes(item.status) && <div className="pb-2 pl-9 pr-2 empty:hidden"><StartMessage item={item} kind={item.status === 'Queued' ? 'refine' : 'build'} /><StartAfterError item={item} data={data} /></div>}
      {slices && <div className="pb-2 pl-7 pr-2" data-slices><SliceList item={item} /></div>}
    </li>
  );
}
