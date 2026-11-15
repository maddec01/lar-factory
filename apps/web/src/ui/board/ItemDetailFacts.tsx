import { Text } from '@lar-works/design-system';
import { CheckIcon } from '@lar-works/design-system/icons';
import type { ReactNode } from 'react';

import type { DataAttributes } from './DataAttributes';
import { ItemTitle } from './ItemParts';
import { ROW_OPENS } from './RowStyles';

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
    label: ReactNode;
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

/** A sprint's count over its children, labelled "This sprint": `count` ("2 of 5 done") and the sprint's `name`. */
export function SprintCount({
    count,
    name,
}: {
    /** The sprint's count, such as "2 of 5 done". */
    count: string;
    /** The sprint's name. */
    name: string;
}) {
    return (
        <div className="text-sm">
            <DetailFact presentation="record" label="This sprint">
                <span className="font-medium">{count}</span>
            </DetailFact>
            <Text variant="caption" tone="muted">
                {name}
            </Text>
        </div>
    );
}

/** The work an item still waits on, each led by its reference and wrapping to two lines, opening its item when it is on
 *  the board; then the done prerequisites under a quiet count, each named on one muted line behind a small success
 *  check, its full name in its tooltip. */
export function WaitsOnList({
    items,
    done,
}: {
    /** The open work the item waits on: its reference ("#139", "Part 15"), its title and what opens it. */
    items: readonly { key: string; reference?: string | undefined; title: string; onOpen?: (() => void) | undefined }[];
    /** The done prerequisites: their count, such as "2 prerequisites done", and each one's reference and title. */
    done?:
        | { text: string; items: readonly { key: string; reference?: string | undefined; title: string }[] }
        | undefined;
}) {
    return (
        <div className="grid min-w-0 gap-1.5 text-sm" data-waits-on>
            {items.length > 0 && (
                <ul className="m-0 grid min-w-0 list-none gap-1.5 p-0">
                    {items.map((item) => {
                        const name = item.reference ? `${item.reference} ${item.title}` : item.title;
                        const text = (
                            <span className="line-clamp-2 wrap-anywhere">
                                <ItemTitle reference={item.reference} title={item.title} />
                            </span>
                        );

                        return (
                            <li key={item.key} title={name} className="min-w-0">
                                {item.onOpen ? (
                                    <button
                                        type="button"
                                        onClick={item.onOpen}
                                        className={`hover:bg-fill-hover -mx-1 block w-[calc(100%+0.5rem)] rounded-xs px-1 text-left ${ROW_OPENS}`}
                                        data-waits-on-open
                                    >
                                        {text}
                                    </button>
                                ) : (
                                    text
                                )}
                            </li>
                        );
                    })}
                </ul>
            )}
            {done && (
                <div className="grid min-w-0 gap-1 pt-0.5" data-waits-on-done>
                    <Text as="span" variant="caption" tone="muted" truncate>
                        {done.text}
                    </Text>
                    <ul className="m-0 grid min-w-0 list-none gap-0.5 p-0">
                        {done.items.map((item) => (
                            <li
                                key={item.key}
                                title={item.reference ? `${item.reference} ${item.title}` : item.title}
                                className="text-fg-muted grid min-w-0 grid-cols-[0.875rem_minmax(0,1fr)] items-center gap-1.5 text-xs leading-5"
                            >
                                <CheckIcon aria-hidden className="stroke-success size-3.5" />
                                <span className="truncate">
                                    <ItemTitle reference={item.reference} title={item.title} />
                                </span>
                            </li>
                        ))}
                    </ul>
                </div>
            )}
        </div>
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
