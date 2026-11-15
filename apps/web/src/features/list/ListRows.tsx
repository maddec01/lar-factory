// The List modal's rows: a group in its left pane and an item in its right pane.

import { onAzure, ref, repoKey, repoName, shortAgo } from '@lar-factory/shared';
import type { Item } from '@lar-factory/shared';
import { LabelChip } from '@lar-works/design-system';

import { listRowLabels, rowTitle, rowTooltip, trackerFacts } from './ListRowFacts';
import { StructureSync, SourceIcon } from '@/features/items';
import { RowKindMark } from '@/features/line';
import { ProjectIcon } from '@/features/repositories';
import { useBoardStore } from '@/services/board/board.hooks';
import { ListItemRow } from '@/ui/board';

export function ItemRow({
    item,
    now,
    showRepo,
    labelColumn,
    onOpen,
}: {
    item: Item;
    now: number;
    showRepo: boolean;
    /** Some row in the list has labels, so this row keeps their column too. */
    labelColumn: boolean;
    onOpen: () => void;
}) {
    const repos = useBoardStore((state) => state.data.repos);
    const project = repoName(repoKey(item), repos);
    const labels = listRowLabels(item, repos);
    const facts = trackerFacts(item);

    return (
        <ListItemRow
            item={item.id}
            name={rowTooltip(item.title, facts, labels)}
            onOpen={onOpen}
            source={
                <>
                    <RowKindMark item={item} listed />
                    {(!item.number || (item.repo && onAzure(item.repo))) && <SourceIcon item={item} bare always />}
                </>
            }
            {...(item.number ? { reference: ref(item) } : {})}
            title={rowTitle(item.title)}
            repoIcon={showRepo && <ProjectIcon repo={repoKey(item)} size="sm" />}
            meta={showRepo ? project : ''}
            age={shortAgo(item.updatedAt, now)}
            labelColumn={labelColumn}
            labels={labels}
            chip={labels[0] !== undefined && <LabelChip label={labels[0]} color={item.labelColors?.[labels[0]]} />}
            {...((item.specSync || (item.sync && item.sync.state !== 'saved')) && {
                note: <StructureSync item={item} />,
            })}
        />
    );
}
