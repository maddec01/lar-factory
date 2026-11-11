// The board's work by stage: Queue, Shaping, Ready to build and Build as full-width lists from top to
// bottom, then the dock of concepts and linked work, in one page scroll. Rows move between sections as board pushes
// change their placement, sliding in and flashing as they land (BoardLife). A dossier expands in place, under its row.

import type { Item } from '@lar-factory/shared';
import type { ReactNode } from 'react';

import { Dossiers } from './Dossiers';
import { Queue } from './Queue';
import { Build, ReadyToBuild, Shaping } from './StagePanes';
import { stageRows } from './StageRows';
import { rowFilter, useScopeStore } from '@/features/filters';
import { useActivityUnavailable, RowActions } from '@/features/items';
import { useBoardStore } from '@/services/board/board.hooks';
import { noteBoardPlaces, StageSections } from '@/ui/board';

/** Each item's lane on the whole board, by the lanes' order down the page, so a read that moves one tells which way. */
function lanes(rows: ReturnType<typeof stageRows>) {
    return new Map(
        [rows.queue, rows.shaping, rows.ready, rows.build].flatMap((lane, place) =>
            lane.map(({ item }) => [item.id, place] as const),
        ),
    );
}

/** `items` are the items in the main area's scope; `desk` sits above the stages. */
export function StageLayout({ items, desk }: { items: Item[]; desk: ReactNode }) {
    const data = useBoardStore((state) => state.data);
    const unavailable = useActivityUnavailable();
    const filters = useScopeStore((state) => state.filters);
    const shows = rowFilter(filters, data.repos);
    const showsRow = ({ item }: { item: Item }) => shows(item);
    const { queue, shaping, ready, build, dock } = stageRows(items, data, unavailable);

    // The board's life follows every item, whatever the scope and filters show.
    noteBoardPlaces('lane', lanes(stageRows(data.items, data, unavailable)), data.firstRead.settled);

    return (
        <>
            {desk}
            <StageSections label="Work by stage">
                <RowActions>
                    <Queue rows={queue} shows={showsRow} />
                    <Shaping shaping={shaping} shows={showsRow} />
                    <ReadyToBuild ready={ready} shows={showsRow} />
                    <Build build={build} shows={showsRow} />
                    <Dossiers dossiers={dock.filter(({ parent }) => shows(parent))} />
                </RowActions>
            </StageSections>
        </>
    );
}
