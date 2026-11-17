// The board's one work row (board/rows.css), in Queue, Shaping, Ready to build, Build and Concepts and linked work: a
// first line in columns that line up down the whole board, one button that opens the item's details with the row's
// action beside it, and under it a second line on the same columns.

import { Loading } from '@lar-works/design-system';
import { GitPullRequest } from '@lar-works/design-system/icons';
import { type MouseEvent, type ReactNode, useLayoutEffect, useRef } from 'react';

import { type ActivityState, StateMark } from './ActivityLine';
import { useArrival } from './BoardLife';
import { FoldToggle } from './FoldToggle';
import { pickedRow, ROW_ACTION, ROW_BOX, ROW_OPENS } from './RowStyles';
import { OneLineAction } from './StartAfterButton';

/** A stage row, a line on its section's card: `item` names it as `data-item`, `picked` marks the item the dialog
 *  shows, and `attention` marks one that waits on you: its state reads in the warning colour, as Your desk above carries
 *  the loud recipe. A row a read just moved here from another lane slides in from that side and flashes the navy wash
 *  (BoardLife). A row is 42px with one line and 62 with two: its hairline edge, 6px above its 28px first line and 6
 *  below. Its hover and the picked wash sit over the tile's fill, as light mode's hover is the same wash as that fill;
 *  the hover eases in as a card's does. */
export function StageRowItem({
    item,
    picked,
    attention = false,
    part = false,
    children,
}: {
    /** A concept's part, in its parts box: also named as `data-part`. */
    part?: boolean;
    /** The item, named as `data-item`. */
    item: string;
    /** The item the dialog shows now. */
    picked: boolean;
    /** The item waits on you: it is on Your desk. */
    attention?: boolean;
    /** The row's lines. */
    children: ReactNode;
}) {
    const arrival = useArrival('lane', item);

    return (
        <li
            data-item={item}
            data-arrived={arrival?.from}
            data-attention={attention || undefined}
            data-part={part ? item : undefined}
            className="@container"
        >
            <div className={`${ROW_BOX} py-1.5 ${pickedRow(picked)}`}>{children}</div>
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

/** A row's first line's cells as the one button that opens its item. Its project chip names the project whole on
 *  hover only while the name is cut, so the row carries no tooltip of its own repeating it. */
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
        <span data-row-identity className="text-fg-soft flex min-w-0 items-center gap-1.5">
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
        <span className="text-fg min-w-0 truncate text-sm leading-7" title={name} data-title>
            {children}
        </span>
    );
}

/** The row's state in words; `title` says more. In a row's state cell it leads with a `mark`, as its thread's activity
 *  does, so every state there reads as a mark and a word on one line; `none` keeps the mark's room. */
export function RowState({
    title,
    mark,
    children,
}: {
    /** More on the state, as its tooltip. */
    title?: string;
    /** The mark before the words, in a row's state cell. */
    mark?: ActivityState | 'blocked' | 'none' | undefined;
    /** The state in words. */
    children: ReactNode;
}) {
    if (!mark)
        return (
            <span className="max-w-full min-w-0 truncate" title={title} data-state>
                {children}
            </span>
        );

    return (
        <span className="flex max-w-full min-w-0 items-center gap-1.5 whitespace-nowrap" title={title} data-state>
            <StateMark state={mark} />
            <span className="min-w-0 truncate">{children}</span>
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
                <OneLineAction>{children}</OneLineAction>
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
                <OneLineAction>{children}</OneLineAction>
            </span>
        </span>
    );
}

/** A row's facts at its end, on its one line: what its thread does or what holds it, its slices, its pull request, then
 *  its RowMetaEnd. A click on it beside its controls goes to `onClick`, as the row's button does. */
export function RowMeta({
    onClick,
    children,
}: {
    /** Called with a click on the facts beside their controls. */
    onClick?: ((event: MouseEvent<HTMLElement>) => void) | undefined;
    /** The facts, in reading order. */
    children: ReactNode;
}) {
    return (
        <div data-row-meta onClick={onClick} className="row-meta">
            {children}
        </div>
    );
}

/** A row's progress among its facts: its `bar`, then its `count`. */
export function RowProgress({
    bar,
    count,
}: {
    /** The bar, such as a SliceBar; none shows the count alone. */
    bar?: ReactNode;
    /** The count, a RowCount or RowSliceToggle. */
    count: ReactNode;
}) {
    return (
        <span data-col="progress" className="flex items-center gap-2">
            {bar && <span data-col="bar">{bar}</span>}
            {count}
        </span>
    );
}

/** The last of a row's facts, flush with the row's end: its cost, then how long it has sat there, each on a fixed
 *  track so they line up down every list. A `full` end says every agent figure, and its track takes their width
 *  (rows.css). */
export function RowMetaEnd({
    full = false,
    cost,
    age,
}: {
    /** It holds every agent figure, not the cost alone. */
    full?: boolean;
    /** The agent figures, a Figures. */
    cost?: ReactNode;
    /** How long it has sat there, an Age. */
    age?: ReactNode;
}) {
    return (
        <span data-meta-end data-full={full || undefined} className="row-meta-end">
            <span data-cost>{cost}</span>
            <span data-age>{age}</span>
        </span>
    );
}

/** The second line's count, such as `2/5 parts`; `pr` leads it with the pull request's mark, as a PR's checks count does
 *  on a desk card. */
export function RowCount({
    title,
    pr = false,
    children,
}: {
    /** The count in full, as its tooltip. */
    title?: string;
    /** It counts a pull request's checks. */
    pr?: boolean;
    /** The count, such as `2/5 parts`. */
    children: ReactNode;
}) {
    return (
        <span data-col="count" className="flex min-w-0 items-center gap-1 tabular-nums" title={title}>
            {pr && <GitPullRequest aria-hidden="true" className="size-3.5 shrink-0" />}
            <span className="truncate">{children}</span>
            {/* The slice toggle's chevron room, so a parts count lines up with a slices count. */}
            <span aria-hidden="true" className="size-3" />
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
        <FoldToggle open={open} onToggle={onToggle} data-col="count">
            <span className="sr-only">{label}:</span> {children}
        </FoldToggle>
    );
}

/** A dependency holding the row, in its state cell: a red mark and what it waits on. */
export function RowBlocked({
    children,
}: {
    /** The dependency holding the row. */
    children: string;
}) {
    return (
        // A red mark says what's stuck at a glance on any list; its words stay quiet.
        <span data-blocked className="flex max-w-full min-w-0 items-center gap-1.5 whitespace-nowrap" title={children}>
            <StateMark state="blocked" />
            <span className="text-fg-muted min-w-0 truncate">{children}</span>
        </span>
    );
}

const SLICE_TONE = { blocked: 'text-danger-fg', active: 'text-primary-fg' } as const;

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
        <span data-note className="flex max-w-full min-w-0 items-center gap-1.5 whitespace-nowrap" title={title}>
            {first && <StateMark state={first.tone === 'blocked' ? 'blocked' : 'working'} />}
            <span className="min-w-0 truncate">
                {first && (
                    <>
                        <span className={`font-medium ${SLICE_TONE[first.tone]}`}>{first.word}</span>{' '}
                        <span className="text-fg">{first.title}</span>
                        {more}
                    </>
                )}
                {after && <span>{after}</span>}
            </span>
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
        <div className="row-slices pt-1 pr-3 pl-17" data-slices>
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

/** The other projects a row's work spans, such as a concept's parts', as a count after its own, named on hover. */
export function RowOthers({ names }: { names: string[] }) {
    return (
        <span className="text-fg-muted shrink-0 tabular-nums" title={`Also in ${names.join(', ')}`}>
            +{names.length}
        </span>
    );
}
