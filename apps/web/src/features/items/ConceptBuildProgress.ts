import { blockedText, buildsAtWork, workingAgain, type BoardData, type Item } from '@lar-factory/shared';

/** Delivery progress follows confirmed completion, never a ticket's or manually written Done status. */
export function conceptBuildProgress(parent: Item, data: BoardData) {
    const members = parent.conceptBuild?.members.filter((member) => member.kind === 'build') ?? [];
    const atWork = new Set(buildsAtWork(data).map((item) => item.id));
    const building = members.filter((member) => !member.complete && atWork.has(member.workId));
    const complete = members.filter((member) => member.complete).length;

    return {
        total: members.length,
        complete,
        building: building.length,
        waiting: members.length - complete - building.length,
        names: building.map((member) => member.title).join(', '),
        outside: members.filter((member) => !member.complete && !data.items.some((item) => item.id === member.workId))
            .length,
    };
}

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

    if (item.passingBrief === false) return 'Waiting for a current approved gate.';

    if (plan.run?.state === 'paused') return 'Paused · start concept builds to continue.';

    if (buildsAtWork(data).some((candidate) => candidate.id === item.id)) return 'Starting build.';

    if (plan.run?.state === 'running' || data.autoBuild?.on)
        return data.autoBuildPass?.hold ?? 'Waiting for shared build capacity.';

    return 'Ready · start concept builds.';
}
