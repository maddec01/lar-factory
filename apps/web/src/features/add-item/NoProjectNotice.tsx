// What Add item says first while no project is added: work belongs to a project, so adding one comes first.

import { noneOnboarded } from '@lar-factory/shared';
import { Alert, Button } from '@lar-works/design-system';

import { useAddItemStore } from './AddItemStore';
import { useWizardStore } from '@/features/onboarding';
import { useBoardStore } from '@/services/board/board.hooks';
import { buttonKind } from '@/ui/board';

/** With no project added, a notice at the top of the pane that one comes first, and the button that adds it. */
export function NoProjectNotice() {
    const none = useBoardStore((state) => noneOnboarded(state.data));

    if (!none) return null;

    return (
        <Alert
            tone="warning"
            size="sm"
            title="Add a project first"
            description="Every item belongs to a project. Add one, then add its work here."
            action={
                <Button
                    {...buttonKind('main')}
                    onClick={() => {
                        useAddItemStore.getState().setOpen(false);
                        useWizardStore.getState().start();
                    }}
                >
                    Add a project
                </Button>
            }
            data-no-project
        />
    );
}
