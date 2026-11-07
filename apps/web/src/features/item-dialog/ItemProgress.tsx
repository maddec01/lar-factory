// The item dialog's progress at the top of its panel: active steps as a bar, the past slim, the upcoming faint, and the
// current one widest, named, with its step number. While a build is In progress or in Review its segment divides into
// one mini segment per slice; at any other status the slices get a small bar of their own. A chip for each slice
// follows, so what the bar shows is also readable. A concept has no step of its own to show: it shows its parts done.

import { itemName } from '@lar-factory/shared';
import type { Item, Status } from '@lar-factory/shared';
import {
    ItemProgressPanel,
    PartsProgress,
    ProgressActivity,
    ProgressCount,
    SliceChip,
    SliceChips,
    WorkflowSteps,
} from '@lar-works/design-system';

import {
    ActivityFeedback,
    useActivityFeedback,
    useShownStatus,
    SliceBar,
    SourceIcon,
    STATUS_COLOR,
    WORKFLOW_STEPS,
} from '@/features/items';

const SPLIT_STATUSES: readonly Status[] = ['In progress', 'Review'];

export function ItemProgress({ item }: { item: Item }) {
    const feedback = useActivityFeedback(item);
    const shown = useShownStatus(item);
    const at = WORKFLOW_STEPS.indexOf(item.status);
    const split = item.slices.length > 0 && SPLIT_STATUSES.includes(item.status);
    const done = item.slices.filter((s) => s.progress === 'done').length;
    const concept = item.kind === 'concept';
    const parts = concept && item.subIssues.total > 0;

    if (at < 0 && !item.slices.length && !parts) return null;

    return (
        <ItemProgressPanel data-progress>
            {/* A concept's parts done out of its parts, as the records count them, including any retention took off the board. */}
            {parts && (
                <PartsProgress label="Parts" completed={item.subIssues.completed} total={item.subIssues.total}>
                    {item.subIssues.completed}/{item.subIssues.total} done
                </PartsProgress>
            )}
            {at >= 0 && !concept && (
                <WorkflowSteps
                    steps={WORKFLOW_STEPS.map((s, i) => {
                        const name = i === at ? shown.word : s;

                        return { title: name, label: `Step ${i + 1} of ${WORKFLOW_STEPS.length}: ${name}` };
                    })}
                    at={at}
                    name={shown.word}
                    color={STATUS_COLOR[item.status]}
                    bar={split ? <SliceBar item={item} thick /> : undefined}
                />
            )}
            {at >= 0 && !item.slices.length && (
                <ProgressActivity>
                    <ActivityFeedback feedback={feedback} />
                    <ActivityFeedback feedback={feedback} labelOnly />
                </ProgressActivity>
            )}
            {item.slices.length > 0 && (
                <SliceChips
                    count={
                        <ProgressCount label="Slices">
                            {done}/{item.slices.length} done
                        </ProgressCount>
                    }
                    bar={split ? undefined : <SliceBar item={item} thick />}
                >
                    {item.slices.map((s) => (
                        <SliceChip
                            key={s.workId ?? s.number}
                            title={`${itemName(s)} (${s.progress})`}
                            source={<SourceIcon item={s} />}
                            progress={s.progress}
                            number={s.number}
                            name={s.title}
                        />
                    ))}
                </SliceChips>
            )}
        </ItemProgressPanel>
    );
}
