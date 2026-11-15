// A piece of work's earlier T3 threads, in the item dialog.

import { Link } from '@lar-works/design-system';
import type { ReactNode } from 'react';

import { MetaDot } from './TextParts';

/** The earlier threads, one EarlierThread each, in small muted text. */
export function EarlierThreadList({
    children,
}: {
    /** The threads, one EarlierThread each. */
    children: ReactNode;
}) {
    // A property of the item as the sidebar lists them: "Threads" in the label column, each thread beside it.
    return (
        <div
            className="grid grid-cols-[var(--fact-label)_minmax(0,1fr)] items-start gap-x-3 text-xs"
            data-earlier-threads
        >
            <span className="text-fg-muted leading-7">Threads</span>
            <ul className="m-0 grid list-none p-0">{children}</ul>
        </div>
    );
}

/** An earlier thread: its `name`, linked when `href` opens it, then its `state`; `title` names it in full. The name
 *  truncates alone, so the state stays in view. */
export function EarlierThread({
    name,
    title,
    href,
    state,
}: {
    /** The thread's name, which truncates alone. */
    name: string;
    /** The thread in full, as its tooltip. */
    title: string;
    /** The thread's page; the name is plain text without one. */
    href?: string | undefined;
    /** The thread's state. */
    state?: ReactNode;
}) {
    return (
        <li className="text-fg-muted flex min-h-7 min-w-0 items-center gap-1.5" title={title}>
            {href ? (
                <span className="min-w-0 truncate">
                    <Link href={href} variant="caption" data-thread-name>
                        {name}
                    </Link>
                </span>
            ) : (
                <span data-thread-name className="truncate">
                    {name}
                </span>
            )}
            {state && (
                <span data-thread-state className="shrink-0">
                    <MetaDot /> {state}
                </span>
            )}
        </li>
    );
}
