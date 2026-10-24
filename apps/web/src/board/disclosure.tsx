// A Collapsible that stays as the user left it across re-renders.

import type { ReactNode } from 'react';
import { Collapsible, CollapsiblePanel, CollapsibleTrigger } from '@mux-factory/ui/collapsible';
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
    <Collapsible className={className} id={id} open={open} onOpenChange={(next) => setOpen(id, next)}>
      <CollapsibleTrigger className="disclosure-trigger">{summary}</CollapsibleTrigger>
      <CollapsiblePanel keepMounted>{children}</CollapsiblePanel>
    </Collapsible>
  );
}
