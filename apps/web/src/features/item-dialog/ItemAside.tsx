// The item dialog's sidebar: the work it waits on, Dependencies, sub-tickets and the rest of its relations, and pull
// requests.

import type { BoardData, Item } from '@lar-factory/shared';
import type { ReactNode } from 'react';

import { ItemRelations } from './ItemRelations';
import { waitsOn } from './Relations';
import type { ItemDetailsRead } from './useItemDetails';
import { Dependencies, PrList, dependenciesOf } from '@/features/items';

const Section = ({ heading, children }: { heading: ReactNode; children: ReactNode }) => (
    <section className="grid min-w-0 grid-cols-[minmax(0,1fr)] gap-2">
        <h2 className="m-0 text-[13px] font-medium">{heading}</h2>
        {children}
    </section>
);

export function ItemAside({
    item,
    data,
    now,
    read,
}: {
    item: Item;
    data: BoardData;
    now: number;
    read: ItemDetailsRead;
}) {
    return (
        <aside className="grid min-w-0 grid-cols-[minmax(0,1fr)] content-start gap-4 @min-[45rem]:col-start-2 @min-[45rem]:row-span-2 @min-[45rem]:row-start-1 @min-[45rem]:border-l @min-[45rem]:border-(--border) @min-[45rem]:pl-6">
            {waitsOn(item).length > 0 && (
                <Section heading="Waits on">
                    <ul className="m-0 grid list-none gap-1.5 p-0 text-sm" data-waits-on>
                        {waitsOn(item).map((b) => (
                            <li
                                key={b.workId}
                                className={b.state === 'closed' ? 'text-(--muted-foreground) line-through' : ''}
                            >
                                {b.title}
                            </li>
                        ))}
                    </ul>
                </Section>
            )}
            {dependenciesOf(item).length > 0 && (
                <Section heading="Dependencies">
                    <Dependencies item={item} data={data} now={now} />
                </Section>
            )}
            <ItemRelations item={item} read={read} />
            {item.linkedPrs.length > 0 && (
                <Section heading="Pull requests">
                    <PrList item={item} />
                </Section>
            )}
        </aside>
    );
}
