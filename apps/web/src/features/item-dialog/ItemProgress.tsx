// The item dialog's progress at the top of its panel: active steps as a bar, the past slim, the upcoming faint, and the
// current one widest, named, with its step number. While a build is In progress or in Review its segment divides into
// one mini segment per slice; at any other status the slices get a small bar of their own. A chip for each slice
// follows, so what the bar shows is also readable. A concept has no step of its own to show: it shows its parts done.

import { itemName } from '@lar-factory/shared';
import type { Item, Slice, Status } from '@lar-factory/shared';

import { ActivityFeedback, useActivityFeedback, useShownStatus, SliceBar, SliceMark } from '@/features/items/ItemParts';
import { SourceIcon } from '@/features/items/SourceIcon';
import { STATUS_COLOR } from '@/features/items/StatusGlyph';
import { WORKFLOW_STEPS } from '@/features/items/WorkflowSteps';

const SPLIT_STATUSES: readonly Status[] = ['In progress', 'Review'];

function SliceChip({ slice }: { slice: Slice }) {
    return (
        <li
            title={`${itemName(slice)} (${slice.progress})`}
            className="inline-flex max-w-full items-center gap-1.5 rounded-full border border-(--border) bg-(--card) py-0.5 ps-1 pe-2.5 text-xs"
        >
            <SourceIcon item={slice} />
            <SliceMark progress={slice.progress} />
            {slice.number > 0 && (
                <span className="shrink-0 text-(--muted-foreground) tabular-nums">#{slice.number}</span>
            )}
            <span
                className={`min-w-0 truncate ${slice.progress === 'done' ? 'text-(--muted-foreground)' : slice.progress === 'active' ? 'font-medium' : ''}`}
            >
                {slice.title}
            </span>
            <span className="shrink-0 text-[11px] text-(--muted-foreground)">{slice.progress}</span>
        </li>
    );
}

/** A concept's parts done out of its parts, as the records count them, including any retention took off the board. */
function PartsProgress({ item }: { item: Item }) {
    const { completed, total } = item.subIssues;

    return (
        <div className="grid gap-1" data-parts-progress>
            <p className="m-0 text-xs text-(--muted-foreground)">
                <span className="font-medium text-(--foreground)">Parts</span> · {completed}/{total} done
            </p>
            <div aria-hidden className="h-1.5 overflow-hidden rounded-full bg-(--soft)">
                <div
                    className="h-full rounded-full bg-(--st-done)"
                    style={{ width: `${(completed / total) * 100}%` }}
                />
            </div>
        </div>
    );
}

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
        <div className="grid min-w-0 grid-cols-[minmax(0,1fr)] gap-2" data-progress>
            {parts && <PartsProgress item={item} />}
            {at >= 0 && !concept && (
                <ol className="m-0 flex list-none items-end gap-[3px] p-0" data-steps>
                    {WORKFLOW_STEPS.map((s, i) => {
                        const name = i === at ? shown.word : s;
                        const label = `Step ${i + 1} of ${WORKFLOW_STEPS.length}: ${name}`;

                        if (i !== at) {
                            return (
                                <li
                                    key={s}
                                    title={s}
                                    aria-label={label}
                                    className="h-1.5 min-w-1.5 flex-1 rounded-full"
                                    style={{
                                        background:
                                            i < at
                                                ? 'color-mix(in srgb, var(--foreground) 28%, transparent)'
                                                : 'var(--soft)',
                                    }}
                                />
                            );
                        }

                        return (
                            <li
                                key={s}
                                title={name}
                                aria-label={label}
                                aria-current="step"
                                className="grid min-w-26 flex-[6] gap-1"
                            >
                                <span className="flex items-baseline justify-between gap-2 text-xs leading-4">
                                    <span className="truncate font-medium">{name}</span>
                                    <span className="shrink-0 text-(--muted-foreground) tabular-nums">
                                        {i + 1}/{WORKFLOW_STEPS.length}
                                    </span>
                                </span>
                                {split ? (
                                    <div aria-hidden>
                                        <SliceBar item={item} thick />
                                    </div>
                                ) : (
                                    <span
                                        className="h-1.5 rounded-full"
                                        style={{
                                            background: `linear-gradient(90deg, color-mix(in srgb, ${STATUS_COLOR[s]} 55%, transparent), ${STATUS_COLOR[s]})`,
                                        }}
                                    />
                                )}
                            </li>
                        );
                    })}
                </ol>
            )}
            {at >= 0 && !item.slices.length && (
                <div className="grid gap-1">
                    <ActivityFeedback feedback={feedback} />
                    <ActivityFeedback feedback={feedback} labelOnly />
                </div>
            )}
            {item.slices.length > 0 && (
                <div className="grid min-w-0 grid-cols-[minmax(0,1fr)] gap-2" data-slices>
                    <p className="m-0 text-xs text-(--muted-foreground)">
                        <span className="font-medium text-(--foreground)">Slices</span> · {done}/{item.slices.length}{' '}
                        done
                    </p>
                    {!split && (
                        <div aria-hidden>
                            <SliceBar item={item} thick />
                        </div>
                    )}
                    <ul className="m-0 flex list-none flex-wrap gap-1.5 p-0">
                        {item.slices.map((s) => (
                            <SliceChip key={s.workId ?? s.number} slice={s} />
                        ))}
                    </ul>
                </div>
            )}
        </div>
    );
}
