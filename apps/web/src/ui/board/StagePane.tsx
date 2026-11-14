// A section of Lar Factory's board's work by stage (Queue, Shaping, Ready to build, Build, Concepts and linked work): its
// header line, then its rows as one list of rounded rows, straight on the page with no card around them, so the board
// reads as one calm surface. It follows the design system's Panel header and heading. A lane with no rows collapses to
// its header line, which says why it's empty, so the page scrolls past it in one line.

import { SectionTitle } from '@lar-works/design-system';
import type { ReactNode } from 'react';

import { LimitBars } from './Counters';

/** Ready keeps its scheduling controls together at the header's end at every width. */
export function ReadyBuildControls({ children }: { children: ReactNode }) {
    return (
        <span className="flex min-w-0 flex-wrap items-center justify-end gap-x-3 gap-y-1" data-ready-build-controls>
            {children}
        </span>
    );
}

/** A stage's section: its status glyph, title and count on the header band, anything at the header's `right`, then its
 *  rows; with no rows, its header band alone, ending in what `empty` says. */
export function StagePane({
    id,
    title,
    glyph,
    count,
    right,
    empty,
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
    /** What the lane says with no rows, a StagePaneEmpty: given, the lane collapses to its header line. */
    empty?: ReactNode;
    /** The stage's StageList. */
    children?: ReactNode;
}) {
    const collapsed = Boolean(empty);
    const headingId = `${id}-h`;

    return (
        <section data-stage={id} data-empty={collapsed || undefined} aria-labelledby={headingId} className="min-w-0">
            <header className="flex min-h-9 items-center px-3 py-1">
                <div className="flex min-w-0 flex-1 flex-col gap-1 sm:flex-row sm:items-center sm:justify-between sm:gap-3">
                    <SectionTitle id={headingId} level="h3" title={title} icon={glyph} count={count} />
                    {(right || collapsed) && (
                        <div className="flex min-w-0 flex-wrap items-center justify-end gap-3" data-stage-controls>
                            {collapsed && empty}
                            {right}
                        </div>
                    )}
                </div>
            </header>
            {!collapsed && children && <div className="@container min-w-0">{children}</div>}
        </section>
    );
}

/** The rows of a stage's section, rounded rows a hair apart under its header, as the design system's lists. */
export function StageList({
    children,
}: {
    /** The rows. */
    children: ReactNode;
}) {
    return <ol className="m-0 grid list-none gap-0.5 p-0">{children}</ol>;
}

/** What a collapsed lane's header line says: that it's loading, that nothing is in it, or that the filters hide every
 *  row, muted at its end. A `quiet` one (nothing in it, which its count of 0 already says) and, on a phone, every one
 *  says it to screen readers only, so the line keeps the room for the lane's name. */
export function StagePaneEmpty({
    quiet = false,
    children,
}: {
    /** Says it to screen readers only. */
    quiet?: boolean;
    /** What the lane says, such as "Nothing here". */
    children: ReactNode;
}) {
    return (
        <p
            data-pane-empty
            className={`text-fg-muted m-0 min-w-0 truncate text-xs ${quiet ? 'sr-only' : 'max-sm:sr-only'}`}
        >
            {children}
        </p>
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
            className="build-limit text-fg-muted inline-flex flex-wrap items-center gap-1.5 text-xs tabular-nums"
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
            className="auto-build text-fg-muted inline-flex min-w-0 items-center gap-1.5 text-xs whitespace-nowrap"
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
