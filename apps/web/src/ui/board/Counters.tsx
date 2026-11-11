import { Popover, StatusPopoverContent, StatusPopoverSection, ToolbarCounter } from '@lar-works/design-system';
import type { ReactNode } from 'react';

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
    count?: number;
    /** A muted line under the title, such as a limit or a total. */
    detail?: ReactNode;
    /** A note under the list, on a divider. */
    foot?: ReactNode;
    /** The popover's list, which scrolls. */
    children: ReactNode;
}

/** One title-bar counter: the design system's ToolbarCounter (a glyph, a tabular figure and an optional build track,
 *  with its glass tooltip) opening a wide status popover (384px) of everything behind the number. Its list sits in
 *  `data-counter-list`, so an app's tests can find it without depending on the classes behind it. */
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
}: BoardCounterProps) {
    return (
        <ToolbarCounter
            icon={icon}
            label={label}
            value={value}
            hint={hint}
            fold={fold}
            {...(track && { track })}
            {...(width && { width })}
        >
            <StatusPopoverContent width="wide" title={title} count={count} detail={detail} footer={foot}>
                <div data-counter-list className="contents">
                    {children}
                </div>
            </StatusPopoverContent>
        </ToolbarCounter>
    );
}

/** A panel's list split by status, each part under its name and count. */
export function CounterGroups({
    children,
}: {
    /** The groups, one CounterGroup each. */
    children: ReactNode;
}) {
    return <div className="grid">{children}</div>;
}

/** One part of a panel's list, under the status popover's group heading: its status's name and count. */
export function CounterGroup({
    title,
    count,
    children,
}: {
    /** The group's status name. */
    title: string;
    /** How many items the group holds. */
    count: number;
    /** The group's CounterItems. */
    children: ReactNode;
}) {
    return (
        <StatusPopoverSection title={title} count={count}>
            {children}
        </StatusPopoverSection>
    );
}

/** What a panel says when its list is empty, or what is still loading. */
export function CounterEmpty({
    children,
}: {
    /** What the panel says, such as "Nothing running". */
    children: ReactNode;
}) {
    return (
        <p className="text-fg-muted m-0 flex min-h-20 items-center justify-center px-2 py-4 text-center text-xs">
            {children}
        </p>
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
    /** Extra context for the row, whose accessible name includes all of its visible text. */
    label: string;
    /** The item's status glyph and source icon. */
    leading: ReactNode;
    /** The item's title. */
    title: ReactNode;
    /** At the right: CounterAge, or a figure such as its spend. */
    trailing: ReactNode;
    /** Called as the reader picks the item, closing the panel. */
    onOpen: () => void;
}

/** One item in a panel, as a menu's row; picking it closes the panel and opens the item. */
export function CounterItem({ item, label, leading, title, trailing, onOpen }: CounterItemProps) {
    return (
        <li>
            <Popover.Close asChild aria-label={undefined} aria-description={label}>
                <button
                    type="button"
                    onClick={onOpen}
                    data-item={item}
                    className="text-fg hover:bg-fill-hover focus-visible:bg-fill-hover flex min-h-7 w-full cursor-default items-center gap-2 rounded-sm px-2 py-1 text-left text-sm outline-none max-lg:min-h-11 pointer-coarse:min-h-11"
                >
                    {leading}
                    {/* Up to two lines, so a title is read, not cut after a few words. */}
                    <span className="line-clamp-2 min-w-0 flex-1">{title}</span>
                    <span className="text-fg-muted flex shrink-0 items-center gap-1.5 text-xs tabular-nums">
                        {trailing}
                    </span>
                </button>
            </Popover.Close>
        </li>
    );
}

/** A row's repository icon and age. */
export function CounterAge({
    icon,
    age,
}: {
    /** The repository's icon. */
    icon: ReactNode;
    /** The item's age, such as "3h". */
    age: string;
}) {
    return (
        <>
            {icon}
            <span className="min-w-7 text-right whitespace-nowrap">{age}</span>
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

/** A value not known yet, as nothing has been read. */
export function CounterDash() {
    return <span className="text-fg-muted font-normal">–</span>;
}

/** A figure that covers only part of what it sums, marked with a plus: amber while some of it is unavailable, muted
 *  while some is still loading. */
export function CounterPartial({
    figure,
    unavailable,
}: {
    /** The figure. */
    figure: string;
    /** Some of it is unavailable, rather than still loading: the plus turns amber. */
    unavailable: boolean;
}) {
    return (
        <>
            {figure}
            <span className={`font-normal ${unavailable ? 'text-warning-fg' : 'text-fg-muted'}`}>+</span>
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
            <span aria-hidden className="inline-flex items-center gap-0.75">
                {Array.from({ length: within }, (_, n) => bar(n, n < used))}
                {past > 0 && (
                    <span className="ml-1 inline-flex gap-0.75">
                        {Array.from({ length: past }, (_, n) => bar(limit + n, true))}
                    </span>
                )}
                {more > 0 && (
                    <span className="text-fg-muted ml-1 text-xs font-medium tabular-nums" data-bars-more>
                        +{more}
                    </span>
                )}
            </span>
            {children}
        </span>
    );
}
