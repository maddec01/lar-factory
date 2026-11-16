import { deskItems } from '@lar-factory/shared';
import type { Item } from '@lar-factory/shared';
import type { ReactNode } from 'react';

import { BoardIdle } from './BoardIdle';
import { Dossiers } from './Dossiers';
import { Queue } from './Queue';
import { Build, ReadyToBuild, Shaping } from './StagePanes';
import { stageRows } from './StageRows';
import { rowFilter, useScopeStore } from '@/features/filters';
import { useActivityUnavailable, RowActions } from '@/features/items';
import { useBoardStore } from '@/services/board/board.hooks';
import { noteBoardPlaces, StageSections } from '@/ui/board';

function lanes(rows: ReturnType<typeof stageRows>) {
    return new Map(
        [rows.queue, rows.shaping, rows.ready, rows.build].flatMap((lane, place) =>
            lane.map(({ item }) => [item.id, place] as const),
        ),
    );
}

export function StageLayout({ items, desk }: { items: Item[]; desk: ReactNode }) {
    const data = useBoardStore((state) => state.data);
    const unavailable = useActivityUnavailable();
    const filters = useScopeStore((state) => state.filters);
    const shows = rowFilter(filters, data.repos);
    const showsRow = ({ item }: { item: Item }) => shows(item);
    const { queue, shaping, ready, build, dock } = stageRows(items, data, unavailable);

    const all = stageRows(data.items, data, unavailable);

    noteBoardPlaces('lane', lanes(all), data.firstRead.settled);

    const idle =
        data.firstRead.settled &&
        ![...all.queue, ...all.shaping, ...all.ready, ...all.build].length &&
        !all.dock.length &&
        !deskItems(data, unavailable).length;

    if (idle) return <BoardIdle />;

    return (
        <>
            <StageSections label="Work by stage">
                <RowActions>
                    <Queue rows={queue} shows={showsRow} />
                    <Shaping shaping={shaping} shows={showsRow} />
                    <ReadyToBuild ready={ready} shows={showsRow} />
                    <Build build={build} shows={showsRow} />
                    <Dossiers dossiers={dock.filter(({ parent }) => shows(parent))} />
                </RowActions>
            </StageSections>
            {desk}
        </>
    );
}
