// The board's one card (board/items.css), on Your desk and in a concept's work map alike, the same size and the same
// parts in the same places: a head of where the item lives and where its work stands, its kind and title on one line as
// the button that opens it, quiet lines under that, and a foot of what it is at (in amber when it waits on you) and its
// age, with its one action over the foot's end on hover. Both surfaces compose this one card, so they never drift apart.

import { type CSSProperties, type ReactNode, useLayoutEffect, useRef } from 'react';

import type { DataAttributes } from './DataAttributes';
import { fitCardLines } from './fitCardLines';
import { ROW_OPENS } from './RowStyles';
import { MetaLine } from './TextParts';

/** What a card needs, which colours its leading bar: it waits on you, works, is done, or is held by other work. */
export type BoardCardTone = 'waiting' | 'active' | 'done' | 'held';

/**
 * A card that opens its item: a click anywhere on it but its controls opens it, and its title is the button that does,
 * for the keyboard. `picked` takes the current ring while its dialog shows.
 */
export function BoardCard({
    tone,
    picked = false,
    onOpen,
    openLabel,
    tooltip,
    head,
    track,
    kind,
    name,
    status,
    statusTone = 'waiting',
    statusTitle,
    statusDot,
    sub,
    age,
    action,
    bottom,
    style,
    ...data
}: {
    /** What it needs, as its leading bar and tint; none for a card that needs nothing. */
    tone?: BoardCardTone | undefined;
    /** Its item's dialog shows now. */
    picked?: boolean;
    /** Called as the reader opens its item. */
    onOpen: () => void;
    /** The title button's accessible name, when the title alone doesn't say it. */
    openLabel?: string | undefined;
    /** The card in full, as the title's tooltip. */
    tooltip: string;
    /** Where the item lives: its source and project, a RowSource. */
    head: ReactNode;
    /** Where the work stands, a StageTrack, flush with the head's end. */
    track?: ReactNode;
    /** The item's kind, a mark before its title. */
    kind?: ReactNode;
    /** The title. */
    name: ReactNode;
    /** What it is at, on the foot's left before its age: what it waits on you for, or else where it stands ("Blocked by #139"). */
    status?: string | undefined;
    /** `waiting` on you, in the desk's amber, or `plain` in the quiet text. */
    statusTone?: 'waiting' | 'plain';
    /** The status in full, as its tooltip. */
    statusTitle?: string | undefined;
    /** A dot in the status's state colour before it, as a row's state and a server scan's lane are marked. */
    statusDot?: string | undefined;
    /** Quiet lines under the title, such as its question or what it belongs to. */
    sub?: ReactNode;
    /** The foot's left: how long ago it last moved, such as "2d ago". */
    age?: ReactNode;
    /** The foot's right: its one action, which shows on hover or keyboard focus, over the foot's end (items.css). */
    action?: ReactNode;
    /** Under the foot, such as a slices bar. */
    bottom?: ReactNode;
    /** A size the surface fixes, such as a map card's. */
    style?: CSSProperties | undefined;
} & DataAttributes) {
    const foot = useRef<HTMLDivElement>(null);
    const card = useRef<HTMLDivElement>(null);

    // The title and the lines under it share the card's fixed height, as much of each as fits and never part of a line
    // (fitCardLines): after every render, as the card's width changes, and once the fonts have loaded.
    useLayoutEffect(() => {
        if (card.current) fitCardLines(card.current);
    });
    useLayoutEffect(() => {
        const element = card.current;

        if (!element || typeof ResizeObserver === 'undefined') return;

        // The width it was fitted at, so a resize that keeps it (a height change the fit itself made) fits nothing again.
        const fitted = { width: element.offsetWidth };
        const observer = new ResizeObserver(() => {
            if (element.offsetWidth === fitted.width) return;

            fitted.width = element.offsetWidth;
            fitCardLines(element);
        });

        observer.observe(element);
        void document.fonts?.ready.then(() => fitCardLines(element));

        return () => observer.disconnect();
    }, []);

    // The foot keeps its action's width as `--card-side-width`, so the foot's words fade out just before the action
    // that stands over it on hover (items.css).
    useLayoutEffect(() => {
        const row = foot.current;
        const side = row?.querySelector<HTMLElement>(':scope > [data-col="side"]');

        if (!row || !side || typeof ResizeObserver === 'undefined') return;

        const measure = () => row.style.setProperty('--card-side-width', `${side.offsetWidth}px`);
        const observer = new ResizeObserver(measure);

        observer.observe(side);
        measure();

        return () => observer.disconnect();
    }, []);

    return (
        <div
            {...data}
            ref={card}
            style={style}
            className={`desk-tile board-card ${picked ? 'ring-primary-edge ring-1' : ''}`}
            data-card-tone={tone}
            onClick={(event) => {
                if ((event.target as Element).closest('button, a') || !window.getSelection()?.isCollapsed) return;

                onOpen();
            }}
        >
            <div className="text-fg-muted flex min-h-5 min-w-0 items-center gap-2 text-xs" data-card-head>
                {head}
                {track && <span className="ml-auto flex shrink-0 items-center">{track}</span>}
            </div>
            <button
                type="button"
                data-row-open
                onClick={onOpen}
                aria-label={openLabel}
                className={`text-fg line-clamp-2 rounded-xs text-left text-sm leading-5 ${ROW_OPENS}`}
                title={tooltip}
                data-title
            >
                {kind && (
                    <span className="inline-flex align-[-3px]" style={{ marginRight: '0.5rem' }}>
                        {kind}
                    </span>
                )}
                {name}
            </button>
            <div className="desk-more text-fg-muted grid gap-1 text-xs empty:hidden" data-desk-more>
                {sub}
            </div>
            <div ref={foot} className="mt-auto flex min-h-7 items-center justify-between gap-3 pt-1" data-card-foot>
                <span data-col="state" className="flex min-w-0 items-center gap-1.5 truncate text-xs">
                    {status && statusDot && (
                        <span
                            className="size-2 shrink-0 rounded-full"
                            style={{ background: statusDot }}
                            aria-hidden="true"
                            data-status-dot
                        />
                    )}
                    {status && (
                        <span
                            className={`truncate font-medium ${statusTone === 'waiting' ? 'text-warning-fg' : 'text-fg-soft'}`}
                            title={statusTitle ?? status}
                            data-state
                        >
                            {status}
                        </span>
                    )}
                    {status && age && (
                        <span className="text-fg-muted" aria-hidden="true">
                            ·
                        </span>
                    )}
                    {age && (
                        <span className="text-fg-muted shrink-0" data-age>
                            {age}
                        </span>
                    )}
                </span>
                <span data-col="side" className="wait-actions flex shrink-0 items-center gap-2">
                    {action}
                </span>
            </div>
            {bottom}
        </div>
    );
}

/** A card's question, under its title in the softer text, whole in its tooltip. */
export function CardQuestion({ children }: { children: string }) {
    return (
        <span className="text-fg-soft" title={children} data-question>
            {children}
        </span>
    );
}

/** What a card's work belongs to, such as its concept: "in #200 acme cloud…". */
export function CardPartOf({ name }: { name: string }) {
    return (
        <span title={name} data-part-of>
            in {name}
        </span>
    );
}

/** The briefs one group approval covers, named on a card's line. */
export function CardBriefs({ members }: { members: string[] }) {
    return (
        <span>
            Briefs: <MetaLine parts={members} />
        </span>
    );
}

/** What a card's thread does now, an ActivityLine, on a line of its own. */
export function CardActivity({ children }: { children: ReactNode }) {
    return (
        <span className="flex min-w-0" data-map-activity>
            {children}
        </span>
    );
}

/** A card's meter under its foot, such as its slices or a working bar. */
export function CardMeter({ children }: { children: ReactNode }) {
    return (
        <span className="shrink-0" data-map-slices>
            {children}
        </span>
    );
}
