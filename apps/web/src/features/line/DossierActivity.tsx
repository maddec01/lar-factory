// A grouped item's own stage and thread activity, independent of its parts' delivery summary.

import type { Item } from '@lar-factory/shared';

import { ActivityLine } from './ActivityLine';
import { RowSecondLine } from './Columns';
import { useActivityState, useActivityStill } from './useActivityState';
import { ActivityFeedback, SliceBar, useActivityFeedback, useShownStatus } from '@/features/items';
import { RowState } from '@/ui/board';

export function DossierState({ item }: { item: Item }) {
    const shown = useShownStatus(item);
    const stage = item.status === 'Ready' ? 'Ready to build' : item.status;

    const text = shown.word === stage ? stage : `${stage} · ${shown.word}`;

    return <RowState title={text}>{text}</RowState>;
}

export function DossierActivity({ item }: { item: Item }) {
    const feedback = useActivityFeedback(item);
    const shown = useShownStatus(item);
    const activity = useActivityState(item);
    const still = useActivityStill(item);
    const working = !still && (feedback.running || shown.running);

    if ((!activity || activity === 'unavailable') && !working && !item.slices.length) return null;

    return (
        <RowSecondLine
            bar={
                item.slices.length ? (
                    <SliceBar item={item} still={still} />
                ) : (
                    working && <ActivityFeedback feedback={{ ...feedback, running: true }} />
                )
            }
        >
            <ActivityLine item={item} />
        </RowSecondLine>
    );
}
