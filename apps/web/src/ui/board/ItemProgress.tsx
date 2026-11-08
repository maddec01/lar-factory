// The progress at the top of Lar Factory's item dialog: the workflow's steps as a bar, a concept's parts done, and a
// piece of work's slices as chips under their count.

import type { ReactNode } from 'react';

import type { DataAttributes } from './DataAttributes';
import type { SliceProgress } from './Slices';
import { SliceMark } from './Slices';
import { sliceProgressLabel } from './StatusColors';

const PAST = 'var(--color-board-past)';

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
 * The workflow’s equal-width steps: past stages darker, upcoming stages faint, and the current one in `color`,
 * or its slice `bar`. Its `name` and ordinal sit above the track.
 * A step that hasn't begun (`waiting`, such as a queued item's) is an empty track outlined in `color`, never a filled
 * one. Each step's `label` is what assistive technology reads and its `title` its tooltip.
 */
export function WorkflowSteps({
    steps,
    at,
    name,
    ordinal,
    color,
    bar,
    waiting = false,
}: {
    /** The workflow's active steps, each with its label and title. */
    steps: readonly { title: string; label: string }[];
    /** The current step's index. */
    at: number;
    /** The current step's name. */
    name: string;
    /** Explicit stage position, such as "Stage 5 of 8"; omitted when the caller needs only the name. */
    ordinal?: string;
    /** The current step's colour, a board role colour. */
    color: string;
    /** What fills the current step in place of the gradient, such as its slices. */
    bar?: ReactNode;
    /** The current step hasn't begun, so nothing of it is drawn as done. */
    waiting?: boolean;
}) {
    return (
        <div className="grid min-w-0 gap-1">
            <div className="flex items-baseline justify-between gap-2 text-xs leading-4">
                <span className="truncate font-medium">{name}</span>
                {ordinal && <span className="text-fg-muted shrink-0 tabular-nums">{ordinal}</span>}
            </div>
            <ol className="m-0 flex list-none items-end gap-0.75 p-0" data-steps>
                {steps.map((step, i) => (
                    <li
                        key={i}
                        title={step.title}
                        aria-label={step.label}
                        aria-current={i === at ? 'step' : undefined}
                        className="h-1.5 min-w-1.5 flex-1 overflow-hidden rounded-full"
                        data-step-waiting={i === at && waiting ? '' : undefined}
                        style={
                            i !== at
                                ? { background: i < at ? PAST : 'var(--color-track)' }
                                : waiting
                                  ? { background: 'var(--color-track)', boxShadow: `inset 0 0 0 1px ${color}` }
                                  : { background: color }
                        }
                    >
                        {i === at && bar && <div aria-hidden>{bar}</div>}
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
        <div className="grid gap-1" data-parts-progress>
            <ProgressCount label={label}>
                {children}
                {note && <span data-parts-note> · {note}</span>}
            </ProgressCount>
            <div aria-hidden className="bg-track h-1.5 overflow-hidden rounded-full">
                <div
                    className="bg-board-done h-full rounded-full"
                    style={{ width: `${total > 0 ? (completed / total) * 100 : 0}%` }}
                />
            </div>
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

/** The slices under the steps: their `count` line, a slice `bar` when the steps don't hold it, and a SliceChip each. */
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
        <div className="grid min-w-0 grid-cols-[minmax(0,1fr)] gap-2" data-slices>
            {count}
            {bar && <div aria-hidden>{bar}</div>}
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
            <span className="text-2xs text-fg-muted shrink-0">{sliceProgressLabel[progress]}</span>
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
