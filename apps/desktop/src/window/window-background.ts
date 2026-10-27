// The window's background before any page paints, and while the page changes, so no white shows between the
// starting page and the board page. One hex per theme: packages/ui/src/styles.css's --background, which is lar-server's
// --color-base-50: oklch 99.2% in light mode and #0a0a0a in dark.

/** The background for the system's current theme. */
export const color = (dark: boolean): string => (dark ? "#0a0a0a" : "#fcfcfc");
