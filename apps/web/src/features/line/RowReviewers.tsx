// A row's reviewers for its build's current review round (Code, Security, UI and the rest), drawn as its slices are: a
// tick for each in the progress column, and a count that unfolds them under the row, each with its mark and word. A
// work map card draws the same ticks under its foot and says the same count in it.

import type { Item, ReviewerStatus } from '@lar-factory/shared';

import { reviewCount } from './StageStatus';
import { RowProgress, RowSliceToggle, SliceBar, SliceList, SliceRow, type SliceProgress } from '@/ui/board';

/** Each reviewer's status as a slice's progress, so it takes a slice's mark and tick: running is active, a verdict or a
 *  finished run done, changes requested or a failed run failed, and one not started yet waiting. */
const PROGRESS: Record<ReviewerStatus, SliceProgress> = {
    Waiting: 'waiting',
    Running: 'active',
    Completed: 'done',
    Approved: 'done',
    'Changes requested': 'failed',
    Failed: 'failed',
};

/** A tick for each reviewer in its status's colour, each named with its status in the bar's tooltip. */
export function ReviewersBar({ item, still }: { item: Item; still: boolean }) {
    return (
        <SliceBar
            noun="Reviewers"
            still={still}
            slices={(item.reviewers ?? []).map((r) => ({ name: r.name, progress: PROGRESS[r.status], word: r.status }))}
        />
    );
}

/** The reviewers' ticks and how many have finished, which unfolds them. */
export function ReviewersProgress({
    item,
    open,
    onToggle,
    still,
}: {
    item: Item;
    open: boolean;
    onToggle: () => void;
    still: boolean;
}) {
    return (
        <RowProgress
            bar={<ReviewersBar item={item} still={still} />}
            count={
                <RowSliceToggle open={open} label={open ? 'Hide reviewers' : 'Show reviewers'} onToggle={onToggle}>
                    {reviewCount(item)}
                </RowSliceToggle>
            }
        />
    );
}

/** The reviewers unfolded under the row, as its slices unfold. */
export function ReviewerList({ item, still }: { item: Item; still: boolean }) {
    return (
        <SliceList>
            {(item.reviewers ?? []).map((r) => (
                <SliceRow
                    key={r.id}
                    source={null}
                    progress={PROGRESS[r.status]}
                    still={still}
                    title={`${r.name} review`}
                    label={r.status}
                />
            ))}
        </SliceList>
    );
}
