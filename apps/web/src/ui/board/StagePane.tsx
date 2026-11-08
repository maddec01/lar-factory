// A section of Lar Factory's board's work by stage (Queue, Shaping, Ready to build, Build, Concepts and linked work): a
// titled list that takes the height of its rows, so a section with none stays small and the page scrolls past them all.

import { EmptyState, SectionTitle } from '@lar-works/design-system';
import type { ReactNode } from 'react';

import { LimitBars } from './Counters';

/** A stage's section: its status glyph, title and count, anything at the header's `right`, then its rows. */
export function StagePane({
    id,
    title,
    glyph,
    count,
    right,
    children,
}: {
    /** Names the section, as `data-stage`, and its heading's id. */
    id: string;
    /** The stage's name. */
    title: string;
    /** The stage's status glyph. */
    glyph?: ReactNode;
    /** How many rows the stage holds. */
    count: number;
    /** What sits at the header's end, such as a BuildLimit. */
    right?: ReactNode;
    /** The stage's StageList or StagePaneEmpty. */
    children: ReactNode;
}) {
    return (
        <section
            data-stage={id}
            aria-labelledby={`${id}-h`}
            className="surface-card min-w-0 overflow-hidden rounded-xl border"
        >
            <header className="border-line flex min-h-10 flex-wrap items-center gap-x-2 gap-y-1 border-b px-3 py-1">
                <SectionTitle id={`${id}-h`} level="h3" title={title} count={count} icon={glyph} />
                {right && <span className="ml-auto flex max-w-full min-w-0 items-center">{right}</span>}
            </header>
            <div className="@container">{children}</div>
        </section>
    );
}

/** The rows of a stage's section. */
export function StageList({
    children,
}: {
    /** The rows. */
    children: ReactNode;
}) {
    return <ol className="m-0 grid list-none p-0">{children}</ol>;
}

/** What a section says with no row: that it's loading, that nothing is in it, or that the filters hide every row. */
export function StagePaneEmpty({
    children,
}: {
    /** What the section says, such as "Nothing here". */
    children: ReactNode;
}) {
    return (
        <div data-pane-empty>
            <EmptyState size="inline" title={children} />
        </div>
    );
}

/** Builds at work against the build limit, in a section's header: one bar per build the `limit` allows, more when
 *  they're over it, separated after the limit as in the title bar, then the count in words. */
export function BuildLimit({
    building,
    limit,
    title,
    children,
}: {
    /** How many builds are at work. */
    building: number;
    /** How many builds the limit allows; none shows the count alone. */
    limit?: number | undefined;
    /** The limit in full, as its tooltip. */
    title: string;
    /** The count in words, after the bars. */
    children: ReactNode;
}) {
    return (
        <span
            className="build-limit text-2xs text-fg-muted inline-flex items-center gap-1.5 whitespace-nowrap tabular-nums"
            title={title}
        >
            {limit !== undefined ? (
                <LimitBars used={building} limit={limit}>
                    {children}
                </LimitBars>
            ) : (
                children
            )}
        </span>
    );
}

/** A switch in a section's header with its visible `label` before it, and before that any `hold` that keeps it from
 *  acting, truncating; `title` says what it would do. */
export function HeaderSwitch({
    label,
    title,
    hold,
    control,
}: {
    /** The switch's visible label. */
    label: string;
    /** What the switch would do, as its tooltip. */
    title: string;
    /** What keeps the switch from acting, before it. */
    hold?: string | undefined;
    /** The Switch, named by `label` for assistive technology. */
    control: ReactNode;
}) {
    return (
        <span
            className="auto-build text-2xs text-fg-muted inline-flex min-w-0 items-center gap-1.5 whitespace-nowrap"
            title={title}
        >
            {hold && (
                <span className="min-w-0 truncate" title={hold} data-auto-build-hold>
                    {hold}
                </span>
            )}
            <span aria-hidden="true">{label}</span>
            {control}
        </span>
    );
}

/** The stages' sections, one under another, named by `label`. */
export function StageSections({
    label,
    children,
}: {
    /** Names the region for screen readers. */
    label: string;
    /** The stages' sections, one StagePane each. */
    children: ReactNode;
}) {
    return (
        <section className="stages flex flex-col gap-3" aria-label={label}>
            {children}
        </section>
    );
}
