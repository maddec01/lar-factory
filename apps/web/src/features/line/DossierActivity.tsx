// A grouped item's own stage and thread activity, independent of its parts' delivery summary.

import { groupState, type Item } from '@lar-factory/shared';

import { useActivityState, useActivityStill } from './useActivityState';
import { useActivityFeedback, useShownStatus } from '@/features/items';
import { useBoardStore } from '@/services/board/board.hooks';
import { RowState } from '@/ui/board';

export function DossierState({ item }: { item: Item }) {
    const shown = useShownStatus(item);

    const data = useBoardStore((state) => state.data);
    const stage = item.status === 'Ready' ? 'Ready to build' : item.status;
    // One word for the parent's state: its activity's when it works, else its stage's.
    const text =
        groupState(item, data) || shown.word === stage || shown.running ? shown.word : `${stage} · ${shown.word}`;

    // The second line's count says how many parts are done, so the state would say it twice.
    if (/^\d+\/\d+ parts done$/.test(text)) return null;

    return <RowState title={text}>{text}</RowState>;
}

/** Whether a grouped item's own thread is at work to report, so its row says what it does in place of its next step. */
export function useDossierActivity(item: Item): boolean {
    const feedback = useActivityFeedback(item);
    const shown = useShownStatus(item);
    const activity = useActivityState(item);
    const still = useActivityStill(item);
    const working = !still && (feedback.running || shown.running);

    // A running status that is its parts', not a thread of its own (a concept's, or a parent with no threads), leaves
    // the row its group state and next step: there is no activity of its own to show.
    const ownThreads = Array.isArray(item.threads) && item.threads.length > 0;

    if (shown.running && (item.kind === 'concept' || !ownThreads)) return false;

    return Boolean((activity && activity !== 'unavailable') || working);
}
