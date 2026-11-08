import { Popover, PopoverHeader, Tooltip, TooltipPopup, TooltipTrigger } from '@lar-works/design-system';
import { ButtonBase as Button, scrollFadeClassName, useScrollFade } from '@lar-works/design-system/primitives';
import type { ReactNode } from 'react';

import { buttonKind } from './ButtonKinds';

/** The title bar's counters, in its status strip after the Refreshed time. */
export function BoardCounters({
    children,
}: {
    /** The counters, one BoardCounter each. */
    children: ReactNode;
}) {
    return <div className="counters flex shrink-0 items-center gap-0.5 whitespace-nowrap">{children}</div>;
}

/** How wide a counter's value stays from dash or loader to number: a count, a count over a limit, or a spend under
 *  $1,000 with its plus. */
const valueWidths = { count: 'min-w-[2ch]', limit: 'min-w-[4ch]', spend: 'min-w-[8ch]' };

/** Which counters the title bar's width folds away: Shaping and Shipped below 54rem, then Spend below 66rem. */
const folds = { never: '', medium: 'hidden @4xl:inline-flex', wide: 'hidden @6xl:inline-flex' };

interface BoardCounterProps {
    /** The status's glyph, in its own colour. */
    icon: ReactNode;
    /** The counter's figure. */
    value: ReactNode;
    /** The figure's reserved width, so the bar doesn't shift as it changes. */
    width?: keyof typeof valueWidths;
    /** Names the counter before its visible value; `hint` supplies its accessible description. */
    label: string;
    /** What the number means, in the tooltip. */
    hint: string;
    /** Below which title bar width the counter folds away. */
    fold?: keyof typeof folds;
    /** The panel's head: its title and, at its right, a figure such as the count. */
    title: string;
    /** The number of items, independent of the header's detail. */
    count?: number;
    /** A small line under the figure, such as a limit. */
    sub?: ReactNode;
    /** A note under the panel's list. */
    foot?: ReactNode;
    /** The panel's list, which scrolls. */
    children: ReactNode;
}

/** One counter: an App control with a glyph and a tabular value, its tooltip, and the panel it opens, padded as a
 *  menu, of everything behind the number. The control names its `fold` and value `width` in `data-fold` and
 *  `data-width`, and the panel marks its head, scrolling list and foot, so an app's tests can read them without
 *  depending on the classes behind them. */
export function BoardCounter({
    icon,
    value,
    width = 'count',
    label,
    hint,
    fold = 'never',
    title,
    count,
    sub,
    foot,
    children,
}: BoardCounterProps) {
    return (
        <Popover>
            <Tooltip>
                <TooltipTrigger asChild>
                    <Popover.Trigger asChild>
                        <Button
                            {...buttonKind('control')}
                            aria-description={hint}
                            data-fold={fold}
                            data-width={width}
                            className={`text-fg-muted hover:text-fg data-[state=open]:bg-fill-selected data-[state=open]:text-fg min-w-0 gap-1.5 ${folds[fold]}`}
                        >
                            <span className="sr-only">{label}:</span>{' '}
                            <span className="counter-icon grid size-4 shrink-0 place-items-center [&_svg]:size-4">
                                {icon}
                            </span>
                            <span
                                className={`counter-value text-fg inline-flex items-center leading-4 font-medium tabular-nums [&_[data-loader]]:w-full [&_[data-loader]]:justify-center [&_svg]:size-3 ${valueWidths[width]}`}
                            >
                                {value}
                            </span>
                        </Button>
                    </Popover.Trigger>
                </TooltipTrigger>
                <TooltipPopup side="bottom">{hint}</TooltipPopup>
            </Tooltip>
            {/* Counters sit at the bar's start: each panel opens from its counter's left edge, rightwards. */}
            <Popover.Content side="bottom" align="start" layout="fill" presentation="flush">
                <div className="counter-popup flex max-h-112 min-h-0 w-112 max-w-full flex-col">
                    <div data-counter-head>
                        <PopoverHeader
                            title={title}
                            count={count ?? (typeof sub === 'number' ? sub : undefined)}
                            detail={typeof sub === 'number' ? undefined : sub}
                        />
                    </div>
                    {/* Padded as a menu, so the first row never sits flush on the header's divider (which then reads as missing). */}
                    <CounterScroll>{children}</CounterScroll>
                    {foot !== undefined && (
                        <div
                            data-counter-foot
                            className="border-line text-fg-muted shrink-0 border-t px-3 pt-1.5 pb-2 text-xs"
                        >
                            {foot}
                        </div>
                    )}
                </div>
            </Popover.Content>
        </Popover>
    );
}

/** A counter panel's rows, scrolling between its header and foot with the shared edge fade, never a hard cut. */
function CounterScroll({ children }: { children: ReactNode }) {
    const { setViewport } = useScrollFade();

    return (
        <div
            ref={setViewport}
            data-counter-list
            className={`min-h-0 flex-1 overflow-y-auto overscroll-contain p-1 ${scrollFadeClassName}`}
        >
            {children}
        </div>
    );
}

/** The divider before the spend counter, which folds with it. */
export function CounterDivider() {
    return <span aria-hidden="true" className="bg-line mx-1 hidden h-4 w-px shrink-0 @6xl:block" />;
}

/** A panel's list split by status, each part under its name and count. */
export function CounterGroups({
    children,
}: {
    /** The groups, one CounterGroup each. */
    children: ReactNode;
}) {
    return <div className="grid gap-1">{children}</div>;
}

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
        <section>
            <h3 className="text-fg-muted m-0 flex h-7 items-center gap-1 px-2 text-xs font-medium">
                {title} <span className="tabular-nums">{count}</span>
            </h3>
            {children}
        </section>
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
                    <span className="text-2xs text-fg-muted flex shrink-0 items-center gap-1.5 tabular-nums">
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

/** A count against a limit, such as builds at work under the build limit: the count, then the limit as small
 *  LimitBars, so it never reads as a fraction such as "4/2". The counter's hint says it in words. */
export function CounterOfLimit({
    count,
    used,
    limit,
}: {
    /** The count, such as "4". */
    count: ReactNode;
    /** How many of the limit are used. */
    used: number;
    /** The limit. */
    limit: number;
}) {
    return (
        <span className="inline-flex items-center gap-1.5">
            {count}
            <LimitBars used={used} limit={limit} size="sm" />
        </span>
    );
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

/** The build limit as bars, then `children`, such as "4 running · limit 2": one bar per build it allows, filled for
 *  each build at work, and extra builds past it after a gap. `sm` is the size inside a counter's value. */
export function LimitBars({
    used,
    limit,
    size = 'md',
    children,
}: {
    /** How many builds are at work. */
    used: number;
    /** How many builds the limit allows. */
    limit: number;
    /** `sm` bars for a counter, `md` for a section's header. */
    size?: 'sm' | 'md';
    /** The count in words after the bars, such as "4 running · limit 2". */
    children?: ReactNode;
}) {
    const bar = (n: number, on: boolean) => (
        <span
            key={n}
            className={`bar ${size === 'sm' ? 'h-1 w-2' : 'h-1.5 w-3'} rounded-full ${on ? 'bg-board-active' : 'bg-line'}`}
        />
    );

    return (
        <span className="inline-flex items-center gap-2">
            <span aria-hidden className={`inline-flex items-center ${size === 'sm' ? 'gap-0.5' : 'gap-0.75'}`}>
                {Array.from({ length: limit }, (_, n) => bar(n, n < used))}
                {used > limit && (
                    <span className={`ml-1 inline-flex ${size === 'sm' ? 'gap-0.5' : 'gap-0.75'}`}>
                        {Array.from({ length: used - limit }, (_, n) => bar(limit + n, true))}
                    </span>
                )}
            </span>
            {children}
        </span>
    );
}
