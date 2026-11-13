import { startActionChoice } from '@lar-factory/shared';
import type { Item } from '@lar-factory/shared';
import { useState } from 'react';

import { useBoardStore } from '@/services/board/board.hooks';
import { postAction } from '@/services/board/board.service';
import { ConceptBuildRun } from '@/ui/board';

export function ConceptBuild({
    item,
    compact = false,
    showAction = true,
}: {
    item: Item;
    compact?: boolean;
    showAction?: boolean;
}) {
    const [pending, setPending] = useState(false);
    const [error, setError] = useState<string | null>(null);

    if (!item.conceptBuild) return null;

    const change = async (state: 'running' | 'paused') => {
        setPending(true);
        setError(null);

        try {
            const result = await postAction('/api/concept-build-run', {
                session: useBoardStore.getState().data.capture?.session,
                itemId: item.id,
                revision: item.revision,
                state,
            });

            setError(result.error ?? null);
        } finally {
            setPending(false);
        }
    };

    return (
        <ConceptBuildRun
            plan={item.conceptBuild}
            compact={compact}
            showAction={showAction}
            startLabel={startActionChoice(item, 'build').label}
            pending={pending}
            error={error}
            onChange={(state) => void change(state)}
        />
    );
}
