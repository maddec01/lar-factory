// The board's fieldset: a bordered group of form controls under a legend, on lar-server's border and type. lar-server
// has none, so the board writes it on the native fieldset, which also disables every control inside it. Unstyled, it
// only groups and disables its fields.
import type * as React from 'react';

export function Fieldset({ className = '', unstyled = false, ...props }: React.ComponentProps<'fieldset'> & { unstyled?: boolean }) {
  return (
    <fieldset
      className={`m-0 min-w-0 ${unstyled ? 'border-0 p-0' : 'mb-3 rounded-lg border border-base-300 px-3 pt-2 pb-0 [&>legend]:mb-2 [&>legend]:font-semibold'} ${className}`}
      data-slot="fieldset"
      {...props}
    />
  );
}

export function FieldsetLegend(props: Omit<React.ComponentProps<'legend'>, 'className'>) {
  return <legend className="p-0 text-sm font-medium leading-5 text-base-content" data-slot="fieldset-legend" {...props} />;
}
