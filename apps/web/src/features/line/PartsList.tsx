// An expanded concept's parts list, on the board and in its dialog: each part a lane row (PartRow), in the same box as
// its Work map, the done ones folded into a count.

import type { BoardData, Item } from '@lar-factory/shared';
import { useState } from 'react';

import type { Part } from './DossierParts';
import { isDone } from './DossierParts';
import { PartRow } from './PartRow';
import { RowActions } from '@/features/items';
import { PartsFrame, ShowDoneToggle, StageList } from '@/ui/board';

/** The parts list: one row per part, the done ones folded into a count. `openFirst` lists the open parts before the done
 *  ones it unfolds, as the concept's dialog does; `onOpen` opens a part in place of the item dialog's own open. */
export function PartsList({
    parts,
    data,
    home,
    openFirst = false,
    onOpen,
}: {
    parts: Part[];
    data: BoardData;
    /** The concept's own repository, which a part in it names quietly. */
    home: string | undefined;
    openFirst?: boolean;
    onOpen?: ((item: Item) => void) | undefined;
}) {
    const [showDone, setShowDone] = useState(false);
    const open = parts.filter((p) => !isDone(p.item));
    const finished = parts.filter((p) => isDone(p.item));
    const shown = !showDone ? open : openFirst ? [...open, ...finished] : parts;
    const retired = finished.filter((p) => p.item.setAside).length;
    // The fold says what it holds, so its count adds up with the row's "parts done": done parts, then retired ones.
    const history = [
        finished.length - retired && `${finished.length - retired} done`,
        retired && `${retired} set aside`,
    ]
        .filter(Boolean)
        .join(' and ');

    return (
        <PartsFrame>
            {/* Its actions read as every row's do, in the concept's dialog too. */}
            <RowActions>
                <StageList>
                    {shown.map((p) => (
                        <PartRow
                            key={p.item.id}
                            part={p}
                            data={data}
                            home={home}
                            onOpen={onOpen && (() => onOpen(p.item))}
                        />
                    ))}
                </StageList>
            </RowActions>
            {finished.length > 0 && (
                <ShowDoneToggle open={showDone} onToggle={() => setShowDone(!showDone)}>
                    {`${showDone ? 'Hide' : 'Show'} ${history}`}
                </ShowDoneToggle>
            )}
        </PartsFrame>
    );
}
