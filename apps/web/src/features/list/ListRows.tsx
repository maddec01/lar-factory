// The List modal's rows: a group in its left pane and an item in its right pane.

import { ref } from '@lar-factory/shared';
import type { Item } from '@lar-factory/shared';
import { LabelChip } from '@lar-works/design-system';

import { listRowLabels, rowTitle, rowTooltip, trackerFacts } from './ListRowFacts';
import { useItemDialogStore } from '@/features/item-dialog';
import { Age, RepoCell, SourceIcon, StructureSync } from '@/features/items';
import { RowKindMark } from '@/features/line';
import { useBoardStore } from '@/services/board/board.hooks';
import { ItemTitle, ListItemRow } from '@/ui/board';

export function ItemRow({
    item,
    showRepo,
    labelColumn,
    onOpen,
}: {
    item: Item;
    showRepo: boolean;
    /** Some row in the list has labels, so this row keeps their column too. */
    labelColumn: boolean;
    onOpen: () => void;
}) {
    const repos = useBoardStore((state) => state.data.repos);
    const labels = listRowLabels(item, repos);
    const facts = trackerFacts(item);
    const picked = useItemDialogStore((state) => state.itemId === item.id);

    return (
        <ListItemRow
            item={item.id}
            picked={picked}
            name={rowTooltip(item.title, facts, labels)}
            onOpen={onOpen}
            source={
                <>
                    <RowKindMark item={item} listed />
                    {/* Every row names where its ticket lives, a GitHub issue too, so no row's mark reads as missing. */}
                    <SourceIcon item={item} bare always />
                </>
            }
            title={<ItemTitle reference={item.number ? ref(item) : undefined} title={rowTitle(item.title)} />}
            project={showRepo && <RepoCell item={item} />}
            age={<Age at={item.updatedAt} />}
            labelColumn={labelColumn}
            labels={labels}
            chip={labels[0] !== undefined && <LabelChip label={labels[0]} color={item.labelColors?.[labels[0]]} />}
            {...((item.specSync || (item.sync && item.sync.state !== 'saved')) && {
                note: <StructureSync item={item} />,
            })}
        />
    );
}
