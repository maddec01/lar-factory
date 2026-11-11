// Asks before a label leaves the tracker: the design system's ConfirmDialog, its confirm in the danger colour, saying
// what it removes and keeping the tracker's reason when the delete fails.

import type { TrackerCapabilities } from '@lar-factory/shared';
import { ConfirmDialog } from '@lar-works/design-system';
import { useState } from 'react';

import { useEditStore } from './EditStore';
import { OTHER_MAPPINGS, ProblemText } from './LabelParts';

export function DeleteConfirm({
    name,
    capabilities,
    mappings,
    onDelete,
    onClose,
}: {
    name: string;
    capabilities: TrackerCapabilities;
    mappings: string | null;
    onDelete: () => Promise<string | null>;
    onClose: () => void;
}) {
    const running = useEditStore((s) => s.running);
    const [failure, setFailure] = useState<string | null>(null);
    const confirm = async () => {
        const failed = await onDelete();

        setFailure(failed);

        if (!failed) onClose();
    };
    const consequence = [
        capabilities.deleteWarning,
        mappings && `This also removes it from ${mappings}.`,
        capabilities.changeScope === 'project' &&
            `${capabilities.heading} belong to the project, so this affects the whole project. ${OTHER_MAPPINGS}`,
        'This can’t be undone from the factory.',
    ]
        .filter(Boolean)
        .join(' ');

    return (
        <ConfirmDialog
            data-delete-label
            title={`Delete ${capabilities.noun} "${name}"?`}
            consequence={consequence}
            confirmLabel={`Delete ${capabilities.noun}`}
            busy={running === 'labels'}
            cancelDisabled={running !== null}
            onConfirm={() => void confirm()}
            onCancel={onClose}
        >
            {failure ? <ProblemText>{failure}</ProblemText> : null}
        </ConfirmDialog>
    );
}
