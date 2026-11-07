// The List modal's rows: a group in its left pane and an item in its right pane.

import { ref, repoKey, repoName, shortAgo } from '@lar-factory/shared';
import type { Item } from '@lar-factory/shared';
import { ListItemRow } from '@lar-works/design-system';

import { AzureFields, ItemKind, LabelChips, StructureSync, SourceIcon } from '@/features/items';
import { ProjectIcon } from '@/features/repositories';
import { useBoardStore } from '@/services/board/board.hooks';

export function ItemRow({
    item,
    now,
    showRepo,
    onOpen,
}: {
    item: Item;
    now: number;
    showRepo: boolean;
    onOpen: () => void;
}) {
    const repos = useBoardStore((state) => state.data.repos);

    return (
        <ListItemRow
            item={item.id}
            name={item.title}
            onOpen={onOpen}
            source={<SourceIcon item={item} />}
            {...(item.number ? { reference: ref(item) } : {})}
            title={item.title}
            repoIcon={showRepo && <ProjectIcon repo={repoKey(item)} size="small" />}
            meta={`${showRepo ? `${repoName(repoKey(item), repos)} · ` : ''}${shortAgo(item.updatedAt, now)}`}
            chips={
                <>
                    <ItemKind item={item} onRow />
                    <LabelChips item={item} />
                    <StructureSync item={item} />
                </>
            }
            details={<AzureFields azure={item.azure} />}
        />
    );
}
