// Where an item's ticket lives, as a quiet link beside its project in the dialog's sidebar, so the dialog needs no
// footer band for one link.

import { ArrowUpRight } from '@lar-works/design-system/icons';
import type { ReactNode } from 'react';

/** A link to the item's ticket: its tracker's `icon` (`name`, such as GitHub, on hover and for screen readers) with an
 *  arrow that says it leaves the board, small enough to sit beside the project name; muted until hovered or focused. */
export function TrackerLink({
    href,
    icon,
    name,
    note,
}: {
    /** The ticket's address. */
    href: string;
    /** The tracker's icon. */
    icon: ReactNode;
    /** The tracker's name, such as "GitHub". */
    name: string;
    /** A word on the ticket after "Open in …" in the tooltip, such as that its plan is saved on this Mac. */
    note?: string | undefined;
}) {
    return (
        <a
            href={href}
            target="_blank"
            rel="noopener"
            title={note ? `Open in ${name}. ${note}` : `Open in ${name}`}
            className="text-fg-muted hover:text-fg focus-ring inline-flex shrink-0 items-center gap-0.5 rounded-xs text-xs transition-colors [&_svg]:size-3.5"
            data-ticket-link
        >
            {icon}
            <span className="sr-only">Open in {name}</span>
            <ArrowUpRight aria-hidden="true" />
        </a>
    );
}
