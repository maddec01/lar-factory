// The item dialog's summary under its title: the item's source, repository, status and age, what blocks it, its parent,
// its kind, and attaching or creating its ticket.

import { blockedText, itemName, openBlockers, repoKey, shortAgo } from '@lar-factory/shared';
import type { BoardData, Item } from '@lar-factory/shared';
import {
    ItemSummary as Summary,
    SummaryAge,
    SummaryBlocked,
    SummaryParent,
    SummaryStatus,
} from '@lar-works/design-system';

import { AttachTicket } from './AttachTicket';
import { CreateTicket } from './CreateTicket';
import { ItemKind, ItemStatusGlyph, RepoTag, SourceIcon, StructureSync, useShownStatus } from '@/features/items';

export function ItemSummary({ item, data, now }: { item: Item; data: BoardData; now: number }) {
    const shown = useShownStatus(item);

    return (
        <Summary
            data-item-summary
            line={
                <>
                    <SourceIcon item={item} />
                    <RepoTag repo={repoKey(item)} repos={data.repos} />
                    <ItemStatusGlyph item={item} /> <SummaryStatus>{shown.word}</SummaryStatus>
                    <SummaryAge>· updated {shortAgo(item.updatedAt, now)}</SummaryAge>
                    {openBlockers(item).length > 0 && <SummaryBlocked>{blockedText(item)}</SummaryBlocked>}
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
                    <ItemKind item={item} />
                    <StructureSync item={item} />
                </>
            }
            actions={
                <>
                    <AttachTicket item={item} />
                    <CreateTicket item={item} />
                </>
            }
        />
    );
}
