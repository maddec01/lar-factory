import { Badge } from '@lar-works/design-system';
import type { ReactNode } from 'react';

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

/** What kind a thing is, as its kind's icon alone, muted, named by `name` on hover and for assistive technology: a row's
 *  quiet mark before its title, where a list of badges would shout. The dialog shows the full KindBadge. With no
 *  `name` it keeps the mark's room, empty, so titles start on one edge whether or not their item has a kind. */
export function KindMark({
    name,
    children,
}: {
    /** The kind's name, such as "Bug"; none for an item with no recognised kind. */
    name?: string;
    /** The kind's icon. */
    children?: ReactNode;
}) {
    if (!name) return <span aria-hidden="true" className="inline-block size-4 shrink-0" data-kind-mark />;

    return (
        <span
            role="img"
            aria-label={name}
            title={name}
            className="text-fg-muted inline-grid size-4 shrink-0 place-items-center [&>svg]:size-3.5"
            data-kind-mark
        >
            {children}
        </span>
    );
}
