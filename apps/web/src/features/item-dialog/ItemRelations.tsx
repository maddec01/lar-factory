// The item dialog's sidebar relations: children, named attachments, blockers and Related work.

import type { IssueRef, Item } from '@lar-factory/shared';
import { CircleCheck, CircleDot } from '@lar-works/design-system/icons';
import type { ReactNode } from 'react';

import { Placeholder } from './DetailsParts';
import type { ItemDetailsRead } from './useItemDetails';
import { AzureFields } from '@/features/items';

/** Named work item links share the child list's native fields and completion marks. */
function TicketLinks({ tickets }: { tickets: IssueRef[] }) {
    return (
        <ul className="m-0 grid list-none gap-1.5 p-0">
            {tickets.map((s) => (
                <li key={s.url} className="flex items-start gap-2 text-sm">
                    {s.state === 'closed' ? (
                        <CircleCheck aria-label="Done" className="mt-0.5 size-3.5 shrink-0 text-(--success)" />
                    ) : (
                        <CircleDot aria-label="Open" className="mt-0.5 size-3.5 shrink-0 text-(--muted-foreground)" />
                    )}
                    <span className="min-w-0">
                        <a href={s.url} target="_blank" rel="noopener" className="wrap-anywhere hover:underline">
                            <span className="text-(--muted-foreground)">#{s.number}</span> {s.title}
                        </a>
                        <AzureFields azure={s.azure} />
                    </span>
                </li>
            ))}
        </ul>
    );
}

function RelationSection({ title, children }: { title: string; children: ReactNode }) {
    return (
        <section className="grid min-w-0 grid-cols-[minmax(0,1fr)] gap-2">
            <h2 className="m-0 text-[13px] font-medium">{title}</h2>
            {children}
        </section>
    );
}

/** Children, named attachments, blockers and Related work; a failed relation read leaves the description intact. */
export function ItemRelations({ item, read }: { item: Item; read: ItemDetailsRead }) {
    if (read.state === 'failed') return null;

    if (read.state === 'loading')
        return (
            <RelationSection title="Sub-tickets">
                <Placeholder className="h-4 w-24" />
            </RelationSection>
        );

    const { subTickets, attachments, blockers, related, relationsError } = read.details;
    const sprint = item.currentSprint;
    const current = sprint ? subTickets.filter((s) => sprint.childNumbers.includes(s.number)) : subTickets;
    const other = sprint ? subTickets.filter((s) => !sprint.childNumbers.includes(s.number)) : [];

    return (
        <>
            {relationsError && (
                <p role="alert" className="m-0 text-sm text-(--error-foreground)">
                    Could not load linked work items: {relationsError}
                </p>
            )}
            {subTickets.length > 0 && (
                <RelationSection title={sprint ? 'Children' : 'Sub-tickets'}>
                    {sprint && (
                        <div className="text-sm">
                            <p className="m-0 font-medium">
                                This sprint: {current.filter((s) => s.state === 'closed').length} of {current.length}{' '}
                                done
                            </p>
                            <p className="m-0 text-xs text-(--muted-foreground)">{sprint.name}</p>
                        </div>
                    )}
                    <TicketLinks tickets={current} />
                    {other.length > 0 && (
                        <details className="grid min-w-0 gap-2">
                            <summary className="cursor-pointer text-sm text-(--muted-foreground)">
                                Other children ({other.length})
                            </summary>
                            <div className="pt-2">
                                <TicketLinks tickets={other} />
                            </div>
                        </details>
                    )}
                </RelationSection>
            )}
            {Boolean(attachments?.length) && (
                <RelationSection title="Attachments">
                    <ul className="m-0 grid list-none gap-1.5 p-0">
                        {attachments!.map((a) => (
                            <li key={a.url} className="text-sm">
                                <a href={a.url} target="_blank" rel="noopener" className="wrap-anywhere underline">
                                    {a.name}
                                </a>
                            </li>
                        ))}
                    </ul>
                </RelationSection>
            )}
            {Boolean(blockers?.length) && (
                <RelationSection title="Blocked by">
                    <TicketLinks tickets={blockers!} />
                </RelationSection>
            )}
            {Boolean(related?.length) && (
                <RelationSection title="Related work">
                    <TicketLinks tickets={related!} />
                </RelationSection>
            )}
        </>
    );
}
