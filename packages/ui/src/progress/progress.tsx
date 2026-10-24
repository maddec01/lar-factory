// The board's progress bar: a rounded track filled to value / max, then an optional caption. T3 has none, so
// the board writes it on Base UI's Progress, which sets the fill's width and the progressbar's ARIA values.
import { Progress as ProgressPrimitive } from '@base-ui/react/progress';
import type * as React from 'react';
import { cn } from '../lib/utils.ts';

export function Progress({ className, caption, ...props }: ProgressPrimitive.Root.Props & { caption?: React.ReactNode }) {
  return (
    <div className={cn('flex items-center gap-2', className)} data-slot="progress">
      <ProgressPrimitive.Root className="h-2 max-w-65 flex-1 overflow-hidden rounded-full bg-(--soft)" data-slot="progress-bar" {...props}>
        <ProgressPrimitive.Indicator className="rounded-[inherit] bg-(--sub)" data-slot="progress-indicator" />
      </ProgressPrimitive.Root>
      {caption && <span className="text-muted-foreground text-xs" data-slot="progress-caption">{caption}</span>}
    </div>
  );
}
