// What the stage rows, dock rows and concept parts share: their second line, on the design system's RowSecondLine, and
// the agent figures on it.

import type { Item, ItemStats, LinkedPr } from '@lar-factory/shared';
import { duration, formatTokens, formatUsd, itemMembers, prLabel } from '@lar-factory/shared';
import { Loading } from '@lar-works/design-system';
import type { MouseEvent, ReactNode } from 'react';

import { useActivityStill } from './useActivityState';
import { hasFigures, INCOMPLETE_TOTAL, usageLoading, usageUnreadable, useLastKnown } from '@/features/items';
import { useBoardStore } from '@/services/board/board.hooks';
import { PullRequestRef, RowSecondLine as DesignRowSecondLine, UsageFigures } from '@/ui/board';

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
        <DesignRowSecondLine
            onClick={onClick}
            bar={bar}
            count={count}
            prs={prs.map((pr) => (
                <PullRequestRef key={pr.number} label={prLabel(pr)} title={prLabel(pr)} />
            ))}
            figures={figures}
        >
            {children}
        </DesignRowSecondLine>
    );
}

/** The agent figures on one line, time · tokens · cost, from the same fields AgentCell reads; nothing when there are none. An incomplete total ends in a +, and its tooltip says why, as it does when they are the last ones seen. While usage loads, known figures stay with a spinner in the tokens' room, the tooltip giving them all, and none known yet give a spinner and its label, which keeps naming the usage read while it loads. Usage T3 couldn't read, with no figures known, says it's unavailable rather than nothing. A `total` loads while any of its members does. A row that stops animating stops its spinner. */
export function Figures({ s, item, total }: { s: ItemStats | null; item: Item; total?: boolean }) {
    const lastKnown = useLastKnown(item);
    const data = useBoardStore((state) => state.data);
    const still = useActivityStill(item);
    const loading =
        usageLoading(item, data) ||
        (!!total && itemMembers(item, data.items).some((member) => usageLoading(member, data)));
    const none = !s || (!hasFigures(s) && (loading || !s.incomplete));

    if (none) {
        if (loading) return <Loading presentation="inline" label={LOADING} title={LOADING} still={still} />;

        return usageUnreadable(item) ? <UsageFigures title={UNAVAILABLE} text={UNAVAILABLE} /> : <span />;
    }

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
