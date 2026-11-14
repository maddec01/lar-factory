// A grouped item's own stage and thread activity, independent of its parts' delivery summary.

import { groupState, type Item } from '@lar-factory/shared';

import { ActivityLine } from './ActivityLine';
import { RowSecondLine } from './Columns';
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
    if (text.endsWith(' parts done')) return null;

    return <RowState title={text}>{text}</RowState>;
}

export function DossierActivity({ item }: { item: Item }) {
    const feedback = useActivityFeedback(item);
    const shown = useShownStatus(item);
    const activity = useActivityState(item);
    const still = useActivityStill(item);
    const working = !still && (feedback.running || shown.running);

    if (shown.running && item.kind === 'concept') return null;

    if ((!activity || activity === 'unavailable') && !working && !item.slices.length) return null;

    // The row's parts track is its one bar: the parent's own work reads as its sentence alone.
    return (
        <RowSecondLine>
            <ActivityLine item={item} />
        </RowSecondLine>
    );
}
