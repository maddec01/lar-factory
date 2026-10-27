// A native select with the look of lar-server's form controls. The board keeps native selects where a form reads
// them through its own input events and reportValidity(), which the copied Select, a button over a listbox,
// doesn't fire.
import type * as React from 'react';
import { formControlClasses } from '../design-system/forms/FormControlStyles.ts';
import { ChevronDownIcon } from '../design-system/icons/NavigationIcons.tsx';

export function NativeSelect({ className = '', ...props }: React.ComponentProps<'select'>) {
  return (
    <span className={`relative inline-flex w-full ${className}`} data-slot="native-select-control">
      <select
        className={`${formControlClasses} h-8 w-full cursor-pointer appearance-none ps-3 pe-8 text-sm outline-none disabled:cursor-default disabled:opacity-50`}
        data-slot="native-select"
        {...props}
      />
      <span aria-hidden className="pointer-events-none absolute end-3 top-1/2 size-3 -translate-y-1/2 text-base-700 [&>svg]:size-full">
        <ChevronDownIcon />
      </span>
    </span>
  );
}
