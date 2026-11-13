import type { BoardData } from './board-domain.ts';
import { limitNumber } from './board-domain.ts';
import { humanWait } from './human-wait.ts';
import { openBlockers, type Item } from './item-domain.ts';
import { buildsAtWork, isLiveThread, ownerThreads } from './thread-domain.ts';

/** Name shared capacity only when an authorized, otherwise eligible part is waiting for a slot. */
export function groupCapacityWait(parent: Item, data: BoardData): string | null {
    const plan = parent.conceptBuild;

    if (
        !plan ||
        parent.paused ||
        plan.run?.state === 'paused' ||
        plan.holds.length ||
        !(plan.run?.state === 'running' || data.autoBuild?.on) ||
        !data.buildLimit ||
        data.autoBuildPass?.hold
    )
        return null;

    const limit = limitNumber(data.buildLimit);
    const used = buildsAtWork(data).length;

    if (used < limit) return null;

    const eligible = plan.members.some((member) => {
        if (member.kind !== 'build' || member.complete) return false;

        const item = data.items.find((item) => item.id === member.workId);
        const start = data.startProgress?.[member.workId]?.build;

        return (
            item?.status === 'Ready' &&
            item.passingBrief === true &&
            !item.paused &&
            !item.archived &&
            !openBlockers(item).length &&
            !humanWait(item, false, data.items) &&
            !ownerThreads(item).some(isLiveThread) &&
            (!start || start.phase === 'failed') &&
            !data.autoBuildPass?.paused[item.id] &&
            !data.autoBuildPass?.waitsForRefinement.includes(item.id)
        );
    });

    return eligible
        ? `Shared capacity full: ${used} of ${limit} slots in use${used > limit ? ` · ${used - limit} over the limit` : ''}`
        : null;
}
