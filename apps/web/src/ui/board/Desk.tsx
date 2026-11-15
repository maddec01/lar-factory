import { SectionTitle, StatusIndicator } from '@lar-works/design-system';
import type { StatusState } from '@lar-works/design-system';
import { Children, type ReactNode, useLayoutEffect, useRef, useState } from 'react';

import { BoardCard } from './BoardCard';
import { useArrival } from './BoardLife';

interface DeskSectionProps {
    /** The section's heading, such as "Your desk". */
    title: string;
    /** How many rows show; with none, `empty` says why, muted beside the title. */
    count: number;
    /** The first read may still add rows; hide its provisional zero. */
    loading?: boolean;
    /** What the section says when nothing awaits you. */
    empty?: ReactNode;
    /** The rows, one DeskCard each. */
    children?: ReactNode;
}

/** "Your desk": the items awaiting your action, as a grid of cards under a section title, the board's one loud surface:
 *  each card an even amber tint with a hairline of the same tone, so what waits on you is the first thing the eye
 *  finds. It shows two rows of cards and Show more, so the lanes under it stay in reach. An empty desk is its title
 *  line alone, saying why beside the title. Its heading is `#desk-h`. */
export function DeskSection({ title, count, loading = false, empty, children }: DeskSectionProps) {
    const [all, setAll] = useState(false);
    const grid = useRef<HTMLOListElement>(null);
    const [columns, setColumns] = useState(4);
    // Two rows of as many cards as fit across; the rest wait for Show more, so the lanes under it stay in reach.
    // Even one more card would start a third row, which pushes the lanes' work out of view on a small window.
    const shown = all || count <= columns * 2 ? count : columns * 2;
    const hidden = Math.max(0, count - shown);
    const hasCards = count > 0;

    useLayoutEffect(() => {
        const element = grid.current;

        if (!element || typeof ResizeObserver === 'undefined') return;

        // A grid whose columns can't be read (no layout yet) keeps the four-across default rather than one column.
        const measure = () => {
            const tracks = getComputedStyle(element).gridTemplateColumns;

            setColumns(!tracks || tracks === 'none' ? 4 : tracks.split(' ').filter(Boolean).length);
        };
        const observer = new ResizeObserver(measure);

        observer.observe(element);
        measure();

        return () => observer.disconnect();
    }, [hasCards]);

    return (
        <section className="desk grid shrink-0 scroll-mt-16 gap-3" aria-labelledby="desk-h">
            <div className="flex min-h-9 items-center justify-between gap-3 pr-3 pl-4">
                <div className="flex min-w-0 items-center gap-3">
                    <SectionTitle
                        id="desk-h"
                        level="h2"
                        title={title}
                        icon={<StatusIndicator state={count ? 'waiting' : 'off'} />}
                        count={count}
                        countLoading={loading}
                    />
                    {/* An empty desk says why beside its title, quiet, so the lanes come straight after it. */}
                    {!count && (
                        <span className="text-fg-muted flex min-w-0 items-center truncate text-xs" data-desk-empty>
                            {empty}
                        </span>
                    )}
                </div>
                {/* A quiet header control on the rows' right gutter, as Auto-build is. */}
                {hidden > 0 && <DeskShowMore onClick={() => setAll(true)}>Show {hidden} more</DeskShowMore>}
            </div>
            {count > 0 && (
                <ol ref={grid} aria-label={title} className="desk-grid m-0 list-none p-0">
                    {Children.toArray(children).slice(0, shown)}
                </ol>
            )}
        </section>
    );
}

/**
 * Brings Your desk into view, as need you's counter does when pressed: off screen (or under the title bar), the board
 * scrolls smoothly up to it; on screen, its cards glow once, so the eye finds them. False when there is no desk to show,
 * so the counter opens its list instead.
 */
export function bringDeskIntoView(): boolean {
    const desk = document.querySelector<HTMLElement>('section.desk');

    if (!desk?.querySelector('.desk-tile')) return false;

    const bar = document.querySelector('.title-bar')?.getBoundingClientRect().bottom ?? 0;
    const { top } = desk.getBoundingClientRect();
    const offScreen = top < bar || top > window.innerHeight / 2;
    const still = window.matchMedia('(prefers-reduced-motion: reduce)').matches;

    if (offScreen) desk.scrollIntoView({ behavior: still ? 'auto' : 'smooth', block: 'start' });

    // The glow starts as the scroll settles, restarting if a glow still runs, and clears itself.
    window.setTimeout(
        () => {
            delete desk.dataset.flash;
            void desk.offsetWidth;
            desk.dataset.flash = '';
            window.clearTimeout(Number(desk.dataset.flashTimer));
            desk.dataset.flashTimer = String(window.setTimeout(() => delete desk.dataset.flash, 1400));
        },
        offScreen && !still ? 350 : 0,
    );

    return true;
}

interface DeskCardProps {
    /** The item's id, as `data-item`. */
    item: string;
    /** Whether the item dialog shows this item now. */
    picked: boolean;
    /** Called as the reader opens the item dialog. */
    onOpen: () => void;
    /** Where the item comes from: its source and project, a RowSource. */
    source: ReactNode;
    /** The item's kind, a quiet mark before its title. */
    kind?: ReactNode;
    /** Where the item stands in its workflow, a StageTrack, at the head's end as on a work-map card. */
    track?: ReactNode;
    /** The step the track points at, such as "Verify", at the foot when nothing else is waited for. */
    step?: string | undefined;
    /** The question its thread asks, under the title. */
    question?: string | undefined;
    /** The lane the item sits in, such as "Build", which the row names before its status. */
    stage?: string | undefined;
    /** The item's title. */
    title: ReactNode;
    /** The title's full text, which names the card. */
    name: string;
    /** The concept or linked parent this work belongs to, supplied by the desk projection. */
    parentName?: string;
    /** The exact member names covered by one group approval. */
    members?: string[];
    /** More about the item under its title, such as a work item's fields. */
    details?: ReactNode;
    /** The status's glyph, only where there is no `statusState` (the row's amber bar marks it instead). */
    statusIcon: ReactNode;
    /** The next step, in words. */
    status: string;
    /** The status's state: its light's colour, beside the neutral word (the shared semantic tone contract). */
    statusState?: StatusState;
    /** How long it has waited, such as "2d ago", after its status. */
    age?: ReactNode;
    /** Beside the status: the next step, such as a DeskHint. */
    next?: ReactNode;
    /** The row's actions, at its end: `sm` buttons, the next step tinted. */
    actions: ReactNode;
}

/**
 * An item on your desk as a card: its kind, source and project on top, its title on up to two lines and what it belongs
 * to, then any next step and details, and at its foot its lane and what it waits for, in amber, with its one action at
 * the end. A click anywhere on it but its controls opens the item dialog; its title is the button that does, for the
 * keyboard. The card whose dialog shows takes the current ring; one that lands on the desk after the board has shown
 * slides in and flashes (BoardLife).
 */
export function DeskCard({
    item,
    picked,
    onOpen,
    source,
    kind,
    stage,
    track,
    step,
    question,
    title,
    name,
    parentName,
    members,
    details,
    status,
    age,
    next,
    actions,
}: DeskCardProps) {
    const arrived = useArrival('desk', item);

    return (
        <li data-item={item} data-arrived={arrived ? 'above' : undefined} data-attention className="desk-row">
            <BoardCard
                tone="waiting"
                picked={picked}
                onOpen={onOpen}
                tooltip={name}
                head={
                    <>
                        {kind}
                        {source}
                    </>
                }
                track={track}
                name={title}
                sub={
                    <>
                        {question && (
                            <span className="text-fg-soft line-clamp-2" title={question} data-question>
                                {question}
                            </span>
                        )}
                        {parentName && (
                            <span className="truncate" title={parentName} data-part-of>
                                in {parentName}
                            </span>
                        )}
                        {next}
                        {!!members?.length && <p className="m-0 wrap-anywhere">Briefs: {members.join(' · ')}</p>}
                        {details}
                    </>
                }
                // Every card says in amber what it waits for, in the board's one word for it, and how long. The track
                // says the lane and step.
                state={
                    <span title={step ?? stage} data-state>
                        {status}
                        {age && <span className="text-fg-muted font-normal"> · {age}</span>}
                    </span>
                }
                action={actions}
            />
        </li>
    );
}

/** A desk card's next step as a hint, such as what its status waits for. */
export function DeskHint({
    children,
}: {
    /** The hint, such as what the status waits for. */
    children?: string | undefined;
}) {
    return (
        <span className="truncate" title={children}>
            {children}
        </span>
    );
}

/** Revision check progress stays visible alongside questions and readiness blockers. */
export function DeskPrProgress({
    label,
    summary,
    note,
    wide,
}: {
    label: string;
    summary: string;
    note?: string;
    wide?: string;
}) {
    return (
        <div
            className="text-fg-muted grid gap-1 text-xs tabular-nums"
            role="status"
            aria-label={`${label} check progress`}
        >
            <span className="text-fg font-medium">{label}</span>
            <span>{summary}</span>
            {wide && <span>PR-wide statuses: {wide}</span>}
            {note && <span>{note}</span>}
        </div>
    );
}

/** Your desk's Show more: muted text that brightens on hover, its text ending on the rows' right edge. */
function DeskShowMore({ onClick, children }: { onClick: () => void; children: ReactNode }) {
    return (
        <button
            type="button"
            onClick={onClick}
            className="text-fg-muted hover:text-fg focus-ring rounded-xs text-xs transition-colors"
        >
            {children}
        </button>
    );
}
