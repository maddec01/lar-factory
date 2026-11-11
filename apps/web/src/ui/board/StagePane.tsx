// A section of Lar Factory's board's work by stage (Queue, Shaping, Ready to build, Build, Concepts and linked work): the
// design system's Panel, bordered on black with no fill, a titled list that takes the height of its rows. A lane with
// no rows collapses to its header line, which says why it's empty, so the page scrolls past it in one line.

import { PanelBase } from '@lar-works/design-system/primitives';
import type { ReactNode } from 'react';

import { LimitBars } from './Counters';

/** A stage's section: its status glyph, title and count, anything at the header's `right`, then its rows; with no rows,
 *  its header line alone, ending in what `empty` says. */
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

    return (
        <PanelBase
            data-stage={id}
            data-empty={collapsed || undefined}
            headingId={`${id}-h`}
            title={title}
            icon={glyph}
            count={count}
            action={
                collapsed ? (
                    <span className="flex min-w-0 items-center gap-3">
                        {empty}
                        {right}
                    </span>
                ) : (
                    right
                )
            }
            collapsed={collapsed}
        >
            {collapsed ? null : children}
        </PanelBase>
    );
}

/** The rows of a stage's section, divided by the panel's hairlines. */
export function StageList({
    children,
}: {
    /** The rows. */
    children: ReactNode;
}) {
    return <ol className="m-0 grid list-none p-0">{children}</ol>;
}

/** What a collapsed lane's header line says: that it's loading, that nothing is in it, or that the filters hide every
 *  row, muted at its end. On a phone the line keeps the room for the lane's name and says it to screen readers only. */
export function StagePaneEmpty({
    children,
}: {
    /** What the lane says, such as "Nothing here". */
    children: ReactNode;
}) {
    return (
        <p data-pane-empty className="text-fg-muted m-0 min-w-0 truncate text-xs max-sm:sr-only">
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
            className="build-limit text-fg-muted inline-flex items-center gap-1.5 text-xs whitespace-nowrap tabular-nums"
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
