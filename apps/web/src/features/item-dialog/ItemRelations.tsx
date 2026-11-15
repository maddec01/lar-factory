// The item dialog's sidebar relations: children, named attachments, blockers and Related work.

import type { IssueRef, Item } from '@lar-factory/shared';
import { Disclosure } from '@lar-works/design-system';

import { sidebarSubTickets } from './Relations';
import { AzureFields } from '@/features/items';
import type { ItemDetailsRead } from '@/services/items/items.hooks';
import { AttachmentLink, DetailsSection, LoadFailed, SprintCount, TicketLink, TicketLinkList } from '@/ui/board';

/** Named work item links share the child list's native fields and completion marks; a `row` each in the main column. */
export function TicketLinks({ tickets, row = false }: { tickets: IssueRef[]; row?: boolean }) {
    return (
        <TicketLinkList>
            {tickets.map((s) => (
                <TicketLink
                    key={s.url}
                    closed={s.state === 'closed'}
                    stateLabel={s.state === 'closed' ? 'Done' : 'Open'}
                    href={s.url}
                    reference={`#${s.number}`}
                    title={s.title}
                    fields={<AzureFields azure={s.azure} />}
                    presentation={row ? 'row' : 'stacked'}
                />
            ))}
        </TicketLinkList>
    );
}

/**
 * Children the slice chips don't already show, named attachments, blockers and Related work; a failed relation read leaves
 * the description intact.
 */
export function ItemRelations({
    item,
    read,
    refresh,
    subTicketsShown = true,
}: {
    item: Item;
    read: ItemDetailsRead;
    refresh: () => Promise<boolean>;
    /** The sidebar lists the sub-tickets; false when the main column's Parts section already does. */
    subTicketsShown?: boolean;
}) {
    if (read.state === 'failed') return null;

    // Sub-tickets show once they load; the main column's loading line stands for them until then.
    if (read.state === 'loading') return null;

    const { attachments, blockers, related, relationsError } = read.details;
    // A concept's dialog lists its parts in its Parts section, so the side doesn't list them again.
    const subTickets =
        item.kind === 'concept' || !subTicketsShown ? [] : sidebarSubTickets(item, read.details.subTickets);
    const sprint = item.currentSprint;
    const current = sprint ? subTickets.filter((s) => sprint.childNumbers.includes(s.number)) : subTickets;
    const other = sprint ? subTickets.filter((s) => !sprint.childNumbers.includes(s.number)) : [];

    return (
        <>
            {relationsError && (
                <LoadFailed what="linked work items" reason={relationsError} onRetry={() => void refresh()} />
            )}
            {subTickets.length > 0 && (
                <DetailsSection heading={sprint ? 'Children' : 'Sub-tickets'}>
                    {sprint && (
                        <SprintCount
                            count={`${current.filter((s) => s.state === 'closed').length} of ${current.length} done`}
                            name={sprint.name}
                        />
                    )}
                    <TicketLinks tickets={current} />
                    {other.length > 0 && (
                        <Disclosure label={`Other children (${other.length})`} presentation="section">
                            <TicketLinks tickets={other} />
                        </Disclosure>
                    )}
                </DetailsSection>
            )}
            {Boolean(attachments?.length) && (
                <DetailsSection heading="Attachments">
                    <TicketLinkList>
                        {attachments!.map((a) => (
                            <AttachmentLink key={a.url} href={a.url} name={a.name} />
                        ))}
                    </TicketLinkList>
                </DetailsSection>
            )}
            {Boolean(blockers?.length) && (
                <DetailsSection heading="Blocked by">
                    <TicketLinks tickets={blockers!} />
                </DetailsSection>
            )}
            {Boolean(related?.length) && (
                <DetailsSection heading="Related work">
                    <TicketLinks tickets={related!} />
                </DetailsSection>
            )}
        </>
    );
}
