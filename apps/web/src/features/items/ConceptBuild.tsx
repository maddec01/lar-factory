import { conceptBuildHoldSummary, groupCapacityWait, openBlockers, plural } from '@lar-factory/shared';
import type { ConceptBuildPlan, Item } from '@lar-factory/shared';
import { useState } from 'react';

import { conceptBuildProgress } from './ConceptBuildProgress';
import { partRef } from './PartRef';
import { StartBuild } from './StartBuild';
import { useBoardStore } from '@/services/board/board.hooks';
import { postAction } from '@/services/board/board.service';
import { ConceptBuildRun } from '@/ui/board';

const DEPENDENCY = /^Dependency on (?:[^/:\s]+\/)?([^:\s]+):/;
const andList = (words: string[]) =>
    words.length > 1 ? `${words.slice(0, -1).join(', ')} and ${words.at(-1)}` : (words[0] ?? '');

/** Why the concept's builds are held, naming the parts as the board does ("Part 26 and Part 27 undecided"), a
 *  Dependency by its project, and approvals by count; the shared summary when a part can't be named. */
function holdText(plan: ConceptBuildPlan, items: readonly Item[]): string {
    const decisions: string[] = [];
    const dependencies = new Set<string>();
    let approvals = 0;
    let other = 0;

    for (const hold of plan.holds) {
        const member = plan.members.find((m) => m.workId === hold.workId);
        const item = items.find((i) => i.id === hold.workId);
        const dependency = DEPENDENCY.exec(hold.reason);

        if (member?.kind === 'decision' && item && partRef(item)) {
            if (!decisions.includes(partRef(item)!)) decisions.push(partRef(item)!);
        } else if (/approved gate/.test(hold.reason)) approvals++;
        else if (dependency) dependencies.add(dependency[1]!);
        else other++;
    }

    if (!decisions.length) return conceptBuildHoldSummary(plan);

    return [
        `until ${andList(decisions)} ${decisions.length === 1 ? 'is' : 'are'} decided`,
        dependencies.size > 0 && `waiting for ${andList([...dependencies])}`,
        approvals > 0 && plural(approvals, 'approval'),
        other > 0 && plural(other, 'other hold'),
    ]
        .filter(Boolean)
        .join(' · ');
}

export function ConceptBuild({
    item,
    compact = false,
    showAction = true,
    holdsSummarized = false,
}: {
    item: Item;
    holdsSummarized?: boolean;
    compact?: boolean;
    showAction?: boolean;
}) {
    const data = useBoardStore((state) => state.data);
    const [pending, setPending] = useState(false);
    const [error, setError] = useState<string | null>(null);

    if (!item.conceptBuild) return null;

    const progress = conceptBuildProgress(item, data);
    // A part that can start by itself while the run is held: Ready, nothing blocking it.
    const readyPart = data.items.find(
        (part) => part.parentId === item.id && part.status === 'Ready' && !part.setAside && !openBlockers(part).length,
    );
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
            holdsSummarized={holdsSummarized}
            compact={compact}
            capacity={groupCapacityWait(item, data)}
            showAction={showAction && (running || addsWork)}
            startLabel={startLabel}
            holdLabel={holdText(item.conceptBuild, data.items)}
            ready={
                readyPart && {
                    name: partRef(readyPart) ?? readyPart.title,
                    action: <StartBuild item={readyPart} data={data} />,
                }
            }
            progress={progress}
            pending={pending}
            error={error}
            onChange={(state) => void change(state)}
        />
    );
}
