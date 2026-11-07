// An item's activity as the board reads it from T3: whether it is at work, the Status the board names it by, and the
// track that sweeps while it runs.

import {
    activityLost,
    activityUnavailable,
    buildActivity,
    itemActivityLine,
    itemActivityThread,
    startProgressOf,
    workingAgain,
} from '@lar-factory/shared';
import type { Item, Status } from '@lar-factory/shared';

import { PURPOSE, useStart } from './StartStore';
import { useBoardStore } from '@/services/board/board.hooks';
import { ambientMotion } from '@/shared/motion/AmbientMotion';
import { useClock } from '@/shared/time/useClock';

export const useActivityUnavailable = () =>
    useBoardStore(({ data, now, clientError }) => activityUnavailable(data, now, clientError));

/** Whether T3's answer for `item`'s thread is lost, which a read going old changes with no new data. */
const useActivityLost = (item: Item) => useClock((now) => activityLost(itemActivityThread(item)?.activity, now));

export function useActivityFeedback(item: Item) {
    const data = useBoardStore((state) => state.data);
    // Shaping work has an activity only while a start runs; Start build's holds every other status.
    const kind = item.status === 'Shaping' || item.status === 'Queued' ? 'refine' : 'build';
    const pressed = useStart(item.id, kind)?.phase === 'pending';
    const unavailable = useActivityUnavailable();
    const disconnected = useBoardStore((state) => !!state.clientError);
    const lineState = useClock((now) => itemActivityLine(item, now, disconnected)?.state);
    // An error from another read, such as GitHub's, leaves T3's activity readable, and the row's phase with it.
    const readable = !!lineState && lineState !== 'unavailable';
    const lost = useActivityLost(item);

    return buildActivity(
        item,
        (unavailable && !readable) || lost,
        pressed ? { phase: 'starting' } : startProgressOf(data, item.id, PURPOSE[kind]),
    );
}

/** How the board names an item now: its recorded Status, or Working while it is at work again. */
export function shownStatus(item: Item, unavailable: boolean): { working: boolean; word: string; glyph: Status } {
    return workingAgain(item, unavailable)
        ? { working: true, word: 'Working', glyph: 'In progress' }
        : { working: false, word: item.status, glyph: item.status };
}

export const useShownStatus = (item: Item) => {
    const unavailable = useActivityUnavailable();
    const lost = useActivityLost(item);

    return shownStatus(item, unavailable || lost);
};

export function ActivityFeedback({
    feedback,
    labelOnly = false,
}: {
    feedback: ReturnType<typeof buildActivity>;
    labelOnly?: boolean;
}) {
    if (labelOnly)
        return (
            <span className="block h-4 text-[11px] leading-4 whitespace-nowrap text-(--muted-foreground)">
                {feedback.label}
            </span>
        );

    return (
        <div
            role="img"
            aria-label={feedback.label}
            className="activity-track h-1.5 overflow-hidden rounded-full bg-(--soft)"
        >
            {feedback.running && (
                <span ref={ambientMotion} className="activity-sweep block h-1.5 w-1/3 rounded-full bg-(--st-now)" />
            )}
        </div>
    );
}
