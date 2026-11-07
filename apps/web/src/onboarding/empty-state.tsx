// The board before its first repository is added.
import { Button, BrandMark } from '@lar-works/design-system';

import { kind } from '../buttons/button-kinds.tsx';
import { useWizardStore } from './wizard-store.ts';

export function EmptyState() {
    const start = useWizardStore((s) => s.start);
    return (
        <div className="min-h-0 flex-1 overflow-y-auto" data-empty-state>
            <div className="mx-auto grid max-w-xl justify-items-center gap-3 px-6 py-16 text-center">
                <BrandMark label="Lar" />
                <h2 className="m-0 text-lg font-semibold">Add your first Project</h2>
                <p className="text-base-700 m-0 text-sm">
                    Connect a Project to see its work and start agents from this board.
                </p>
                <Button {...kind('other')} onClick={() => start()} data-onboard>
                    Add a Project
                </Button>
            </div>
        </div>
    );
}
