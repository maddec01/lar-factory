// A piece of work's earlier T3 threads, in the item dialog.

import { linkRecipe } from '@lar-works/design-system/primitives';
import type { ReactNode } from 'react';

/** The earlier threads, one EarlierThread each, in small muted text. */
export function EarlierThreadList({
    children,
}: {
    /** The threads, one EarlierThread each. */
    children: ReactNode;
}) {
    return (
        <ul className="text-fg-muted m-0 grid list-none gap-1 p-0 text-xs" data-earlier-threads>
            {children}
        </ul>
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
    state: ReactNode;
}) {
    return (
        <li className="flex min-w-0 items-center gap-1.5" title={title}>
            {href ? (
                <a href={href} data-thread-name className={`truncate ${linkRecipe.accent}`}>
                    {name}
                </a>
            ) : (
                <span data-thread-name className="truncate">
                    {name}
                </span>
            )}{' '}
            <span data-thread-state className="shrink-0">
                · {state}
            </span>
        </li>
    );
}
