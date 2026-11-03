// The model menu shared by Start, Start after and Settings: T3 default first, then models grouped by provider instance.
import { useId } from 'react';
import { offers, storedChoice, type ModelChoice, type ModelGroup } from '@lar-factory/shared';
import { DropdownMenu } from '@lar-factory/ui/design-system/DropdownMenu';

export function ModelEntries({ groups, selected, heading, held, defaultHeld, itemId, onPick }: {
  groups: ModelGroup[]; selected?: ModelChoice; heading: string; held?: string; defaultHeld?: string; itemId?: string;
  onPick: (choice: ModelChoice | undefined) => void;
}) {
  const headings = useId();
  const checked = storedChoice(selected);
  const entry = (label: string, choice?: ModelChoice, unavailable?: string) => {
    const why = held ?? unavailable ?? (!choice ? defaultHeld : undefined);
    return <DropdownMenu.RadioItem key={storedChoice(choice)} value={storedChoice(choice)}
      data-opens-here={storedChoice(choice) === checked || undefined} aria-disabled={why !== undefined || undefined} title={why}
      data-start-pick={itemId} data-instance-id={choice?.instanceId} data-model={choice?.model}
      onSelect={(event) => why === undefined ? onPick(choice) : event.preventDefault()}>
      <span className="min-w-0 flex-1 truncate">{label}</span>
    </DropdownMenu.RadioItem>;
  };
  return <DropdownMenu.RadioGroup value={checked} aria-labelledby={`${headings}-with`}>
    <DropdownMenu.Label id={`${headings}-with`}>{heading}</DropdownMenu.Label>
    {entry('T3 default')}
    {groups.map((group, i) => <DropdownMenu.Group key={group.instanceId} aria-labelledby={`${headings}-${i}`}>
      <DropdownMenu.Label id={`${headings}-${i}`}>{group.name}</DropdownMenu.Label>
      {group.models.map((model) => entry(model.label, { instanceId: group.instanceId, model: model.slug }))}
    </DropdownMenu.Group>)}
    {selected && !offers(groups, selected) && entry(`${selected.instanceId} ${selected.model} (not offered)`, selected,
      "This model isn't offered now. Choose another model.")}
  </DropdownMenu.RadioGroup>;
}

/** Focus the checked model on open. The copied menu forwards this Radix prop but omits it from its type. */
export const opensOnChecked = {
  onOpenAutoFocus: (event: Event): void => {
    event.preventDefault();
    (event.target as HTMLElement).querySelector<HTMLElement>('[data-opens-here]')?.focus({ preventScroll: true });
  },
};
