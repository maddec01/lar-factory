// lar-server's Select over plain choices, for a form to read. The copied Select is a button over a listbox: its items
// can't have an empty value and it fires no input event, so this holds "none" as a stand-in, gives the form the value
// in a hidden field, and fires input on that field once a pick has rendered.
import { forwardRef, useRef, type KeyboardEvent, type ReactNode } from 'react';
import { flushSync } from 'react-dom';
import { Select, SelectItem, type SelectProps } from '../design-system/forms/Select.tsx';

const NONE = '__none';

export interface FormSelectChoice { value: string; name: string; icon?: ReactNode; disabled?: boolean }

export interface FormSelectProps extends Omit<SelectProps, 'value' | 'defaultValue' | 'onValueChange' | 'children'> {
  value: string;
  onChange: (value: string) => void;
  choices: readonly FormSelectChoice[];
  /** The name of the choice that empties the value; without it, an empty value shows the placeholder. */
  none?: string;
  /** A pick writes at once, so a letter key on the closed control doesn't pick: the Select's typeahead only works once its list is open. */
  writesOnPick?: boolean;
}

/** Marks a letter key as handled, which the Select's trigger takes as leaving its typeahead out. Space and arrows still open the list. */
const withoutClosedTypeahead = (event: KeyboardEvent) => {
  if (event.key.length === 1 && event.key !== ' ' && !event.ctrlKey && !event.altKey && !event.metaKey) event.preventDefault();
};

export const FormSelect = forwardRef<HTMLButtonElement, FormSelectProps>(({ name, value, onChange, choices, none, writesOnPick, ...props }, ref) => {
  const field = useRef<HTMLInputElement>(null);
  const pick = (item: string) => {
    flushSync(() => onChange(item === NONE ? '' : item));
    field.current?.dispatchEvent(new Event('input', { bubbles: true }));
  };
  return (<>
    {name && <input ref={field} type="hidden" name={name} value={value} />}
    <Select {...props} {...writesOnPick && { onKeyDown: withoutClosedTypeahead }} ref={ref} value={value || (none ? NONE : '')} onValueChange={pick}>
      {none && <SelectItem value={NONE}>{none}</SelectItem>}
      {choices.map((choice) => (
        <SelectItem key={choice.value} value={choice.value} icon={choice.icon} textValue={choice.name} disabled={choice.disabled}>{choice.name}</SelectItem>
      ))}
    </Select>
  </>);
});

FormSelect.displayName = 'FormSelect';
