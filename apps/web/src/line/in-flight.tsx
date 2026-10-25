// Everything else in flight, on the line's stage track: every item past the Queue and short of Done that no dossier
// shows, furthest along first. Each row carries its agent figures, a build its slices, and its side its thread and
// next action. Ready items keep Start build here as well as on the desk. Items in Needs you, Verify or Ready to merge
// show where they are but take no action here: you act on them from the desk.

import type { ReactNode } from 'react';
import { openBlockers } from '@mux-factory/shared';
import type { BoardData, Item } from '@mux-factory/shared';
import { useBoardStore } from '../board/board-store.ts';
import { KeepClicks } from '../items/keep-clicks.tsx';
import { OpenThread } from '../items/open-thread.tsx';
import { StartBuild } from '../items/start-build.tsx';
import { StartAfterError } from '../items/start-after.tsx';
import { StartMessage } from '../items/start-control.tsx';
import { dossiersOf, inDossiers } from './dossier-parts.ts';
import { OnYourDesk, Row, StageHeader, THREAD_TEXT, YOURS, stageOf } from './stage-track.tsx';

/** A button that doesn't open the item underneath it, nor do clicks in the menu it opens. It wraps to its own line, inside the cell. */
function Act({ children }: { children: ReactNode }) {
  return <KeepClicks as="span" className="min-w-0 max-w-full">{children}</KeepClicks>;
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
  if (YOURS.includes(item.status)) return <OnYourDesk status={item.status} />;
  const blocked = item.status === 'Ready' ? openBlockers(item).length : 0;
  return <><span className="min-w-0 truncate">{blocked ? `blocked by ${blocked}` : THREAD_TEXT[item.status]}</span><NextAction item={item} data={data} /></>;
}

/** `items` are the line's items in the main area's scope; those a dossier shows are left out. */
export function InFlight({ items }: { items: Item[] }) {
  const { data, now } = useBoardStore();
  const shown = inDossiers(dossiersOf(items, data.items));
  const rows = items.filter((i) => stageOf(i.status) >= 0 && i.status !== 'Done' && !shown.has(i.id)).sort((a, b) => stageOf(b.status) - stageOf(a.status));
  return (
    <div className="overflow-hidden rounded-xl border border-(--border) bg-(--card)" data-in-flight>
      <StageHeader label={`Everything else in flight · ${rows.length}`} side="Thread · next" />
      {rows.length ? rows.map((i) => (
        <Row key={i.id} item={i} data={data} now={now} waiting={openBlockers(i).length > 0} side={<Side item={i} data={data} />}>
          {i.status === 'Ready' && <KeepClicks className="px-3 pb-2 pl-7 empty:hidden"><StartMessage item={i} kind="build" /><StartAfterError item={i} data={data} /></KeepClicks>}
        </Row>
      )) : <p className="m-0 p-6 text-center text-(--muted-foreground)">Nothing else in flight.</p>}
    </div>
  );
}
