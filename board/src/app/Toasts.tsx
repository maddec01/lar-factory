// Toasts: a success clears itself after 5 s, later while it's hovered or has focus; a failure
// stays until it's closed. They sit top right, below the header while it's on screen and below the app's title bar.

import { useEffect, useLayoutEffect, useRef } from 'react';
import type { ReactNode } from 'react';
import { flushSync } from 'react-dom';
import { useToastStore } from './toast-store.ts';
import type { Toast } from './toast-store.ts';

/** How long a success toast stays. */
export const TOAST_MS = 5_000;
/** How often a toast that's being read or used checks whether it was left. */
const RECHECK_MS = 1_000;
/** Where focus goes when a closed toast had it and names nowhere of its own. */
const FALLBACK_FOCUS = '.add-item';

/** The close button every failure and toast carries; `what` names what it closes for screen readers. */
export function DismissButton({ what, onClick }: { what: string; onClick: () => void }) {
  return <button type="button" className="dismiss" aria-label={`Dismiss${what}`} onClick={onClick}>{'×'}</button>;
}

/** Closes something in `close`, then, if focus was inside `el`, moves it to the first of `next` that's on the page. */
export function closeKeepingFocus(el: Element | null, close: () => void, next: string[] = []): void {
  const hadFocus = Boolean(el?.contains(document.activeElement));
  flushSync(close);
  if (!hadFocus || document.activeElement !== document.body) return;
  // querySelector returns the first in page order; take the first selector that matches.
  const target = [...next, FALLBACK_FOCUS].map((sel) => document.querySelector<HTMLElement>(sel)).find(Boolean);
  target?.focus({ preventScroll: true });
}

/** One toast. `onClose` runs when it's closed or, for a success, when its time is up. */
export function ToastView({ what, failed = false, focusAfter, onClose, children }: {
  what: string;
  failed?: boolean;
  focusAfter?: string[];
  onClose: () => void;
  children: ReactNode;
}) {
  const ref = useRef<HTMLDivElement>(null);
  const close = useRef(onClose);
  close.current = onClose;
  useEffect(() => {
    if (failed) return;
    let timer: ReturnType<typeof setTimeout>;
    const expire = (paused: boolean) => {
      // Being read or used: check again soon, then give it a full 5 s once it's left.
      if (ref.current?.matches(':hover, :focus-within')) timer = setTimeout(() => expire(true), RECHECK_MS);
      else if (paused) timer = setTimeout(() => expire(false), TOAST_MS);
      else close.current();
    };
    timer = setTimeout(() => expire(false), TOAST_MS);
    return () => clearTimeout(timer);
  }, [failed]);
  return (
    <div className="banner toast" role={failed ? 'alert' : 'status'} ref={ref}>
      <DismissButton what={`: ${what}`} onClick={() => closeKeepingFocus(ref.current, onClose, focusAfter)} />
      {children}
    </div>
  );
}

/** Keeps --toast-top below the header while it's on screen, and always below the app's title bar, so toasts
 * never cover the header's buttons or banners nor sit in the bar that drags the window. */
function placeToasts(): void {
  const bottom = Math.max(...['header.top', '.title-bar'].map((sel) => document.querySelector(sel)?.getBoundingClientRect().bottom ?? 0));
  document.documentElement.style.setProperty('--toast-top', `${Math.max(12, Math.round(bottom) + 8)}px`);
}

/** The page's toasts: `children` first, for toasts other parts of the page own, then the store's. */
export function Toasts({ children }: { children?: ReactNode }) {
  const toasts = useToastStore((state) => state.toasts);
  const dismiss = useToastStore((state) => state.dismiss);
  // The header's height changes with its banners, so place them after every render too.
  useLayoutEffect(placeToasts);
  useEffect(() => {
    addEventListener('scroll', placeToasts, { passive: true });
    addEventListener('resize', placeToasts);
    return () => {
      removeEventListener('scroll', placeToasts);
      removeEventListener('resize', placeToasts);
    };
  }, []);
  return (
    <div className="toasts">
      {children}
      {toasts.map((t: Toast) => (
        <ToastView key={t.key} what={t.what} failed={t.failed} focusAfter={t.focusAfter} onClose={() => dismiss(t.key)}>{t.body}</ToastView>
      ))}
    </div>
  );
}
