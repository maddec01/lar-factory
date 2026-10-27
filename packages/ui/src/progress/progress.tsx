// The board's progress bar: a rounded track filled to value / max, then an optional caption. lar-server has none, so
// the board writes it with lar-server's tokens and type, as its StackedMeter is, and sets the progressbar's ARIA values.
import type * as React from 'react';
import { Text } from '../design-system/typography/Typography.tsx';

export function Progress({ className = '', caption, value, max = 100, ...props }: Omit<React.ComponentProps<'div'>, 'children'> & {
  value: number; max?: number; caption?: React.ReactNode;
}) {
  const share = max > 0 ? Math.min(Math.max(value / max, 0), 1) : 0;
  return (
    <div className={`flex items-center gap-2 ${className}`} data-slot="progress">
      <div role="progressbar" aria-valuemin={0} aria-valuemax={max} aria-valuenow={value} className="h-2 max-w-65 flex-1 overflow-hidden rounded-full bg-base-200" data-slot="progress-bar" {...props}>
        <div className="h-full rounded-[inherit] bg-primary" style={{ width: `${share * 100}%` }} data-slot="progress-indicator" />
      </div>
      {caption && <Text as="span" variant="caption" tone="muted" data-slot="progress-caption">{caption}</Text>}
    </div>
  );
}
