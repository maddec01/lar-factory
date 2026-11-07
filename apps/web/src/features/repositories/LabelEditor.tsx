// The editor a label row opens: its name, colour and description, saving only what changed.

import type { TrackerCapabilities, TrackerLabel } from '@lar-factory/shared';
import {
    Alert,
    Button,
    buttonKind,
    ColorSwatches,
    Inline,
    Input,
    InsetPanel,
    Text,
    TrackerLabelEditor,
} from '@lar-works/design-system';
import { useState, type FormEvent } from 'react';

import { useEditStore, type LabelChange } from './EditStore';
import { OTHER_MAPPINGS, ProblemText, capitalized } from './LabelParts';
import { FieldRow } from '@/shared/settings/FieldRow';

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
    const save = async (event: FormEvent) => {
        event.preventDefault();

        if (problem || badColor || !Object.keys(update).length) return;

        const failed = await onSave({ change: 'update', name: label.name, update });

        setFailure(failed);

        if (!failed) onDone();
    };

    return (
        <TrackerLabelEditor onSubmit={(event) => void save(event)}>
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
            <Inline as="span">
                <Button {...buttonKind('other')} type="button" disabled={running !== null} onClick={onDone}>
                    Cancel
                </Button>
                <Button
                    {...buttonKind('other')}
                    type="submit"
                    disabled={running !== null || !!problem || !!badColor || !Object.keys(update).length}
                    loading={running === 'labels'}
                >
                    Save
                </Button>
            </Inline>
        </TrackerLabelEditor>
    );
}
