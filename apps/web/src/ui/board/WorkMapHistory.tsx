import type { ReactNode } from 'react';

import { FoldToggle } from './FoldToggle';
import { COMPACT_ROW, pickedRow } from './RowStyles';
import { MAP_LAYER } from './WorkMapLayers';

/** The finished history's quiet toggle at `top`: one muted line on the lane names' left edge, its done glyph, what
 *  it holds ("3 settled decisions · 17 finished builds") and Show or Hide with its chevron. It stays there, inside the
 *  visible frame, as the map scrolls sideways. */
export function MapHistoryGroup({
    open,
    top,
    height,
    glyph,
    children,
    onToggle,
    onHover,
}: {
    /** The finished parts are shown. */
    open: boolean;
    /** Its top in pixels. */
    top: number;
    /** Its height in pixels. */
    height: number;
    /** The group's glyph, a done StatusGlyph. */
    glyph: ReactNode;
    /** What the group holds, such as "3 settled decisions · 17 finished builds". */
    children: string;
    /** Called as the reader shows or hides the finished parts. */
    onToggle: () => void;
    /** Called as the pointer enters or leaves, marking the cards that follow the finished parts. */
    onHover: (hovered: boolean) => void;
}) {
    return (
        <div className="absolute inset-x-0 flex items-center" style={{ top, height }}>
            {/* Opaque, so the group's line runs on from under it and rails scrolled past never show through its words. */}
            {/* The board's fold, its words on the lane names' 12px edge. */}
            <span
                className={`bg-surface-page sticky left-1 ${MAP_LAYER.history} flex max-w-[calc(100cqw-0.5rem)] min-w-0 rounded-xs px-2 py-1`}
                onMouseEnter={() => onHover(true)}
                onMouseLeave={() => onHover(false)}
            >
                <FoldToggle
                    open={open}
                    label={`${open ? 'Hide' : 'Show'} ${children}`}
                    onToggle={onToggle}
                    data-map-history
                >
                    <span className="flex shrink-0">{glyph}</span>
                    <span className="min-w-0 truncate">{children}</span>
                    <span className="shrink-0">{open ? 'Hide' : 'Show'}</span>
                </FoldToggle>
            </span>
        </div>
    );
}

/** Finished parts use the visible frame width even when the graph scrolls sideways. */
export function MapHistoryList({
    children,
}: {
    /** The finished parts, one HistoryRow each. */
    children: ReactNode;
}) {
    return (
        <ol
            className="bg-surface-page sticky left-0 m-0 grid w-full list-none grid-cols-[repeat(auto-fill,minmax(min(100%,28rem),1fr))] gap-x-4 gap-y-1 px-3 pb-3"
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
    picked,
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
    /** The item the dialog shows now. */
    picked: boolean;
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
            className={`${COMPACT_ROW} ${pickedRow(picked)} grid min-h-12 min-w-0 grid-cols-[auto_1fr] items-center gap-x-2 gap-y-1 text-sm`}
            data-history-part={id}
        >
            {glyph}
            <span className="min-w-0">{kind}</span>
            <button
                type="button"
                onClick={onOpen}
                title={name}
                className="focus-ring col-span-2 min-w-0 rounded-xs text-left wrap-anywhere"
            >
                {title}
            </button>
            {after && (
                <span className="text-fg-muted col-span-2 min-w-0 text-xs wrap-anywhere" title={afterTitle}>
                    {after}
                </span>
            )}
            <span className="text-fg-muted col-span-2 flex min-w-0 flex-wrap items-center gap-2 text-xs">{side}</span>
        </li>
    );
}
