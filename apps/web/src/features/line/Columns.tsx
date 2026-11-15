// What the stage rows, dock rows and concept parts share: the agent figures at a row's end.

import type { Item, ItemStats } from '@lar-factory/shared';
import { duration, formatTokens, formatUsd, itemMembers } from '@lar-factory/shared';

import { useActivityStill } from './useActivityState';
import { hasFigures, INCOMPLETE_TOTAL, usageLoading, usageUnreadable, useLastKnown } from '@/features/items';
import { useBoardStore } from '@/services/board/board.hooks';
import { UsageFigures } from '@/ui/board';

/** The agent figures, from the same fields AgentCell reads: the cost on the row (every figure when `full`), with time · tokens · cost in its tooltip; nothing when there are none. An incomplete total ends in a +, and its tooltip says why, as it does when they are the last ones seen. While usage loads, known figures stay with a spinner in the tokens' room, the tooltip giving them all, and none known yet give a spinner and its label, which keeps naming the usage read while it loads. Usage T3 couldn't read, with no figures known, says it's unavailable rather than nothing. A `total` loads while any of its members does. A row that stops animating stops its spinner. */
export function Figures({
    s,
    item,
    total,
    full = false,
}: {
    s: ItemStats | null;
    item: Item;
    total?: boolean;
    /** Every figure on the line, "2h 29m · 64.8M tokens · $29.12", where there is room for them, as a concept
     *  dialog's part has. */
    full?: boolean;
}) {
    const lastKnown = useLastKnown(item);
    const data = useBoardStore((state) => state.data);
    const still = useActivityStill(item);
    const loading =
        usageLoading(item, data) ||
        (!!total && itemMembers(item, data.items).some((member) => usageLoading(member, data)));
    const none = !s || (!hasFigures(s) && (loading || !s.incomplete));

    if (none) {
        // Only the spinner, in the cost's room, with its words in the tooltip: a cost-width slot never holds cut words.
        if (loading) return <UsageFigures title={LOADING} updating={LOADING} still={still} />;

        return usageUnreadable(item) ? <UsageFigures title={UNAVAILABLE} text={UNAVAILABLE} /> : <span />;
    }

    const cost = s.costUsd !== undefined ? formatUsd(s.costUsd) : null;
    const all = hasFigures(s) ? [duration(s.agentMs), formatTokens(s.tokens), cost].filter(Boolean).join(' · ') : null;
    // The row says the cost, the figure that matters at a glance; time and tokens are in its tooltip. With no cost, time.
    const text =
        all &&
        (full
            ? [duration(s.agentMs), `${formatTokens(s.tokens)} tokens`, cost].filter(Boolean).join(' · ')
            : (cost ?? duration(s.agentMs)));
    const title = s.frozen
        ? `Agent time · tokens · cost, as it stood at merge: ${all}`
        : [
              all && `Agent time · tokens · cost: ${all}`,
              all && lastKnown,
              s.incomplete && INCOMPLETE_TOTAL,
              loading && UPDATING,
          ]
              .filter(Boolean)
              .join('. ');

    return (
        <UsageFigures
            title={title}
            text={text}
            updating={loading ? UPDATING : undefined}
            still={still}
            partial={s.incomplete ? 'partial' : undefined}
            incomplete={s.incomplete ? 'Usage incomplete' : undefined}
        />
    );
}

const LOADING = 'Loading usage';
/** In the figures' own words, as Loading usage and Usage incomplete. */
const UNAVAILABLE = 'Usage unavailable';
const UPDATING = 'Updating usage';
