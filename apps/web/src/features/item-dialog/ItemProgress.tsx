// The item dialog's progress at the top of its panel: active steps as a bar with each step's name under it, the past
// done, the upcoming faint and the current one in its colour, named by the recorded stage with its step number (the
// header above says what the item is doing now, so the two never repeat each other), drawn empty while the stage
// hasn't begun. An item with slices fills its current step by the slices done, so the dialog draws one bar, never a
// second track of its own for the slices. A chip for each slice follows, so what the bar shows is also readable; each opens its ticket, so the sidebar doesn't list them again. A
// concept has no step of its own to show: it shows its parts done, and why the count holds parts its list doesn't.

import { blockedText, openBlockers } from '@lar-factory/shared';
import type { Item } from '@lar-factory/shared';

import {
    ActivityFeedback,
    useActivityFeedback,
    useShownStatus,
    SliceBar,
    workflowSteps,
    SliceList,
} from '@/features/items';
import { partsOf, unreadParts, unreadPartsText } from '@/features/line';
import { useBoardStore } from '@/services/board/board.hooks';
import {
    ItemProgressPanel,
    PartsProgress,
    ProgressActivity,
    ProgressCount,
    SliceChips,
    WorkflowSteps,
} from '@/ui/board';

export function ItemProgress({ item }: { item: Item }) {
    const feedback = useActivityFeedback(item);
    const shown = useShownStatus(item);
    const items = useBoardStore((state) => state.data.items);
    const steps = workflowSteps(item);
    const at = steps.findIndex((stage) => stage === shown.progressStage);
    const done = item.slices.filter((s) => s.progress === 'done').length;
    const concept = item.kind === 'concept';
    const parts = concept && item.subIssues.total > 0;
    const missing = parts ? unreadParts(item, partsOf(item, items)) : 0;
    // The same test the summary's Status uses for Blocked.
    const held = !item.setAside && (shown.blocked || openBlockers(item).length > 0);

    if (at < 0 && !item.slices.length && !parts) return null;

    return (
        <ItemProgressPanel data-progress>
            {/* A concept's parts done out of its parts, as the records count them, including any retention took off the board. */}
            {parts && (
                <PartsProgress
                    label="Parts"
                    completed={item.subIssues.completed}
                    total={item.subIssues.total}
                    note={missing > 0 ? unreadPartsText(missing) : undefined}
                >
                    {item.subIssues.completed}/{item.subIssues.total} parts done
                </PartsProgress>
            )}
            {at >= 0 && !concept && (
                <WorkflowSteps
                    steps={steps.map((s, i) => ({
                        title: s,
                        label: `Step ${i + 1} of ${steps.length}: ${s}`,
                    }))}
                    at={at}
                    name={shown.progressStage}
                    ordinal={`Stage ${at + 1} of ${steps.length}`}
                    // Held as the sidebar's Status says Blocked, so the line never reads as ready to go.
                    held={held ? (blockedText(item) ?? 'Blocked') : undefined}
                />
            )}
            {at >= 0 && !item.slices.length && feedback.running && (
                <ProgressActivity>
                    <ActivityFeedback feedback={feedback} />
                </ProgressActivity>
            )}
            {item.slices.length > 0 && (
                <SliceChips
                    count={
                        <ProgressCount>
                            {done}/{item.slices.length} slices done
                        </ProgressCount>
                    }
                    bar={<SliceBar item={item} thick={at < 0 || concept} />}
                >
                    {/* The slices as the board's own slice list, a row each, not chips. */}
                    <SliceList item={item} />
                </SliceChips>
            )}
        </ItemProgressPanel>
    );
}
