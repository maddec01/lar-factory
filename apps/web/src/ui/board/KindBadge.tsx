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
