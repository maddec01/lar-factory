/**
 * Safari, and Firefox while macOS keyboard navigation is off, move Tab only between text fields unless an
 * element sets its tab index explicitly. Controls spread this before their own props, so Tab reaches every
 * button, switch, select, radio and link in every browser and callers can still opt out with `tabIndex={-1}`.
 */
export const tabbable = { tabIndex: 0 } as const;
