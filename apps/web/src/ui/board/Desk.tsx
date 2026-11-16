import { ScrollRowArrows, SectionTitle, StatusIndicator, useScrollRow } from '@lar-works/design-system';
import { useScrollFade } from '@lar-works/design-system/primitives';
import { type ReactNode, useCallback } from 'react';

import { useArrival } from './BoardLife';

interface DeskSectionProps {
    /** The section's heading, such as "Your desk". */
    title: string;
    /** How many rows show; with none, `empty` says why, in the row's place. */
    count: number;
    /** The first read may still add rows; hide its provisional zero. */
    loading?: boolean;
    /** What the section says when nothing awaits you, a HeaderEmpty. */
    empty?: ReactNode;
    /** The rows, one DeskCard each. */
    children?: ReactNode;
}

/** "Your desk": the items awaiting your action, as one row of same-size cards under a section title, the board's one
 *  loud surface: each card an even amber tint with a hairline of the same tone, so what waits on you is the first thing
 *  the eye finds. The row scrolls sideways, fading at an edge with more cards past it, with arrows in the header, and
 *  keeps its height whether it holds cards or not, so the lanes under it never jump. An empty desk says why in the
 *  row's place. Its heading is `#desk-h`. */
export function DeskSection({ title, count, loading = false, empty, children }: DeskSectionProps) {
    const { setViewport, className: fade } = useScrollFade({ axis: 'horizontal', row: true });
    const { setRow, scroll, canScrollBack, canScrollForward } = useScrollRow<HTMLOListElement>(count);
    const setList = useCallback(
        (element: HTMLOListElement | null) => {
            setViewport(element);
            setRow(element);
        },
        [setViewport, setRow],
    );

    return (
        <section className="desk grid shrink-0 scroll-mt-16 gap-3" aria-labelledby="desk-h">
            <div className="flex min-h-9 items-center justify-between gap-3 pr-3 pl-4">
                <SectionTitle
                    id="desk-h"
                    level="h2"
                    title={title}
                    icon={<StatusIndicator state={count ? 'waiting' : 'off'} />}
                    count={count}
                    countLoading={loading}
                />
                {(canScrollBack || canScrollForward) && (
                    <ScrollRowArrows
                        size="sm"
                        onScroll={scroll}
                        canScrollBack={canScrollBack}
                        canScrollForward={canScrollForward}
                        backLabel="Previous cards"
                        forwardLabel="Next cards"
                    />
                )}
            </div>
            {count > 0 ? (
                <ol ref={setList} aria-label={title} className={`desk-grid m-0 list-none ${fade}`}>
                    {children}
                </ol>
            ) : (
                <div className="desk-empty">{empty}</div>
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

/**
 * An item on your desk: its card (ItemCard, the board's one card) as an entry in the desk's row. One that lands on the
 * desk after the board has shown slides in and flashes (BoardLife).
 */
export function DeskCard({
    item,
    children,
}: {
    /** The item's id, as `data-item`. */
    item: string;
    /** The item's card. */
    children: ReactNode;
}) {
    const arrived = useArrival('desk', item);

    return (
        <li data-item={item} data-arrived={arrived ? 'above' : undefined} data-attention className="desk-row">
            {children}
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
