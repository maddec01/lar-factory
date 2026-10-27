// The size every title bar control shares, over the copied Button's 32 px: 28 px tall, 12 px text and 16 px icons,
// as lar-server's title bar sizes its own.

/** A text button's size. The copied Button sets its height again from `sm`, so this does too. */
export const CONTROL = 'h-7 text-xs sm:h-7 [&_svg]:size-4';

/** An icon-only button's size: 28 px square. */
export const ICON_CONTROL = 'size-7 **:data-[slot=icon]:size-4';
