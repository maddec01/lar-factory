// The progress at the top of Lar Factory's item dialog: the workflow's steps as a bar, a concept's parts done, and a
// piece of work's slices as chips under their count.

import { SegmentedProgress } from '@lar-works/design-system';
import type { ReactNode } from 'react';

import type { DataAttributes } from './DataAttributes';

/** The dialog's progress block: the steps, the parts, the activity and the slices, stacked. */
export function ItemProgressPanel({
    children,
    ...data
}: {
    /** The steps, parts, activity and slices. */
    children: ReactNode;
} & DataAttributes) {
    return (
        <div {...data} className="grid min-w-0 grid-cols-[minmax(0,1fr)] gap-2">
            {children}
        </div>
    );
}

/** A count's line over its bar, such as "Slices · 2/3 done": `label` in the text colour, then `children`. */
export function ProgressCount({
    label,
    children,
}: {
    /** The count's name, such as "Slices", in the text colour. */
    label: string;
    /** The count, such as "2/3 done". */
    children: ReactNode;
}) {
    return (
        <p className="text-fg-muted m-0 text-xs">
            <span className="text-fg font-medium">{label}</span> · {children}
        </p>
    );
}

/**
 * Where the work stands in its workflow, on one line: the current step's name, then a short track of the workflow's
 * steps (the design system's segmented track: past stages done, upcoming ones bare, the current one in `color`, filled
 * to `value`, such as its slices done, or outlined while it `waiting`s); its `ordinal`, such as "Stage 4 of 7", on hover.
 */
export function WorkflowSteps({
    steps,
    at,
    name,
    ordinal,
    color,
    value,
    pulse = false,
    waiting = false,
}: {
    /** The workflow's active steps, each with its label (for assistive technology) and title (its name under it). */
    steps: readonly { title: string; label: string }[];
    /** The current step's index. */
    at: number;
    /** The current step's name, which labels the track (its name under the track is drawn from `steps`). */
    name: string;
    /** Explicit stage position, such as "Stage 5 of 8", read with the track's name; the names under it show it. */
    ordinal?: string;
    /** The current step's colour, a board role colour. */
    color: string;
    /** How much of the current step is done, from 0 to 1, such as its slices; all of it by default. */
    value?: number | undefined;
    /** The current step's work runs: its fill breathes. */
    pulse?: boolean;
    /** The current step hasn't begun, so nothing of it is drawn as done. */
    waiting?: boolean;
}) {
    return (
        <div className="flex min-w-0 items-center gap-3" title={ordinal} data-steps>
            {/* The stage in words, then where it sits in the workflow on a short track: one line, not a band. */}
            <span className="text-fg shrink-0 text-sm font-medium" data-step-names>
                {steps[at]?.title ?? name}
            </span>
            <span className="w-28 shrink-0">
                <SegmentedProgress
                    label={ordinal ? `${ordinal}: ${name}` : name}
                    size="sm"
                    current={at}
                    segments={steps.map((step, i) =>
                        i < at
                            ? { label: step.label, state: 'ready' as const, color: 'var(--color-board-past)' }
                            : i === at
                              ? { label: step.label, color, value, pulse, waiting }
                              : { label: step.label },
                    )}
                />
            </span>
        </div>
    );
}

/** A concept's parts done out of its parts, as a ProgressCount over a bar in the done colour. */
export function PartsProgress({
    label,
    completed,
    total,
    note,
    children,
}: {
    /** The count's name, such as "Parts". */
    label: string;
    /** How many parts are done. */
    completed: number;
    /** How many parts there are. */
    total: number;
    /** What the count says, such as "4/9 done". */
    children: ReactNode;
    /** Why the count holds parts the list below doesn't show, beside the count. */
    note?: string | undefined;
}) {
    return (
        <div className="grid gap-1.5" data-parts-progress>
            <ProgressCount label={label}>
                {children}
                {note && <span data-parts-note> · {note}</span>}
            </ProgressCount>
            <SegmentedProgress
                label={`${label}: ${completed} of ${total} done`}
                segments={[
                    {
                        label: `${completed} of ${total} done`,
                        state: 'ready',
                        value: total > 0 ? completed / total : 0,
                    },
                ]}
            />
        </div>
    );
}

/** The activity under the steps: its track, then its label. */
export function ProgressActivity({
    children,
}: {
    /** The activity's track and label. */
    children: ReactNode;
}) {
    return <div className="grid gap-1">{children}</div>;
}

/** The slices under the steps: their `count` line, with a slice `bar` 12px after it at a fixed 112px when the steps
 *  don't hold it, then their list, as the board's slice rows. */
export function SliceChips({
    count,
    bar,
    children,
}: {
    /** The slices' count line. */
    count: ReactNode;
    /** A slice bar, when the steps don't hold it. */
    bar?: ReactNode;
    /** The slices' list, a SliceList. */
    children: ReactNode;
}) {
    return (
        <div className="grid min-w-0 grid-cols-[minmax(0,1fr)] gap-2 not-first:mt-4" data-slices>
            <div className="flex min-w-0 items-center">
                {count}
                {bar && (
                    <div aria-hidden className="ms-3 w-28 shrink-0">
                        {bar}
                    </div>
                )}
            </div>
            {children}
        </div>
    );
}
