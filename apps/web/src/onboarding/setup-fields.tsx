// T3 project choices keep their folder paths beside the radio control.

import { RadioGroupItem } from '@lar-works/design-system';
import { useId, type ReactNode } from 'react';

/**
 * One choice of a radio group, on one line. The design system's item's own label can't shrink, so a long title wouldn't truncate;
 * this label sits beside the bare radio instead.
 */
export function Choice({ value, children }: { value: string; children: ReactNode }) {
    const id = useId();

    return (
        <div
            data-choice={value}
            className="border-base-300 has-data-[state=checked]:border-primary/60 has-data-[state=checked]:bg-primary/8 flex items-center gap-2 rounded-lg border px-3 py-1.5"
        >
            <RadioGroupItem id={id} value={value} />
            <label htmlFor={id} className="flex min-w-0 flex-1 cursor-pointer text-sm">
                {children}
            </label>
        </div>
    );
}
