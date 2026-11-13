import { startActionChoice } from '@lar-factory/shared';
import type { Item } from '@lar-factory/shared';
import { useState } from 'react';

import { useBuilds } from './BuildLimitText';
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
    const builds = useBuilds();
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
            capacity={`${builds.occupancy}: ${builds.items.filter((build) => item.conceptBuild!.members.some((member) => member.workId === build.id)).length} from this concept`}
            showAction={showAction}
            startLabel={startActionChoice(item, 'build').label}
            pending={pending}
            error={error}
            onChange={(state) => void change(state)}
        />
    );
}
