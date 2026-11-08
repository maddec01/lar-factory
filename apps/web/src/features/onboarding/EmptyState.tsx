// The board before its first repository is added.
import { BrandMark, Button, EmptyState as EmptyStateMessage } from '@lar-works/design-system';

import { useWizardStore } from './WizardStore';
import { buttonKind, EmptyBoard } from '@/ui/board';

export function EmptyState() {
    const start = useWizardStore((s) => s.start);

    return (
        <EmptyBoard data-empty-state>
            <EmptyStateMessage
                artwork={<BrandMark label="Lar" />}
                title="Add your first Project"
                description="Connect a project to see its work and start agents from this board."
                actions={
                    <Button {...buttonKind('other')} onClick={() => start()} data-onboard>
                        Add a project
                    </Button>
                }
            />
        </EmptyBoard>
    );
}
