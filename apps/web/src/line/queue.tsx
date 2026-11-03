// The Queue section: Queued items, in order, as numbered rows that open the item dialog, each started by hand, and Start
// next. An item blocked by an open issue waits, with Start after. A filter only hides rows: the rest keep their numbers,
// and Start next starts the same item, naming it when its row is hidden. Reordering isn't built yet.

import { openBlockers, startHold, shortAgo } from '@lar-factory/shared';
import type { BoardData, Item } from '@lar-factory/shared';
import { Button } from '@lar-factory/ui/design-system/Button';
import { kind } from '../buttons/button-kinds.tsx';
import { useBoardStore } from '../board/board-store.ts';
import { useItemDialogStore } from '../item-dialog/item-dialog-store.ts';
import { ItemTitle, KindMarker, RepoCell } from '../items/item-parts.tsx';
import { OpenThread, hasLiveThread } from '../items/open-thread.tsx';
import { StartOrAfter } from '../items/start-after.tsx';
import { StartControl, StartMessage } from '../items/start-control.tsx';
import { SourceIcon } from '../items/source-icon.tsx';
import { Pane, PaneEmpty } from './pane.tsx';
import { ROW_OPENS, picked } from './stage-track.tsx';
import type { StageRow } from './stage-rows.ts';

const NONE_STARTS = 'Every queued item is blocked, needs a T3 project, waits for onboarding, or has a thread at work.';

/**
 * Whether Start can run on the item: an issue carrying one status that nothing open blocks, in a repository done
 * onboarding that T3 has a project for, with no item thread running or waiting on you.
 */
const canStart = (data: BoardData) => (item: Item) => !openBlockers(item).length
  && !startHold(data, item.repo) && !hasLiveThread(item);

/** A row's action: Shape issue, Open thread while the item has a live thread, once it starts. */
function RowAction({ item, data }: { item: Item; data: BoardData }) {
  if (hasLiveThread(item)) return <OpenThread item={item} data={data} />;
  return <StartOrAfter item={item} data={data} label="Shape issue" />;
}

function Row({ item, n, data, now }: { item: Item; n: number; data: BoardData; now: number }) {
  const isPicked = useItemDialogStore((state) => state.itemId === item.id);
  return (
    <li data-item={item.id} className={`border-b border-(--border) pb-2 last:border-b-0 hover:bg-(--accent) ${picked(isPicked)}`}>
      <button type="button" data-row-open onClick={() => useItemDialogStore.getState().open(item.id)} title={item.title}
        className={`grid w-full grid-cols-[1rem_minmax(0,1fr)] gap-x-1.5 gap-y-1 px-2 pb-1.5 pt-2 text-left ${ROW_OPENS}`}>
        <span className="queue-n text-right text-[11px] font-medium leading-4 tabular-nums text-(--muted-foreground)">{n + 1}</span>
        <span className="queue-title line-clamp-2 text-[12px]/4 font-medium"><ItemTitle item={item} /></span>
        <span className="queue-meta col-start-2 flex min-w-0 items-center gap-1.5 text-[11px] text-(--muted-foreground)"><SourceIcon item={item} /><RepoCell item={item} /><span className="queue-age shrink-0">{shortAgo(item.updatedAt, now)}</span><KindMarker item={item} /></span>
      </button>
      <div className="flex min-w-0 flex-wrap items-center gap-1 pl-[1.875rem] pr-2"><RowAction item={item} data={data} /></div>
      <div className="px-2 pt-1 empty:hidden"><StartMessage item={item} /></div>
    </li>
  );
}

/** Start next, the Queue's Main action, starts `next`; with none, while items are queued, it shows disabled and says why. */
function StartNext({ queued, next, nextHidden, data }: { queued: number; next: Item | undefined; nextHidden: boolean; data: BoardData }) {
  if (next) return <StartControl item={next} data={data} label="Start next" main naming={nextHidden} />;
  return queued > 0 ? <Button {...kind('main')} className="disabled:pointer-events-auto" disabled title={NONE_STARTS}>Start next</Button> : null;
}

/** `rows` are the Queue's items in the main area's scope, `shows` says which the filters leave. */
export function Queue({ rows, shows }: { rows: StageRow[]; shows: (row: StageRow) => boolean }) {
  const { data, now } = useBoardStore();
  const next = rows.find(({ item }) => canStart(data)(item))?.item;
  const shown = rows.map((row, n) => ({ row, n })).filter(({ row }) => shows(row));
  const nextHidden = next !== undefined && !shows({ item: next, concept: undefined });
  return (
    <Pane id="queue" title="Queue" status="Queued" count={shown.length} className="queue" right={<StartNext queued={rows.length} next={next} nextHidden={nextHidden} data={data} />}>
      {/* What the hidden row would say about Start next. */}
      {nextHidden && <div className="border-b border-(--border) px-3 py-2 text-[11px] text-(--muted-foreground) empty:hidden"><StartMessage item={next} /></div>}
      {shown.length
        ? <ol className="m-0 grid list-none p-0">{shown.map(({ row: { item }, n }) => <Row key={item.id} item={item} n={n} data={data} now={now} />)}</ol>
        : <PaneEmpty filtered={rows.length > 0} none="Queue empty. Queue items from the List.">Nothing queued matches.</PaneEmpty>}
    </Pane>
  );
}
