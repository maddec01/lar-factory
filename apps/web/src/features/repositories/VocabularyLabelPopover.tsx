// Vocabulary labels use the same searchable checklist as item labels and filters.

import { typedLabelsProblem, type VocabularyTerm } from '@lar-factory/shared';
import { emptyVocabularyTerm } from '@lar-factory/shared/vocabulary';
import { Button, buttonKind, Inline, LabelPicker, Popover, Stack } from '@lar-works/design-system';

import type { useVocabularyFields } from './useVocabularyFields';
import type { VocabularyKind } from './VocabularyKinds';

const labelPopoverPosition = { collisionPadding: 16 };

export function VocabularyLabelPopover({
    name,
    repo,
    value,
    newLabels,
    disabled,
    onCommit,
    fields: { open, close, title, plural, noun, chosen, offered, labelsProblem, access, choose, gone, update },
}: {
    name: VocabularyKind;
    repo: string;
    value: VocabularyTerm;
    newLabels: string[];
    disabled: boolean;
    onCommit?: ((value: VocabularyTerm, newLabels: string[]) => void) | undefined;
    fields: ReturnType<typeof useVocabularyFields>;
}) {
    return (
        <Popover open={open} onOpenChange={close}>
            <Popover.Trigger asChild>
                <Button {...buttonKind('control')} disabled={disabled} aria-label={`Choose ${title} ${plural}`}>
                    {chosen.length ? 'Edit' : `Add ${noun}`}
                </Button>
            </Popover.Trigger>
            <Popover.Content align="end" width="md" {...labelPopoverPosition}>
                <Stack space="related">
                    <LabelPicker
                        data-label-picker={name}
                        choices={offered.map((label) => ({
                            name: label,
                            description: gone(label) ? 'Unavailable' : undefined,
                        }))}
                        picked={chosen}
                        onToggle={choose}
                        filterLabel={`Search ${plural} for ${title}`}
                        placeholder={`Filter or type a new ${noun}`}
                        noMatchLabel={`No matching ${plural}.`}
                        locked={labelsProblem ? offered.filter((label) => !chosen.includes(label)) : []}
                        busy={disabled}
                        create={{
                            refused: labelsProblem ?? access.newLabels,
                            problem: (label) => typedLabelsProblem(repo, [label]),
                            note: onCommit ? '' : `New ${plural} are created when you add the Project.`,
                            createLabel: (label) =>
                                onCommit ? `Create "${label}"` : `Create "${label}" when you add the Project`,
                            onCreate: (label) => update(value, [...newLabels, label], !!onCommit),
                        }}
                    />
                    <Inline>
                        <Button
                            {...buttonKind('other')}
                            disabled={disabled}
                            onClick={() => update(emptyVocabularyTerm(), [])}
                        >
                            None
                        </Button>
                        <Button {...buttonKind('other')} onClick={() => close(false)}>
                            Done
                        </Button>
                    </Inline>
                </Stack>
            </Popover.Content>
        </Popover>
    );
}
