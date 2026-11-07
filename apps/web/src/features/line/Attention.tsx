// An expanded dossier's attention list: what keeps its work moving, or that nothing holds it up.

import type { BoardData, Item } from '@lar-factory/shared';

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

    if (!rows.length)
        return (
            <p className="m-0 text-[13px] text-(--muted-foreground)" data-attention-none>
                Nothing holds this up.
            </p>
        );

    return (
        // The labels' column is 7.5rem, or as wide as the longest label so none wraps ("To verify or merge" needs more).
        <dl className="m-0 grid grid-cols-[minmax(7.5rem,max-content)_minmax(0,1fr)] gap-x-4 gap-y-2" data-attention>
            {rows.map((r) => (
                <div key={r.key} className="contents" data-attention-row={r.key}>
                    <dt className={`pt-2 text-[11px] font-medium tracking-wide whitespace-nowrap uppercase ${r.tone}`}>
                        {r.label} <span className="tabular-nums">{r.entries.length}</span>
                    </dt>
                    <dd className="m-0 grid gap-1">{r.entries}</dd>
                </div>
            ))}
        </dl>
    );
}
