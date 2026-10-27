// The page's banners: a warning with a title and a description, and one with a close button that, closed,
// stays away until its key is restored or the page reloads.

import type { ReactNode } from 'react';
import { Alert } from '@lar-factory/ui/design-system/Alert';
import { useDismissed, useDismissStore } from './dismiss-store.ts';
import { DismissButton, closeKeepingFocus } from './toasts.tsx';

/** `action` sits under the banner's text. */
export function Banner({ title, action, children }: { title: string; action?: ReactNode; children: ReactNode }) {
  return <Alert tone="warning" data-tone="warning" className="banner" title={title} action={action}>{children}</Alert>;
}

export function ClosableBanner({ dismissKey, what, title, children }: {
  dismissKey: string;
  /** Names what it closes for screen readers, such as ": update failed". */
  what: string;
  title: string;
  children: ReactNode;
}) {
  const dismissed = useDismissed(dismissKey);
  if (dismissed) return null;
  return (
    <Banner title={title} action={<DismissButton what={what} onClick={(event) =>
      closeKeepingFocus(event.currentTarget.closest('.banner'), () => useDismissStore.getState().dismiss(dismissKey))} />}>
      {children}
    </Banner>
  );
}
