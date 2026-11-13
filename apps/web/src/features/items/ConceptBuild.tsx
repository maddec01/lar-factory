import { groupCapacityWait } from '@lar-factory/shared';
import type { Item } from '@lar-factory/shared';
import { useState } from 'react';

import { conceptBuildProgress } from './ConceptBuildProgress';
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
    const data = useBoardStore((state) => state.data);
    const [pending, setPending] = useState(false);
    const [error, setError] = useState<string | null>(null);

    if (!item.conceptBuild) return null;

    const progress = conceptBuildProgress(item, data);
    const running = item.conceptBuild.run?.state === 'running';
    const paused = item.conceptBuild.run?.state === 'paused';
    // Auto-build already schedules these parts. Play adds work only when it authorizes a waiting run.
    const addsWork = (!data.autoBuild?.on || paused) && (!progress.total || progress.waiting > progress.outside);
    const startLabel =
        progress.building || progress.complete ? 'Start remaining concept builds' : 'Start concept builds';

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
            capacity={groupCapacityWait(item, data)}
            showAction={showAction && (running || addsWork)}
            startLabel={startLabel}
            progress={progress}
            pending={pending}
            error={error}
            onChange={(state) => void change(state)}
        />
    );
}
