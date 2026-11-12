// What the board's rows share: the focus ring of a row's own buttons, the action slot, and how
// the row the item dialog shows is marked; and the warning panel its notes share.

/** A row's own buttons draw their focus ring inside the pane that clips them. */
export const ROW_OPENS = 'focus-ring-inset';
/** What a row's action slot holds, centred and against its right edge. */
export const ROW_ACTION =
    'flex min-w-0 flex-wrap items-center justify-end gap-x-2 gap-y-1 text-right text-xs text-fg-muted';

/** A row the item dialog shows now: the design system's current recipe, its navy wash under a navy hairline. */
export const pickedRow = (picked: boolean) =>
    picked ? 'bg-current-surface hover:bg-current-surface ring-1 ring-inset ring-primary-edge' : '';
