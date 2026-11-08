import { BadgeBase } from '@lar-works/design-system/primitives';
import type { ReactNode } from 'react';

export interface KindBadgeProps {
    /** The kind's lar-brand app hue (an oklch hue angle, such as 25 for a bug), drawn as a soft tint with text and a
     *  hairline in the hue; without one the badge is neutral. */
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

/** What kind a thing is, as a badge in that kind's own hue: an item's bug or feature, a catalog's music or video. The
 *  same pill as Badge, coloured by a lar-brand hue instead of a status tone; KindIcon draws the same hue on an icon. */
export function KindBadge(props: KindBadgeProps) {
    return <BadgeBase {...props} />;
}
