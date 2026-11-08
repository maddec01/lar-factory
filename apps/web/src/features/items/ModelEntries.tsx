import {
    offers,
    modelDisplayName,
    storedChoice,
    t3DefaultDetail,
    type ModelChoice,
    type ModelGroup,
    type ModelSelection,
} from '@lar-factory/shared';
import { DropdownMenu } from '@lar-works/design-system';
// The model menu shared by Start, Start after and Settings: Project default in T3 first, then models grouped by provider instance.
import { useId } from 'react';

export function ModelEntries({
    groups,
    t3Default,
    selected,
    heading,
    held,
    defaultHeld,
    itemId,
    onPick,
}: {
    groups: ModelGroup[];
    t3Default?: ModelSelection | undefined;
    selected?: ModelChoice;
    heading: string;
    held?: string;
    defaultHeld?: string;
    itemId?: string;
    onPick: (choice: ModelChoice | undefined) => void;
}) {
    const headings = useId();
    const checked = storedChoice(selected);
    const entry = (label: string, choice?: ModelChoice, unavailable?: string, detail?: string) => {
        const why = held ?? unavailable ?? (!choice ? defaultHeld : undefined);

        return (
            <DropdownMenu.RadioItem
                key={storedChoice(choice)}
                value={storedChoice(choice)}
                data-opens-here={storedChoice(choice) === checked || undefined}
                aria-disabled={why !== undefined || undefined}
                title={[why, detail].filter(Boolean).join('\n') || undefined}
                data-start-pick={itemId}
                data-instance-id={choice?.instanceId}
                data-model={choice?.model}
                onSelect={(event) => (why === undefined ? onPick(choice) : event.preventDefault())}
            >
                <DropdownMenu.ItemText detail={detail}>{label}</DropdownMenu.ItemText>
            </DropdownMenu.RadioItem>
        );
    };

    return (
        <DropdownMenu.RadioGroup value={checked} aria-labelledby={`${headings}-with`}>
            <DropdownMenu.Label id={`${headings}-with`}>{heading}</DropdownMenu.Label>
            {entry('Project default in T3', undefined, undefined, t3DefaultDetail(groups, t3Default))}
            {groups.map((group, i) => (
                <DropdownMenu.Group key={group.instanceId} aria-labelledby={`${headings}-${i}`}>
                    <DropdownMenu.Label id={`${headings}-${i}`}>{group.name}</DropdownMenu.Label>
                    {group.models.map((model) =>
                        entry(modelDisplayName(groups, model.slug), {
                            instanceId: group.instanceId,
                            model: model.slug,
                        }),
                    )}
                </DropdownMenu.Group>
            ))}
            {selected &&
                !offers(groups, selected) &&
                entry(
                    `${selected.instanceId} ${selected.model} (not offered)`,
                    selected,
                    'This model isn’t offered now. Choose another model.',
                )}
        </DropdownMenu.RadioGroup>
    );
}
