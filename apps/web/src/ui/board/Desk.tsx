import { Button, EmptyState, SectionTitle } from '@lar-works/design-system';
import type { StatusState } from '@lar-works/design-system';
import { type ReactNode, useState } from 'react';

import { useArrival } from './BoardLife';
import { buttonKind } from './ButtonKinds';
import { pickedRow } from './RowStyles';
import { RowFirst, RowOpen, RowSide, RowTitleCell } from './StageRow';

interface DeskSectionProps {
    /** The section's heading, such as "Your desk". */
    title: string;
    /** How many rows show; with none, `empty` says why in one muted line. */
    count: number;
    /** The first read may still add rows; hide its provisional zero. */
    loading?: boolean;
    /** What the section says when nothing awaits you. */
    empty?: ReactNode;
    /** The rows, one DeskCard each. */
    children?: ReactNode;
}

/** "Your desk": the items awaiting your action, as a list of rounded rows on the stage rows' columns, under a section
 *  title as Section draws it, so every request shows at once without scrolling sideways. It is the board's one loud
 *  surface: its rows sit in one rounded panel, an even amber tint and the attention bar, with no outline, on the lanes'
 *  grid. Past five it shows its first five rows and
 *  Show all, so the board under it stays in reach. An empty desk is one muted line under its title. Its heading is
 *  `#desk-h`. */
export function DeskSection({ title, count, loading = false, empty, children }: DeskSectionProps) {
    const [all, setAll] = useState(false);

    return (
        <section className="desk @container grid shrink-0 gap-1" aria-labelledby="desk-h">
            <div className="flex min-h-10 items-center px-3 py-1">
                <SectionTitle id="desk-h" level="h2" title={title} count={count} countLoading={loading} />
            </div>
            {count ? (
                <>
                    <ol
                        aria-label={title}
                        className="attention-flat m-0 grid list-none gap-0.5 rounded-xl p-0"
                        data-collapsed={(!all && count > 5) || undefined}
                    >
                        {children}
                    </ol>
                    {!all && count > 5 && (
                        <span className="desk-show-all px-3 pt-1">
                            <Button {...buttonKind('other')} onClick={() => setAll(true)}>
                                Show all {count}
                            </Button>
                        </span>
                    )}
                </>
            ) : (
                <div className="px-3">
                    <EmptyState size="inline" title={empty} />
                </div>
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
    /** Where the item comes from: its source and project, a RowSource. */
    source: ReactNode;
    /** The item's kind, a quiet mark before its title. */
    kind?: ReactNode;
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
    /** Beside the status: the next step, such as a DeskHint. */
    next?: ReactNode;
    /** The row's actions, at its end: `sm` buttons, the next step tinted. */
    actions: ReactNode;
}

/**
 * An item on your desk as a rounded row on the stage rows' columns, in the desk's attention panel: its status light,
 * kind and title and what it belongs to, its project, then its lane and status, and its actions at the end. Under the
 * title, quiet, come the next step and any details. A click anywhere on it but its actions opens the item dialog. The row whose dialog shows takes the current wash; one that
 * lands on the desk after the board has shown slides in and flashes (BoardLife).
 */
export function DeskCard({
    item,
    picked,
    onOpen,
    source,
    kind,
    stage,
    title,
    name,
    parentName,
    members,
    details,
    statusIcon,
    status,
    statusState,
    next,
    actions,
}: DeskCardProps) {
    const arrived = useArrival('desk', item);

    return (
        <li
            data-item={item}
            data-arrived={arrived ? 'above' : undefined}
            data-attention
            className="desk-row @container"
        >
            <div className={`hover:bg-fill-hover rounded-lg py-1.5 transition-colors ${pickedRow(picked)}`}>
                <RowFirst>
                    <RowOpen onOpen={onOpen}>
                        {/* The amber bar marks the row; a glyph shows only where the row has no state light. */}
                        <span className="grid size-6 place-items-center" data-glyph>
                            {!statusState && statusIcon}
                        </span>
                        {source}
                        <RowTitleCell>
                            {kind}
                            <span className="text-fg min-w-0 truncate text-sm leading-7" title={name} data-title>
                                {title}
                            </span>
                            {parentName && (
                                <span className="text-fg-muted min-w-0 shrink truncate text-xs" data-part-of>
                                    in {parentName}
                                </span>
                            )}
                        </RowTitleCell>
                        <span data-col="state" className="flex min-w-0 items-center gap-x-2 leading-4">
                            {stage && <span className="min-w-0 truncate">{status ? `${stage} ·` : stage}</span>}
                            <span className="text-warning-fg shrink-0 font-medium" data-state>
                                {status}
                            </span>
                        </span>
                    </RowOpen>
                    <RowSide>{actions}</RowSide>
                </RowFirst>
                <div className="desk-more text-fg-muted grid gap-1 text-xs empty:hidden" data-desk-more>
                    {next}
                    {!!members?.length && <p className="m-0 wrap-anywhere">Briefs: {members.join(' · ')}</p>}
                    {details}
                </div>
            </div>
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
