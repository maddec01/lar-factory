// What names an item wherever it shows: where its ticket is saved and its repository, and its kind, as a quiet mark on
// stage rows, desk cards and dock rows and as a badge in its dialog.

import { isBuild } from '@lar-factory/shared';
import type { Item } from '@lar-factory/shared';
import { Badge } from '@lar-works/design-system';
import { memo } from 'react';

import { partKind, partLabel } from './DossierParts';
import { PartKindLabel } from './WorkMapParts';
import { KIND_BADGES, KindBadge, RepoCell, SourceIcon } from '@/features/items';
import { conceptIcons, KindMark, PartKindIcon, RowIdentity } from '@/ui/board';

/** A row's kind: Linked work for a group parent, otherwise its kind badge, decision method or Build; no recognised kind has none. */
export const RowKind = memo(function RowKind({ item }: { item: Item }) {
    if (item.kind !== 'concept' && item.flow === 'linked' && !item.parentId && !item.parent)
        return <Badge tone="neutral">Linked work</Badge>;

    if (KIND_BADGES[item.kind]) return <KindBadge kind={item.kind} />;

    return item.kind === 'decision' || item.kind === 'build' || isBuild(item) ? (
        <Badge>
            <PartKindLabel kind={partKind(item)} />
        </Badge>
    ) : null;
});

/** A row's kind as its muted icon before the title, named on hover; its empty room for an item with no recognised kind. */
export const RowKindMark = memo(function RowKindMark({ item }: { item: Item }) {
    if (item.kind !== 'concept' && item.flow === 'linked' && !item.parentId && !item.parent)
        return (
            <KindMark name="Linked work">
                <conceptIcons.linkedWork aria-hidden="true" />
            </KindMark>
        );

    const kind = KIND_BADGES[item.kind];

    // A decision or a build has no kind badge of its own: its method's or Build's icon marks it.
    if (!kind)
        return item.kind === 'decision' || item.kind === 'build' || isBuild(item) ? (
            <KindMark name={partLabel(partKind(item))}>
                <PartKindIcon kind={partKind(item)} />
            </KindMark>
        ) : (
            <KindMark />
        );

    const Icon = kind.icon;

    return (
        <KindMark name={kind.name}>
            <Icon aria-hidden="true" />
        </KindMark>
    );
});

/** Where the ticket is saved, as its bare muted icon, then the repository. */
export const RowSource = memo(function RowSource({ item }: { item: Item }) {
    return (
        <RowIdentity>
            <SourceIcon item={item} bare always />
            <RepoCell item={item} />
        </RowIdentity>
    );
});
