// The board's one popover for picking labels or choices: an item's labels, a new ticket's, a vocabulary term's and a
// filter's checklist all open the same 18rem panel under their trigger.

import { Popover } from '@lar-works/design-system';
import type { ReactElement, ReactNode } from 'react';

/** Radix's room between the popover and the window's edge, which the design system's Popover passes on. */
const keepInWindow = { collisionPadding: 16 };

/** A trigger that opens a checklist of labels or choices (the design system's LabelPicker, or FilterChoice rows) in a
 *  popover of one width, the picker's own 18rem, with what it says about itself under it (`footer`: its status, an
 *  error, None and Done). Without `open` it keeps its own open state. */
export function LabelPickerPopover({
    trigger,
    footer,
    open,
    onOpenChange,
    align = 'start',
    children,
}: {
    /** The button that opens it, such as Add label or a filter's menu button. */
    trigger: ReactElement;
    /** Under the picker: its status, an error, or the buttons that finish with it. */
    footer?: ReactNode;
    /** It is open, when its owner keeps that state. */
    open?: boolean | undefined;
    /** Called as it opens or closes. */
    onOpenChange?: ((open: boolean) => void) | undefined;
    /** Its edge that lines up with the trigger's: `end` for a trigger at a row's end. */
    align?: 'start' | 'end';
    /** The picker or the checklist. */
    children: ReactNode;
}) {
    return (
        <Popover {...(open !== undefined && { open })} onOpenChange={onOpenChange}>
            <Popover.Trigger asChild>{trigger}</Popover.Trigger>
            <Popover.Content side="bottom" align={align} {...keepInWindow}>
                <div className="grid w-72 gap-2" data-label-picker-popover>
                    {children}
                    {footer}
                </div>
            </Popover.Content>
        </Popover>
    );
}
