// The board before its first repository is added.
import { BrandMark, Button, buttonKind, CollectionState, EmptyBoard } from '@lar-works/design-system';

import { useWizardStore } from './WizardStore';

export function EmptyState() {
    const start = useWizardStore((s) => s.start);

    return (
        <EmptyBoard data-empty-state>
            <CollectionState
                variant="welcome"
                icon={<BrandMark label="Lar" />}
                title="Add your first Project"
                description="Connect a Project to see its work and start agents from this board."
                action={
                    <Button {...buttonKind('other')} onClick={() => start()} data-onboard>
                        Add a Project
                    </Button>
                }
            />
        </EmptyBoard>
    );
}
