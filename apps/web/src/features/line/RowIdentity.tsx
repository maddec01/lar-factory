// What names a row wherever it shows: where its ticket is saved, its repository, and its kind or decision method. Each
// keeps one place and style on stage rows, desk cards and dock rows.

import { isBuild } from '@lar-factory/shared';
import type { Item } from '@lar-factory/shared';
import { Badge } from '@lar-works/design-system';
import { memo } from 'react';

import { partKind } from './DossierParts';
import { PartKindLabel } from './WorkMapParts';
import { KIND_BADGES, KindBadge, RepoCell, SourceIcon } from '@/features/items';
import { RowIdentity } from '@/ui/board';

/** A row's kind: its badge, a decision's method or Build, with or without a ticket; a ticket with no recognised kind has none. */
export const RowKind = memo(function RowKind({ item }: { item: Item }) {
    if (KIND_BADGES[item.kind]) return <KindBadge kind={item.kind} />;

    return item.kind === 'decision' || item.kind === 'build' || isBuild(item) ? (
        <Badge>
            <PartKindLabel kind={partKind(item)} />
        </Badge>
    ) : null;
});

/** The ticket's source and the repository, side by side. */
export const RowSource = memo(function RowSource({ item }: { item: Item }) {
    return (
        <RowIdentity>
            <SourceIcon item={item} />
            <RepoCell item={item} />
        </RowIdentity>
    );
});
