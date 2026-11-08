import type { Item, Status } from '@lar-factory/shared';
// One glyph per status, the way T3 marks a thread working, waiting or done, in the status's colour: the design system's
// StatusGlyph, animated while the board trusts that the item's work runs. The item-state presenter decides all of it, so
// a row, the dialog, the desk and a counter draw the same glyph for the same item.
import { StatusIndicator } from '@lar-works/design-system';
import type { ComponentProps } from 'react';

import { useItemState } from './ItemState';
import { statusColor, StatusGlyph, StatusGlyphSlot } from '@/ui/board';

export { StatusGlyph };

/** Each status's colour, as the design system's StatusGlyph draws it. */
export const STATUS_COLOR: Record<Status, string> = statusColor;

/** The item's glyph as the presenter answers it; `status` draws another status still, such as Done for a finished part. */
export function ItemStatusGlyph({
    item,
    status,
    size,
}: {
    item: Item;
    status?: Status;
    size?: ComponentProps<typeof StatusGlyph>['size'];
}) {
    const shown = useItemState(item);

    if (status && status !== item.status) return <StatusGlyph status={status} size={size} />;

    if (shown.light && shown.state)
        return (
            <StatusGlyphSlot size={size}>
                <StatusIndicator state={shown.state} srLabel={shown.word} />
            </StatusGlyphSlot>
        );

    return (
        <StatusGlyph
            status={shown.working ? item.status : shown.glyph}
            state={shown.glyphState}
            running={shown.running}
            size={size}
        />
    );
}
