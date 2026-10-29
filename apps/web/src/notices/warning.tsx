// A lasting warning in the shared notification stack. Updates keep its place and its content mounted.

import { useEffect, useRef } from 'react';
import type { ReactNode } from 'react';
import { toast } from '@lar-factory/ui/toasts';
import { useDismissed, useDismissStore } from './dismiss-store.ts';
import { DismissButton, closeKeepingFocus } from './toasts.tsx';

export function Warning({ dismissKey, title, what = title, action, children }: {
  dismissKey: string;
  what?: string;
  title: string;
  action?: ReactNode;
  children: ReactNode;
}) {
  const dismissed = useDismissed(dismissKey);
  const id = useRef<string | null>(null);
  useEffect(() => {
    if (dismissed) return;
    const current = toast.create({ color: 'warning', duration: 0, closable: false });
    id.current = current;
    return () => {
      toast.dismiss(current);
      id.current = null;
    };
  }, [dismissKey, dismissed]);
  useEffect(() => {
    if (!id.current) return;
    toast.update(id.current, { description: (
      <div data-warning={dismissKey}>
        <DismissButton what={`: ${what}`} onClick={(event) => closeKeepingFocus(
          event.currentTarget.closest('[data-slot="toast"]'),
          () => useDismissStore.getState().dismiss(dismissKey),
        )} />
        <div data-slot="title" className="font-semibold">{title}</div>
        <div data-slot="description">{children}</div>
        {action && <div className="mt-2">{action}</div>}
      </div>
    ) });
  }, [dismissKey, dismissed, what, title, action, children]);
  return null;
}
