// Toasts, shown through the design system's Toaster: a success clears itself after 5 s, later while it's hovered or
// has focus; a failure stays until it's closed. One toast per slot, so a new one replaces the last.

import { useEffect, useRef } from 'react';
import type { MouseEvent, ReactNode } from 'react';
import { flushSync } from 'react-dom';
import { IconButton } from '@lar-factory/ui/design-system/IconButton';
import { CloseIcon } from '@lar-factory/ui/design-system/NavigationIcons';
import { toast as toasts, Toaster } from '@lar-factory/ui/toasts';
import { OPEN_ITEM_DIALOG } from '../item-dialog/item-dialog-store.ts';

/** How long a success toast stays. */
const TOAST_MS = 5_000;
/** Where focus goes when a closed toast had it and names nowhere of its own. */
const FALLBACK_FOCUS = ['.add-item', '.open-settings'];

/** Keeps a new entry visible without taking focus or scrolling when an older entry changes. */
function scrollToNewest(viewport: HTMLDivElement | null) {
  if (!viewport) return;
  viewport.scrollTop = viewport.scrollHeight;
  const observer = new MutationObserver((changes) => {
    const newest = viewport.lastElementChild;
    if (newest && changes.some(({ addedNodes }) => Array.from(addedNodes).includes(newest))) {
      viewport.scrollTop = viewport.scrollHeight;
    }
  });
  observer.observe(viewport, { childList: true });
  return () => observer.disconnect();
}

/** One viewport on every screen. Ninna-ui portals it outside the board, which is inert during loading. */
export function NotificationStack() {
  return <Toaster ref={scrollToNewest} position="bottom-right" max={Infinity} className="notification-stack" offset="calc(var(--spacing) * 1)" />;
}

export interface Toast {
  /** One toast per slot: a new one replaces the last. */
  slot: string;
  /** A failure is a red alert that stays until it's closed; a success is green and clears itself after 5 s. */
  failed?: boolean;
  /** Names the toast for its close button, such as "Moved #61". */
  what: string;
  body: ReactNode;
  /** Where keyboard focus goes when the toast closes while focus is in it: the first selector that matches. */
  focusAfter?: string[];
}

/** The close button every failure and toast carries; `what` names what it closes for screen readers. */
export function DismissButton({ what, onClick }: { what: string; onClick: (event: MouseEvent<HTMLButtonElement>) => void }) {
  return <IconButton className="dismiss" aria-label={`Dismiss${what}`} icon={<CloseIcon />} onClick={onClick} />;
}

const focusFirst = (selectors: string[]) => {
  // The item dialog holds focus while it's open, and its buttons share their data attributes with the board's.
  const root = document.querySelector(OPEN_ITEM_DIALOG) ?? document;
  // querySelector returns the first in page order; take the first selector that matches.
  selectors.map((sel) => root.querySelector<HTMLElement>(sel)).find(Boolean)?.focus({ preventScroll: true });
};

/** Moves focus to the first of `selectors` on the page, or in the item dialog while it's open, if something took it away with the element that had it. */
export function refocus(selectors: string[]): void {
  // The item dialog's focus trap catches focus on the dialog itself when the element that had it goes.
  const lost = document.activeElement === document.body || document.activeElement === document.querySelector(OPEN_ITEM_DIALOG);
  if (lost) focusFirst(selectors);
}

/** Moves focus to the first of `next` that's on the page, or to the fallback. */
const focusAfterClose = (next: string[]) => focusFirst([...next, ...FALLBACK_FOCUS]);

/** Closes something in `close`, then, if focus was inside `el`, moves it to the first of `next` that's on the page. */
export function closeKeepingFocus(el: Element | null, close: () => void, next: string[] = []): void {
  const hadFocus = Boolean(el?.contains(document.activeElement));
  flushSync(close);
  if (hadFocus) focusAfterClose(next);
}

/** The id of the toast in each slot, in ninna-ui's toast manager. */
const slots = new Map<string, string>();

/** Closes the toast `id` in `slot`, moving focus on if it was in the toast. */
function closeToast(slot: string, id: string, focusAfter: string[] = []): void {
  closeKeepingFocus(document.querySelector(`[data-toast-id="${id}"]`), () => {
    if (slots.get(slot) === id) slots.delete(slot);
    toasts.dismiss(id);
  }, focusAfter);
}

/** Shows `toast` in its slot, replacing the one there. */
export function showToast(toast: Toast): void {
  clearToast(toast.slot);
  const id: string = toasts.create({
    color: toast.failed ? 'danger' : 'success',
    // The board's own clock closes successes (ToastBody) and its own button closes every toast, so ninna-ui never does.
    duration: 0,
    closable: false,
    description: <ToastBody {...toast} onClose={() => closeToast(toast.slot, id, toast.focusAfter)} />,
  });
  slots.set(toast.slot, id);
}

/** Shows a success toast in `slot` that links the PR at `prUrl` as `label`, between `before` and `after`. */
export function showPrToast({ slot, what, prUrl, label, before = 'Opened ', after = '.' }: {
  slot: string; what: string; prUrl: string; label: string; before?: string; after?: string;
}): void {
  showToast({ slot, what, body: <span>{before}<a href={prUrl} target="_blank" rel="noopener">{label}</a>{after}</span> });
}

/** Closes whatever toast holds this slot. */
export function clearToast(slot: string): void {
  const id = slots.get(slot);
  if (id) closeToast(slot, id);
}

/** One toast's content. `onClose` runs when its close button is clicked or, for a success, when its time is up. */
function ToastBody({ slot, what, failed = false, body, onClose }: Toast & { onClose: () => void }) {
  const ref = useRef<HTMLSpanElement>(null);
  useEffect(() => {
    if (failed) return;
    const entry = ref.current?.closest<HTMLElement>('[data-slot="toast"]');
    if (!entry) return;
    let hovered = entry.matches(':hover');
    let focused = entry.contains(document.activeElement);
    let timer: ReturnType<typeof setTimeout> | undefined;
    const restart = () => {
      clearTimeout(timer);
      if (!hovered && !focused) timer = setTimeout(onClose, TOAST_MS);
    };
    const enter = () => { hovered = true; restart(); };
    const leave = () => { hovered = false; restart(); };
    const focus = () => { focused = true; restart(); };
    const blur = (event: FocusEvent) => {
      focused = event.relatedTarget instanceof Node && entry.contains(event.relatedTarget);
      restart();
    };
    entry.addEventListener('mouseenter', enter);
    entry.addEventListener('mouseleave', leave);
    entry.addEventListener('focusin', focus);
    entry.addEventListener('focusout', blur);
    restart();
    return () => {
      clearTimeout(timer);
      entry.removeEventListener('mouseenter', enter);
      entry.removeEventListener('mouseleave', leave);
      entry.removeEventListener('focusin', focus);
      entry.removeEventListener('focusout', blur);
    };
  }, [failed, onClose]);
  return (
    <span ref={ref} data-toast={slot}>
      <DismissButton what={`: ${what}`} onClick={onClose} />
      {body}
    </span>
  );
}
