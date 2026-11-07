// Which rows each section of the stage layout holds, read from the placement rule in the shared package: the items in
// the main area's scope, whatever a filter hides.

import { placementOf } from '@lar-factory/shared';
import type { BoardData, Item } from '@lar-factory/shared';

import { dossiersOf } from './DossierParts';
import type { DossierItems } from './DossierParts';
import { stageOf } from './StageTrack';

export interface StageRow {
    item: Item;
    /** The dossier a part's row names. */
    concept: Item | undefined;
}

export interface StageRows {
    queue: StageRow[];
    shaping: StageRow[];
    ready: StageRow[];
    /** Furthest along first. */
    build: StageRow[];
    dock: DossierItems[];
}

export function stageRows(items: readonly Item[], data: BoardData, unavailable: boolean): StageRows {
    const placed = (item: Item) =>
        placementOf(item, { starts: data.startProgress?.[item.id], unavailable, all: data.items });
    const rows: Pick<StageRows, 'queue' | 'shaping' | 'ready' | 'build'> = {
        queue: [],
        shaping: [],
        ready: [],
        build: [],
    };

    for (const item of items) {
        const { sections, concept } = placed(item);

        for (const section of sections)
            if (section !== 'desk' && section !== 'dock') rows[section].push({ item, concept });
    }

    return {
        ...rows,
        build: rows.build.sort((a, b) => stageOf(b.item.status) - stageOf(a.item.status)),
        dock: dossiersOf(items, data.items).filter(({ parent }) => placed(parent).sections.includes('dock')),
    };
}
