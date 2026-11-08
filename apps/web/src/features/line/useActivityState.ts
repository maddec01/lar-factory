// The activity state and stillness a row follows as T3's read ages. Only a change in the answer rerenders the row.

import { itemActivityLine, itemActivityStill } from '@lar-factory/shared';
import type { Item, ThreadActivityState } from '@lar-factory/shared';

import { useActivityFeedback } from '@/features/items';
import { useBoardStore } from '@/services/board/board.hooks';
import { useClock } from '@/shared/time/useClock';

/** The state of `item`'s line, if it shows one: a start in flight says its own progress. Its caller renders only when the state changes, not on every second. */
export function useActivityState(item: Item): ThreadActivityState | undefined {
    const disconnected = useBoardStore((state) => !!state.clientError);
    const { label } = useActivityFeedback(item);
    const state = useClock((now) => itemActivityLine(item, now, disconnected)?.state);

    return label === 'Starting' || label === 'May have started' ? undefined : state;
}

/** Whether `item`'s row stops animating, which a read going old changes with no new data. */
export function useActivityStill(item: Item): boolean {
    const disconnected = useBoardStore((state) => !!state.clientError);

    return useClock((now) => itemActivityStill(item, now, disconnected));
}
