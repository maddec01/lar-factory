import type { Item, ItemStats } from '@lar-factory/shared';
// An item's agent work: its usage figures as one muted line, or the line that says why there are none.
import { duration, formatTokens, formatUsd, shapingOwner } from '@lar-factory/shared';
import { Loading, Text } from '@lar-works/design-system';

import { useItemState } from './ItemState';
import { hasFigures, usageUnreadable } from './UsageFigures';
import { useLastKnown } from './useLastKnown';
import { useBoardStore } from '@/services/board/board.hooks';
import { FigureRows } from '@/ui/board';

/** Why a total isn't the whole sum. */
export const INCOMPLETE_TOTAL = 'Some agent usage is not available yet.';

/**
 * Agent time, tokens and cost: as one short muted figure after any `label`, the cost (or the agent time with no cost),
 * with every figure named in its tooltip; or as `rows`, one per figure under `label` as their heading, with the wall
 * time while the work runs (a still item's "elapsed" would read as a clock still going). Nothing when no thread worked
 * on the item or T3's database can't be read. While T3 can't be read, the board keeps the figures it last saw, and the tooltip says so. `stats` shows other
 * figures than the item's own; `only` shows it only in a narrow or a wide container.
 */
export function AgentWork({
    item,
    stats: s = item.stats,
    label,
    only,
    inline = false,
    rows = false,
}: {
    item: Item;
    stats?: ItemStats | 'unavailable';
    label?: string;
    only?: 'narrow' | 'wide';
    /** Inside a line of text or a button, where a paragraph can't go. */
    inline?: boolean;
    /** One labelled row per figure, as the dialog's sidebar lists properties. */
    rows?: boolean;
}) {
    const lastKnown = useLastKnown(item);
    const { running } = useItemState(item);

    if (!s || s === 'unavailable' || !hasFigures(s)) return null;

    const old = !s.frozen ? lastKnown : null;
    const figures: [label: string, value: string][] = [];

    figures.push(['Agent time', duration(s.agentMs)], ['Tokens', formatTokens(s.tokens)]);

    if (s.costUsd !== undefined) figures.push(['Cost', formatUsd(s.costUsd)]);

    if (s.wallMs) figures.push(['Wall time', duration(s.wallMs)]);

    const shown = figures.filter(([name]) => name !== 'Wall time' || running);

    const title = [figures.map(([k, v]) => `${k} ${v}`).join(' · '), old, s.incomplete && INCOMPLETE_TOTAL]
        .filter(Boolean)
        .join('. ');

    if (rows)
        return (
            <FigureRows
                title={title}
                rows={shown.map(([name, v]) => ({
                    label: name === 'Wall time' ? 'Since start' : name,
                    value: `${v}${name === 'Cost' && s.incomplete ? '+' : ''}`,
                }))}
                heading={label}
                note={[old && 'Last known', s.incomplete && 'Incomplete'].filter(Boolean).join(' · ') || undefined}
            />
        );

    // One short figure, so a fact's value never wraps: the cost, or the agent time when it has none; the rest is in the
    // tooltip.
    const cost = shown.find(([name]) => name === 'Cost');

    return (
        <Text
            as={inline ? 'span' : 'p'}
            variant="caption"
            tone="muted"
            data-agent-work
            data-only={only}
            data-last-known={old ? '' : undefined}
            title={title}
            numeric
            only={only}
        >
            {label && `${label}: `}
            {cost ? `${cost[1]}${s.incomplete ? '+' : ''}` : `Agent time ${duration(s.agentMs)}`}
        </Text>
    );
}

/** The header’s muted work state when there are no figures, including loading and unreadable usage. */
export function AgentWorkNote({ item }: { item: Item }) {
    const owner = shapingOwner(
        item,
        useBoardStore((state) => state.data.items),
    );

    if (item.conceptBuild?.run)
        return (
            <Text variant="caption" tone="muted" data-agent-work-note>
                {item.conceptBuild.run.state === 'running'
                    ? 'Concept builds running'
                    : 'Concept builds paused · active builds continue'}
            </Text>
        );

    // Usage loads only for recorded threads, which T3 may not have answered for yet.
    const hasThread = item.usageState === 'loading' || (Array.isArray(item.threads) && item.threads.length > 0);
    const s = usageUnreadable(item) ? 'unavailable' : hasThread ? item.stats : undefined;

    // Known figures answer for an item still loading; none, or all zeros, say no more than having none.
    if (s && s !== 'unavailable' && hasFigures(s)) return null;

    // Figures from threads no longer recorded still say work happened, which the header shows.
    if (!hasThread && item.stats && item.stats !== 'unavailable' && hasFigures(item.stats)) return null;

    const none =
        item.status === 'Verify' && item.linkedPrs.length
            ? 'Build ready for verification'
            : item.status === 'Ready to merge' && item.linkedPrs.length
              ? 'Build ready to merge'
              : item.verification?.latest?.result === 'fail'
                ? 'Fixing failed Verify'
                : owner
                  ? `Shaped in ${owner.kind} thread`
                  : undefined;

    // With no agent work there is nothing to say under the title, so the header stays one line.
    if (!none && s !== 'unavailable' && item.usageState !== 'loading') return null;

    return (
        <Text variant="caption" tone="muted" data-agent-work-note>
            {s === 'unavailable' ? (
                'Agent work unavailable.'
            ) : item.usageState === 'loading' ? (
                <Loading presentation="inline" label="Loading agent work…" />
            ) : (
                none
            )}
        </Text>
    );
}
