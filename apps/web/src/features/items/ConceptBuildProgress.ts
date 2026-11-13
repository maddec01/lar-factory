import {
    blockedText,
    staleGateReason,
    buildsAtWork,
    workingAgain,
    type BoardData,
    type Item,
} from '@lar-factory/shared';

export { groupBuildProgress as conceptBuildProgress } from '@lar-factory/shared';

/** A concept's Ready builds explain what must change next; active work keeps its usual stage presenter. */
export function conceptBuildWait(item: Item, data: BoardData): string | null {
    if (item.kind !== 'build') return null;

    const parent = data.items.find((candidate) => candidate.id === item.parentId);
    const plan = parent?.conceptBuild;

    if (!plan || plan.members.find((member) => member.workId === item.id)?.complete) return null;

    if (workingAgain(item)) return null;

    if (item.status === 'Done')
        return (
            plan.members
                .find((member) => member.workId === item.id)
                ?.waits.filter((reason) => !reason.startsWith('Status is '))
                .join(' ') || 'Waiting for provider-confirmed merge.'
        );

    if (item.status === 'Ready to merge') return 'Waiting for PR merge.';

    if (item.status !== 'Ready') return null;

    const paused = data.autoBuildPass?.paused[item.id];

    if (paused) return `Start paused: ${paused}`;

    const blocked = blockedText(item);

    if (blocked) return blocked;

    if (item.staleGate) return staleGateReason(item);

    if (item.passingBrief === false) return 'Waiting for a current approved gate.';

    if (plan.run?.state === 'paused') return 'Paused · start concept builds to continue.';

    if (buildsAtWork(data).some((candidate) => candidate.id === item.id)) return 'Starting build.';

    if (plan.run?.state === 'running' || data.autoBuild?.on)
        return data.autoBuildPass?.hold ?? 'Waiting for shared build capacity.';

    return 'Ready · start concept builds.';
}
