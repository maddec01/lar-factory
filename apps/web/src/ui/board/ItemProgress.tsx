// The progress at the top of Lar Factory's item dialog: the workflow's steps as a bar, a concept's parts done, and a
// piece of work's slices as chips under their count.

import { SegmentedProgress } from '@lar-works/design-system';
import type { ReactNode } from 'react';

import type { DataAttributes } from './DataAttributes';
import type { SliceProgress } from './Slices';
import { SliceMark } from './Slices';
import { sliceProgressLabel } from './StatusColors';

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
 * The workflow's equal-width steps (the design system's segmented track) with each step's name under it: past stages
 * done, upcoming stages the bare track, and the current one in `color`, filled to `value` (such as its slices done) or
 * outlined while it `waiting`s (a queued item's, never a filled one). The ordinal sits above the track and the current
 * step's name under it, in the text colour, so the name shows once; `name` labels the track for assistive technology.
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
    /** Explicit stage position, such as "Stage 5 of 8"; omitted when the caller needs only the name. */
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
        <div className="grid min-w-0 gap-1.5" data-steps>
            {ordinal && <p className="text-fg-muted m-0 text-xs tabular-nums">{ordinal}</p>}
            <SegmentedProgress
                label={ordinal ? `${ordinal}: ${name}` : name}
                current={at}
                segments={steps.map((step, i) =>
                    i < at
                        ? { label: step.label, state: 'ready' as const }
                        : i === at
                          ? { label: step.label, color, value, pulse, waiting }
                          : { label: step.label },
                )}
            />
            {/* Each step's name under its segment, on the track's columns; on a phone, where the names don't fit, the
                current step's alone. */}
            <ol
                aria-hidden="true"
                className="text-fg-muted m-0 grid list-none gap-0.75 p-0 text-xs"
                style={{ gridTemplateColumns: `repeat(${steps.length}, minmax(0, 1fr))` }}
                data-step-names
            >
                {steps.map((step, i) => (
                    <li
                        key={i}
                        title={step.title}
                        className={
                            i === at
                                ? 'text-fg truncate font-medium max-sm:overflow-visible max-sm:text-clip'
                                : 'truncate max-sm:invisible'
                        }
                    >
                        {step.title}
                    </li>
                ))}
            </ol>
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

/** The slices under the steps, 24px below their names: their `count` line, with a slice `bar` 12px after it at a fixed
 *  112px when the steps don't hold it, then a SliceChip each. */
export function SliceChips({
    count,
    bar,
    children,
}: {
    /** The slices' count line. */
    count: ReactNode;
    /** A slice bar, when the steps don't hold it. */
    bar?: ReactNode;
    /** The slices, one SliceChip each. */
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
            <ul className="m-0 flex list-none flex-wrap gap-1.5 p-0">{children}</ul>
        </div>
    );
}

const sliceChip =
    'border-line bg-surface-raised inline-flex max-w-full items-center gap-1.5 rounded-full border py-0.5 ps-1 pe-2.5 text-xs';

/** A slice as a chip: where its ticket is saved, its mark, number, title (muted when done, medium while active) and
 *  state; `title` names it in full. With `href` the chip opens its ticket in a new tab. */
export function SliceChip({
    title,
    source,
    progress,
    number,
    name,
    href,
}: {
    /** The slice in full, as its tooltip. */
    title: string;
    /** Where its ticket is saved, a SourceIcon. */
    source: ReactNode;
    /** The slice's state, which picks its mark. */
    progress: SliceProgress;
    /** The slice's number. */
    number?: number | undefined;
    /** The slice's title. */
    name: string;
    /** The slice's ticket, making the chip a link. */
    href?: string | undefined;
}) {
    const content = (
        <>
            <SliceMark progress={progress} />
            {source}
            {!!number && <span className="text-fg-muted shrink-0 tabular-nums">#{number}</span>}
            <span
                className={`min-w-0 truncate ${progress === 'done' ? 'text-fg-muted' : progress === 'active' ? 'font-medium' : ''}`}
            >
                {name}
            </span>
            <span className="text-fg-muted shrink-0">{sliceProgressLabel[progress]}</span>
        </>
    );

    return href ? (
        <li title={title} className="flex max-w-full">
            <a
                href={href}
                target="_blank"
                rel="noopener"
                className={`${sliceChip} text-fg hover:bg-fill-hover hover:border-line-strong no-underline transition-colors`}
            >
                {content}
            </a>
        </li>
    ) : (
        <li title={title} className={sliceChip}>
            {content}
        </li>
    );
}
