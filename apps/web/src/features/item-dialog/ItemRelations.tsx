// The item dialog's sidebar relations: children, named attachments, blockers and Related work.

import type { IssueRef, Item } from '@lar-factory/shared';
import { Disclosure, PageError, Stack } from '@lar-works/design-system';

import { Placeholder } from './DetailsParts';
import { sidebarSubTickets } from './Relations';
import { AzureFields } from '@/features/items';
import type { ItemDetailsRead } from '@/services/items/items.hooks';
import { AttachmentLink, DetailsSection, SprintCount, TicketLink, TicketLinkList } from '@/ui/board';

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

/**
 * Children the slice chips don't already show, named attachments, blockers and Related work; a failed relation read leaves
 * the description intact.
 */
export function ItemRelations({
    item,
    read,
    refresh,
}: {
    item: Item;
    read: ItemDetailsRead;
    refresh: () => Promise<boolean>;
}) {
    if (read.state === 'failed') return null;

    if (read.state === 'loading')
        return item.kind !== 'concept' && item.subIssues.total > item.slices.length ? (
            <DetailsSection heading="Sub-tickets">
                <Placeholder />
            </DetailsSection>
        ) : null;

    const { attachments, blockers, related, relationsError } = read.details;
    // A concept's dialog lists its parts in its Parts section, so the side doesn't list them again.
    const subTickets = item.kind === 'concept' ? [] : sidebarSubTickets(item, read.details.subTickets);
    const sprint = item.currentSprint;
    const current = sprint ? subTickets.filter((s) => sprint.childNumbers.includes(s.number)) : subTickets;
    const other = sprint ? subTickets.filter((s) => !sprint.childNumbers.includes(s.number)) : [];

    return (
        <>
            {relationsError && (
                <Stack role="alert">
                    <PageError
                        size="inline"
                        title="Couldn’t load linked work items"
                        description={relationsError}
                        primaryAction={{ label: 'Try again', onAction: () => void refresh() }}
                    />
                </Stack>
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
