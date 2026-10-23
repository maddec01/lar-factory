// A failure banner with a close button. Closed, it stays away until its key is restored or the page reloads.

import { useRef } from 'react';
import type { ReactNode } from 'react';
import { useDismissed, useDismissStore } from './dismiss-store.ts';
import { DismissButton, closeKeepingFocus } from './Toasts.tsx';

export function ClosableBanner({ dismissKey, what, className = 'banner', children }: {
  dismissKey: string;
  /** Names what it closes for screen readers, such as ": update failed". */
  what: string;
  className?: string;
  children: ReactNode;
}) {
  const ref = useRef<HTMLDivElement>(null);
  const dismissed = useDismissed(dismissKey);
  if (dismissed) return null;
  const close = () => closeKeepingFocus(ref.current, () => useDismissStore.getState().dismiss(dismissKey));
  return (
    <div className={className} role="alert" ref={ref}>
      <DismissButton what={what} onClick={close} />
      {children}
    </div>
  );
}
