// The board's small shared text pieces: a small group's title, a line of facts parted by dots, and a moment.

import { Fragment, type ReactNode } from 'react';

const groupTitle = 'text-fg-soft m-0 flex min-w-0 items-center gap-1.5 text-xs font-medium';

/** A small group's title, such as a release's name, an attention row's label or a work-map lane's name: 12/500 in the
 *  soft text colour, with any icon or status dot before it. `as` an `h3` it heads a section of its own. */
export function GroupTitle({
    as = 'span',
    children,
}: {
    /** The element it renders: `h3` when it heads a section, `span` otherwise. */
    as?: 'span' | 'h3';
    /** The title, and any icon before it. */
    children: ReactNode;
}) {
    if (as === 'h3') return <h3 className={groupTitle}>{children}</h3>;

    return <span className={groupTitle}>{children}</span>;
}

/** Facts on one line parted by a dot, such as "passed · Run by build": the dots are drawn, not read aloud, and a part
 *  that's empty (false, null, undefined or '') is left out with its dot. It takes the surrounding text's look. */
export function MetaLine({
    parts,
}: {
    /** The facts, in order, each a rendered node or a string. */
    parts: readonly ReactNode[];
}) {
    const shown = parts.filter((part) => part !== false && part !== null && part !== undefined && part !== '');

    return (
        <>
            {shown.map((part, index) => (
                <Fragment key={index}>
                    {index > 0 && (
                        <>
                            {' '}
                            <MetaDot />{' '}
                        </>
                    )}
                    {part}
                </Fragment>
            ))}
        </>
    );
}

/** The dot between two facts on a line, drawn but not read aloud; MetaLine's, for a line laid out in its own boxes. */
export function MetaDot() {
    return <span aria-hidden="true">·</span>;
}

/** A moment as the board says it everywhere, such as "3 Nov, 14:05": the day and month, the year only when it isn't
 *  this one, and the time; text that isn't a moment stays as it is. */
function formatMoment(at: string): string {
    const date = new Date(at);

    if (Number.isNaN(date.getTime())) return at;

    return date.toLocaleString(undefined, {
        day: 'numeric',
        month: 'short',
        ...(date.getFullYear() === new Date().getFullYear() ? {} : { year: 'numeric' }),
        hour: '2-digit',
        minute: '2-digit',
    });
}

/** A moment in a line of text, as formatMoment says it, machine-readable. */
export function Moment({
    at,
}: {
    /** The moment, as an ISO string. */
    at: string;
}) {
    return <time dateTime={at}>{formatMoment(at)}</time>;
}
