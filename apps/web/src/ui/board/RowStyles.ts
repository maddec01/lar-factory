// What the board's rows share: the focus ring of a row's own buttons, the action slot, and how
// the row the item dialog shows is marked; and the warning panel its notes share.

/** A row's own buttons draw their focus ring inside the pane that clips them. */
export const ROW_OPENS = 'focus-ring-inset';

/** A choice in a popover's checklist, such as a filter's choices: the design system's LabelPicker row (its 12px text,
 *  the fill on hover). */
export const MENU_ROW = 'hover:bg-fill-hover flex cursor-pointer items-center gap-2 rounded-md px-1.5 py-1 text-xs';
/** A result to pick from a list in a popover or a panel, such as Add item's ticket search results: a 32px row of
 *  14px text, the fill on hover, its focus ring outside. */
export const PICK_ROW =
    'hover:bg-fill-hover focus-ring flex w-full min-w-0 items-baseline gap-2 rounded-md px-2 py-1.5 text-left text-sm';
/** What a row's action slot holds, centred and against its right edge. */
export const ROW_ACTION =
    'flex min-w-0 flex-wrap items-center justify-end gap-x-2 gap-y-1 text-right text-xs text-fg-muted';

/** A row of work on the board's surfaces (a lane row, a concept's line, a List row): the hover fill, easing in as a
 *  card's does, on the large radius. Its height is its own. A row that opens an item shows it by this fill, not by
 *  underlining its title; a title in a sentence underlines (ItemTitle). */
export const ROW_BOX = 'hover:bg-fill-hover rounded-lg transition-colors';
/** A compact row in a list inside a panel or a section (a counter's item, an attention entry, a slice, a finished
 *  part): the same hover fill on the medium radius, 4px above and below and 8px at its sides. */
export const COMPACT_ROW = 'hover:bg-fill-hover rounded-md px-2 py-1 transition-colors';

/** A row the item dialog shows now: the design system's current recipe, its navy wash under a navy hairline. */
export const pickedRow = (picked: boolean) =>
    picked ? 'bg-current-surface hover:bg-current-surface ring-1 ring-inset ring-primary-edge' : '';
