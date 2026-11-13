// The item dialog's summary under its title: the item's source, repository and what it is doing now, as the one
// item-state presenter says it on every surface (the stage bar below names the recorded stage), what blocks it, its parent, its
// kind as its row names it when the dialog's Kind control doesn't, and attaching or creating its ticket. The meta area
// says when it was updated.

import { blockedText, itemName, openBlockers } from '@lar-factory/shared';
import type { Item } from '@lar-factory/shared';

import { AttachTicket } from './AttachTicket';
import { CreateTicket } from './CreateTicket';
import { isGroupParent } from './group-parent';
import { ItemKindControl } from './ItemKindControl';
import { ItemKind, ItemStatusGlyph, RepoCell, SourceIcon, StructureSync, useShownStatus } from '@/features/items';
import { RowKind } from '@/features/line';
import { useBoardStore } from '@/services/board/board.hooks';
import { ItemSummary as Summary, SummaryBlocked, SummaryParent, SummaryStatus } from '@/ui/board';

export function ItemSummary({ item }: { item: Item }) {
    const group = isGroupParent(
        item,
        useBoardStore((state) => state.data.items),
    );
    const shown = useShownStatus(item);

    return (
        <Summary
            data-item-summary
            line={
                <>
                    <SourceIcon item={item} />
                    <RepoCell item={item} />
                    <ItemStatusGlyph item={item} /> <SummaryStatus title={shown.recorded}>{shown.word}</SummaryStatus>
                    {openBlockers(item).length > 0 && !shown.blocked && (
                        <SummaryBlocked>{blockedText(item)}</SummaryBlocked>
                    )}
                </>
            }
            parent={
                item.parent && (
                    <SummaryParent
                        data-item-parent
                        prefix="Part of"
                        name={itemName(item.parent)}
                        href={item.parent.url}
                    />
                )
            }
            kind={
                <>
                    <ItemKind
                        item={item}
                        summaryKind={<ItemKindControl item={item} fallback={<RowKind item={item} />} />}
                    />
                    <StructureSync item={item} localNote={!group} />
                </>
            }
            actions={
                item.status !== 'Done' && (
                    <>
                        <AttachTicket item={item} />
                        <CreateTicket item={item} />
                    </>
                )
            }
        />
    );
}
