// What the stage rows, dock rows and concept parts share: their second line, the agent figures on it, and what holds a
// row's action. rows.css keeps the columns.

import { duration, formatTokens, formatUsd, itemMembers, itemTotal, prLabel } from '@lar-factory/shared';
import type { BoardData, Item, ItemStats, LinkedPr } from '@lar-factory/shared';
import { GitPullRequest } from '@lar-works/design-system/icons';
import type { MouseEvent, ReactNode } from 'react';

import { useActivityStill } from './ActivityLine';
import { statsOf } from './StageTrack';
import { useItemDialogStore } from '@/features/item-dialog/ItemDialogStore';
import { hasFigures, INCOMPLETE_TOTAL, useLastKnown, usageLoading } from '@/features/items/ItemParts';
import { useBoardStore } from '@/services/board/board.hooks';
import { Loader } from '@/shared/ui/loading/Loader';

/** What a row's action slot holds, centred and against its right edge. */
export const ROW_ACTION =
    'flex min-w-0 flex-wrap items-center justify-end gap-x-2 gap-y-1 text-right text-xs text-(--muted-foreground)';
/** The rule under a row, which takes no height, so every row of a type measures the same. */
export const ROW_RULE = 'shadow-[inset_0_-1px_var(--border)] last:shadow-none';

/** A click on a second line beside its controls opens the item, as its first line's button does; letting go of a drag that selected text doesn't. */
export const opensItem = (item: Item) => (e: MouseEvent<HTMLElement>) => {
    if ((e.target as Element).closest('button, a') || !window.getSelection()?.isCollapsed) return;

    useItemDialogStore.getState().open(item.id);
};

/** A row's second line: bar and count on the left, `children` in its text slot, then its pull requests and figures. */
export function RowSecondLine({
    bar,
    count,
    prs = [],
    figures,
    onClick,
    children,
}: {
    bar?: ReactNode;
    count?: ReactNode;
    prs?: LinkedPr[];
    figures?: ReactNode;
    onClick?: (e: MouseEvent<HTMLElement>) => void;
    children?: ReactNode;
}) {
    return (
        <div data-progress onClick={onClick} className={`row-second ${onClick ? 'cursor-pointer' : ''}`}>
            <span data-col="bar" className="min-w-0">
                {bar}
            </span>
            {count || <span data-col="count" />}
            <span data-col="next" className="flex min-w-0 items-center gap-3">
                {children}
            </span>
            <span data-col="pr" className="flex min-w-0 gap-2 overflow-hidden tabular-nums">
                {prs.map((pr) => (
                    <span key={pr.number} title={prLabel(pr)} className="inline-flex shrink-0 items-center gap-1">
                        <GitPullRequest className="size-3 shrink-0 text-(--st-done)" />
                        {prLabel(pr)}
                    </span>
                ))}
            </span>
            <span data-col="figures">{figures}</span>
        </div>
    );
}

/** The agent figures: a Dossier's total (parent plus parts), else the item's own; null when there are none. A total with no figures to show is empty and incomplete. */
export const figuresOf = (item: Item, data: BoardData, total?: boolean): ItemStats | null => {
    const sum = total ? itemTotal(item, data.items) : null;

    return sum === null ? statsOf(item) : sum === 'unavailable' ? { agentMs: 0, tokens: 0, incomplete: true } : sum;
};

/** The agent figures on one line, time · tokens · cost, from the same fields AgentCell reads; nothing when there are none. An incomplete total ends in a +, and its tooltip says why, as it does when they are the last ones seen. While usage loads, known figures stay with a spinner in the tokens' room, the tooltip giving them all, and none known yet give a spinner and its label. A `total` loads while any of its members does. A row that stops animating stops its spinner. */
export function Figures({ s, item, total }: { s: ItemStats | null; item: Item; total?: boolean }) {
    const lastKnown = useLastKnown(item);
    const data = useBoardStore((state) => state.data);
    const still = useActivityStill(item);
    const loading =
        usageLoading(item, data) ||
        (!!total && itemMembers(item, data.items).some((member) => usageLoading(member, data)));

    if (!s || (!hasFigures(s) && (loading || !s.incomplete)))
        return loading ? <Loader label="Loading usage" still={still} /> : <span />;

    const cost = s.costUsd !== undefined ? formatUsd(s.costUsd) : null;
    const all = hasFigures(s) ? [duration(s.agentMs), formatTokens(s.tokens), cost].filter(Boolean).join(' · ') : null;
    const text = all && loading ? [duration(s.agentMs), cost].filter(Boolean).join(' · ') : all;
    const title = s.frozen
        ? 'Agent time · tokens · cost, as it stood at merge'
        : [
              all && `Agent time · tokens · cost${loading ? `: ${all}` : ''}`,
              all && lastKnown,
              s.incomplete && INCOMPLETE_TOTAL,
              loading && UPDATING,
          ]
              .filter(Boolean)
              .join('. ');

    return (
        <span
            className="flex min-w-0 items-center justify-end gap-1 text-(--muted-foreground) tabular-nums"
            title={title}
        >
            {loading && <Loader title={UPDATING} still={still} />}
            {text && <span className="truncate">{text}</span>}
            {s.incomplete &&
                (text ? (
                    <span className="-ml-1 shrink-0" data-partial>
                        +<span className="sr-only"> partial</span>
                    </span>
                ) : (
                    <span className="shrink-0">Usage incomplete</span>
                ))}
        </span>
    );
}

const UPDATING = 'Updating usage';
