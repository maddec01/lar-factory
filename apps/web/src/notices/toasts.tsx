// Toasts, shown through the design system's Toaster: a success clears itself after 5 s, later while it's hovered or
// has focus; a failure stays until it's closed. One toast per slot, so a new one replaces the last.

import { useEffect, useRef } from 'react';
import type { MouseEvent, ReactNode, RefObject } from 'react';
import { flushSync } from 'react-dom';
import { IconButton } from '@lar-factory/ui/design-system/IconButton';
import { CloseIcon } from '@lar-factory/ui/design-system/NavigationIcons';
import { toast as toasts, Toaster } from '@lar-factory/ui/toasts';
import { OPEN_ITEM_DIALOG } from '../item-dialog/item-dialog-store.ts';

/** How long a success toast stays. */
const TOAST_MS = 5_000;
/** Where focus goes when a closed toast had it and names nowhere of its own. */
const FALLBACK_FOCUS = ['.add-item', '.open-settings', '[data-slot="modal-close"]'];

/** Each notice's fade, as wide as a Modal body's: notices scrolled past fade out at the stack's edges. */
const FADE_PX = 24;

/**
 * Follows the newest notice while the User is at the bottom: a new entry, a narrower or shorter window and a notice
 * growing all keep it in view. Once the User scrolls away the stack stays where they left it, until they scroll back.
 * Notices scrolled past fade at the stack's edges. Each notice carries its own slice of the fade: a mask on the
 * stack would make it the notices' backdrop root and cut their blur off from the board behind.
 */
function followNewest(viewport: HTMLDivElement | null) {
  if (!viewport) return;
  let following = true;
  const notices = () => Array.from(viewport.children).filter((el): el is HTMLElement => el instanceof HTMLElement);
  const fade = () => {
    const { scrollTop, scrollHeight, clientHeight } = viewport;
    const stack = viewport.getBoundingClientRect();
    const top = Math.min(FADE_PX, Math.max(0, scrollTop));
    const bottom = Math.min(FADE_PX, Math.max(0, scrollHeight - clientHeight - scrollTop));
    for (const entry of notices()) {
      const y = entry.getBoundingClientRect().top - stack.top;
      entry.style.setProperty('--fade-from', `${-y}px`);
      entry.style.setProperty('--fade-top', `${top - y}px`);
      entry.style.setProperty('--fade-bottom', `${stack.height - bottom - y}px`);
      entry.style.setProperty('--fade-to', `${stack.height - y}px`);
    }
  };
  const toNewest = () => {
    if (following) viewport.scrollTop = viewport.scrollHeight;
    fade();
  };
  const scrolled = () => {
    following = viewport.scrollHeight - viewport.clientHeight - viewport.scrollTop <= 1;
    fade();
  };
  const resizes = new ResizeObserver(toNewest);
  const observe = () => {
    resizes.disconnect();
    resizes.observe(viewport);
    notices().forEach((entry) => resizes.observe(entry));
  };
  const entries = new MutationObserver((changes) => {
    observe();
    const newest = viewport.lastElementChild;
    const arrived = changes.some(({ addedNodes }) => Array.from(addedNodes).includes(newest as Node));
    // Only a new entry moves the stack; one closing or changing above leaves the User where they are.
    if (arrived) toNewest();
    else fade();
  });
  entries.observe(viewport, { childList: true });
  viewport.addEventListener('scroll', scrolled, { passive: true });
  // Entering notices slide in; measure them where they land.
  viewport.addEventListener('animationend', fade);
  viewport.addEventListener('transitionend', fade);
  observe();
  toNewest();
  return () => {
    entries.disconnect();
    resizes.disconnect();
    viewport.removeEventListener('scroll', scrolled);
    viewport.removeEventListener('animationend', fade);
    viewport.removeEventListener('transitionend', fade);
  };
}

/**
 * One viewport on every screen, above every dialog. Ninna-ui portals it outside the board, which is inert during
 * loading. When its notices don't fit it scrolls, and those scrolled past fade at its edges, as a Modal's body does.
 */
export function NotificationStack() {
  return <Toaster ref={followNewest} position="bottom-right" max={Infinity} className="notification-stack"
    offset="calc(var(--spacing) * 1)" />;
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
  const root = document.querySelector(OPEN_ITEM_DIALOG) ?? document.querySelector('[role="dialog"][data-state="open"]') ?? document;
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

/** Closes whatever toast holds this slot. */
export function clearToast(slot: string): void {
  const id = slots.get(slot);
  if (id) closeToast(slot, id);
}

/** Gives a successful notification five seconds after hover and keyboard focus leave it. */
function useSuccessClose(ref: RefObject<Element | null>, enabled: boolean, onClose: () => void): void {
  const close = useRef(onClose);
  close.current = onClose;
  useEffect(() => {
    if (!enabled) return;
    const entry = ref.current?.closest<HTMLElement>('[data-slot="toast"]');
    if (!entry) return;
    let hovered = entry.matches(':hover');
    let focused = entry.contains(document.activeElement);
    let timer: ReturnType<typeof setTimeout> | undefined;
    const restart = () => {
      clearTimeout(timer);
      if (!hovered && !focused) timer = setTimeout(() => close.current(), TOAST_MS);
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
  }, [enabled, ref]);
}

/** One toast's content. `onClose` runs when its close button is clicked or, for a success, when its time is up. */
function ToastBody({ slot, what, failed = false, body, onClose }: Toast & { onClose: () => void }) {
  const ref = useRef<HTMLSpanElement>(null);
  useSuccessClose(ref, !failed, onClose);
  return (
    <span ref={ref} data-toast={slot}>
      <DismissButton what={`: ${what}`} onClick={onClose} />
      {body}
    </span>
  );
}
