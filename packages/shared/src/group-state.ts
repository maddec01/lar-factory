import type { BoardData } from './board-domain.ts';
import { plural } from './format.ts';
import { humanWait } from './human-wait.ts';
import type { Item } from './item-domain.ts';
import { releaseHolds } from './release-plan.ts';
import { buildsAtWork, ownerThreads } from './thread-domain.ts';

type GroupData = Pick<BoardData, 'items' | 'startProgress'>;

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
        parent.kind === 'build' ||
        (!parent.conceptBuild && !parent.releasePlan && !data.items.some((item) => item.parentId === parent.id))
    )
        return null;

    const progress = groupBuildProgress(parent, data, unavailable);
    const parts = data.items.filter((item) => item.parentId === parent.id);
    const pending = parts.filter((item) => !complete(item));
    const waiting = humanWait(parent, unavailable, data.items);
    const run = parent.conceptBuild?.run;
    const running = !complete(parent) && progress.building > 0;
    const buildWord = running
        ? `${plural(progress.building, 'build')} running${progress.waiting ? ` · ${progress.waiting} waiting` : ''}`
        : null;
    const word = complete(parent)
        ? 'Delivered'
        : parent.paused
          ? 'Group paused'
          : run?.state === 'paused' && (progress.waiting || pending.length)
            ? `Concept builds paused${buildWord ? ` · ${buildWord}` : ''}`
            : (buildWord ??
              (waiting && waiting.label !== 'Release step'
                  ? waiting.label
                  : !pending.length && parent.releasePlan?.steps.some((step) => !step.done)
                    ? 'Waiting on release step'
                    : !pending.length && releaseHolds(parent.releasePlan).length
                      ? parent.releasePlan?.outcomeCheck.result === 'failed'
                          ? 'Outcome check failed'
                          : 'Waiting on Outcome check'
                      : run?.state === 'running'
                        ? 'Concept builds running'
                        : pending.length
                          ? `${plural(pending.length, 'part')} remaining`
                          : parent.subIssues?.total > parts.length
                            ? 'Some parts are outside the board'
                            : progress.total
                              ? 'Waiting on delivery'
                              : parent.status));

    return { word, running, progress };
}
