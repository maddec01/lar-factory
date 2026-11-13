import { humanWait, plural, releaseHolds, type Item } from '@lar-factory/shared';

import { useActivityUnavailable } from '@/features/items';
import { isDone, partsOf } from '@/features/line';
import { useBoardStore } from '@/services/board/board.hooks';
import { GroupStatus } from '@/ui/board';

export function GroupDetails({ item }: { item: Item }) {
    const { data } = useBoardStore();
    const parts = partsOf(item, data.items);
    const unavailable = useActivityUnavailable();
    const waiting = humanWait(item, unavailable);
    const running = parts.filter(
        (part) =>
            !unavailable &&
            part.kind === 'build' &&
            !isDone(part.item) &&
            Array.isArray(part.item.threads) &&
            part.item.threads.some(
                (thread) => !thread.observedAt && (thread.state === 'running' || thread.hasRunningChildren),
            ),
    ).length;
    const pending = parts.filter((part) => !isDone(part.item));
    const status = isDone(item)
        ? 'Delivered'
        : item.paused
          ? 'Group paused'
          : item.conceptBuild?.run?.state === 'paused' && pending.some((part) => part.kind === 'build')
            ? 'Concept builds paused'
            : waiting
              ? waiting.label
              : running
                ? `${plural(running, 'build')} running`
                : !pending.length && item.releasePlan?.steps.some((step) => !step.done)
                  ? 'Waiting on release step'
                  : !pending.length && releaseHolds(item.releasePlan).length
                    ? item.releasePlan?.outcomeCheck.result === 'failed'
                        ? 'Outcome check failed'
                        : 'Waiting on Outcome check'
                    : item.conceptBuild?.run?.state === 'running'
                      ? 'Concept builds running'
                      : pending.length
                        ? `${plural(pending.length, 'part')} remaining`
                        : item.subIssues.total > parts.length
                          ? 'Some parts are outside the board'
                          : 'Waiting on delivery';

    return <GroupStatus>{status}</GroupStatus>;
}
