// The board before its first repository is added: the design system's start hero, the Lar mark on Factory's amber
// halo, with one way on.
import { BrandMark, Button, EmptyState as EmptyStateMessage } from '@lar-works/design-system';

import { useWizardStore } from './WizardStore';
import { buttonKind, EmptyBoard } from '@/ui/board';

export function EmptyState() {
    const start = useWizardStore((s) => s.start);

    return (
        <EmptyBoard data-empty-state>
            <EmptyStateMessage
                size="start"
                // The page's heading is "Lar Factory" (BoardShell); this is its one section.
                level="h2"
                artwork={<BrandMark label="Lar" size="lg" />}
                title="Add your first project"
                description="Connect a project to see its work and start agents from this board."
                actions={
                    <Button {...buttonKind('main', { size: 'md' })} onClick={() => start()} data-onboard>
                        Add a project
                    </Button>
                }
            />
        </EmptyBoard>
    );
}
