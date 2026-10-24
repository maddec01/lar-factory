// Which build's slice popover is open, as slice-popover.ts decides from the pointer, focus and keys.
// It lives outside the cards, so new data re-rendering them keeps it open.

import { create } from 'zustand';
import { NO_POPOVER, nextPopover, openPopover } from '../../../server/src/slice-popover.ts';
import type { PopoverEvent, PopoverState } from '../../../server/src/slice-popover.ts';

interface SlicePopoverStore {
  state: PopoverState;
  send: (event: PopoverEvent) => void;
}

export const useSlicePopoverStore = create<SlicePopoverStore>()((set) => ({
  state: NO_POPOVER,
  send: (event) => set(({ state }) => ({ state: nextPopover(state, event) })),
}));

/** Whether the build card `id`'s popover is open. */
export const useSlicePopoverOpen = (id: string) => useSlicePopoverStore((s) => openPopover(s.state) === id);
