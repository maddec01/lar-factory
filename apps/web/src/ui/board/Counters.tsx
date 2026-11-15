import { Popover, PopoverHeader, ToolbarCounter } from '@lar-works/design-system';
import { scrollFadeClassName, useScrollFade } from '@lar-works/design-system/primitives';
import { type ReactNode, useRef, useState } from 'react';

import { OverflowCount } from './OverflowCount';
import { COMPACT_ROW, pickedRow } from './RowStyles';
import { tooltipWhenCut } from './TooltipWhenCut';

interface BoardCounterProps {
    /** The status's glyph, in its own colour. */
    icon: ReactNode;
    /** The counter's figure. */
    value: ReactNode;
    /** Builds against a limit, as a mini track after the figure: `used` of `limit`. */
    track?: { used: number; limit: number };
    /** The figure's reserved width, so the bar doesn't shift as it changes: a count, a count with its track, or a
     *  figure such as a spend. */
    width?: 'count' | 'track' | 'figure';
    /** Names the counter before its visible value; `hint` supplies its accessible description. */
    label: string;
    /** What the number means, in the tooltip. */
    hint: string;
    /** Below which title bar width the counter folds away: `medium` (56rem) or `wide` (72rem). */
    fold?: 'never' | 'medium' | 'wide';
    /** The popover's title. */
    title: string;
    /** How many items it lists, quietly after the title. */
    count?: number | string;
    /** A muted line under the title, such as a limit or a total. */
    detail?: ReactNode;
    /** A note under the list, on a divider. */
    foot?: ReactNode;
    /** The popover's list, which scrolls. */
    children: ReactNode;
    /** Called as the reader presses the counter; returning true keeps its popover shut, as the press did something
     *  better, such as bringing Your desk into view. */
    onActivate?: () => boolean;
}

/** One title-bar counter: the design system's ToolbarCounter (a glyph, a tabular figure and an optional build track,
 *  with its glass tooltip) opening a CounterPopover of everything behind the number. */
export function BoardCounter({
    icon,
    value,
    track,
    width,
    label,
    hint,
    fold = 'never',
    title,
    count,
    detail,
    foot,
    children,
    onActivate,
}: BoardCounterProps) {
    const [open, setOpen] = useState(false);

    return (
        <ToolbarCounter
            open={open}
            onOpenChange={(next) => setOpen(next && onActivate?.() ? false : next)}
            icon={icon}
            label={label}
            value={value}
            hint={hint}
            fold={fold}
            {...(track && { track })}
            {...(width && { width })}
        >
            <CounterPopover title={title} count={count} detail={detail} foot={foot}>
                {children}
            </CounterPopover>
        </ToolbarCounter>
    );
}

/**
 * A counter's popover, the design system's status popover as its parts (a PopoverHeader over rows that scroll, fading at
 * their edges, and a muted foot on a divider), opening under its counter from the counter's start, as the title bar's
 * counters sit at its left: a status popover's end alignment would push it to the window's edge. It is 30rem wide on a
 * desktop window (items.css), so its rows keep their titles' ends. Its list sits in `data-counter-list`, so an app's
 * tests can find it without depending on the classes behind it.
 */
function CounterPopover({
    title,
    count,
    detail,
    foot,
    children,
}: Pick<BoardCounterProps, 'title' | 'count' | 'detail' | 'foot' | 'children'>) {
    const content = useRef<HTMLDivElement>(null);
    const { setViewport } = useScrollFade();

    return (
        <Popover.Content
            ref={content}
            // Focus lands on the popover itself, which its title names, rather than on the rows' scroller, so opening it
            // never rings the whole list.
            onOpenAutoFocus={(event) => {
                event.preventDefault();
                content.current?.focus();
            }}
            side="bottom"
            align="start"
            sideOffset={8}
            height="capped"
            layout="fill"
            presentation="flush"
        >
            <PopoverHeader title={title} count={count} detail={detail} />
            {/* Focusable, so rows past the cap scroll from the keyboard too. */}
            <div
                ref={setViewport}
                tabIndex={0}
                className={`${scrollFadeClassName} focus-ring-inset flex min-h-0 flex-1 flex-col gap-1 overflow-y-auto overscroll-contain p-2 ${foot ? '' : 'rounded-b-[inherit]'}`}
            >
                <div data-counter-list className="contents">
                    {children}
                </div>
            </div>
            {foot && (
                <div
                    data-slot="status-popover-footer"
                    className="border-line text-fg-muted shrink-0 border-t px-4 py-2 text-xs"
                >
                    {foot}
                </div>
            )}
        </Popover.Content>
    );
}

export function CounterList({
    children,
}: {
    /** The panel's CounterItems. */
    children: ReactNode;
}) {
    return <ul className="m-0 grid list-none grid-cols-[minmax(0,1fr)] gap-px p-0">{children}</ul>;
}

interface CounterItemProps {
    /** The item's id, as `data-item`. */
    item: string;
    /** The item the dialog shows now. */
    picked?: boolean;
    /** Extra context for the row, whose accessible name includes all of its visible text. */
    label: string;
    /** The item's status glyph and source icon. */
    leading: ReactNode;
    /** The item's title. */
    title: ReactNode;
    /** At the row's end: a figure such as its spend, or what it waits for. */
    trailing?: ReactNode;
    /** Called as the reader picks the item, closing the panel. */
    onOpen: () => void;
    /** A quiet line under the title, such as its project. */
    sub?: ReactNode;
}

/** One item in a panel, as a menu's row; picking it closes the panel and opens the item. */
export function CounterItem({ item, picked = false, label, leading, title, trailing, onOpen, sub }: CounterItemProps) {
    // The title in full on hover, only while its two lines cut it off.
    const whenCut = tooltipWhenCut(label, (row) => row.querySelector('[data-counter-title]'));

    return (
        <li>
            <Popover.Close asChild aria-label={undefined} aria-description={label}>
                <button
                    type="button"
                    onClick={onOpen}
                    onPointerEnter={whenCut}
                    data-item={item}
                    className={`${COMPACT_ROW} ${pickedRow(picked)} text-fg focus-visible:bg-fill-hover grid min-h-8 w-full cursor-pointer ${trailing ? 'grid-cols-[auto_minmax(0,1fr)_auto]' : 'grid-cols-[auto_minmax(0,1fr)]'} items-start gap-x-2.5 text-left text-sm outline-none`}
                >
                    {/* The marks and the figure sit on the title's first line, however many lines it takes. */}
                    <span className="flex h-5 items-center gap-2">{leading}</span>
                    {/* The title on up to two lines across the row, its project (and age) quiet under it; every row
                        keeps room for two title lines, so the rows down the list have one height. */}
                    <span className={`grid min-w-0 content-start ${sub ? 'min-h-14' : 'min-h-10'}`}>
                        <span className="line-clamp-2 wrap-anywhere" data-counter-title>
                            {title}
                        </span>
                        {sub && <span className="text-fg-muted flex min-w-0 items-center gap-1.5 text-xs">{sub}</span>}
                    </span>
                    {/* At one width down the list, so every title gives way at the same place. */}
                    {trailing && (
                        <span className="text-fg-muted flex h-5 min-w-16 items-center justify-end gap-1.5 text-xs tabular-nums">
                            {trailing}
                        </span>
                    )}
                </button>
            </Popover.Close>
        </li>
    );
}

/** A row's project, then its age after a dot, each on the line's one gap. */
export function CounterAge({
    project,
    age,
}: {
    /** The project, a RepoCell, giving way first. */
    project: ReactNode;
    /** The item's age, an Age; none where the row's end already says what matters. */
    age?: ReactNode;
}) {
    return (
        <>
            {project}
            {age && (
                <>
                    <span aria-hidden="true">·</span>
                    <span className="whitespace-nowrap">{age}</span>
                </>
            )}
        </>
    );
}

/** A row's figure, such as its spend. */
export function CounterFigure({
    children,
}: {
    /** The figure, such as "$1.20". */
    children: ReactNode;
}) {
    return <span className="text-fg font-medium">{children}</span>;
}

/** A routine counter's glyph without its colour, so the title bar's one colour is need you's amber. */
export function QuietGlyph({ children }: { children: ReactNode }) {
    return <span className="text-fg-muted inline-flex grayscale">{children}</span>;
}

/** What a counter's figure counts, in words after it on a wide bar, such as "need you"; its label already says it to
 *  assistive technology. */
export function CounterWords({
    quiet = false,
    always = false,
    children,
}: {
    /** Muted, for a routine count beside the one that asks for you. */
    quiet?: boolean;
    /** Shown at every width, as need you's on a phone's bar. */
    always?: boolean;
    /** The words, such as "need you". */
    children: string;
}) {
    return (
        <span
            aria-hidden="true"
            className={`whitespace-nowrap ${always ? '' : 'max-lg:hidden'} ${quiet ? 'text-fg-muted font-normal' : 'text-fg'}`}
        >
            {children}
        </span>
    );
}

/** A value not known yet, as nothing has been read. */
export function CounterDash() {
    return <span className="text-fg-muted font-normal">–</span>;
}

/** A figure that covers only part of what it sums, as some of it is unavailable, marked with an amber plus. */
export function CounterPartial({
    figure,
}: {
    /** The figure. */
    figure: string;
}) {
    return (
        <>
            {figure}
            <span className="text-warning-fg font-normal">+</span>
        </>
    );
}

/** The most bars LimitBars draws; past it, a count says how many more there are. */
const MOST_BARS = 5;

/** The build limit as bars, then `children`, such as "4 running · limit 2": one bar per build it allows, filled for
 *  each build at work, and extra builds past it after a gap. It draws MOST_BARS at most, then "+n" for the rest, so a
 *  busy board's bars never run across the Build stage's header. */
export function LimitBars({
    used,
    limit,
    children,
}: {
    /** How many builds are at work. */
    used: number;
    /** How many builds the limit allows. */
    limit: number;
    /** The count in words after the bars, such as "4 running · limit 2". */
    children?: ReactNode;
}) {
    const bar = (n: number, on: boolean) => (
        <span key={n} className={`bar h-1.5 w-3 rounded-full ${on ? 'bg-board-active' : 'bg-line'}`} />
    );

    const within = Math.min(limit, MOST_BARS);
    const past = Math.min(Math.max(used - limit, 0), MOST_BARS - within);
    const more = Math.max(limit, used) - within - past;

    return (
        <span className="inline-flex items-center gap-2">
            <span aria-hidden className="inline-flex items-center gap-1">
                {Array.from({ length: within }, (_, n) => bar(n, n < used))}
                {past > 0 && (
                    <span className="ml-1 inline-flex gap-1">
                        {Array.from({ length: past }, (_, n) => (
                            <span key={limit + n} className="bar bg-warning h-1.5 w-3 rounded-full" />
                        ))}
                    </span>
                )}
                {more > 0 && (
                    <span className="ml-1 flex">
                        <OverflowCount n={more} />
                    </span>
                )}
            </span>
            {children}
        </span>
    );
}
