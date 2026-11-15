// A dossier's Work map: lanes of parts placed left to right by what they wait on, arrows between them, the end-to-end
// check, and finished history folded into one group below. The board lays it out; these draw it at the given places.

import { Tooltip, TooltipPopup, TooltipTrigger } from '@lar-works/design-system';
import { ArrowRightIcon } from '@lar-works/design-system/icons';
import { useCallback, useEffect, useRef, useState, type ReactNode, type RefObject } from 'react';

import { PartKindIcon } from './PartsList';

/** How many of the map's cards lie partly or wholly past the frame's right edge, what they are (each card's
 *  `data-map-name`), the first of them, the middle of its height (where an arrow into it arrives), how wide the fade over
 *  them is (from the last card in full view to the edge, so it never dims a card that shows whole) and whether the map is
 *  wider than its frame at all. */
function pastEdge(el: HTMLDivElement) {
    const edge = el.scrollLeft + el.clientWidth + 1;
    const right = (node: HTMLElement) => node.offsetLeft + node.offsetWidth;
    const nodes = [...el.querySelectorAll<HTMLElement>('[data-map-node]')];
    const past = nodes.filter((node) => right(node) > edge).sort((a, b) => a.offsetLeft - b.offsetLeft);
    const whole = Math.max(el.scrollLeft, ...nodes.map(right).filter((r) => r <= edge));
    const first = past[0] ?? null;

    return {
        count: past.length,
        names: past.map((node) => node.dataset.mapName ?? '').filter(Boolean),
        first,
        fade: Math.min(64, Math.max(0, edge - 1 - whole)),
        middle: first ? first.offsetTop + first.offsetHeight / 2 : 0,
        wide: el.scrollWidth > el.clientWidth + 1,
    };
}

const NOTHING_PAST = { count: 0, names: [] as string[], fade: 0, middle: 0, wide: false };

/**
 * The map's frame, which scrolls sideways when the map is wider, snapping to its columns. While the map is wider than the
 * frame, a gutter of its own at the frame's right end holds a "2 more" button, so it never sits over a card: while cards
 * lie past the edge, the edge fades over the part of the next one that shows, and the button, level with the next one so
 * the arrow running into it points at it, counts them, names them in its tooltip and scrolls the next one into view;
 * `frameRef` measures the scrolling width, short of the gutter.
 */
export function WorkMapFrame({
    frameRef,
    children,
}: {
    /** The frame's scrolling element, which measures its width. */
    frameRef?: RefObject<HTMLDivElement | null>;
    /** The map's MapCanvas. */
    children: ReactNode;
}) {
    const own = useRef<HTMLDivElement | null>(null);
    const [more, setMore] = useState(NOTHING_PAST);
    const measure = useCallback(() => {
        const el = own.current;
        const { count, names, fade, middle, wide } = el ? pastEdge(el) : NOTHING_PAST;

        setMore((was) =>
            was.count === count &&
            was.fade === fade &&
            was.middle === middle &&
            was.wide === wide &&
            was.names.join('\n') === names.join('\n')
                ? was
                : { count, names, fade, middle, wide },
        );
    }, []);
    const setRef = useCallback(
        (el: HTMLDivElement | null) => {
            own.current = el;

            if (frameRef) frameRef.current = el;
        },
        [frameRef],
    );
    const next = () => {
        const el = own.current;
        const first = el && pastEdge(el).first;

        if (el && first)
            el.scrollTo({ left: first.offsetLeft + first.offsetWidth + 16 - el.clientWidth, behavior: 'smooth' });
    };
    const label = `${more.count} more`;
    const names = more.names.join(' · ');

    useEffect(() => {
        const el = own.current;

        if (!el) return;

        const observer = new ResizeObserver(measure);

        observer.observe(el);

        if (el.firstElementChild) observer.observe(el.firstElementChild);

        return () => observer.disconnect();
    }, [measure]);

    return (
        <div className="border-line bg-surface-page relative flex overflow-hidden rounded-lg border" data-work-map>
            <div className="relative min-w-0 flex-1">
                <div
                    ref={setRef}
                    onScroll={measure}
                    className="@container snap-x snap-proximity overflow-x-auto"
                    data-work-map-scroll
                >
                    {children}
                </div>
                {more.count > 0 && more.fade > 0 && (
                    <span
                        aria-hidden="true"
                        className="from-surface-page pointer-events-none absolute inset-y-0 right-0 z-10 bg-linear-to-l to-transparent"
                        style={{ width: more.fade }}
                        data-work-map-more
                    />
                )}
            </div>
            {more.wide && (
                // The gutter the count lives in, level with the next card's middle, where the arrow into it arrives.
                <div className="relative w-20 shrink-0" data-work-map-gutter>
                    {more.count > 0 && (
                        <Tooltip>
                            <TooltipTrigger asChild>
                                <button
                                    type="button"
                                    onClick={next}
                                    aria-label={`${label} to the right: ${names}`}
                                    style={{ top: more.middle }}
                                    className="border-line bg-surface-raised text-fg-muted hover:text-fg focus-ring absolute left-1/2 z-20 flex h-6 -translate-1/2 items-center gap-1 rounded-full border pr-1.5 pl-2 text-xs whitespace-nowrap tabular-nums shadow-(--shadow-raised)"
                                    data-work-map-next
                                >
                                    {label}
                                    <ArrowRightIcon aria-hidden="true" className="size-3.5" />
                                </button>
                            </TooltipTrigger>
                            <TooltipPopup side="left">{names}</TooltipPopup>
                        </Tooltip>
                    )}
                </div>
            )}
        </div>
    );
}

/** The map's drawing area, `width` by `height` pixels, which places what it holds absolutely; its frame snaps to
 *  every `snap.step` pixels, `snap.count` times, a column at a time. */
export function MapCanvas({
    width,
    height,
    snap,
    children,
}: {
    /** The drawing's width in pixels. */
    width: number;
    /** The drawing's height in pixels. */
    height: number;
    /** Where scrolling comes to rest: a column's width and how many columns. */
    snap?: { step: number; count: number } | undefined;
    /** What the map draws, placed absolutely. */
    children: ReactNode;
}) {
    return (
        <div className="relative" style={{ width, height }} data-map-canvas>
            {snap &&
                Array.from({ length: snap.count }, (_, i) => (
                    <span
                        key={i}
                        aria-hidden="true"
                        className="absolute top-0 size-px snap-start"
                        style={{ left: i * snap.step }}
                    />
                ))}
            {children}
        </div>
    );
}

/** A lane's band across the map, untinted so a lane whose cards start far right shows no empty block, each after the
 *  first parted by a hairline, with its `name` in a label that stays in view over the cards as the map scrolls. */
export function MapBand({
    index,
    top,
    height,
    width,
    labelWidth,
    children,
}: {
    /** The lane's index; every lane after the first is parted from the one above. */
    index: number;
    /** The band's top in pixels. */
    top: number;
    /** The band's height in pixels. */
    height: number;
    /** The band's width in pixels. */
    width: number;
    /** The label's width in pixels. */
    labelWidth: number;
    /** The lane's name, a MapLaneName. */
    children: ReactNode;
}) {
    return (
        <div className={`absolute left-0 ${index ? 'border-line border-t' : ''}`} style={{ top, height, width }}>
            {/* Opaque, so a card scrolled under it never shows through. */}
            <div className="bg-surface-page sticky left-0 z-[5] h-full" style={{ width: labelWidth }}>
                <div className="flex h-full flex-col justify-center gap-0.5 px-3">
                    <span className="flex min-w-0 items-center gap-1.5 text-xs font-medium">{children}</span>
                </div>
            </div>
        </div>
    );
}

/** A lane's name with its icon, the one its kind of part wears: the decisions' lane, or the dossier's own repository's
 *  builds. */
export function MapLaneName({
    lane,
    children,
}: {
    /** The lane: `decisions` or `builds`. */
    lane: 'decisions' | 'builds';
    /** The lane's name. */
    children: string;
}) {
    return (
        <>
            <span className="text-fg-muted flex shrink-0 [&>svg]:size-3.5">
                <PartKindIcon kind={lane === 'decisions' ? 'decision' : 'build'} />
            </span>
            {children}
        </>
    );
}

/** An arrow from one part to another: `d` is its line; a `done` one is solid in the done colour. `lit` draws it bold
 *  and full while either end is hovered, and `dim` faint while another is. A `rail` joins a card to the history group:
 *  thin and muted, under the arrows between current work, still ending at its card. */
export interface MapEdge {
    key: string;
    kind?: 'blocker' | 'dependency' | undefined;
    d: string;
    done: boolean;
    lit: boolean;
    dim: boolean;
    rail?: boolean;
}

/** The map's arrows, under its parts. `markerId` is unique to the map. */
export function MapEdges({
    width,
    height,
    markerId,
    edges,
}: {
    /** The drawing's width in pixels. */
    width: number;
    /** The drawing's height in pixels. */
    height: number;
    /** The arrowheads' marker id, unique to the map. */
    markerId: string;
    /** The arrows, each with its path and state. */
    edges: MapEdge[];
}) {
    return (
        <svg className="pointer-events-none absolute inset-0" width={width} height={height} aria-hidden="true">
            <defs>
                {['done', 'open'].map((k) => (
                    <marker
                        key={k}
                        id={`${markerId}-${k}`}
                        viewBox="0 0 8 8"
                        refX="7"
                        refY="4"
                        markerWidth="7"
                        markerHeight="7"
                        orient="auto"
                    >
                        <path
                            d="M0 0 8 4 0 8z"
                            fill={k === 'done' ? 'var(--color-board-done)' : 'var(--color-fg-muted)'}
                        />
                    </marker>
                ))}
            </defs>
            {[...edges]
                .sort((a, b) => Number(!!b.rail) - Number(!!a.rail))
                .map((e) => (
                    <path
                        key={e.key}
                        d={e.d}
                        fill="none"
                        data-edge={e.key}
                        data-edge-kind={e.kind}
                        data-edge-rail={e.rail || undefined}
                        stroke={e.done && !e.rail ? 'var(--color-board-done)' : 'var(--color-fg-muted)'}
                        strokeWidth={e.rail ? (e.lit ? 1.5 : 1) : e.lit ? 2.5 : 1.5}
                        strokeDasharray={e.kind === 'dependency' ? '2 4' : e.done ? undefined : '5 4'}
                        opacity={
                            e.rail ? (e.lit ? 0.75 : e.dim ? 0.15 : 0.4) : e.lit ? 1 : e.dim ? 0.2 : e.done ? 0.7 : 0.9
                        }
                        markerEnd={`url(#${markerId}-${e.done && !e.rail ? 'done' : 'open'})`}
                    />
                ))}
        </svg>
    );
}

/** An arrow's label, at `left`/`top` and at most `maxWidth` wide, such as "2 completed prerequisites": small muted text
 *  in a gap of its own beside the card it leads to, a button that shows what it stands for, its tooltip naming them
 *  (`names`). */
export function MapEdgeLabel({
    edge,
    label,
    names,
    left,
    top,
    maxWidth,
    onOpen,
}: {
    /** The arrow it labels, named as `data-edge-label`. */
    edge: string;
    /** The label's text. */
    label: string;
    /** What the arrow stands for, as its tooltip. */
    names: string;
    /** Its left in pixels. */
    left: number;
    /** Its top in pixels. */
    top: number;
    /** Its widest, in pixels. */
    maxWidth: number;
    /** Called as the reader opens what it stands for. */
    onOpen: () => void;
}) {
    return (
        <Tooltip>
            <TooltipTrigger asChild>
                <button
                    type="button"
                    aria-label={`${label}: ${names}`}
                    onClick={onOpen}
                    data-edge-label={edge}
                    className="text-fg-muted hover:text-fg focus-ring absolute z-[4] h-4 truncate rounded-xs text-left text-xs leading-4 hover:underline"
                    style={{ left, top, maxWidth }}
                >
                    {label}
                </button>
            </TooltipTrigger>
            <TooltipPopup side="top">{names}</TooltipPopup>
        </Tooltip>
    );
}

/** A node's place on the map; hovering it lights its arrows, and the nodes at their other ends take a stronger edge
 *  (`related`, items.css), every card staying readable. */
export function MapNode({
    name,
    left,
    top,
    related,
    onHover,
    children,
}: {
    /** What it is, which the frame's "2 more" names while it lies past the edge. */
    name: string;
    /** Its left in pixels. */
    left: number;
    /** Its top in pixels. */
    top: number;
    /** An arrow joins it to the node hovered now. */
    related: boolean;
    /** Called as the pointer enters or leaves, lighting its arrows. */
    onHover: (hovered: boolean) => void;
    /** The node, such as a MapPartNode. */
    children: ReactNode;
}) {
    return (
        <div
            className="absolute"
            style={{ left, top }}
            data-map-node
            data-map-name={name}
            data-map-related={related || undefined}
            onMouseEnter={() => onHover(true)}
            onMouseLeave={() => onHover(false)}
        >
            {children}
        </div>
    );
}

export { MapHistoryGroup, MapHistoryList, HistoryRow } from './WorkMapHistory';
export { MAP_NODE_HEIGHT, MapPartNode, MapCheckNode, MapPrerequisiteNode, measureMapCards } from './WorkMapNodes';
