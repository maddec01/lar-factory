// The board's one work row (board/rows.css), in Queue, Shaping, Ready to build, Build and Concepts and linked work: a
// first line in columns that line up down the whole board, one button that opens the item's details with the row's
// action beside it, and under it a second line on the same columns.

import { Loading } from '@lar-works/design-system';
import { ChevronDownIcon, ChevronRightIcon } from '@lar-works/design-system/icons';
import { type MouseEvent, type ReactNode, useLayoutEffect, useRef } from 'react';

import { useArrival } from './BoardLife';
import { pickedRow, ROW_ACTION, ROW_OPENS } from './RowStyles';
import { StateWord } from './StateWord';

/** A stage row: `item` names it as `data-item`, and `picked` marks the item the dialog shows. A row a read just moved
 *  here from another lane slides in from that side and flashes the navy wash (BoardLife). A row is 40px with one line
 *  and 60 with two: 6px above its 28px first line and 6 below, the panel's hairline taking the last pixel. Its hover
 *  eases in as a card's does. */
export function StageRowItem({
    item,
    picked,
    children,
}: {
    /** The item, named as `data-item`. */
    item: string;
    /** The item the dialog shows now. */
    picked: boolean;
    /** The row's lines. */
    children: ReactNode;
}) {
    const arrival = useArrival('lane', item);

    return (
        <li
            data-item={item}
            data-arrived={arrival?.from}
            className={`hover:bg-fill-hover @container pt-1.5 pb-1.25 transition-colors last:pb-1.5 ${pickedRow(picked)}`}
        >
            {children}
        </li>
    );
}

/** A row's first line: its cells, then its side. It keeps its side's width as `--row-side-width`, so on a phone the
 *  title beside the action leaves it its natural width (rows.css). */
export function RowFirst({
    children,
}: {
    /** The cells, then the side. */
    children: ReactNode;
}) {
    const ref = useRef<HTMLDivElement>(null);

    useLayoutEffect(() => {
        const row = ref.current;
        const side = row?.querySelector<HTMLElement>(':scope > [data-col="side"]');

        if (!row || !side || typeof ResizeObserver === 'undefined') return;

        const measure = () => row.style.setProperty('--row-side-width', `${side.offsetWidth}px`);
        const observer = new ResizeObserver(measure);

        observer.observe(side);
        measure();

        return () => observer.disconnect();
    }, []);

    return (
        <div ref={ref} className="row-first">
            {children}
        </div>
    );
}

/** A row's first line's cells as the one button that opens its item. */
export function RowOpen({
    onOpen,
    children,
}: {
    /** Called as the reader opens the item. */
    onOpen: () => void;
    /** The first line's cells. */
    children: ReactNode;
}) {
    return (
        <button type="button" data-row-open data-meta onClick={onOpen} className={`row-cols ${ROW_OPENS}`}>
            {children}
        </button>
    );
}

/** A row's first line's cells, when its title opens the item and the rest of the line does something else. */
export function RowCells({
    children,
}: {
    /** The first line's cells. */
    children: ReactNode;
}) {
    return <div className="row-cols">{children}</div>;
}

/** The first cell: the item's status glyph. */
export function RowGlyph({
    children,
}: {
    /** The status glyph. */
    children: ReactNode;
}) {
    return (
        <span className="grid size-6 place-items-center" data-glyph>
            {children}
        </span>
    );
}

/** The first cell of a Queue row: its place in the Queue. */
export function QueuePlace({
    children,
}: {
    /** The place, such as "1". */
    children: ReactNode;
}) {
    return <span className="queue-n text-center font-medium tabular-nums">{children}</span>;
}

/** Where the item's ticket is saved and its repository, in the source cell. */
export function RowIdentity({
    children,
}: {
    /** The source and repository. */
    children: ReactNode;
}) {
    return (
        <span data-row-identity className="text-fg-muted flex min-w-0 items-center gap-1.5">
            {children}
        </span>
    );
}

/** The kind cell. */
export function RowKindCell({
    children,
}: {
    /** The kind's badge. */
    children: ReactNode;
}) {
    return (
        <span className="flex min-w-0 items-center" data-kind>
            {children}
        </span>
    );
}

/** The title cell: the RowTitle and what it is part of. */
export function RowTitleCell({
    children,
}: {
    /** The RowTitle and what it is part of. */
    children: ReactNode;
}) {
    return (
        <span className="flex min-w-0 items-center gap-2" data-title-cell>
            {children}
        </span>
    );
}

/** The row's title, truncating; `name` gives it whole. */
export function RowTitle({
    name,
    children,
}: {
    /** The title in full, as its tooltip. */
    name: string;
    /** The title, an ItemTitle. */
    children: ReactNode;
}) {
    return (
        <span className="text-fg min-w-0 truncate text-sm leading-7 font-medium" title={name} data-title>
            {children}
        </span>
    );
}

/** After the title: which concept or parent the row's work belongs to, giving its room up first. */
export function RowPartOf({
    children,
}: {
    /** What the work belongs to, in words. */
    children: string;
}) {
    return (
        <span
            data-concept
            title={children}
            className="bg-surface-sunken text-fg-muted max-w-44 min-w-16 shrink-[100] truncate rounded-xs px-1.5"
        >
            {children}
        </span>
    );
}

/** The state cell, which `clips` what overflows it unless what it holds keeps its own width. What follows the state,
 *  such as a kind marker, wraps under it rather than being cut off. */
export function RowStateCell({
    clips = true,
    children,
}: {
    /** Clips what overflows the cell. */
    clips?: boolean;
    /** The state and what follows it. */
    children: ReactNode;
}) {
    return (
        <span
            className={`flex min-w-0 items-center gap-x-1.5 leading-4${clips ? ' overflow-hidden' : ''}`}
            data-col="state"
        >
            {children}
        </span>
    );
}

/** The row's state in words; `title` says more. */
export function RowState({
    title,
    children,
}: {
    /** More on the state, as its tooltip. */
    title?: string;
    /** The state in words. */
    children: ReactNode;
}) {
    return (
        <span className="max-w-full min-w-0 truncate" title={title} data-state>
            {children}
        </span>
    );
}

/** A Queue row's state: how long it has waited. */
export function QueueAge({
    children,
}: {
    /** How long the row has waited. */
    children: ReactNode;
}) {
    return (
        <span className="queue-age shrink-0 tabular-nums" data-state>
            {children}
        </span>
    );
}

/** The row's action slot, at its right. With `passEmpty`, clicks on its controls stay there, and a click beside them
 *  reaches the row. */
export function RowSide({
    passEmpty = false,
    children,
}: {
    /** Clicks beside its controls reach the row. */
    passEmpty?: boolean;
    /** The row's action. */
    children: ReactNode;
}) {
    if (!passEmpty)
        return (
            <span data-col="side" className={`row-side ${ROW_ACTION}`}>
                {children}
            </span>
        );

    return (
        <span data-col="side" className="row-side">
            <span
                className={ROW_ACTION}
                onClick={(event) => {
                    if (event.target !== event.currentTarget) event.stopPropagation();
                }}
            >
                {children}
            </span>
        </span>
    );
}

/** Where to act on an item that waits on you, in its action slot. */
export function OnYourDesk({
    children,
}: {
    /** Where to act on the item. */
    children: ReactNode;
}) {
    return <span className="text-warning-fg">{children}</span>;
}

/** A row's second line: `bar` and `count` on the left, `children` in its text slot, then its pull requests and
 *  figures. A click on it beside its controls goes to `onClick`. */
export function RowSecondLine({
    bar,
    count,
    prs,
    figures,
    onClick,
    children,
}: {
    /** A bar on the left, such as a SliceBar. */
    bar?: ReactNode;
    /** A RowCount or RowSliceToggle; with none, its cell stays empty. */
    count?: ReactNode;
    /** The pull requests, as PullRequestRefs. */
    prs?: ReactNode;
    /** Figures at the line's end. */
    figures?: ReactNode;
    /** Called with a click on the line beside its controls. */
    onClick?: ((event: MouseEvent<HTMLElement>) => void) | undefined;
    /** The line's text, after the bar and count. */
    children?: ReactNode;
}) {
    return (
        <div data-progress onClick={onClick} className={`row-second ${onClick ? 'cursor-pointer' : ''}`}>
            <span data-col="bar" className="min-w-0">
                {bar}
            </span>
            {count || <span data-col="count" />}
            <span data-col="next" className="flex min-w-0 items-center gap-3">
                {children}
            </span>
            <span data-col="pr" className="flex min-w-0 gap-2 overflow-hidden tabular-nums">
                {prs}
            </span>
            <span data-col="figures">{figures}</span>
        </div>
    );
}

/** The second line's count, such as `2/5 parts`. */
export function RowCount({
    title,
    children,
}: {
    /** The count in full, as its tooltip. */
    title?: string;
    /** The count, such as `2/5 parts`. */
    children: ReactNode;
}) {
    return (
        <span data-col="count" className="tabular-nums" title={title}>
            {children}
        </span>
    );
}

/** The second line's slice count as a button that unfolds the row's slices under it. */
export function RowSliceToggle({
    open,
    label,
    onToggle,
    children,
}: {
    /** The slices are unfolded. */
    open: boolean;
    /** Names the button, as what it does now. */
    label: string;
    /** Called as the reader folds or unfolds the slices. */
    onToggle: () => void;
    /** The slice count. */
    children: ReactNode;
}) {
    return (
        <button
            type="button"
            aria-expanded={open}
            onClick={onToggle}
            data-col="count"
            className={`hover:text-fg flex h-4 items-center gap-1 justify-self-start rounded-xs tabular-nums ${ROW_OPENS}`}
        >
            <span className="sr-only">{label}:</span> {children}
            {open ? <ChevronDownIcon className="size-3" /> : <ChevronRightIcon className="size-3" />}
        </button>
    );
}

/** A dependency holding the row, in its second line: the waiting light and what it waits on. */
export function RowBlocked({
    children,
}: {
    /** The dependency holding the row. */
    children: string;
}) {
    return (
        <StateWord state="waiting" title={children} data-blocked>
            {children}
        </StateWord>
    );
}

const SLICE_TONE = { blocked: 'text-warning-fg', active: 'text-primary-fg' } as const;

/** The second line's word on the row's slices: its first blocked or active slice, `more` after it, and anything `after`
 *  that (such as that every slice is implemented); `title` lists them all. */
export function RowSliceNote({
    title,
    first,
    more,
    after,
}: {
    /** The note in full, as its tooltip. */
    title?: string | undefined;
    /** The first blocked or active slice: its word, tone and title. */
    first?: { word: string; tone: keyof typeof SLICE_TONE; title: string } | undefined;
    /** How many more, after it. */
    more?: string | undefined;
    /** Anything after that, such as that every slice is implemented. */
    after?: string | undefined;
}) {
    return (
        <span data-note className="min-w-0 truncate" title={title}>
            {first && (
                <>
                    <span className={`font-medium ${SLICE_TONE[first.tone]}`}>{first.word}</span>{' '}
                    <span className="text-fg">{first.title}</span>
                    {more}
                </>
            )}
            {after && <span>{after}</span>}
        </span>
    );
}

/** Under a row: Start's message or error and what Auto-build says of it, taking no room when empty. */
export function RowFoot({
    children,
}: {
    /** Start's message or error and what Auto-build says. */
    children: ReactNode;
}) {
    return <div className="pt-1 pr-3 pl-12 empty:hidden">{children}</div>;
}

/** Under a row: its unfolded slices. */
export function RowSlices({
    children,
}: {
    /** The unfolded slices, a SliceList. */
    children: ReactNode;
}) {
    return (
        <div className="row-slices pt-1 pr-3 pl-10" data-slices>
            {children}
        </div>
    );
}

/** The agent figures on one line, at the row's right: `text`, ending in a + when `partial`, or `incomplete` when there
 *  are no figures to show; while `updating`, a spinner named by it leads them. A row that stops animating keeps its
 *  spinner `still`. */
export function UsageFigures({
    title,
    text,
    updating,
    still = false,
    partial,
    incomplete,
}: {
    /** The figures in full, as their tooltip. */
    title: string;
    /** The figures, such as "$1.20 · 34k tokens". */
    text?: string | null | undefined;
    /** What the figures say while they update. */
    updating?: string | undefined;
    /** Keeps the updating mark from pulsing. */
    still?: boolean;
    /** Screen-reader words for the +. */
    partial?: string | undefined;
    /** The words in place of figures for an incomplete total with none to show. */
    incomplete?: string | undefined;
}) {
    return (
        <span className="text-fg-muted flex min-w-0 items-center justify-end gap-1 tabular-nums" title={title}>
            {updating && <Loading presentation="inline" title={updating} still={still} />}
            {text && <span className="truncate">{text}</span>}
            {text
                ? partial && (
                      <span className="-ml-1 shrink-0" data-partial>
                          +<span className="sr-only"> {partial}</span>
                      </span>
                  )
                : incomplete && <span className="shrink-0">{incomplete}</span>}
        </span>
    );
}
