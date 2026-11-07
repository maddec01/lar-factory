// The Queue section: Queued items, in order, as numbered stage rows that open the item dialog, each started by hand. An
// item blocked by an open issue waits, with Start after. A filter only hides rows: the rest keep their numbers.
// Reordering isn't built yet.

import { useBoardStore } from '../board/board-store.ts';
import { Pane, PaneEmpty } from './pane.tsx';
import { StageRow } from './stage-row.tsx';
import type { StageRow as Row } from './stage-rows.ts';

/** `rows` are the Queue's items in the main area's scope, `shows` says which the filters leave. */
export function Queue({ rows, shows }: { rows: Row[]; shows: (row: Row) => boolean }) {
    const data = useBoardStore((state) => state.data);
    const shown = rows.map((row, n) => ({ row, n })).filter(({ row }) => shows(row));
    return (
        <Pane id="queue" title="Queue" status="Queued" count={shown.length} className="queue">
            {shown.length ? (
                <ol className="m-0 grid list-none p-0">
                    {shown.map(({ row, n }) => (
                        <StageRow key={row.item.id} row={row} data={data} n={n} />
                    ))}
                </ol>
            ) : (
                <PaneEmpty filtered={rows.length > 0} none="Queue empty. Queue items from the List.">
                    Nothing queued matches.
                </PaneEmpty>
            )}
        </Pane>
    );
}
