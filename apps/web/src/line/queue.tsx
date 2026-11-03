// The Queue section: Queued items, in order, as numbered stage rows that open the item dialog, each started by hand, and Start
// next. An item blocked by an open issue waits, with Start after. A filter only hides rows: the rest keep their numbers,
// and Start next starts the same item, naming it when its row is hidden. Reordering isn't built yet.

import { openBlockers, startHold } from '@lar-factory/shared';
import type { BoardData, Item } from '@lar-factory/shared';
import { Button } from '@lar-factory/ui/design-system/Button';
import { kind } from '../buttons/button-kinds.tsx';
import { useBoardStore } from '../board/board-store.ts';
import { hasLiveThread } from '../items/open-thread.tsx';
import { StartControl, StartMessage } from '../items/start-control.tsx';
import { Pane, PaneEmpty } from './pane.tsx';
import { StageRow } from './stage-row.tsx';
import type { StageRow as Row } from './stage-rows.ts';

const NONE_STARTS = 'Every queued item is blocked, needs a T3 project, waits for onboarding, or has a thread at work.';

/**
 * Whether Start can run on the item: an issue carrying one status that nothing open blocks, in a repository done
 * onboarding that T3 has a project for, with no item thread running or waiting on you.
 */
const canStart = (data: BoardData) => (item: Item) => !openBlockers(item).length
  && !startHold(data, item.repo) && !hasLiveThread(item);

/** Start next, the Queue's Main action, starts `next`; with none, while items are queued, it shows disabled and says why. */
function StartNext({ queued, next, nextHidden, data }: { queued: number; next: Item | undefined; nextHidden: boolean; data: BoardData }) {
  if (next) return <StartControl item={next} data={data} label="Start next" main naming={nextHidden} />;
  return queued > 0 ? <Button {...kind('main')} className="disabled:pointer-events-auto" disabled title={NONE_STARTS}>Start next</Button> : null;
}

/** `rows` are the Queue's items in the main area's scope, `shows` says which the filters leave. */
export function Queue({ rows, shows }: { rows: Row[]; shows: (row: Row) => boolean }) {
  const data = useBoardStore((state) => state.data);
  const next = rows.find(({ item }) => canStart(data)(item))?.item;
  const shown = rows.map((row, n) => ({ row, n })).filter(({ row }) => shows(row));
  const nextHidden = next !== undefined && !shows({ item: next, concept: undefined });
  return (
    <Pane id="queue" title="Queue" status="Queued" count={shown.length} className="queue" right={<StartNext queued={rows.length} next={next} nextHidden={nextHidden} data={data} />}>
      {/* What the hidden row would say about Start next. */}
      {nextHidden && <div className="border-b border-(--border) px-3 py-2 text-[11px] text-(--muted-foreground) empty:hidden"><StartMessage item={next} /></div>}
      {shown.length
        ? <ol className="m-0 grid list-none p-0">{shown.map(({ row, n }) => <StageRow key={row.item.id} row={row} data={data} n={n} />)}</ol>
        : <PaneEmpty filtered={rows.length > 0} none="Queue empty. Queue items from the List.">Nothing queued matches.</PaneEmpty>}
    </Pane>
  );
}
