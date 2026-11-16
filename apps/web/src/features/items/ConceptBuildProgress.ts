import {
    openBlockers,
    startAfterRef,
    plural,
    staleGateReason,
    buildsAtWork,
    workingAgain,
    type BoardData,
    type Item,
} from '@lar-factory/shared';

export { groupBuildProgress as conceptBuildProgress } from '@lar-factory/shared';

/** What holds a part, short enough for its row and map card: its one prerequisite by number or part ("Blocked by #139",
 *  "Blocked by Part 15"), a Dependency by its owner, else a count; the item's dialog names each in full. Null when
 *  nothing blocks it. */
function blockedShort(item: Item, items: readonly Item[]): string | null {
    const blockers = openBlockers(item);

    if (!blockers.length) return null;

    if (blockers.every((b) => b.dependency)) return `Waits on ${blockers.map((b) => b.dependency!.owner).join(', ')}`;

    const ref = blockers.length === 1 ? startAfterRef(item, items) : null;

    return `Blocked by ${ref ?? plural(blockers.length, 'part')}`;
}

/** A concept's Ready builds explain what must change next; active work keeps its usual stage presenter. */
function conceptBuildWait(item: Item, data: BoardData): string | null {
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
                .join(' ') || 'Waiting for merge'
        );

    if (item.status === 'Ready to merge') return 'Waiting for merge';

    if (item.status !== 'Ready') return null;

    const paused = data.autoBuildPass?.paused[item.id];

    if (paused) return `Start paused: ${paused}`;

    const blocked = blockedShort(item, data.items);

    if (blocked) return blocked;

    if (item.staleGate) return staleGateReason(item);

    if (item.passingBrief === false) return 'Needs a fresh approval';

    if (plan.run?.state === 'paused') return 'Paused';

    if (buildsAtWork(data).some((candidate) => candidate.id === item.id)) return 'Starting';

    if (plan.run?.state === 'running' || data.autoBuild?.on)
        return data.autoBuildPass?.hold ?? 'Waiting for a build slot';

    return 'Ready';
}

/** Past waiting: a thread has taken the part on, whatever it waited for. */
const STARTED: readonly string[] = ['In progress', 'Review', 'Verify', 'Ready to merge', 'Done'];

/** What a concept's part waits for, in the words its parts list row and map card say: conceptBuildWait's for a build,
 *  and for any other part, such as a queued decision, what holds it before it starts ("Blocked by Part 24"). Null when
 *  nothing does, so the caller says the item's own word. */
export function partWait(item: Item, data: BoardData): string | null {
    const wait = conceptBuildWait(item, data);

    if (wait || !item.parentId || STARTED.includes(item.status)) return wait;

    return blockedShort(item, data.items);
}
