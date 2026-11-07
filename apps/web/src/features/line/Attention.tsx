// An expanded dossier's attention list: what keeps its work moving, or that nothing holds it up.

import type { BoardData, Item } from '@lar-factory/shared';
import { AttentionList, AttentionNone } from '@lar-works/design-system';

import type { FindRef } from './DossierHelpers';
import type { Part } from './DossierParts';
import { useAttentionRows } from './useAttentionRows';

/** What keeps the work moving, as labelled rows, each shown only with entries: parts in Needs you, parts in Verify or
 *  Ready to merge, open decisions, blocked slices, parts waiting on others, parts ready to start, Dependencies, met or
 *  not, and the map's fog. `only` limits it to those rows for the parent, since the Work map draws its parts itself. */
export function Attention({
    parent,
    parts,
    data,
    find,
    only,
}: {
    parent: Item;
    parts: Part[];
    data: BoardData;
    find: FindRef;
    only?: readonly string[];
}) {
    const rows = useAttentionRows(parent, parts, data, find, only);

    if (!rows.length && only) return null;

    if (!rows.length) return <AttentionNone>Nothing holds this up.</AttentionNone>;

    return <AttentionList rows={rows} />;
}
