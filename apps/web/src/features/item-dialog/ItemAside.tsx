// The item dialog's sidebar: the work it waits on, Dependencies, sub-tickets and the rest of its relations, and pull
// requests.

import type { BoardData, Item } from '@lar-factory/shared';
import { plural } from '@lar-factory/shared';
import type { ReactNode } from 'react';

import { isGroupParent } from './group-parent';
import { ItemChecksSection } from './ItemChecks';
import { ItemRelations } from './ItemRelations';
import { showsPullRequests, subTicketsInParts, waitsOn } from './Relations';
import { Dependencies, PrList, dependenciesOf } from '@/features/items';
import { partRef } from '@/features/line';
import type { ItemDetailsRead } from '@/services/items/items.hooks';
import { DetailsSection, ItemDialogAside, NoPullRequest, WaitsOnList } from '@/ui/board';

/** The work the item waits on: what is still open, under "Waits on", and the done prerequisites as one quiet count. */
function WaitsOn({
    item,
    data,
    openPart,
}: {
    item: Item;
    data: BoardData;
    openPart?: ((itemId: string) => void) | undefined;
}) {
    const waits = waitsOn(item);
    const open = waits.filter((b) => b.state !== 'closed');
    const done = waits.filter((b) => b.state === 'closed');

    if (!waits.length) return null;

    // Led by its reference, as its row's "Blocked by Part 15" names it.
    const named = (b: (typeof waits)[number], i: number) => {
        const item = data.items.find((other) => other.id === b.workId);

        return {
            key: b.workId ?? String(i),
            item,
            reference: item ? partRef(item) : b.number ? `#${b.number}` : undefined,
            title: item?.title ?? b.title ?? '',
        };
    };

    return (
        <DetailsSection heading={open.length > 0 ? 'Waits on' : undefined}>
            <WaitsOnList
                items={open.map((b, i) => {
                    // Opening it when it is on the board.
                    const { item: onBoard, ...shown } = named(b, i);

                    return { ...shown, onOpen: onBoard && openPart ? () => openPart(onBoard.id) : undefined };
                })}
                done={
                    done.length > 0
                        ? { text: `${plural(done.length, 'prerequisite')} done`, items: done.map(named) }
                        : undefined
                }
            />
        </DetailsSection>
    );
}

export function ItemAside({
    item,
    data,
    now,
    read,
    refresh,
    lead,
    openPart,
    relations = true,
}: {
    /** Opens another item in the dialog, such as the work it waits on. */
    openPart?: (itemId: string) => void;
    /** The item has relations, pull requests or dependencies to list after `lead`. */
    relations?: boolean;
    /** What the sidebar opens with: the item's properties, figures and facts. */
    lead?: ReactNode;
    item: Item;
    data: BoardData;
    now: number;
    read: ItemDetailsRead;
    refresh: () => Promise<boolean>;
}) {
    return (
        <ItemDialogAside>
            {lead}
            {relations && <WaitsOn item={item} data={data} openPart={openPart} />}
            {relations && dependenciesOf(item).length > 0 && (
                <DetailsSection heading="Dependencies">
                    <Dependencies item={item} data={data} now={now} />
                </DetailsSection>
            )}
            {relations && (
                <ItemRelations
                    item={item}
                    read={read}
                    refresh={refresh}
                    subTicketsShown={!subTicketsInParts(item, data.items)}
                />
            )}
            {relations && showsPullRequests(item, isGroupParent(item, data.items)) && (
                <DetailsSection empty={item.linkedPrs.length ? undefined : <NoPullRequest />}>
                    {item.linkedPrs.length > 0 && (
                        <PrList
                            item={item}
                            checks={
                                item.kind === 'build' && (
                                    <ItemChecksSection key={`checks-${item.id}`} itemId={item.id} />
                                )
                            }
                        />
                    )}
                </DetailsSection>
            )}
        </ItemDialogAside>
    );
}
