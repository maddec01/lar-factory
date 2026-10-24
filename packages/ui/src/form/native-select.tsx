// A native select with the look of T3's SelectTrigger. The board keeps native selects where a form reads them
// through its own input events and reportValidity(), which Base UI's Select doesn't fire; the classes follow
// selectTriggerVariants' default variant in T3's ui/select.tsx at d53873b.
import { ChevronDownIcon } from 'lucide-react';
import type * as React from 'react';
import { cn } from '../lib/utils.ts';

export function NativeSelect({ className, ...props }: React.ComponentProps<'select'>) {
  return (
    <span className={cn('relative inline-flex w-full', className)} data-slot="native-select-control">
      <select
        className="min-h-9 w-full min-w-0 cursor-pointer appearance-none rounded-lg border border-input bg-background not-dark:bg-clip-padding ps-[calc(--spacing(3)-1px)] pe-8 text-base text-foreground shadow-xs/5 outline-none ring-ring/24 transition-[color,box-shadow,background-color] focus-visible:border-ring focus-visible:ring-[3px] focus-visible:ring-inset aria-invalid:border-destructive/36 focus-visible:aria-invalid:border-destructive/64 focus-visible:aria-invalid:ring-destructive/16 disabled:pointer-events-none disabled:opacity-64 sm:min-h-8 sm:text-sm dark:bg-input/32 dark:aria-invalid:ring-destructive/24 [:disabled,:focus-visible,[aria-invalid]]:shadow-none"
        data-slot="native-select"
        {...props}
      />
      <ChevronDownIcon aria-hidden className="-translate-y-1/2 pointer-events-none absolute end-3 top-1/2 size-3 text-icon-muted opacity-50" />
    </span>
  );
}
