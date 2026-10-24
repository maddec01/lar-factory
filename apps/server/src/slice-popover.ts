// Which build's slice popover is open. The browser feeds in pointer, focus and key
// events; keeping the state here, not in the DOM, lets a re-render reopen it in place.

/** Each field is the item id of a build card, or null. */
export interface PopoverState {
  /** The card whose bars a mouse or pen is over. */
  hovered: string | null;
  /** The card that holds focus: its trigger or one of its slice links. */
  focused: string | null;
  /** The card whose trigger was last clicked or tapped. */
  tapped: string | null;
  /** The card closed by Escape or Enter, kept closed until the pointer and focus have both left it. */
  closed: string | null;
}

export type PopoverEvent =
  | { type: 'hover' | 'focus'; id: string | null }
  /** A click or tap on a trigger pins its popover open, or closes it when already pinned. A mouse has
   *  opened it by hovering before the click lands, so a plain toggle would close it on the first click. */
  | { type: 'tap'; id: string }
  /** Enter or Space on a trigger opens or closes its popover. */
  | { type: 'toggle'; id: string }
  | { type: 'escape' }
  /** A pointer press outside every popover. */
  | { type: 'outside' };

export const NO_POPOVER: PopoverState = { hovered: null, focused: null, tapped: null, closed: null };

export function openPopover(s: PopoverState): string | null {
  const id = s.hovered ?? s.focused ?? s.tapped;
  return id === s.closed ? null : id;
}

export function nextPopover(s: PopoverState, e: PopoverEvent): PopoverState {
  const next = ((): PopoverState => {
    switch (e.type) {
      case 'hover':
        return { ...s, hovered: e.id };
      case 'focus':
        return { ...s, focused: e.id };
      case 'tap':
        return s.tapped === e.id ? { ...s, tapped: null, closed: e.id } : { ...s, tapped: e.id, closed: null };
      case 'toggle':
        return openPopover(s) === e.id ? { ...s, tapped: null, closed: e.id } : { ...s, tapped: e.id, closed: null };
      case 'escape':
        return { ...s, tapped: null, closed: openPopover(s) ?? s.closed };
      case 'outside':
        return { ...s, tapped: null };
    }
  })();
  const left = next.closed !== null && next.hovered !== next.closed && next.focused !== next.closed;
  return left ? { ...next, closed: null } : next;
}
