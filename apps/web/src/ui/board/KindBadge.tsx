import { Badge } from '@lar-works/design-system';
import type { CSSProperties, ReactNode } from 'react';

export interface KindBadgeProps {
    /** The kind's hue on the design system's categorical palette (an oklch angle, `categoricalHues`, such as rose for
     *  a bug), drawn as the design system's kind badge; without one the badge is neutral. */
    hue?: number | undefined;
    /** The kind's name, after its icon if it has one. */
    children: ReactNode;
    /** sm (20px) for a row, a card or a field; md (24px) for a heading's or a hero's kind. */
    size?: 'sm' | 'md';
    /** The full name, shown on hover, when the badge's text is shortened. */
    title?: string;
    /** Dims the text to the muted colour, for a kind that is listed but switched off. */
    muted?: boolean;
}

/** What kind a thing is, as the design system's one kind badge (Badge `hue`) at its full strength: an item's bug or
 *  feature, in its categorical hue, the same badge every Lar app draws for a kind. */
export function KindBadge({ hue, ...props }: KindBadgeProps) {
    return <Badge {...props} hue={hue} />;
}

/** What kind a thing is, as its kind's icon alone, named by `name` on hover and for assistive technology: a row's mark
 *  before its title, where a list of badges would shout. It draws in its kind's `hue`, the same colour as the dialog's
 *  KindBadge, so a kind reads the same everywhere; a kind with no hue stays muted. With no `name` it keeps the mark's
 *  room, empty, so titles start on one edge whether or not their item has a kind. */
export function KindMark({
    name,
    hue,
    labelled = false,
    children,
}: {
    /** The kind's hue on the categorical palette, as its KindBadge's; none draws it muted. */
    hue?: number | undefined;
    /** Shows the kind's name after its icon, as a card's head does; `fact` names it in the text colour at its sidebar's
     *  size, as a value beside its label, as Project's is. */
    labelled?: boolean | 'fact';
    /** The kind's name, such as "Bug"; none for an item with no recognised kind. */
    name?: string;
    /** The kind's icon. */
    children?: ReactNode;
}) {
    if (!name && labelled === 'fact') return null;

    if (!name) return <span aria-hidden="true" className="inline-block size-4 shrink-0" data-kind-mark />;

    const mark = (
        <span
            role="img"
            aria-label={name}
            title={name}
            className={`inline-grid size-4 shrink-0 place-items-center [&>svg]:size-3.5 ${hue === undefined ? 'text-fg-muted' : 'categorical-icon'}`}
            style={hue === undefined ? undefined : ({ '--lar-category-hue': hue } as CSSProperties)}
            data-kind-mark
        >
            {children}
        </span>
    );

    return labelled ? (
        <span
            className={`inline-flex shrink-0 items-center gap-1.5 ${labelled === 'fact' ? 'text-fg text-xs' : 'text-fg-muted text-xs'}`}
        >
            {mark}
            <span aria-hidden="true" data-kind-name>
                {name}
            </span>
        </span>
    ) : (
        mark
    );
}
