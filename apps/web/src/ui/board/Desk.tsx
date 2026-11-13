import {
    CardHeader,
    EmptyState,
    ScrollRow,
    ScrollRowArrows,
    SectionTitle,
    StatusIndicator,
    useScrollRow,
} from '@lar-works/design-system';
import type { StatusState } from '@lar-works/design-system';
import { CardBase } from '@lar-works/design-system/primitives';
import type { ReactNode } from 'react';

import { useArrival } from './BoardLife';

interface DeskSectionProps {
    /** The section's heading, such as "Your desk". */
    title: string;
    /** How many cards show; with none, `empty` says why in one muted line. */
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

/** "Your desk": the items awaiting your action as cards in one row (the design system's ScrollRow, under a section
 *  title as Section draws it) that scrolls sideways, fading at the edges with more beyond them, with arrows beside the
 *  title that scroll it. An empty desk is one muted line under its title. Its heading is `#desk-h`. */
export function DeskSection({
    title,
    count,
    loading = false,
    empty,
    children,
    backLabel = 'Previous cards',
    forwardLabel = 'Next cards',
}: DeskSectionProps) {
    const { setRow, scroll, canScrollBack, canScrollForward } = useScrollRow<HTMLUListElement>(count);

    return (
        <section className="desk grid shrink-0 gap-3" aria-labelledby="desk-h">
            <SectionTitle
                id="desk-h"
                level="h2"
                title={title}
                count={count}
                countLoading={loading}
                actions={
                    canScrollBack || canScrollForward ? (
                        <ScrollRowArrows
                            size="sm"
                            onScroll={scroll}
                            canScrollBack={canScrollBack}
                            canScrollForward={canScrollForward}
                            backLabel={backLabel}
                            forwardLabel={forwardLabel}
                        />
                    ) : undefined
                }
            />
            {count ? (
                <ScrollRow ref={setRow} label={title}>
                    {children}
                </ScrollRow>
            ) : (
                <EmptyState size="inline" title={empty} />
            )}
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
    /** The first row: where the item comes from. */
    source: ReactNode;
    /** The item's kind, a badge. */
    kind: ReactNode;
    /** How long the item has waited. */
    age: ReactNode;
    /** The item's title. */
    title: ReactNode;
    /** The title's full text, which names the card. */
    name: string;
    /** The concept or linked parent this work belongs to, supplied by the desk projection. */
    parentName?: string;
    /** More about the item under its title, such as a work item's fields. */
    details?: ReactNode;
    /** The status's glyph, only where there is no `statusState` (whose light is drawn instead). */
    statusIcon: ReactNode;
    /** The next step, in words. */
    status: string;
    /** The status's state: its light's colour, beside the neutral word (the shared semantic tone contract). */
    statusState?: StatusState;
    /** Beside the status: the next step, such as a DeskHint. */
    next?: ReactNode;
    /** The card's actions, at its foot's end: `sm` buttons, the next step tinted. */
    actions: ReactNode;
}

/**
 * An item on your desk, the design system's card in the attention recipe (an amber edge, a 3px amber bar down its
 * leading edge and a faint wash from it), opening the item dialog from anywhere on it but its actions. Every card has
 * the same rows, and every card in the row its tallest's height, so they line up across cards: source, kind and age;
 * the title, up to two lines; any tracker fields; then, at the card's foot, the status and next step and the card's
 * actions. The card whose dialog shows takes the current edge. A card that lands on the desk after the board has
 * shown pulses its edge once (BoardLife).
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
    parentName,
    details,
    statusIcon,
    status,
    statusState,
    next,
    actions,
}: DeskCardProps) {
    const arrived = useArrival('desk', item);

    return (
        <CardBase
            as="li"
            className="desk-card w-[min(22rem,calc(100vw-4.5rem))] shrink-0 snap-start"
            data-item={item}
            data-arrived={arrived ? '' : undefined}
            label={name}
            onOpen={onOpen}
            attention="warning"
            selected={picked}
            padding="sm"
            header={
                <CardHeader
                    eyebrow={
                        <span className="desk-meta contents">
                            {source}
                            {kind}
                            <span className="ml-auto shrink-0">{age}</span>
                        </span>
                    }
                    title={<span title={name}>{title}</span>}
                    titleLines={2}
                />
            }
            footer={
                <>
                    {statusState ? (
                        <StatusIndicator state={statusState} label={status} />
                    ) : (
                        <span className="text-fg inline-flex shrink-0 items-center gap-1.5 text-xs font-medium">
                            {statusIcon}
                            {status}
                        </span>
                    )}
                    <span className="desk-next text-fg-muted flex min-w-0 flex-1 items-center text-xs tabular-nums">
                        {next}
                    </span>
                </>
            }
            actions={<span className="desk-actions contents">{actions}</span>}
        >
            {parentName && <p className="text-fg-muted text-xs">Part of {parentName}</p>}
            {details}
        </CardBase>
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
