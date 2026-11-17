// What names an item wherever it shows: where its ticket is saved and its repository, and its kind, as a quiet mark on
// stage rows, desk cards and dock rows and as a badge in its dialog.

import { isBuild, onAzure, visibleKind } from '@lar-factory/shared';
import type { Item } from '@lar-factory/shared';
import { TicketIcon } from '@lar-works/design-system/icons';
import { memo, type ReactNode } from 'react';

import { partKind, partLabel } from './DossierParts';
import { KIND_BADGES, RepoCell, SourceIcon } from '@/features/items';
import { conceptIcons, KindMark, PartKindIcon, RowIdentity, RowOthers } from '@/ui/board';

/** An item's kind in its dialog: its icon and name as a plain value, as its project reads; nothing for no recognised kind. */
export const RowKind = memo(function RowKind({ item }: { item: Item }) {
    return <RowKindMark item={item} labelled="fact" />;
});

/** A row's kind as its muted icon before the title, named on hover; its empty room for an item with no recognised kind.
 *  Work that links others reads as Linked work, as its group's line names it. A `listed` row (one away from its group,
 *  in the List or search) reads one way in both: its kind first, as its dialog's Kind names it, then Linked work, and a
 *  neutral ticket glyph rather than empty room. */
export const RowKindMark = memo(function RowKindMark({
    item,
    labelled = false,
    listed = false,
}: {
    item: Item;
    labelled?: boolean | 'fact';
    listed?: boolean;
}) {
    const kind = KIND_BADGES[visibleKind(item)];

    if (!(listed && kind) && item.kind !== 'concept' && item.flow === 'linked' && !item.parentId && !item.parent)
        return (
            <KindMark name="Linked work" labelled={labelled}>
                <conceptIcons.linkedWork aria-hidden="true" />
            </KindMark>
        );

    // A decision or a build has no kind badge of its own: its method's or Build's icon marks it.
    if (!kind)
        return item.kind === 'decision' || item.kind === 'build' || isBuild(item) ? (
            <KindMark name={partLabel(partKind(item))} labelled={labelled}>
                <PartKindIcon kind={partKind(item)} />
            </KindMark>
        ) : listed ? (
            <KindMark name="Ticket">
                <TicketIcon aria-hidden="true" />
            </KindMark>
        ) : (
            // A ticket with no kind keeps the slot, quiet, rather than a mark that would read as a checkbox.
            <KindMark />
        );

    const Icon = kind.icon;

    return (
        <KindMark name={kind.name} hue={kind.hue} labelled={labelled}>
            <Icon aria-hidden="true" />
        </KindMark>
    );
});

/** What an item is and where it lives, as one group: where its ticket is saved, its kind mark, then its project's icon
 *  and name, the same on a lane row, a concept's part and a desk card's head. GitHub is where tickets live unless a row
 *  says otherwise, so without `always` a GitHub ticket shows no tracker mark; `always` shows every tracker's. */
/** A concept part's source and project after its title: its tracker's mark always, since a concept's parts mix GitHub
 *  issues and parts saved only on this Mac, and its project, the concept's own (`home`) quietly. */
export const PartSource = memo(function PartSource({
    item,
    home,
    kind,
}: {
    item: Item;
    home: boolean;
    /** The part's kind mark, after its source, as a lane row's is. */
    kind?: ReactNode;
}) {
    return (
        <RowIdentity>
            <SourceIcon item={item} bare always />
            {kind}
            <RepoCell item={item} home={home} />
        </RowIdentity>
    );
});

export const RowSource = memo(function RowSource({
    item,
    kind,
    always = false,
    project = true,
    others = [],
}: {
    item: Item;
    /** The item's kind mark, after its source, so source, kind and project read as one. */
    kind?: ReactNode;
    always?: boolean;
    /** Whether to name its project; a work-map card leaves it to its lane, which already names it. */
    project?: boolean;
    /** Other projects the work spans, such as a concept's parts', as a count after its own, named on hover. */
    others?: string[];
}) {
    const github = item.number > 0 && !(item.repo && onAzure(item.repo));

    return (
        <RowIdentity>
            {(always || !github) && <SourceIcon item={item} bare always />}
            {kind}
            {project && <RepoCell item={item} />}
            {others.length > 0 && <RowOthers names={others} />}
        </RowIdentity>
    );
});
