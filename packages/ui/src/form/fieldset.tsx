// The board's fieldset: a bordered group of form controls under a legend. T3 has none, so the board writes it
// on Base UI's Fieldset with T3's border, radius and type. Unstyled, it only groups and disables its fields.
import { Fieldset as FieldsetPrimitive } from '@base-ui/react/fieldset';
import { cn } from '../lib/utils.ts';

export function Fieldset({ className, unstyled = false, ...props }: FieldsetPrimitive.Root.Props & { unstyled?: boolean }) {
  return (
    <FieldsetPrimitive.Root
      className={cn('m-0 min-w-0 border-0 p-0', !unstyled && 'mb-3 rounded-lg border px-3 pt-2', className)}
      data-slot="fieldset"
      {...props}
    />
  );
}

export function FieldsetLegend({ className, ...props }: FieldsetPrimitive.Legend.Props) {
  return (
    <FieldsetPrimitive.Legend
      className={cn('mb-2 font-semibold text-foreground text-sm', className)}
      data-slot="fieldset-legend"
      {...props}
    />
  );
}
