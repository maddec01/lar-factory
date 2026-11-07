// The item dialog's summary under its title: the item's source, repository, status and age, what blocks it, its parent,
// its kind, and attaching or creating its ticket.

import { blockedText, itemName, openBlockers, repoKey, shortAgo } from '@lar-factory/shared';
import type { BoardData, Item } from '@lar-factory/shared';

import { AttachTicket } from './AttachTicket';
import { CreateTicket } from './CreateTicket';
import { ItemKind, ItemStatusGlyph, RepoTag, SourceIcon, StructureSync, useShownStatus } from '@/features/items';

export function ItemSummary({ item, data, now }: { item: Item; data: BoardData; now: number }) {
    const shown = useShownStatus(item);

    return (
        <div
            className="border-base-300 text-base-700 @container grid shrink-0 gap-1 border-b px-5 pb-3 text-xs sm:px-6"
            data-item-summary
        >
            <div className="flex min-w-0 flex-wrap items-center gap-2">
                <SourceIcon item={item} />
                <RepoTag repo={repoKey(item)} repos={data.repos} />
                <ItemStatusGlyph item={item} /> <span className="text-base-content font-medium">{shown.word}</span>
                <span className="min-w-0 truncate @max-[30rem]:hidden">· updated {shortAgo(item.updatedAt, now)}</span>
                {openBlockers(item).length > 0 && (
                    <span className="rounded bg-(--error-surface) px-1.5 text-(--error-foreground)">
                        {blockedText(item)}
                    </span>
                )}
            </div>
            {item.parent && (
                <p className="m-0 min-w-0 wrap-anywhere" data-item-parent>
                    Part of{' '}
                    {item.parent.url ? (
                        <a href={item.parent.url} target="_blank" rel="noopener" className="underline">
                            {itemName(item.parent)}
                        </a>
                    ) : (
                        itemName(item.parent)
                    )}
                </p>
            )}
            <div className="flex flex-wrap items-center gap-2">
                <ItemKind item={item} />
                <StructureSync item={item} />
            </div>
            <div className="flex flex-wrap items-start gap-2">
                <AttachTicket item={item} />
                <CreateTicket item={item} />
            </div>
        </div>
    );
}
