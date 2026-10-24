// Everything else in flight, on the line's stage track: every item past the Queue and short of Done, furthest along
// first. Each row carries its agent figures, a build its slices, and its side its thread and next action. Items
// waiting on you show where they are but take no action here: you act on them from the desk.

import type { ReactNode } from 'react';
import type { BoardData, Item, Status } from '@mux-factory/shared';
import { useBoardStore } from '../board/board-store.ts';
import { OpenThread } from '../items/open-thread.tsx';
import { StartBuild } from '../items/start-build.tsx';
import { StartMessage } from '../items/start-control.tsx';
import { StatusGlyph } from '../items/status-glyph.tsx';
import { Row, StageHeader, stageOf } from './stage-track.tsx';

const YOURS: Status[] = ['Needs you', 'Verify', 'Ready to merge'];

const THREAD_TEXT: Partial<Record<Status, string>> = {
  Shaping: 'shaping thread running', Ready: 'build starts on Start', 'In progress': 'build thread running', Review: 'reviewers running',
};

/** A button that doesn't open the item underneath it, nor do clicks in the menu it opens. */
function Act({ children }: { children: ReactNode }) {
  return <span className="shrink-0" onClick={(e) => e.stopPropagation()}>{children}</span>;
}

/** The one thing a status asks next. */
function NextAction({ item, data }: { item: Item; data: BoardData }) {
  switch (item.status) {
    case 'Ready': return <Act><StartBuild item={item} data={data} quiet /></Act>;
    case 'Shaping': case 'In progress': case 'Review': return <Act><OpenThread item={item} data={data} size="xs" variant="outline" /></Act>;
    default: return null;
  }
}

/** The side cell for an item: its thread, its action, or where to act on it when it waits on you. */
function Side({ item, data }: { item: Item; data: BoardData }) {
  if (YOURS.includes(item.status)) return <span className="inline-flex items-center gap-1 text-(--warning-foreground)"><StatusGlyph status={item.status} className="size-3" />on your desk</span>;
  const blocked = item.status === 'Ready' && item.blockedBy > 0;
  return <><span className="min-w-0 truncate">{blocked ? `blocked by ${item.blockedBy}` : THREAD_TEXT[item.status]}</span><NextAction item={item} data={data} /></>;
}

/** `items` are the line's items in the main area's scope. */
export function InFlight({ items }: { items: Item[] }) {
  const { data, now } = useBoardStore();
  const rows = items.filter((i) => stageOf(i.status) >= 0 && i.status !== 'Done').sort((a, b) => stageOf(b.status) - stageOf(a.status));
  return (
    <div className="overflow-hidden rounded-xl border border-(--border) bg-(--card)" data-in-flight>
      <StageHeader label={`Everything else in flight · ${rows.length}`} side="Thread · next" />
      {rows.length ? rows.map((i) => (
        <Row key={i.id} item={i} data={data} now={now} waiting={i.blockedBy > 0} side={<Side item={i} data={data} />}>
          {i.status === 'Ready' && <div className="px-3 pb-2 pl-7 empty:hidden" onClick={(e) => e.stopPropagation()}><StartMessage item={i} kind="build" /></div>}
        </Row>
      )) : <p className="m-0 p-6 text-center text-(--muted-foreground)">Nothing else in flight.</p>}
    </div>
  );
}
