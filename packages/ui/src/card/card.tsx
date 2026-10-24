// The board's card: a bordered panel on T3's card surface. T3 has no card the board uses, so the board writes
// it with T3's tokens. An accent card takes the --you colour on its border and a bar down its leading edge.
import type * as React from 'react';
import { cn } from '../lib/utils.ts';

export function Card({ className, accent = false, ...props }: React.ComponentProps<'article'> & { accent?: boolean }) {
  return (
    <article
      className={cn(
        'flex min-w-0 flex-col gap-1.5 rounded-lg border bg-card px-3 py-2.5 shadow-xs/5',
        accent && 'border-[color-mix(in_srgb,var(--you)_55%,var(--border))] ps-3.5 shadow-[inset_4px_0_0_var(--you)]',
        className,
      )}
      data-accent={accent || undefined}
      data-slot="card"
      {...props}
    />
  );
}
