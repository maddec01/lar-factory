// The page's banners: a warning with a title and a description, and one with a close button that, closed,
// stays away until its key is restored or the page reloads.

import { useRef } from 'react';
import type { ReactNode, Ref } from 'react';
import { Alert, AlertAction, AlertDescription, AlertTitle } from '@mux-factory/ui/alert';
import { useDismissed, useDismissStore } from './dismiss-store.ts';
import { DismissButton, closeKeepingFocus } from './toasts.tsx';

/** `action` sits at the banner's right end. */
export function Banner({ title, action, ref, children }: { title: string; action?: ReactNode; ref?: Ref<HTMLDivElement>; children: ReactNode }) {
  return (
    <Alert variant="warning" className="banner" ref={ref}>
      <AlertTitle>{title}</AlertTitle>
      <AlertDescription className="block">{children}</AlertDescription>
      {action && <AlertAction>{action}</AlertAction>}
    </Alert>
  );
}

export function ClosableBanner({ dismissKey, what, title, children }: {
  dismissKey: string;
  /** Names what it closes for screen readers, such as ": update failed". */
  what: string;
  title: string;
  children: ReactNode;
}) {
  const ref = useRef<HTMLDivElement>(null);
  const dismissed = useDismissed(dismissKey);
  if (dismissed) return null;
  const close = () => closeKeepingFocus(ref.current, () => useDismissStore.getState().dismiss(dismissKey));
  return <Banner title={title} ref={ref} action={<DismissButton what={what} onClick={close} />}>{children}</Banner>;
}
