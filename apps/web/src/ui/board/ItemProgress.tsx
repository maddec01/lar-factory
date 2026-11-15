// The progress at the top of Lar Factory's item dialog: the workflow's steps as a bar, a concept's parts done, and a
// piece of work's slices as chips under their count.

import { SegmentedProgress } from '@lar-works/design-system';
import { ChevronRightIcon } from '@lar-works/design-system/icons';
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
    children,
}: {
    /** The count in the row's words, such as "2/3 slices done". */
    children: ReactNode;
}) {
    return <p className="text-fg m-0 text-sm font-medium">{children}</p>;
}

/**
 * Where the work stands in its workflow, on one line: every step named in order, the past a step brighter than what's
 * to come and the current one on a soft fill, each label on the same column whichever is current; its `ordinal`, such
 * as "Stage 4 of 7", on hover.
 */
export function WorkflowSteps({
    steps,
    at,
    name,
    ordinal,
}: {
    /** The workflow's active steps, each with its label (for assistive technology) and title (its name under it). */
    steps: readonly { title: string; label: string }[];
    /** The current step's index. */
    at: number;
    /** The current step's name, which labels the track (its name under the track is drawn from `steps`). */
    name: string;
    /** Explicit stage position, such as "Stage 5 of 8", read with the track's name; the names under it show it. */
    ordinal?: string;
}) {
    return (
        <ol
            className="m-0 flex min-w-0 list-none flex-wrap items-center gap-x-1 gap-y-1 p-0 text-xs"
            title={ordinal}
            data-steps
        >
            <span className="sr-only">{ordinal ? `${ordinal}: ${name}` : name}</span>
            {/* Every step named in order, the past quiet, the current one marked in its colour, what's to come faint. */}
            {steps.map((step, i) => (
                // A plain first step's label starts on the gutter; a current one's fill does, as no fill crosses it.
                <li
                    key={step.title}
                    className={`flex items-center gap-1 ${i === 0 && at !== 0 ? '-ml-2' : ''}`}
                    aria-label={step.label}
                >
                    {i > 0 && <ChevronRightIcon aria-hidden="true" className="text-fg-muted size-3" />}
                    {i === at ? (
                        // The sidebar's status says its state, so the step names where the work is, without a second light.
                        <span className="bg-fill-muted text-fg rounded-md px-2 py-0.5 font-medium" data-step-names>
                            {step.title}
                        </span>
                    ) : (
                        <span className={`px-2 py-0.5 ${i < at ? 'text-fg-soft' : 'text-fg-muted'}`}>{step.title}</span>
                    )}
                </li>
            ))}
        </ol>
    );
}

/** Where the work stands in its workflow, in miniature: one short segment per step, the past filled quietly, the current
 *  one in `color`, what's to come on the track; `label` names it for screen readers and as its tooltip. */
export function StageTrack({
    steps,
    at,
    color,
    label,
    step,
}: {
    /** The current step's name, quiet after the track, so it reads at a glance. */
    step?: string | undefined;
    /** How many steps the workflow has. */
    steps: number;
    /** The current step's index. */
    at: number;
    /** The current step's colour. */
    color: string;
    /** Where it stands in words, such as "Step 5 of 7: Build". */
    label: string;
}) {
    return (
        <span className="text-fg-muted inline-flex items-center gap-2 text-xs" title={label}>
            {step && <span aria-hidden="true">{step}</span>}
            <span role="img" aria-label={label} className="inline-flex items-center gap-0.5" data-stage-track>
                {Array.from({ length: steps }, (_, i) => (
                    <span
                        key={i}
                        className={`h-1 w-2 rounded-full ${i < at ? 'bg-fg-muted opacity-60' : i === at ? '' : 'bg-track'}`}
                        style={i === at ? { background: color } : undefined}
                    />
                ))}
            </span>
        </span>
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
            <ProgressCount>
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
