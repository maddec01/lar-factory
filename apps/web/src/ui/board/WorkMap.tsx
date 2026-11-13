// A dossier's Work map: lanes of parts placed left to right by what they wait on, arrows between them, the end-to-end
// check, and finished history folded into one group below. The board lays it out; these draw it at the given places.

import { Tooltip, TooltipPopup, TooltipTrigger } from '@lar-works/design-system';
import { HammerIcon, LightbulbIcon } from '@lar-works/design-system/icons';
import type { ReactNode, Ref } from 'react';

/** The map's frame, which scrolls sideways when the map is wider; `frameRef` measures its width. */
export function WorkMapFrame({
    frameRef,
    children,
}: {
    /** The frame's element, which measures its width. */
    frameRef?: Ref<HTMLDivElement>;
    /** The map's MapCanvas. */
    children: ReactNode;
}) {
    return (
        <div ref={frameRef} className="border-line bg-surface-page overflow-x-auto rounded-lg border" data-work-map>
            {children}
        </div>
    );
}

/** The map's drawing area, `width` by `height` pixels, which places what it holds absolutely. */
export function MapCanvas({
    width,
    height,
    children,
}: {
    /** The drawing's width in pixels. */
    width: number;
    /** The drawing's height in pixels. */
    height: number;
    /** What the map draws, placed absolutely. */
    children: ReactNode;
}) {
    return (
        <div className="relative" style={{ width, height }} data-map-canvas>
            {children}
        </div>
    );
}

/** A lane's band across the map, banded on odd `index`es, with its `name` in a label that stays in view as the map
 *  scrolls. */
export function MapBand({
    index,
    top,
    height,
    width,
    labelWidth,
    children,
}: {
    /** The lane's index; odd ones are banded. */
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
        <div
            className={`absolute left-0 ${index ? 'border-line border-t' : ''} ${index % 2 ? 'bg-surface-sunken/50' : ''}`}
            style={{ top, height, width }}
        >
            <div
                className="bg-surface-page/85 sticky left-0 flex h-full flex-col justify-center gap-0.5 px-3"
                style={{ width: labelWidth }}
            >
                <span className="flex min-w-0 items-center gap-1.5 text-xs font-medium">{children}</span>
            </div>
        </div>
    );
}

/** A lane's name with its icon: the decisions' lane, or the dossier's own repository's builds. */
export function MapLaneName({
    lane,
    children,
}: {
    /** The lane: `decisions` or `builds`. */
    lane: 'decisions' | 'builds';
    /** The lane's name. */
    children: string;
}) {
    const Icon = lane === 'decisions' ? LightbulbIcon : HammerIcon;

    return (
        <>
            <Icon className="text-fg-muted size-3.5" />
            {children}
        </>
    );
}

/** An arrow from one part to another: `d` is its line; a `done` one is solid in the done colour. `lit` draws it bold
 *  while either end is hovered, and `dim` faint while another is. */
export interface MapEdge {
    key: string;
    d: string;
    done: boolean;
    lit: boolean;
    dim: boolean;
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
            {edges.map((e) => (
                <path
                    key={e.key}
                    d={e.d}
                    fill="none"
                    data-edge={e.key}
                    stroke={e.done ? 'var(--color-board-done)' : 'var(--color-fg-muted)'}
                    strokeWidth={e.lit ? 2.5 : 1.5}
                    strokeDasharray={e.done ? undefined : '5 4'}
                    opacity={e.dim ? 0.2 : e.done ? 0.7 : 0.9}
                    markerEnd={`url(#${markerId}-${e.done ? 'done' : 'open'})`}
                />
            ))}
        </svg>
    );
}

/** An arrow's label, at `left`/`top` and at most `maxWidth` wide: a button that opens what it stands for, its tooltip
 *  naming them (`names`). */
export function MapEdgeLabel({
    edge,
    label,
    names,
    left,
    top,
    maxWidth,
    onOpen,
}: {
    /** The arrow it labels, named as `data-edge`. */
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
                    className="text-fg-muted hover:text-fg focus-ring absolute z-10 flex min-h-6 items-start truncate rounded-xs text-left text-xs leading-4 hover:underline"
                    style={{ left, top, maxWidth }}
                >
                    {label}
                </button>
            </TooltipTrigger>
            <TooltipPopup side="top">{names}</TooltipPopup>
        </Tooltip>
    );
}

/** A node's place on the map, faint while `dim`; hovering it lights its arrows. */
export function MapNode({
    left,
    top,
    dim,
    onHover,
    children,
}: {
    /** Its left in pixels. */
    left: number;
    /** Its top in pixels. */
    top: number;
    /** Faint, as another node is hovered. */
    dim: boolean;
    /** Called as the pointer enters or leaves, lighting its arrows. */
    onHover: (hovered: boolean) => void;
    /** The node, such as a MapPartNode. */
    children: ReactNode;
}) {
    return (
        <div
            className={`absolute transition-opacity ${dim ? 'opacity-40' : ''}`}
            style={{ left, top }}
            onMouseEnter={() => onHover(true)}
            onMouseLeave={() => onHover(false)}
        >
            {children}
        </div>
    );
}

export { MapHistoryGroup, MapHistoryList, HistoryRow } from './WorkMapHistory';
export { MAP_NODE_HEIGHT, MapPartNode, MapCheckNode } from './WorkMapNodes';
