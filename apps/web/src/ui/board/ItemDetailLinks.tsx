import { Link, SkeletonLoader } from '@lar-works/design-system';
import { CircleCheckIcon, CircleDotIcon } from '@lar-works/design-system/icons';
import type { ReactNode } from 'react';

import { ItemTitle } from './ItemParts';

/** Linked work items, such as sub-tickets or blockers, one TicketLink each; or attachments, one AttachmentLink each. */
export function TicketLinkList({
    children,
}: {
    /** The links, one TicketLink or AttachmentLink each. */
    children: ReactNode;
}) {
    return <ul className="m-0 grid min-w-0 list-none grid-cols-[minmax(0,1fr)] gap-1.5 p-0">{children}</ul>;
}

/** A linked work item: done or open (`stateLabel` names it), its `reference` and `title` linked, and its tracker's
 *  `fields` under them, truncating to the column; as a `row`, on one line with its fields at the line's end. */
export function TicketLink({
    closed,
    stateLabel,
    href,
    reference,
    title,
    fields,
    presentation = 'stacked',
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
    /** Its tracker's fields, under the title, or at the row's end. */
    fields?: ReactNode;
    /** `stacked` (the default) in the sidebar; `row`, one line, in the main column's width. */
    presentation?: 'stacked' | 'row';
}) {
    const row = presentation === 'row';

    return (
        <li className={`flex min-w-0 gap-2 text-sm ${row ? 'items-center' : 'items-start'}`}>
            {closed ? (
                <CircleCheckIcon
                    aria-label={stateLabel}
                    className={`text-success-fg size-3.5 shrink-0 ${row ? '' : 'mt-0.5'}`}
                />
            ) : (
                <CircleDotIcon
                    aria-label={stateLabel}
                    className={`text-fg-muted size-3.5 shrink-0 ${row ? '' : 'mt-0.5'}`}
                />
            )}
            <span className={`min-w-0 flex-1 ${row ? 'flex items-center gap-3' : ''}`}>
                <a
                    href={href}
                    target="_blank"
                    rel="noopener"
                    title={row ? `${reference} ${title}` : undefined}
                    className={`hover:underline ${row ? 'min-w-0 flex-1 truncate' : 'wrap-anywhere'}`}
                >
                    <ItemTitle reference={reference} title={title} />
                </a>
                {row ? <span className="max-w-[45%] shrink-0">{fields}</span> : fields}
            </span>
        </li>
    );
}

/** `count` linked work items still loading, one placeholder row each in a `row` TicketLink's height and shape (its state
 *  glyph, its title, its fields at the end), so the list takes its place without the dialog jumping as they arrive;
 *  `label` names what loads for screen readers. */
export function TicketLinkPlaceholders({ count, label }: { count: number; label: string }) {
    // Titles of about the same length, a little apart, so the rows read as a list rather than a paragraph.
    const titles = ['w-[42%]', 'w-[36%]', 'w-[40%]'] as const;

    return (
        <SkeletonLoader label={label}>
            <ul className="m-0 grid list-none gap-1.5 p-0" data-ticket-placeholders>
                {Array.from({ length: count }, (_, i) => (
                    <li key={i} className="flex h-5 min-w-0 items-center gap-2">
                        {/* A line as tall as it is wide, in the state glyph's 14px, is its round mark. */}
                        <span className="size-3.5 shrink-0">
                            <SkeletonLoader.Shape />
                        </span>
                        <span className="min-w-0 flex-1">
                            <span className={`block ${titles[i % titles.length]}`}>
                                <SkeletonLoader.Shape />
                            </span>
                        </span>
                        <span className="w-30 max-w-[30%] shrink-0">
                            <SkeletonLoader.Shape />
                        </span>
                    </li>
                ))}
            </ul>
        </SkeletonLoader>
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
        <li className="text-sm wrap-anywhere">
            <Link href={href} external showExternalIcon={false}>
                {name}
            </Link>
        </li>
    );
}
