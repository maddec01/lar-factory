// The layout of onboarding's questions: Choice, Field and Group lay out every question onboarding asks, one to a row with
// its label and one line of help.

import { useId, type ReactNode } from 'react';
import { Field as LabelledField } from '@lar-factory/ui/design-system/Field';
import { RadioGroupItem } from '@lar-factory/ui/design-system/RadioGroup';
import { Fieldset, FieldsetLegend } from '@lar-factory/ui/fieldset';

/** One choice of a radio group: its title, then a line of detail. */
export function Choice({ value, title, children, disabled }: { value: string; title: ReactNode; children?: ReactNode; disabled?: boolean }) {
  return (
    <div data-choice={value} className={`rounded-lg border border-base-300 px-3 py-2.5 has-data-[state=checked]:border-primary/60 has-data-[state=checked]:bg-primary/8 ${disabled ? 'opacity-60' : ''}`}>
      <RadioGroupItem value={value} disabled={disabled} label={title} description={children} />
    </div>
  );
}

/** The props that tie a field's control to its help and problem. */
type Described = { 'aria-describedby'?: string };

/**
 * One field on its own row: the copied Field's label and control, one line of help, then what Next waits for from it,
 * if anything. The help and problem sit outside the label and describe the control, so they aren't read as its name.
 * The problem is muted help until `invalid`, which marks it and the control.
 */
export function Field({ name, label, hint, problem, invalid = false, children }: {
  name?: string; label: string; hint?: ReactNode; problem?: string; invalid?: boolean; children: (described: Described) => ReactNode;
}) {
  const id = useId();
  const marked = !!problem && invalid;
  const describedBy = [hint && `${id}-hint`, problem && `${id}-problem`].filter(Boolean).join(' ');
  return (
    <div data-field={name} className="grid gap-1.5">
      {/* The copied Field shows one helper line; the board shows the help and the problem below it instead. */}
      <LabelledField label={label} invalid={marked}>{children(describedBy ? { 'aria-describedby': describedBy } : {})}</LabelledField>
      {hint && <span id={`${id}-hint`} className="text-xs text-base-700">{hint}</span>}
      {problem && <span id={`${id}-problem`} data-problem className={`text-xs ${marked ? 'text-(--lar-danger-text)' : 'text-base-700'}`}>{problem}</span>}
    </div>
  );
}

/** A group of choices on its own row: its legend, one line of help, then the choices. */
export function Group({ legend, hint, children }: { legend: string; hint?: ReactNode; children: ReactNode }) {
  return (
    <Fieldset unstyled className="grid gap-2">
      <FieldsetLegend>{legend}</FieldsetLegend>
      {hint && <p className="m-0 -mt-1 text-xs text-base-700">{hint}</p>}
      {children}
    </Fieldset>
  );
}
