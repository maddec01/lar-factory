// The window's background before any page paints, and while the page changes, so no white shows between the
// starting page and the board page. One hex per theme: the design system's page background, --color-surface-page:
// #fcfcfc (--color-palette-zinc-2) in light mode and #0a0a0a (--color-palette-neutral-1) in dark.

/** The background for the system's current theme. */
export const color = (dark: boolean): string => (dark ? '#0a0a0a' : '#fcfcfc');
