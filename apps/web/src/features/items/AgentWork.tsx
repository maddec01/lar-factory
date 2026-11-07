// An item's agent work: its usage figures as one muted line, or the line that says why there are none.

import { UNREADABLE, clock, day, duration, formatTokens, formatUsd } from '@lar-factory/shared';
import type { BoardData, Item, ItemStats } from '@lar-factory/shared';
import { Text } from '@lar-works/design-system';

import { isDone } from '@/features/line';
import { useBoardStore } from '@/services/board/board.hooks';

/**
 * While usage can't be read for this item, or for any, the sentence that says shown figures are the ones last seen; otherwise
 * null. The whole board's last read says when only while it fails, as a read that works says nothing of a failing family.
 */
export function useLastKnown(item: Item): string | null {
    const read = useBoardStore((state) => state.data.usageRead);
    const unreadable = read?.readable === false;

    if (!unreadable && item.usageState !== 'failed') return null;

    const at =
        unreadable && read.readAt ? ` from ${day(read.readAt, undefined)}, ${clock(read.readAt, undefined)}` : '';

    return `Last known figures${at}: T3 Code's usage can't be read now.`;
}

/** Why a total isn't the whole sum. */
export const INCOMPLETE_TOTAL = "This total is incomplete: usage for part of it is still loading or can't be read.";

/** Whether figures say anything: all-zero ones say no more than having none. */
export const hasFigures = (s: ItemStats) => Boolean(s.agentMs || s.wallMs || s.tokens || s.costUsd);

/**
 * Cost, agent time, tokens and wall time as one small muted line after any `label`, each named in the tooltip; nothing
 * when no thread worked on the item or T3's database can't be read. While T3 can't be read, the board keeps the figures
 * it last saw, and the line says so. `stats` shows other figures than the item's own; `only` shows it only in a narrow
 * or a wide container.
 */
export function AgentWork({
    item,
    stats: s = item.stats,
    label,
    only,
}: {
    item: Item;
    stats?: ItemStats | 'unavailable';
    label?: string;
    only?: 'narrow' | 'wide';
}) {
    const lastKnown = useLastKnown(item);

    if (!s || s === 'unavailable' || !hasFigures(s)) return null;

    const old = !s.frozen ? lastKnown : null;
    const figures: [label: string, value: string, unit: string][] = [];

    if (s.costUsd !== undefined) figures.push(['Cost', formatUsd(s.costUsd), '']);

    figures.push(['Agent time', duration(s.agentMs), ''], ['Tokens', formatTokens(s.tokens), ' tokens']);

    if (s.wallMs) figures.push(['Wall time', duration(s.wallMs), ' wall']);

    return (
        <Text
            variant="caption"
            tone="muted"
            data-agent-work
            data-last-known={old ? '' : undefined}
            title={[figures.map(([k, v]) => `${k} ${v}`).join(' · '), old, s.incomplete && INCOMPLETE_TOTAL]
                .filter(Boolean)
                .join('. ')}
            numeric
            only={only}
        >
            {label && `${label}: `}
            {figures.map(([, v, unit]) => v + unit).join(' · ')}
            {old && ' · last known'}
            {s.incomplete && ' · incomplete'}
        </Text>
    );
}

/**
 * Whether the item's figures are still to come: its usage is loading, a read can still replace its provisional figures, or
 * no stats read has reached its threads yet. Figures frozen at merge are final, and a settled read with nothing, or no thread,
 * is known empty. Figures stay provisional while a never-observed thread keeps failing, which no coming read answers.
 */
export const usageLoading = (
    { stats, usageState, threads }: Item,
    { firstRead, items }: Pick<BoardData, 'firstRead' | 'items'>,
): boolean => {
    if (typeof stats === 'object' && stats.frozen) return false;

    if (usageState === 'loading') return true;

    if (typeof stats === 'object' && stats.provisional)
        return !firstRead.settled || items.some((other) => other.usageState === 'loading');

    return !usageState && stats === undefined && Array.isArray(threads) && threads.length > 0;
};

/** Whether T3's usage can't be read for this item: an item known to have no thread has none to lose. */
export const usageUnreadable = (item: Item): boolean =>
    (item.stats === 'unavailable' || (item.usageState === 'failed' && !(item.stats && hasFigures(item.stats)))) &&
    !(Array.isArray(item.threads) && !item.threads.length);

/** The line that says why there are no agent work figures: no T3 thread worked on the item, or T3's database can't be read. */
export function AgentWorkNote({ item }: { item: Item }) {
    // Usage loads only for recorded threads, which T3 may not have answered for yet.
    const hasThread = item.usageState === 'loading' || (Array.isArray(item.threads) && item.threads.length > 0);
    const s = usageUnreadable(item) ? 'unavailable' : hasThread ? item.stats : undefined;

    // Known figures answer for an item still loading; none, or all zeros, say no more than having none.
    if (s && s !== 'unavailable' && (item.usageState !== 'loading' || hasFigures(s))) return null;

    // A settled decision may have no thread of its own, which is nothing to wait for.
    if (!s && !hasThread && item.kind === 'decision' && isDone(item)) return null;

    const none = item.kind === 'concept' ? 'No T3 thread of its own.' : 'No T3 thread has worked on this yet.';

    return (
        <Text variant="caption" tone="muted">
            {s === 'unavailable' ? UNREADABLE : hasThread ? 'Usage totals are still loading.' : none}
        </Text>
    );
}
