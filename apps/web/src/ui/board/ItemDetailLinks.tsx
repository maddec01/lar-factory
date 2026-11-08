import { CircleCheckIcon, CircleDotIcon } from '@lar-works/design-system/icons';
import { linkRecipe } from '@lar-works/design-system/primitives';
import type { ReactNode } from 'react';

/** Linked work items, such as sub-tickets or blockers, one TicketLink each; or attachments, one AttachmentLink each. */
export function TicketLinkList({
    children,
}: {
    /** The links, one TicketLink or AttachmentLink each. */
    children: ReactNode;
}) {
    return <ul className="m-0 grid list-none gap-1.5 p-0">{children}</ul>;
}

/** A linked work item: done or open (`stateLabel` names it), its `reference` and `title` linked, and its tracker's
 *  `fields` under them. */
export function TicketLink({
    closed,
    stateLabel,
    href,
    reference,
    title,
    fields,
}: {
    /** The work item is done. */
    closed: boolean;
    /** Its state in words, such as "Closed". */
    stateLabel: string;
    /** The work item's page. */
    href: string;
    /** Its reference, such as `#12`. */
    reference: string;
    /** Its title. */
    title: string;
    /** Its tracker's fields, under the title. */
    fields?: ReactNode;
}) {
    return (
        <li className="flex items-start gap-2 text-sm">
            {closed ? (
                <CircleCheckIcon aria-label={stateLabel} className="text-success-fg mt-0.5 size-3.5 shrink-0" />
            ) : (
                <CircleDotIcon aria-label={stateLabel} className="text-fg-muted mt-0.5 size-3.5 shrink-0" />
            )}
            <span className="min-w-0">
                <a href={href} target="_blank" rel="noopener" className="wrap-anywhere hover:underline">
                    <span className="text-fg-muted">{reference}</span> {title}
                </a>
                {fields}
            </span>
        </li>
    );
}

/** An attachment's name, linked. */
export function AttachmentLink({
    href,
    name,
}: {
    /** The attachment's address. */
    href: string;
    /** The attachment's file name. */
    name: string;
}) {
    return (
        <li className="text-sm">
            <a href={href} target="_blank" rel="noopener" className={`wrap-anywhere ${linkRecipe.accent}`}>
                {name}
            </a>
        </li>
    );
}
