// The item dialog's sidebar relations: children, named attachments, blockers and Related work.

import type { IssueRef, Item } from '@lar-factory/shared';
import {
    AttachmentLink,
    DetailsSection,
    DetailsText,
    Disclosure,
    SprintCount,
    TicketLink,
    TicketLinkList,
} from '@lar-works/design-system';

import { Placeholder } from './DetailsParts';
import type { ItemDetailsRead } from './useItemDetails';
import { AzureFields } from '@/features/items';

/** Named work item links share the child list's native fields and completion marks. */
function TicketLinks({ tickets }: { tickets: IssueRef[] }) {
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
                />
            ))}
        </TicketLinkList>
    );
}

/** Children, named attachments, blockers and Related work; a failed relation read leaves the description intact. */
export function ItemRelations({ item, read }: { item: Item; read: ItemDetailsRead }) {
    if (read.state === 'failed') return null;

    if (read.state === 'loading')
        return (
            <DetailsSection heading="Sub-tickets">
                <Placeholder />
            </DetailsSection>
        );

    const { subTickets, attachments, blockers, related, relationsError } = read.details;
    const sprint = item.currentSprint;
    const current = sprint ? subTickets.filter((s) => sprint.childNumbers.includes(s.number)) : subTickets;
    const other = sprint ? subTickets.filter((s) => !sprint.childNumbers.includes(s.number)) : [];

    return (
        <>
            {relationsError && (
                <DetailsText tone="error">Could not load linked work items: {relationsError}</DetailsText>
            )}
            {subTickets.length > 0 && (
                <DetailsSection heading={sprint ? 'Children' : 'Sub-tickets'}>
                    {sprint && (
                        <SprintCount
                            count={`This sprint: ${current.filter((s) => s.state === 'closed').length} of ${current.length} done`}
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
