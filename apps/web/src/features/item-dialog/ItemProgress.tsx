// The item dialog's progress at the top of its panel: active steps as a bar with each step's name under it, the past
// done, the upcoming faint and the current one in its colour, named by the recorded stage with its step number (the
// header above says what the item is doing now, so the two never repeat each other), drawn empty while the stage
// hasn't begun. An item with slices fills its current step by the slices done, so the dialog draws one bar, never a
// second track of its own for the slices. A chip for each slice follows, so what the bar shows is also readable; each opens its ticket, so the sidebar doesn't list them again. A
// concept has no step of its own to show: it shows its parts done, and why the count holds parts its list doesn't.

import { itemName } from '@lar-factory/shared';
import type { Item, Status } from '@lar-factory/shared';
import { statusStateColors } from '@lar-works/design-system';

import {
    ActivityFeedback,
    useActivityFeedback,
    useShownStatus,
    SliceBar,
    shownSliceProgress,
    SourceIcon,
    STATUS_COLOR,
    WORKFLOW_STEPS,
} from '@/features/items';
import { partsOf, unreadParts, unreadPartsText } from '@/features/line';
import { useBoardStore } from '@/services/board/board.hooks';
import {
    ItemProgressPanel,
    PartsProgress,
    ProgressActivity,
    ProgressCount,
    SliceChip,
    SliceChips,
    sliceProgressLabel,
    WorkflowSteps,
} from '@/ui/board';

/** A stage the item waits to begin: its turn in the Queue, or a build not started. */
const WAITING: readonly Status[] = ['Queued', 'Ready'];

export function ItemProgress({ item }: { item: Item }) {
    const feedback = useActivityFeedback(item);
    const shown = useShownStatus(item);
    const items = useBoardStore((state) => state.data.items);
    const at = WORKFLOW_STEPS.findIndex((stage) => stage === shown.progressStage);
    const split = item.slices.length > 0;
    const done = item.slices.filter((s) => s.progress === 'done').length;
    const concept = item.kind === 'concept';
    const parts = concept && item.subIssues.total > 0;
    const missing = parts ? unreadParts(item, partsOf(item, items)) : 0;

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
                    {item.subIssues.completed}/{item.subIssues.total} done
                </PartsProgress>
            )}
            {at >= 0 && !concept && (
                <WorkflowSteps
                    steps={WORKFLOW_STEPS.map((s, i) => ({
                        title: s,
                        label: `Step ${i + 1} of ${WORKFLOW_STEPS.length}: ${s}`,
                    }))}
                    at={at}
                    name={shown.progressStage}
                    ordinal={`Stage ${at + 1} of ${WORKFLOW_STEPS.length}`}
                    // The presenter keeps the bar’s section and evidence aligned with the header.
                    color={
                        shown.progressState
                            ? statusStateColors[shown.progressState]
                            : shown.glyphState
                              ? statusStateColors[shown.glyphState]
                              : STATUS_COLOR[item.status]
                    }
                    // An item with slices fills its current step by the slices done.
                    value={split ? Math.max(done, 0.5) / item.slices.length : undefined}
                    pulse={feedback.running}
                    waiting={WAITING.includes(item.status) && !shown.execution}
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
                        <ProgressCount label="Slices">
                            {done}/{item.slices.length} done
                        </ProgressCount>
                    }
                    bar={at < 0 || concept ? <SliceBar item={item} thick /> : undefined}
                >
                    {item.slices.map((s) => (
                        <SliceChip
                            key={s.workId ?? s.number}
                            title={`${itemName(s)} (${sliceProgressLabel[shownSliceProgress(item, s.progress)]})`}
                            source={<SourceIcon item={s} />}
                            progress={shownSliceProgress(item, s.progress)}
                            number={s.number}
                            name={s.title}
                            href={s.url || undefined}
                        />
                    ))}
                </SliceChips>
            )}
        </ItemProgressPanel>
    );
}
