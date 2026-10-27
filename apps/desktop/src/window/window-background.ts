// The window's background before any page paints, and while the page changes, so no white shows between the
// starting page and the board page. One hex per theme: packages/ui/src/styles.css's --background, which is
// zinc-25 (oklch 99.2%) in light mode and neutral-950 (oklch 14.5%) in dark.

/** The background for the system's current theme. */
export const color = (dark: boolean): string => (dark ? "#0a0a0a" : "#fcfcfc");
