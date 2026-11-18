import type { BoardData } from './board-domain.ts';
import { plural } from './format.ts';
import { reconcileWaitItems } from './group-reconciliation.ts';
import { humanWait } from './human-wait.ts';
import type { Item } from './item-domain.ts';
import { releaseHolds } from './release-plan.ts';
import { buildsAtWork, ownerThreads, type ItemThread } from './thread-domain.ts';

type GroupData = Pick<BoardData, 'items' | 'startProgress'>;

const ownerAtWork = (thread: ItemThread) =>
    !thread.observedAt &&
    !thread.archived &&
    thread.state !== 'needs you' &&
    (thread.state === 'running' || thread.currentRunning || thread.hasRunningChildren);

/** Maintenance is progress only while a current owner is working; the checklist alone asks nothing of the user. */
export function groupProgress(parent: Item, all: readonly Item[], unavailable = false) {
    if (unavailable || parent.paused || parent.setAside || complete(parent)) return undefined;

    const outcome = parent.outcomeCheck;
    const run = outcome?.run;
    const owner = all.find((item) => item.id === run?.ownerWorkId);

    if (
        parent.releasePlan?.outcomeCheck.result === 'pending' &&
        outcome?.ready &&
        run?.sent &&
        !run.error &&
        !run.rejected &&
        run.digest === outcome.digest &&
        Array.isArray(owner?.threads) &&
        owner.threads.some((thread) => thread.id === run.threadId && ownerAtWork(thread))
    )
        return 'Checking Outcome';

    if (
        !parent.reconciliation?.items.length ||
        humanWait(parent, unavailable, all) ||
        !ownerThreads(parent).some((thread) => thread.purpose !== 'build' && ownerAtWork(thread))
    )
        return undefined;

    return reconcileWaitItems(parent.reconciliation).length ? 'Reconciling' : 'Updating map';
}

const complete = (item: Item) => item.completion?.complete ?? (item.status === 'Done' || item.state === 'closed');

/** Delivery counts use the durable plan, including builds outside the board, and the shared capacity projection. */
export function groupBuildProgress(parent: Item, data: GroupData, unavailable = false) {
    const members =
        parent.conceptBuild?.members.filter((member) => member.kind === 'build') ??
        data.items
            .filter((item) => item.parentId === parent.id && item.kind !== 'decision')
            .map((item) => ({
                workId: item.id,
                title: item.title,
                complete: complete(item),
            }));
    const atWork = new Set(
        buildsAtWork(data, unavailable)
            .filter((item) => {
                const start = data.startProgress?.[item.id]?.build;

                if (start && start.phase !== 'failed') return true;

                if (item.paused || item.needsYou) return false;

                const threads = ownerThreads(item);

                return (
                    !threads.length ||
                    (!unavailable &&
                        threads.some(
                            (thread) =>
                                !thread.observedAt &&
                                !thread.archived &&
                                (thread.state === 'running' ||
                                    thread.currentRunning ||
                                    thread.hasRunningChildren ||
                                    thread.queued),
                        ))
                );
            })
            .map((item) => item.id),
    );
    const building = members.filter((member) => !member.complete && atWork.has(member.workId));
    const done = members.filter((member) => member.complete).length;

    return {
        total: members.length,
        complete: done,
        building: building.length,
        waiting: members.length - done - building.length,
        names: building.map((member) => member.title).join(', '),
        outside: members.filter((member) => !member.complete && !data.items.some((item) => item.id === member.workId))
            .length,
    };
}

/** One group status for its row, details, build header and desk; shaping cannot mask delivery. */
export function groupState(parent: Item, data: GroupData, unavailable = false) {
    const group =
        parent.kind === 'concept' ||
        (parent.flow === 'linked' && (!parent.parentId || data.items.some((item) => item.parentId === parent.id)));

    const ownsBuild =
        parent.kind !== 'concept' &&
        (parent.linkedPrs?.length ||
            parent.buildPhase ||
            (Array.isArray(parent.threads) && parent.threads.some((thread) => thread.purpose === 'build')));

    if (
        !group ||
        ownsBuild ||
        parent.kind === 'decision' ||
        (!parent.conceptBuild && !parent.releasePlan && !data.items.some((item) => item.parentId === parent.id))
    )
        return null;

    const progress = groupBuildProgress(parent, data, unavailable);
    const delivery = progress.total > 0 && progress.complete === progress.total;
    const parts = data.items.filter((item) => item.parentId === parent.id);
    const pending = parts.filter((item) => !complete(item));
    const waiting = humanWait(parent, unavailable, data.items);
    const run = parent.conceptBuild?.run;
    const running = !complete(parent) && progress.building > 0;
    const activity = groupProgress(parent, data.items, unavailable);
    const buildWord = running
        ? `${plural(progress.building, 'build')} running${progress.waiting ? ` · ${progress.waiting} waiting` : ''}`
        : null;
    const word = complete(parent)
        ? 'Delivered'
        : parent.paused
          ? 'Group paused'
          : run?.state === 'paused' && (progress.waiting || pending.length)
            ? `Concept builds paused${buildWord ? ` · ${buildWord}` : ''}`
            : (activity ??
              buildWord ??
              (waiting && waiting.label !== 'Release step'
                  ? waiting.label
                  : delivery && !pending.length && parent.releasePlan?.steps.some((step) => !step.done)
                    ? 'Waiting on release step'
                    : delivery && !pending.length && releaseHolds(parent.releasePlan).length
                      ? parent.releasePlan?.outcomeCheck.result === 'failed'
                          ? 'Outcome check failed'
                          : 'Waiting on Outcome check'
                      : run?.state === 'running'
                        ? 'Concept builds running'
                        : pending.length
                          ? // Done over all its parts, those off the board included, as the board's parts count says it.
                            parent.subIssues?.total
                              ? `${parent.subIssues.completed}/${parent.subIssues.total} parts done`
                              : `${parts.length - pending.length}/${parts.length} parts done`
                          : parent.subIssues?.total > parts.length
                            ? 'Some parts are outside the board'
                            : progress.total
                              ? 'Waiting on delivery'
                              : parent.refinement?.complete
                                ? 'Refined · no delivery planned'
                                : parent.status));

    return { word, running, progress };
}
