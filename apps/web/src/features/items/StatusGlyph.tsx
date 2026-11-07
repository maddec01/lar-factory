// One glyph per status, the way T3 marks a thread working, waiting or done, in the status's colour: the design system's
// StatusGlyph, animated while the board trusts that the item's work runs.

import {
    activityLost,
    activityUnavailable,
    buildActivity,
    itemActivityLine,
    itemActivityThread,
} from '@lar-factory/shared';
import type { Item, Status } from '@lar-factory/shared';
import { StatusGlyph, statusColor } from '@lar-works/design-system';
import type { ComponentProps } from 'react';
import { useShallow } from 'zustand/react/shallow';

import { useStartStore } from './StartStore';
import { useBoardStore } from '@/services/board/board.hooks';
import { useClock } from '@/shared/time/useClock';

export { StatusGlyph };

/** Each status's colour, as the design system's StatusGlyph draws it. */
export const STATUS_COLOR: Record<Status, string> = statusColor;

/** Current execution for status icons, including delegated work after its parent turn ends. */
export function useStatusActivity() {
    const unavailable = useBoardStore(
        ({ data, now, clientError }) =>
            activityUnavailable(data, now, clientError) ||
            !!data.localProblem ||
            (!!data.tools?.t3 && data.tools.t3.result !== 'ok') ||
            (!!data.t3Availability &&
                (data.t3Availability.availability !== 'available' || !!data.t3Availability.observedAt)),
    );
    // A push makes a new startProgress each time, so this selects the ids of the items with a start in flight.
    const starting = useBoardStore(
        useShallow((state) =>
            Object.entries(state.data.startProgress ?? {})
                .filter(([, starts]) =>
                    Object.values(starts).some(
                        (start) => start.phase === 'starting' || start.phase === 'may-have-started',
                    ),
                )
                .map(([id]) => id),
        ),
    );
    const starts = useStartStore((state) => state.starts);
    const builds = useStartStore((state) => state.builds);

    return (item: Item): boolean => {
        if (unavailable || item.paused || item.archived || item.needsYou || item.threads === 'unavailable')
            return false;

        // A thread waiting on the user, stopped, or whose activity T3 couldn't give isn't known to be moving.
        const now = Date.now();
        const line = itemActivityLine(item, now)?.state;

        if (line === 'waiting' || line === 'stopped' || activityLost(itemActivityThread(item)?.activity, now))
            return false;

        if (starts[item.id]?.phase === 'pending' || builds[item.id]?.phase === 'pending' || starting.includes(item.id))
            return false;

        if (item.status === 'Shaping') {
            return !!item.threads?.some(
                (thread) =>
                    thread.purpose !== 'build' &&
                    !thread.observedAt &&
                    !thread.archived &&
                    (thread.currentRunning || thread.hasRunningChildren),
            );
        }

        return (
            ['In progress', 'Review', 'Verify', 'Ready to merge'].includes(item.status) && buildActivity(item).running
        );
    };
}

/** The item's recorded status, animated only while its execution is trusted. */
export function ItemStatusGlyph({
    item,
    status = item.status,
    presentation,
}: {
    item: Item;
    status?: Status;
    presentation?: ComponentProps<typeof StatusGlyph>['presentation'];
}) {
    const running = useStatusActivity();

    // A read going old changes the answer with no new data.
    useClock((now) => activityLost(itemActivityThread(item)?.activity, now));

    return <StatusGlyph status={status} running={running(item)} presentation={presentation} />;
}
