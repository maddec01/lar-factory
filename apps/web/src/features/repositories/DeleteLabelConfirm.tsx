import type { TrackerCapabilities } from '@lar-factory/shared';
import { Alert, Button, Modal, Text } from '@lar-works/design-system';
import { useState } from 'react';

import { useEditStore } from './EditStore';
import { OTHER_MAPPINGS, ProblemText } from './LabelParts';
import { kind } from '@/shared/ui/buttons/ButtonKinds';

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

    return (
        <Modal loading={running !== null} onClose={onClose}>
            {/* ninna-ui's Modal drops the description from aria-describedby, so the detail names itself. */}
            <Modal.Content
                data-delete-label
                role="alertdialog"
                title={`Delete ${capabilities.noun} "${name}"?`}
                description={capabilities.deleteWarning}
                aria-describedby="delete-label-detail"
                closeOnOverlayClick={false}
            >
                <Modal.Body>
                    <div className="grid gap-3">
                        <Alert tone="danger" title={capabilities.deleteWarning}>
                            <Text id="delete-label-detail" tone="muted">
                                {mappings && `This also removes it from ${mappings}. `}
                                {capabilities.changeScope === 'project' &&
                                    `${capabilities.heading} belong to the project, so this affects the whole project. ${OTHER_MAPPINGS} `}
                                This can't be undone from the factory.
                            </Text>
                        </Alert>
                        <ProblemText>{failure}</ProblemText>
                    </div>
                </Modal.Body>
                <Modal.Footer>
                    <Button {...kind('other')} disabled={running !== null} onClick={onClose}>
                        Cancel
                    </Button>
                    <Button {...kind('main', 'danger')} loading={running === 'labels'} onClick={() => void confirm()}>
                        Delete {capabilities.noun}
                    </Button>
                </Modal.Footer>
            </Modal.Content>
        </Modal>
    );
}
