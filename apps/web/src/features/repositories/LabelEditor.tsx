// The editor a label row opens: its name, colour and description, a draft that Settings' footer saves (or Enter),
// sending only what changed; Cancel there, or Edit again, closes it.

import type { TrackerCapabilities, TrackerLabel } from '@lar-factory/shared';
import { Alert, ColorSwatches, Input, InsetPanel, Text, useSettingsDraft } from '@lar-works/design-system';
import { useState, type FormEvent } from 'react';

import { useEditStore, type LabelChange } from './EditStore';
import { OTHER_MAPPINGS, ProblemText } from './LabelParts';
import { FieldRow } from '@/shared/settings/FieldRow';
import { TrackerLabelEditor } from '@/ui/board';

const SWATCHES = [
    'D73A4A',
    'E99695',
    'FBCA04',
    '0E8A16',
    'C2E0C6',
    'BFDADC',
    '1D76DB',
    '5319E7',
    'D4C5F9',
    'EDEDED',
].map((hex) => ({ value: hex, color: `#${hex}`, label: `Colour #${hex}` }));

/** The change to `label` an editor's fields make: only what differs, so a tracker hears nothing it needn't. */
function changeFrom(
    label: TrackerLabel,
    draft: Required<TrackerLabel>,
    capabilities: TrackerCapabilities,
): Partial<TrackerLabel> {
    return {
        ...(draft.name.trim() !== label.name && { name: draft.name.trim() }),
        ...(capabilities.color && draft.color !== (label.color ?? '') && { color: draft.color.replace(/^#/, '') }),
        ...(capabilities.description &&
            draft.description !== (label.description ?? '') && { description: draft.description }),
    };
}

export function LabelEditor({
    label,
    capabilities,
    mappings,
    onSave,
    onDone,
}: {
    label: TrackerLabel;
    capabilities: TrackerCapabilities;
    mappings: string | null;
    onSave: (change: LabelChange) => Promise<string | null>;
    onDone: () => void;
}) {
    const running = useEditStore((s) => s.running);
    const [draft, setDraft] = useState({
        name: label.name,
        color: label.color ?? '',
        description: label.description ?? '',
    });
    const [failure, setFailure] = useState<string | null>(null);
    const Noun = capitalized(capabilities.noun);
    const update = changeFrom(label, draft, capabilities);
    const problem = draft.name.trim() === label.name ? null : capabilities.nameProblem(draft.name);
    const badColor =
        update.color !== undefined && !/^[0-9a-f]{6}$/i.test(update.color) ? 'Use a colour of six hex digits.' : null;
    const { submit } = useSettingsDraft({
        dirty: Object.keys(update).length > 0,
        invalid: !!problem || !!badColor,
        save: async () => {
            const failed = await onSave({ change: 'update', name: label.name, update });

            setFailure(failed);

            if (failed) throw new Error(failed);

            onDone();
        },
        reset: onDone,
        error: failure,
    });
    const save = (event: FormEvent) => {
        event.preventDefault();
        submit();
    };

    return (
        <TrackerLabelEditor onSubmit={save}>
            {capabilities.changeScope === 'project' && (
                <Alert tone="warning" title="Renaming affects the whole project">
                    {capabilities.heading} belong to the project, not to this repository. Everything with this{' '}
                    {capabilities.noun} follows the new name, in every repository of the project. {OTHER_MAPPINGS}
                </Alert>
            )}
            <InsetPanel presentation="settings">
                <FieldRow label={`${Noun} name`}>
                    <Input
                        aria-label={`${Noun} name`}
                        value={draft.name}
                        disabled={running !== null}
                        onChange={(e) => setDraft({ ...draft, name: e.target.value })}
                    />
                </FieldRow>
                <ProblemText>{problem}</ProblemText>
                {mappings && update.name !== undefined && (
                    <Text variant="caption" tone="muted">
                        This also updates {mappings}.
                    </Text>
                )}
                {capabilities.color && (
                    <FieldRow label="Colour">
                        <ColorSwatches
                            swatches={SWATCHES}
                            value={draft.color}
                            disabled={running !== null}
                            onPick={(color) => setDraft({ ...draft, color })}
                        >
                            <Input
                                aria-label="Hex colour"
                                presentation="short"
                                value={draft.color}
                                disabled={running !== null}
                                onChange={(e) => setDraft({ ...draft, color: e.target.value })}
                            />
                        </ColorSwatches>
                        <ProblemText>{badColor}</ProblemText>
                    </FieldRow>
                )}
                {capabilities.description && (
                    <FieldRow label="Description">
                        <Input
                            aria-label={`${Noun} description`}
                            placeholder="Optional"
                            value={draft.description}
                            disabled={running !== null}
                            onChange={(e) => setDraft({ ...draft, description: e.target.value })}
                        />
                    </FieldRow>
                )}
            </InsetPanel>
            <ProblemText>{failure}</ProblemText>
        </TrackerLabelEditor>
    );
}

/** The tracker's label noun at the start of a field name. */
const capitalized = (word: string) => `${word.charAt(0).toUpperCase()}${word.slice(1)}`;
