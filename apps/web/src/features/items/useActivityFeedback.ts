// The activity and status an item shows, from T3's latest read and this page's pending starts. A read going old
// changes what the board can still say is working.

import {
    activityLost,
    activityUnavailable,
    buildActivity,
    itemActivityLine,
    itemActivityThread,
    startProgressOf,
} from '@lar-factory/shared';
import type { Item } from '@lar-factory/shared';

import { itemState, useItemState } from './ItemState';
import type { ItemState } from './ItemState';
import { PURPOSE, useStart } from './StartStore';
import { useBoardStore } from '@/services/board/board.hooks';
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

/** How the board names an item now, read at the time: the one presenter's answer, for a caller outside React's render. */
export const shownStatus = (item: Item, unavailable: boolean): ItemState => {
    const now = Date.now();

    return itemState(item, {
        unavailable,
        line: itemActivityLine(item, now)?.state,
        lost: activityLost(itemActivityThread(item)?.activity, now),
        starting: false,
    });
};

/** How the board names `item` now: the one presenter, ItemState. */
export const useShownStatus = useItemState;
