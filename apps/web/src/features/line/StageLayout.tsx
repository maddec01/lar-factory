// The board's work by stage: Queue, Shaping, Ready to build and Build as full-width lists from top to
// bottom, then the dock of concepts and linked work, in one page scroll. Rows move between sections as board pushes
// change their placement. A dossier expands in place, under its row.

import type { Item } from '@lar-factory/shared';
import type { ReactNode } from 'react';

import { Dossiers } from './Dossiers';
import { Queue } from './Queue';
import { Build, ReadyToBuild, Shaping } from './StagePanes';
import { stageRows } from './StageRows';
import { rowFilter, useScopeStore } from '@/features/filters';
import { useActivityUnavailable, RowActions } from '@/features/items';
import { useBoardStore } from '@/services/board/board.hooks';

/** `items` are the items in the main area's scope; `desk` sits above the stages. */
export function StageLayout({ items, desk }: { items: Item[]; desk: ReactNode }) {
    const data = useBoardStore((state) => state.data);
    const unavailable = useActivityUnavailable();
    const filters = useScopeStore((state) => state.filters);
    const shows = rowFilter(filters, data.repos);
    const showsRow = ({ item }: { item: Item }) => shows(item);
    const { queue, shaping, ready, build, dock } = stageRows(items, data, unavailable);

    return (
        <>
            {desk}
            <section className="stages flex flex-col gap-3" aria-label="Work by stage">
                <RowActions>
                    <Queue rows={queue} shows={showsRow} />
                    <Shaping shaping={shaping} shows={showsRow} />
                    <ReadyToBuild ready={ready} shows={showsRow} />
                    <Build build={build} shows={showsRow} />
                    <Dossiers dossiers={dock.filter(({ parent }) => shows(parent))} />
                </RowActions>
            </section>
        </>
    );
}
