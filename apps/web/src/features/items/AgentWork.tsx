import type { Item, ItemStats } from '@lar-factory/shared';
// An item's agent work: its usage figures as one muted line, or the line that says why there are none.
import { duration, formatTokens, formatUsd, shapingOwner } from '@lar-factory/shared';
import { Text } from '@lar-works/design-system';

import { useItemState } from './ItemState';
import { hasFigures, usageUnreadable } from './UsageFigures';
import { useLastKnown } from './useLastKnown';
import { useBoardStore } from '@/services/board/board.hooks';

/** Why a total isn't the whole sum. */
export const INCOMPLETE_TOTAL = 'Some agent usage is not available yet.';

/**
 * Agent time, tokens and cost, in the board's order, as one small muted line after any `label`, with the wall time while
 * the work runs (a still item's "elapsed" would read as a clock still going); each named in the tooltip; nothing
 * when no thread worked on the item or T3's database can't be read. While T3 can't be read, the board keeps the figures
 * it last saw, and the line says so. `stats` shows other figures than the item's own; `only` shows it only in a narrow
 * or a wide container.
 */
export function AgentWork({
    item,
    stats: s = item.stats,
    label,
    only,
    inline = false,
}: {
    item: Item;
    stats?: ItemStats | 'unavailable';
    label?: string;
    only?: 'narrow' | 'wide';
    /** Inside a line of text or a button, where a paragraph can't go. */
    inline?: boolean;
}) {
    const lastKnown = useLastKnown(item);
    const { running } = useItemState(item);

    if (!s || s === 'unavailable' || !hasFigures(s)) return null;

    const old = !s.frozen ? lastKnown : null;
    const figures: [label: string, value: string, unit: string][] = [];

    figures.push(['Agent time', duration(s.agentMs), ''], ['Tokens', formatTokens(s.tokens), ' tokens']);

    if (s.costUsd !== undefined) figures.push(['Cost', formatUsd(s.costUsd), '']);

    if (s.wallMs) figures.push(['Wall time', duration(s.wallMs), ' elapsed']);

    const shown = figures.filter(([name]) => name !== 'Wall time' || running);

    return (
        <Text
            as={inline ? 'span' : 'p'}
            variant="caption"
            tone="muted"
            data-agent-work
            data-only={only}
            data-last-known={old ? '' : undefined}
            title={[figures.map(([k, v]) => `${k} ${v}`).join(' · '), old, s.incomplete && INCOMPLETE_TOTAL]
                .filter(Boolean)
                .join('. ')}
            numeric
            only={only}
        >
            {label && `${label}: `}
            {shown.map(([name, v, unit]) => (name === 'Agent time' ? `Agent time ${v}` : v + unit)).join(' · ')}
            {old && ' · last known'}
            {s.incomplete && ' · incomplete'}
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
                : item.kind === 'concept'
                  ? 'No direct agent work yet'
                  : owner
                    ? `Shaped in ${owner.kind} thread`
                    : 'No agent work yet';

    return (
        <Text variant="caption" tone="muted" data-agent-work-note>
            {s === 'unavailable'
                ? 'Agent work unavailable.'
                : item.usageState === 'loading'
                  ? 'Loading agent work…'
                  : none}
        </Text>
    );
}
