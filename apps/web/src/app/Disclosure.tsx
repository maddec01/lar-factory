// A <details> that stays as the user left it across re-renders.

import type { ReactNode } from 'react';
import { useDetailsStore } from './details-store.ts';

export function Disclosure({ id, className, byDefault, summary, children }: {
  id: string;
  className: string;
  byDefault: boolean;
  summary: ReactNode;
  children: ReactNode;
}) {
  const open = useDetailsStore((state) => state.toggled[id] ?? byDefault);
  const setOpen = useDetailsStore((state) => state.setOpen);
  return (
    <details className={className} id={id} open={open} onToggle={(event) => setOpen(id, event.currentTarget.open)}>
      <summary>{summary}</summary>
      {children}
    </details>
  );
}
