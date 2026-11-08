import type { ReactNode } from 'react';

import type { DataAttributes } from './DataAttributes';

/** The meta area under the summary: wrapping facts, then an optional notice on a full-width row of its own. */
export function MetaArea({
    children,
    notice,
    ...data
}: {
    /** The facts, one DetailFact each. */
    children: ReactNode;
    /** Context or a decision about the facts, below them rather than among the metadata columns. */
    notice?: ReactNode;
} & DataAttributes) {
    return (
        <div {...data} className="grid min-w-0 gap-3">
            <div className="flex min-w-0 flex-wrap items-start gap-x-8 gap-y-3" data-meta-facts>
                {children}
            </div>
            {notice}
        </div>
    );
}

/**
 * A labelled fact: in the meta area, its label over its value, which wraps rather than running past the dialog and keeps
 * a control's height, so a value that edits in place (an inline select, chips with their edit button) lines up with
 * plain text; in a `record`, a fact of the work record whose value wraps onto lines of its own.
 */
export function DetailFact({
    label,
    presentation = 'meta',
    children,
    ...data
}: {
    /** The fact's label. */
    label: string;
    /** `meta` sets the label over the value in the meta area; `record` beside it in the record. */
    presentation?: 'meta' | 'record';
    /** The fact's value, or the control that edits it. */
    children: ReactNode;
} & DataAttributes) {
    if (presentation === 'record')
        return (
            <div {...data} className="flex min-w-0 flex-wrap items-baseline gap-x-1.5 text-sm">
                <span className="text-fg-muted shrink-0 text-xs">{label}</span>
                {children}
            </div>
        );

    return (
        <div {...data} className="grid max-w-full min-w-0 content-start text-sm">
            <span className="text-fg-muted text-xs leading-4">{label}</span>
            <span className="flex min-h-7 min-w-0 flex-wrap items-center gap-1.5 wrap-anywhere">{children}</span>
        </div>
    );
}

/** A line of short items, such as a review round's verdicts, wrapping. */
export function InlineList({
    items,
}: {
    /** The items, such as a review round's verdicts. */
    items: readonly string[];
}) {
    return (
        <ul className="m-0 flex list-none flex-wrap gap-x-3 p-0">
            {items.map((item, index) => (
                <li key={index}>{item}</li>
            ))}
        </ul>
    );
}

/** Facts one under the other, such as a record's review rounds. */
export function FactList({
    children,
    ...data
}: {
    /** The facts, one under the other. */
    children: ReactNode;
} & DataAttributes) {
    return (
        <div {...data} className="grid gap-1">
            {children}
        </div>
    );
}

/** A sprint's count over its children: `count` ("This sprint: 2 of 5 done") and the sprint's `name`. */
export function SprintCount({
    count,
    name,
}: {
    /** The sprint's count, such as "This sprint: 2 of 5 done". */
    count: string;
    /** The sprint's name. */
    name: string;
}) {
    return (
        <div className="text-sm">
            <p className="m-0 font-medium">{count}</p>
            <p className="text-fg-muted m-0 text-xs">{name}</p>
        </div>
    );
}

/** The work an item waits on, struck through once closed. */
export function WaitsOnList({
    items,
}: {
    /** The work the item waits on, each with whether it is closed. */
    items: readonly { key: string; title: string; closed: boolean }[];
}) {
    return (
        <ul className="m-0 grid list-none gap-1.5 p-0 text-sm" data-waits-on>
            {items.map((item) => (
                <li key={item.key} className={item.closed ? 'text-fg-muted line-through' : ''}>
                    {item.title}
                </li>
            ))}
        </ul>
    );
}

/** Chips in a wrapping line, grouped with no box of their own, such as the labels fact's, for tests to name. */
export function ChipGroup({
    children,
    ...data
}: {
    /** The chips. */
    children: ReactNode;
} & DataAttributes) {
    return (
        <span {...data} className="contents">
            {children}
        </span>
    );
}
