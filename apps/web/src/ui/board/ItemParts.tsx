// The bits every view of Lar Factory's board draws for a piece of work: its numbered title, title link, repository,
// tracker fields, label chips and planning notes.

import type { ReactNode } from 'react';

import type { DataAttributes } from './DataAttributes';
import { tooltipWhenCut } from './TooltipWhenCut';

/** A title with its ticket's reference (`#12`) before it, muted, the way the board lists every item; captured work has
 *  no reference, and a reference alone (such as `#12` in a sentence) has no title. With `href` it links to the ticket in
 *  a new tab, with `onOpen` it is a button that opens the item; either underlines on hover, as a link in text does,
 *  while a row that opens on click shows its hover fill instead. */
export function ItemTitle({
    reference,
    title,
    name,
    href,
    onOpen,
}: {
    /** The ticket's reference, such as `#12`; captured work has none. */
    reference?: string | undefined;
    /** The item's title; none for a reference alone. */
    title?: string | undefined;
    /** Names the item in full, as a link's or button's tooltip. */
    name?: string | undefined;
    /** The ticket's page, opened in a new tab. */
    href?: string | undefined;
    /** Called as the reader opens the item. */
    onOpen?: (() => void) | undefined;
}) {
    const text = (
        <>
            {reference ? <span className="text-fg-muted font-normal tabular-nums">{reference}</span> : null}
            {reference && title ? ' ' : null}
            {title}
        </>
    );

    if (href)
        return (
            <a href={href} target="_blank" rel="noopener" title={name} className={OPENS}>
                {text}
            </a>
        );

    if (onOpen)
        return (
            <button type="button" onClick={onOpen} title={name} className={`text-left ${OPENS}`}>
                {text}
            </button>
        );

    return text;
}

/** A title that opens its item: the link's hover underline and the design system's focus ring. */
const OPENS = 'focus-ring rounded-xs hover:underline';

const identities = {
    row: 'flex min-w-0 items-center gap-1',
    map: 'inline-flex min-w-0 max-w-full items-center gap-1.5',
} as const;

/** A repository's project icon and name together, the name truncating: in a row's line, or roomier on the work map,
 *  its tooltip giving the name whole only while it is cut off. */
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
    /** The name in full, as its tooltip at all times; without it, a truncating name is its own tooltip while cut off. */
    title?: string;
    /** `row` in a row's line, `map` roomier on the work map. */
    presentation?: 'row' | 'map';
} & DataAttributes) {
    const whenCut = title === undefined ? tooltipWhenCut(name) : undefined;

    return (
        <span {...data} title={title} onPointerEnter={whenCut} onFocus={whenCut} className={identities[presentation]}>
            {icon}
            <span className="min-w-0 truncate">{name}</span>
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
