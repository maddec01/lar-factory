// The bits every view of Lar Factory's board draws for a piece of work: its numbered title, title link, repository,
// tracker fields, label chips and planning notes.

import type { ReactNode } from 'react';

import type { DataAttributes } from './DataAttributes';

/** A title with its ticket's reference (`#12`) before it, muted, the way the board lists every item; captured work has
 *  no reference. */
export function ItemTitle({
    reference,
    title,
}: {
    /** The ticket's reference, such as `#12`; captured work has none. */
    reference?: string | undefined;
    /** The item's title. */
    title: string;
}) {
    return (
        <>
            {reference ? (
                <>
                    <span className="text-fg-muted font-normal tabular-nums">{reference}</span>{' '}
                </>
            ) : null}
            {title}
        </>
    );
}

/** A title with its reference as a link to its ticket in a new tab, or as text when it has no page, as a sentence names
 *  it. */
export function TitleLink({
    reference,
    title,
    href,
}: {
    /** The ticket's reference, such as `#12`. */
    reference?: string | undefined;
    /** The item's title. */
    title: string;
    /** The ticket's page, opened in a new tab; the reference is text without one. */
    href?: string | undefined;
}) {
    const text = (
        <>
            {reference ? (
                <>
                    <span className="ref">{reference}</span>{' '}
                </>
            ) : null}
            {title}
        </>
    );

    return href ? (
        <a className="title" href={href} target="_blank" rel="noopener">
            {text}
        </a>
    ) : (
        <span className="title">{text}</span>
    );
}

const identities = {
    row: 'flex min-w-0 items-center gap-1',
    map: 'inline-flex min-w-0 max-w-full items-center gap-1.5',
    wrap: 'inline-flex min-w-0 items-center gap-2',
} as const;

/** A repository's project icon and name together, the name truncating: in a row's line, or roomier on the work map,
 *  where `title` names it in full. `wrap` is roomier still and wraps the name, anywhere if it must, for a line that
 *  says more than the name, such as an archived item's repository, number and state. */
export function RepoIdentity({
    icon,
    name,
    title,
    presentation = 'row',
    ...data
}: {
    /** The repository's project icon. */
    icon: ReactNode;
    /** The repository's name, truncating. */
    name: string;
    /** The name in full, as its tooltip; a truncating name is its own tooltip by default. */
    title?: string;
    /** `row` in a row's line, `map` roomier on the work map, `wrap` when the name may wrap. */
    presentation?: 'row' | 'map' | 'wrap';
} & DataAttributes) {
    return (
        <span
            {...data}
            title={title ?? (presentation === 'wrap' ? undefined : name)}
            className={identities[presentation]}
        >
            {icon}
            <span className={presentation === 'wrap' ? 'min-w-0 wrap-anywhere' : 'min-w-0 truncate'}>{name}</span>
        </span>
    );
}

/** A tracker's fields for the item (such as Azure's type, state and assignee) as one muted line that truncates, its
 *  tooltip giving it whole. */
export function ItemFields({
    text,
    ...data
}: {
    /** The tracker's fields as one line, such as "Bug · Active · Ana". */
    text: string;
} & DataAttributes) {
    return (
        <span {...data} title={text} className="text-fg-muted block min-w-0 truncate text-xs">
            {text}
        </span>
    );
}
