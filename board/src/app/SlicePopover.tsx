// A build card's slice popover (disclosure pattern), with its bars as the trigger. It opens on hover,
// focus or tap, a second click or tap closes it, Enter or Space toggles it, and Escape closes it and
// returns focus to the trigger. slice-popover.ts decides; Base UI places the popover and reports
// presses outside and Escape.

import { useRef } from 'react';
import type { ReactNode } from 'react';
import { Popover } from '@base-ui/react/popover';
import { popoverOrder } from '../board-view.ts';
import type { Item, Slice } from '../model.ts';
import { useSlicePopoverOpen, useSlicePopoverStore } from './slice-popover-store.ts';

export const sliceKey = (s: Slice) => `${s.repo}#${s.number}`;

export function SlicePopover({ item, children }: { item: Item; children: ReactNode }) {
  const id = item.id;
  const open = useSlicePopoverOpen(id);
  const block = useRef<HTMLDivElement>(null);
  const popup = useRef<HTMLDivElement>(null);
  const inside = (el: EventTarget | null) => el instanceof Node && Boolean(block.current?.contains(el) || popup.current?.contains(el));
  const inOtherDialog = (el: EventTarget | null) => {
    const dialog = el instanceof Element ? el.closest('[role="dialog"],[role="alertdialog"]') : null;
    return dialog !== null && dialog !== popup.current;
  };
  const send = useSlicePopoverStore.getState().send;
  const state = () => useSlicePopoverStore.getState().state;
  const onOpenChange = (_open: boolean, details: Popover.Root.ChangeEventDetails) => {
    if (details.reason === 'trigger-press') send({ type: 'tap', id });
    else if (details.reason === 'outside-press') send({ type: 'outside' });
    // Tab out of the popover: Base UI then focuses what follows the trigger, so it must close, even
    // when pinned or under the pointer, as Escape closes it.
    else if (details.reason === 'focus-out') send({ type: 'escape' });
    // Not while another dialog has the key (Base UI's popups are divs with a dialog role, as is this
    // popover's own); focus returns to the trigger only when it was in the popover.
    else if (details.reason === 'escape-key' && !inOtherDialog(details.event.target)) {
      send({ type: 'escape' });
      if (inside(document.activeElement)) block.current?.querySelector<HTMLElement>('.slices-trigger')?.focus();
    }
  };
  const popId = `slices-${id}`;
  return (
    <div className={`slices${open ? ' open' : ''}`} data-slices={id} ref={block}
      onPointerEnter={(e) => e.pointerType !== 'touch' && send({ type: 'hover', id })}
      onPointerLeave={(e) => e.pointerType !== 'touch' && state().hovered === id && send({ type: 'hover', id: null })}
      onFocus={() => send({ type: 'focus', id })}
      onBlur={(e) => !inside(e.relatedTarget) && state().focused === id && send({ type: 'focus', id: null })}>
      <Popover.Root open={open} onOpenChange={onOpenChange}>
        <Popover.Trigger className="slices-trigger" nativeButton={false} render={<div />} aria-controls={popId}
          onKeyDown={(e) => {
            if (e.key !== 'Enter' && e.key !== ' ') return;
            e.preventDefault();
            e.preventBaseUIHandler();
            send({ type: 'toggle', id });
          }}
          // Base UI clicks a div trigger on Space's keyup, which would count as a tap and undo the toggle.
          onKeyUp={(e) => e.key === ' ' && e.preventBaseUIHandler()}>
          {children}
        </Popover.Trigger>
        {/* In <body>, so Tab leaves the last slice for what follows the card. React's events still
            bubble from it to the block, so the pointer or focus on it count as on the card's bars. */}
        <Popover.Portal keepMounted>
          <Popover.Positioner className="slices-positioner" side="bottom" align="start" sideOffset={2} anchor={block}>
            <Popover.Popup className="slices-pop" id={popId} ref={popup} initialFocus={false} finalFocus={false}>
              <ul className="slice-rows" aria-label="Slices">
                {popoverOrder(item.slices).map((s) => (
                  <li className={`row-item slice-row ${s.progress}`} key={sliceKey(s)}>
                    <span className="slice-mark" aria-hidden="true" />
                    <a className="row-title" href={s.url} title={s.title} target="_blank" rel="noopener"><span className="ref">#{s.number}</span> {s.title}<span className="sr-only"> ({s.progress})</span></a>
                  </li>
                ))}
              </ul>
            </Popover.Popup>
          </Popover.Positioner>
        </Popover.Portal>
      </Popover.Root>
    </div>
  );
}
