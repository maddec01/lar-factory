// The board's one card (board/items.css), on Your desk and in a concept's work map alike: a head of kind, project and
// where the work stands, the title as the button that opens it, quiet lines under it, and a foot with its state on the
// left and its one action on the right. Both surfaces compose this one card, so they never drift apart.

import type { CSSProperties, ReactNode } from 'react';

import type { DataAttributes } from './DataAttributes';
import { ROW_OPENS } from './RowStyles';

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
    name,
    sub,
    state,
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
    /** The head's marks: the kind, then the project or source. */
    head: ReactNode;
    /** Where the work stands, a StageTrack, flush with the head's end. */
    track?: ReactNode;
    /** The title. */
    name: ReactNode;
    /** Quiet lines under the title, such as its question or what it belongs to. */
    sub?: ReactNode;
    /** The foot's left: its state, in amber when it waits on you. */
    state?: ReactNode;
    /** The foot's right: its one action. */
    action?: ReactNode;
    /** Under the foot, such as a slices bar. */
    bottom?: ReactNode;
    /** A size the surface fixes, such as a map card's. */
    style?: CSSProperties | undefined;
} & DataAttributes) {
    return (
        <div
            {...data}
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
                {name}
            </button>
            <div className="desk-more text-fg-muted grid gap-1 text-xs empty:hidden" data-desk-more>
                {sub}
            </div>
            <div className="mt-auto flex min-h-7 items-center justify-between gap-3 pt-1">
                <span
                    data-col="state"
                    className={`flex min-w-0 items-center gap-1.5 truncate text-xs ${tone === 'waiting' ? 'text-warning-fg font-medium' : ''}`}
                >
                    {state}
                </span>
                <span data-col="side" className="wait-actions flex shrink-0 items-center gap-2">
                    {action}
                </span>
            </div>
            {bottom}
        </div>
    );
}
