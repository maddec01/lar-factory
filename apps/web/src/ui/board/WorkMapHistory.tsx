import { ChevronDownIcon, ChevronRightIcon } from '@lar-works/design-system/icons';
import type { ReactNode } from 'react';

/** The group finished history folds into, across the map at `top`: a button with its `glyph` and `text` that shows or
 *  hides the finished parts, saying which it does. */
export function MapHistoryGroup({
    open,
    top,
    height,
    dim,
    glyph,
    text,
    showLabel,
    hideLabel,
    onToggle,
    onHover,
}: {
    /** The finished parts are shown. */
    open: boolean;
    /** Its top in pixels. */
    top: number;
    /** Its height in pixels. */
    height: number;
    /** Faint, as another node is hovered. */
    dim: boolean;
    /** The group's glyph. */
    glyph: ReactNode;
    /** The group's text, such as "4 finished". */
    text: string;
    /** The button's accessible name while hidden. */
    showLabel: string;
    /** The button's accessible name while shown. */
    hideLabel: string;
    /** Called as the reader shows or hides the finished parts. */
    onToggle: () => void;
    /** Called as the pointer enters or leaves. */
    onHover: (hovered: boolean) => void;
}) {
    return (
        <button
            type="button"
            aria-expanded={open}
            onClick={onToggle}
            data-map-history
            onMouseEnter={() => onHover(true)}
            onMouseLeave={() => onHover(false)}
            className={`border-line bg-surface-raised hover:bg-fill-hover focus-ring absolute flex items-center gap-2 rounded-lg border px-2.5 text-left text-xs shadow-(--shadow-raised) transition-opacity ${dim ? 'opacity-40' : ''}`}
            style={{ left: 12, right: 12, top, height }}
        >
            {glyph}
            <span className="min-w-0 truncate font-medium">{text}</span>
            <span className="text-fg-muted inline-flex shrink-0 items-center gap-1">
                {open ? (
                    <>
                        {hideLabel}
                        <ChevronDownIcon className="size-3.5" />
                    </>
                ) : (
                    <>
                        {showLabel}
                        <ChevronRightIcon className="size-3.5" />
                    </>
                )}
            </span>
        </button>
    );
}

/** The finished parts under the map, `width` wide, one HistoryRow each. */
export function MapHistoryList({
    width,
    children,
}: {
    /** The list's width in pixels. */
    width: number;
    /** The finished parts, one HistoryRow each. */
    children: ReactNode;
}) {
    return (
        <ol
            className="m-0 grid list-none grid-cols-[repeat(auto-fill,minmax(min(100%,28rem),1fr))] gap-x-4 gap-y-1 px-3 pb-3"
            style={{ width }}
            data-map-history-parts
        >
            {children}
        </ol>
    );
}

/** A finished part as one row of the history: its glyph, kind, title opening it, what it followed, and at its right its
 *  repository, pull requests and thread. */
export function HistoryRow({
    id,
    glyph,
    kind,
    name,
    onOpen,
    title,
    after,
    afterTitle,
    side,
}: {
    /** The part's item, named as `data-item`. */
    id: string;
    /** The part's status glyph. */
    glyph: ReactNode;
    /** The part's kind. */
    kind: ReactNode;
    /** The part's full name, for its title's tooltip. */
    name: string;
    /** Called as the reader opens the part. */
    onOpen: () => void;
    /** The part's title. */
    title: ReactNode;
    /** What the part followed. */
    after?: string | undefined;
    /** What it followed in full, as its tooltip. */
    afterTitle?: string | undefined;
    /** Its repository, pull requests and thread, at the right. */
    side: ReactNode;
}) {
    return (
        <li
            className="hover:bg-fill-hover flex min-h-12 min-w-0 items-center gap-3 rounded-md px-3 text-sm"
            data-history-part={id}
        >
            {glyph}
            <span className="w-22 shrink-0">{kind}</span>
            <button
                type="button"
                onClick={onOpen}
                title={name}
                className="focus-ring min-w-0 truncate rounded-xs text-left hover:underline"
            >
                {title}
            </button>
            {after && (
                <span className="text-fg-muted min-w-0 shrink-[1000] truncate text-xs" title={afterTitle}>
                    {after}
                </span>
            )}
            <span className="text-fg-muted ml-auto flex shrink-0 items-center gap-2 text-xs">{side}</span>
        </li>
    );
}
