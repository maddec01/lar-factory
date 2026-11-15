// The List modal's rows: a group in its left pane and an item in its right pane.

import { onAzure, ref, repoKey, repoName, shortAgo } from '@lar-factory/shared';
import type { Item } from '@lar-factory/shared';

import { AzureFields, LabelChips, StructureSync, SourceIcon } from '@/features/items';
import { RowKindMark } from '@/features/line';
import { ProjectIcon } from '@/features/repositories';
import { useBoardStore } from '@/services/board/board.hooks';
import { ListItemRow } from '@/ui/board';

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
            source={
                <>
                    <RowKindMark item={item} />
                    {(!item.number || (item.repo && onAzure(item.repo))) && <SourceIcon item={item} bare always />}
                </>
            }
            {...(item.number ? { reference: ref(item) } : {})}
            title={item.title}
            repoIcon={showRepo && <ProjectIcon repo={repoKey(item)} size="sm" />}
            meta={showRepo ? repoName(repoKey(item), repos) : ''}
            age={shortAgo(item.updatedAt, now)}
            chips={
                <>
                    <LabelChips item={item} />
                    <StructureSync item={item} />
                </>
            }
            details={<AzureFields azure={item.azure} />}
        />
    );
}
