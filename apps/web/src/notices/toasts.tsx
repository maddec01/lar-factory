// Toasts, drawn by coss's toast: a success clears itself after 5 s, later while it's hovered or has focus;
// a failure stays until it's closed. One toast per slot, so a new one replaces the last. They sit top right,
// below the banners while they're on screen and below the title bar.

import { useEffect, useLayoutEffect, useRef } from 'react';
import type { ReactNode } from 'react';
import { flushSync } from 'react-dom';
import { XIcon } from 'lucide-react';
import { Button } from '@lar-factory/ui/button';
import { ToastProvider, toastManager } from '@lar-factory/ui/toast';
import { OPEN_ITEM_DIALOG } from '../item-dialog/item-dialog-store.ts';

/** How long a success toast stays. */
const TOAST_MS = 5_000;
/** How often a toast that's being read or used checks whether it was left. */
const RECHECK_MS = 1_000;
/** Where focus goes when a closed toast had it and names nowhere of its own. */
const FALLBACK_FOCUS = '.add-item';

export interface Toast {
  /** One toast per slot: a new one replaces the last. */
  slot: string;
  /** A failure is an alert with a red dot, as T3's error toast, that stays until it's closed; a success clears itself after 5 s. */
  failed?: boolean;
  /** Names the toast for its close button, such as "Moved #61". */
  what: string;
  body: ReactNode;
  /** Where keyboard focus goes when the toast closes while focus is in it: the first selector that matches. */
  focusAfter?: string[];
}

/** The close button every failure and toast carries; `what` names what it closes for screen readers. */
export function DismissButton({ what, onClick }: { what: string; onClick: () => void }) {
  return <Button variant="ghost" size="icon-xs" className="dismiss" aria-label={`Dismiss${what}`} onClick={onClick}><XIcon /></Button>;
}

const focusFirst = (selectors: string[]) => {
  // The item dialog holds focus while it's open, and its buttons share their data attributes with the board's.
  const root = document.querySelector(OPEN_ITEM_DIALOG) ?? document;
  // querySelector returns the first in page order; take the first selector that matches.
  selectors.map((sel) => root.querySelector<HTMLElement>(sel)).find(Boolean)?.focus({ preventScroll: true });
};

/** Moves focus to the first of `selectors` on the page, or in the item dialog while it's open, if something took it away with the element that had it. */
export function refocus(selectors: string[]): void {
  if (document.activeElement === document.body) focusFirst(selectors);
}

/** Moves focus to the first of `next` that's on the page, or to the fallback. */
const focusAfterClose = (next: string[]) => focusFirst([...next, FALLBACK_FOCUS]);

/** Closes something in `close`, then, if focus was inside `el`, moves it to the first of `next` that's on the page. */
export function closeKeepingFocus(el: Element | null, close: () => void, next: string[] = []): void {
  const hadFocus = Boolean(el?.contains(document.activeElement));
  flushSync(close);
  if (hadFocus) focusAfterClose(next);
}

/** The id of the toast in each slot, in coss's toast manager. */
const slots = new Map<string, string>();
let count = 0;

/** Shows `toast` in its slot, replacing the one there. */
export function showToast(toast: Toast): void {
  clearToast(toast.slot);
  const id = `toast-${++count}`;
  slots.set(toast.slot, id);
  toastManager.add({
    id,
    // The board's own clock closes successes (ToastBody), so the manager never does.
    timeout: 0,
    description: <ToastBody {...toast} onClose={() => toastManager.close(id)} />,
    data: { rootProps: { role: toast.failed ? 'alert' : 'status', 'data-toast': toast.slot, 'data-toast-id': id, 'data-tone': toast.failed ? 'error' : undefined } },
    // Every way a toast closes runs this, a swipe included, while the toast is still on the page.
    onClose: () => {
      if (slots.get(toast.slot) === id) slots.delete(toast.slot);
      const el = document.querySelector(`[data-toast-id="${id}"]`);
      // A closed toast stays on the page while it animates out, so its focus is moved, not found lost.
      if (el?.contains(document.activeElement)) focusAfterClose(toast.focusAfter ?? []);
    },
  });
}

/** Closes whatever toast holds this slot. */
export function clearToast(slot: string): void {
  const id = slots.get(slot);
  if (id) toastManager.close(id);
}

/** One toast's content. `onClose` runs when its close button is clicked or, for a success, when its time is up. */
function ToastBody({ what, failed = false, body, onClose }: Toast & { onClose: () => void }) {
  const ref = useRef<HTMLSpanElement>(null);
  const toast = () => ref.current?.closest('[data-toast]') ?? null;
  // The banners come and go, so place toasts again as each one shows.
  useLayoutEffect(placeToasts, []);
  useEffect(() => {
    if (failed) return;
    let timer: ReturnType<typeof setTimeout>;
    const expire = (paused: boolean) => {
      // Being read or used: check again soon, then give it a full 5 s once it's left.
      if (toast()?.matches(':hover, :focus-within')) timer = setTimeout(() => expire(true), RECHECK_MS);
      else if (paused) timer = setTimeout(() => expire(false), TOAST_MS);
      else onClose();
    };
    timer = setTimeout(() => expire(false), TOAST_MS);
    return () => clearTimeout(timer);
  }, [failed, onClose]);
  return (
    <span ref={ref}>
      <DismissButton what={`: ${what}`} onClick={onClose} />
      <span className={`me-2 inline-block size-2 rounded-full ${failed ? 'bg-error' : 'bg-success'}`} />
      {body}
    </span>
  );
}

/** Keeps --toast-anchor at the bottom of the banners while they're on screen, and never above the title bar's,
 * so toasts (placed below it in notices.css) never cover the banners' buttons nor sit in the bar
 * that drags the window. */
function placeToasts(): void {
  const bottom = Math.max(...['.banners', '.title-bar'].map((sel) => document.querySelector(sel)?.getBoundingClientRect().bottom ?? 0));
  document.documentElement.style.setProperty('--toast-anchor', `${Math.round(bottom)}px`);
}

/** The page's toasts. */
export function Toasts() {
  useEffect(() => {
    placeToasts();
    // The main area scrolls, not the window: capture hears its scroll.
    addEventListener('scroll', placeToasts, { passive: true, capture: true });
    addEventListener('resize', placeToasts);
    return () => {
      removeEventListener('scroll', placeToasts, { capture: true });
      removeEventListener('resize', placeToasts);
    };
  }, []);
  return <ToastProvider position="top-right" />;
}
