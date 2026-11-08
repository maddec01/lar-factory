import { ScrollRowArrows, SectionTitle, StatusIndicator, useScrollRow } from '@lar-works/design-system';
import type { StatusState } from '@lar-works/design-system';
import { useScrollFade } from '@lar-works/design-system/primitives';
import { type ReactNode, useCallback } from 'react';

interface DeskSectionProps {
    /** The section's heading, such as "Your desk". */
    title: string;
    /** How many cards show; with none, `empty` says why in one small line. */
    count: number;
    /** The first read may still add cards; hide its provisional zero. */
    loading?: boolean;
    /** What the section says when nothing awaits you. */
    empty?: ReactNode;
    /** The cards, one DeskCard each. */
    children?: ReactNode;
    /** The arrows that scroll the row when its cards overflow. */
    backLabel?: string;
    /** The fade's scroll button's accessible name, when the cards overflow. */
    forwardLabel?: string;
}

/** "Your desk": the items awaiting your action as small cards in one row that scrolls sideways under the page's padding
 *  to the window's edges. When they overflow, the row fades out at the edges with more beyond them and arrows beside
 *  the title scroll it. An empty desk is one small line. */
export function DeskSection({
    title,
    count,
    loading = false,
    empty,
    children,
    backLabel = 'Previous cards',
    forwardLabel = 'Next cards',
}: DeskSectionProps) {
    const { setRow, scroll, canScrollBack, canScrollForward } = useScrollRow<HTMLDivElement>(count);
    const { setViewport, className: fade } = useScrollFade({ axis: 'horizontal', row: true });
    const setFadingRow = useCallback(
        (element: HTMLDivElement | null) => {
            setRow(element);
            setViewport(element);
        },
        [setRow, setViewport],
    );

    if (!count)
        return (
            <section className="desk text-fg-muted flex shrink-0 items-baseline gap-2 text-xs" aria-labelledby="desk-h">
                <SectionTitle id="desk-h" title={title} count={count} countLoading={loading} />
                <p className="m-0">{empty}</p>
            </section>
        );

    return (
        <section className="desk grid shrink-0 gap-2" aria-labelledby="desk-h">
            <div className="flex h-7 items-center gap-2">
                <SectionTitle id="desk-h" title={title} count={count} countLoading={loading} />
                {canScrollBack || canScrollForward ? (
                    <div className="ml-auto">
                        <ScrollRowArrows
                            size="sm"
                            onScroll={scroll}
                            canScrollBack={canScrollBack}
                            canScrollForward={canScrollForward}
                            backLabel={backLabel}
                            forwardLabel={forwardLabel}
                        />
                    </div>
                ) : null}
            </div>
            <div
                ref={setFadingRow}
                className={`-mx-6 flex snap-x scroll-px-6 [scrollbar-width:none] items-start gap-3 overflow-x-auto px-6 py-1 [--scroll-fade-row:4.5rem] [&::-webkit-scrollbar]:hidden [&>*]:snap-start ${fade}`}
            >
                {children}
            </div>
        </section>
    );
}

interface DeskCardProps {
    /** The item's id, as `data-item`. */
    item: string;
    /** Whether the item dialog shows this item now. */
    picked: boolean;
    /** Called as the reader opens the item dialog. */
    onOpen: () => void;
    /** The first row: where the item comes from, its kind and its age. */
    source: ReactNode;
    /** The item's kind, a badge. */
    kind: ReactNode;
    /** How long the item has waited. */
    age: ReactNode;
    /** The item's title. */
    title: ReactNode;
    /** The title's full text, for its tooltip. */
    name: string;
    /** More about the item under its title, such as a work item's fields. */
    details?: ReactNode;
    /** The status's glyph, only where there is no `statusState` (whose dot is drawn instead). */
    statusIcon: ReactNode;
    /** The next step, in words. */
    status: string;
    /** The status's state: its dot's colour, beside the neutral word (the shared semantic tone contract). */
    statusState?: StatusState;
    /** Beside the status: the next step, such as a DeskHint. */
    next?: ReactNode;
    /** The card's actions, in its right corner, the board's button kinds drawn 32px tall there. A click beside them
     *  opens the item, as anywhere else on the card. */
    actions: ReactNode;
}

/**
 * An item on your desk, opening the item dialog. Every card has the same four rows at the same heights, so they line
 * up across cards: source, kind and age; the title; the status and next step; and the card's actions. Its summary is a
 * button too, so the keyboard can open it. The card itself stays neutral, and so does its status word: the status's
 * dot (StatusIndicator) carries the colour, as on every row in every app.
 */
export function DeskCard({
    item,
    picked,
    onOpen,
    source,
    kind,
    age,
    title,
    name,
    details,
    statusIcon,
    status,
    statusState,
    next,
    actions,
}: DeskCardProps) {
    return (
        <div
            onClick={onOpen}
            data-item={item}
            className={`desk-card surface-card hover:bg-fill-hover relative grid w-88 shrink-0 cursor-pointer content-start gap-2 rounded-xl border px-3.5 py-3 ${picked ? 'ring-primary ring-offset-surface-page ring-2 ring-offset-1' : ''}`}
        >
            <button type="button" className="focus-ring-inset grid min-w-0 gap-2 rounded-xs text-left">
                <span className="desk-meta text-2xs flex h-6 min-w-0 items-center gap-2">
                    {source}
                    {kind}
                    <span className="text-fg-muted ml-auto shrink-0">{age}</span>
                </span>
                <span className="desk-title text-ui/5 h-5 truncate font-medium" title={name}>
                    {title}
                </span>
                {details}
            </button>
            <span className="flex min-w-0 items-center gap-2">
                <span className="text-2xs flex shrink-0 items-center gap-1.5 [&_svg]:size-3">
                    {statusState ? (
                        <StatusIndicator state={statusState} label={status} size="sm" />
                    ) : (
                        <>
                            {statusIcon}
                            <span className="text-fg font-medium">{status}</span>
                        </>
                    )}
                </span>
                <span className="desk-next text-2xs text-fg-muted flex h-5 min-w-0 flex-1 items-center gap-1.5 tabular-nums">
                    {next}
                </span>
            </span>
            <div
                className="desk-actions flex h-8 shrink-0 items-center justify-end gap-1.5 [&_[data-kind]:not([data-toggle])]:h-8 [&_[data-kind][data-icon-only]]:w-8!"
                // The actions keep their clicks from the card; a click on the row's own empty space still opens it.
                onClick={(event) => {
                    if (event.target !== event.currentTarget) event.stopPropagation();
                }}
            >
                {actions}
            </div>
        </div>
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
