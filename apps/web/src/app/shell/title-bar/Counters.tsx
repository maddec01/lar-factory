import { boardSections, formatUsd, plural, readingScope, usageFailed, usageIncomplete } from '@lar-factory/shared';
import type { Item, Status } from '@lar-factory/shared';
import { EmptyState, Loading } from '@lar-works/design-system';
import { CircleDollarSign } from '@lar-works/design-system/icons';
import { useState } from 'react';

import { List } from './CounterParts';
import { spendFace, spendScope } from './SpendFace';
import { StatusGlyph, useBuilds } from '@/features/items';
import { useBoardStore } from '@/services/board/board.hooks';
import { BoardCounter as Counter, CounterDash, QuietGlyph, CounterFigure } from '@/ui/board';

const costOf = (item: Item) => (item.stats && item.stats !== 'unavailable' ? (item.stats.costUsd ?? 0) : 0);

export function Counters() {
    const { data, now, clientError } = useBoardStore();
    const s = boardSections(data, now, clientError);
    const builds = useBuilds();
    const { items: building, limit, waiting } = builds;
    // Builds waiting on an open PR hold no slot: the counter names them beside the limit, never in its count.
    const waitingNote = waiting.length ? `${waiting.length} waiting on their PR` : undefined;
    const costs = data.items
        .map((item) => ({ item, cost: costOf(item) }))
        .filter((x) => x.cost > 0)
        .sort((a, b) => b.cost - a.cost);
    const unavailable =
        !!data.itemSourceProblems?.length ||
        !!data.error ||
        !!data.localProblem ||
        data.usageRead?.readable === false ||
        data.items.some(usageFailed);
    const usageStillLoading = !unavailable && (!data.firstRead.settled || data.items.some(usageIncomplete));
    const reading = readingScope(data);
    const total = costs.reduce((t, c) => t + c.cost, 0);
    const [settled, setSettled] = useState<number | null>(null);

    if (!unavailable && !usageStillLoading && settled !== total) setSettled(total);

    const spend = spendFace({ total, known: costs.length > 0, unavailable, loading: usageStillLoading, settled });
    const glyph = (status: Status) => (
        <StatusGlyph status={status} running={status === 'In progress' && builds.running > 0} />
    );
    const unknown = (n: number) => reading && !n;
    const countOf = (n: number) => (unknown(n) ? <CounterDash /> : n);
    const hintFor = (n: number, hint: string) => (unknown(n) ? 'Still loading projects' : hint);
    const countFor = (n: number) => (unknown(n) ? undefined : n);
    const empty = (none: string) =>
        reading ? (
            <Loading presentation="status" label="Loading projects…" />
        ) : (
            <EmptyState size="inline" title={none} />
        );
    const listOf = (items: Item[], none: string) => (items.length ? <List items={items} /> : empty(none));

    const spendShown = costs.length > 0 && !(usageStillLoading && !unavailable && settled === null);

    if (reading) return null;

    return (
        <>
            {s.shaping.length > 0 && (
                <Counter
                    label="shaping"
                    value={<>{countOf(s.shaping.length)}</>}
                    icon={<QuietGlyph>{glyph('Shaping')}</QuietGlyph>}
                    fold="medium"
                    title="Shaping"
                    count={countFor(s.shaping.length)}
                    hint={hintFor(
                        s.shaping.length,
                        s.shaping.length
                            ? `${plural(s.shaping.length, 'item')} being shaped`
                            : 'Nothing shaping right now',
                    )}
                >
                    {listOf(s.shaping, 'Nothing shaping right now.')}
                </Counter>
            )}

            {(building.length > 0 || waiting.length > 0) && (
                <Counter
                    label="building"
                    icon={<QuietGlyph>{glyph('In progress')}</QuietGlyph>}
                    title="Building"
                    count={countFor(building.length)}
                    value={<>{countOf(building.length)}</>}
                    hint={hintFor(building.length, builds.text)}
                    detail={
                        [limit === undefined ? undefined : `Shared limit ${limit}`, waitingNote]
                            .filter(Boolean)
                            .join(' · ') || undefined
                    }
                    foot={
                        reading
                            ? undefined
                            : "A build with an open PR doesn't count toward this limit. At capacity, Build waits for a slot; its chevron offers Start now (over the limit)."
                    }
                >
                    {listOf(building, 'Nothing building right now.')}
                </Counter>
            )}

            {s.done.length > 0 && (
                <Counter
                    label="shipped"
                    value={<>{countOf(s.done.length)}</>}
                    icon={<QuietGlyph>{glyph('Done')}</QuietGlyph>}
                    fold="medium"
                    title="Shipped"
                    count={countFor(s.done.length)}
                    detail="Last 7 days"
                    hint={hintFor(s.done.length, 'Done in the last 7 days')}
                    foot={s.done.length ? 'Newest first. Work leaves this list 7 days after it’s done.' : undefined}
                >
                    {listOf(s.done, 'Nothing shipped this week.')}
                </Counter>
            )}

            {spendShown && (
                <Counter
                    label="spend"
                    value={spend.value}
                    fold="wide"
                    title="Agent spend"
                    count={costs.length ? plural(costs.length, 'item') : undefined}
                    detail={costs.length ? `${spend.sub} · ${spendScope(data.retention?.hideAfterDays)}` : spend.sub}
                    icon={
                        <QuietGlyph>
                            <CircleDollarSign strokeWidth={2.25} />
                        </QuietGlyph>
                    }
                    hint={spend.hint ?? 'Agent cost on open and recent items, an API estimate'}
                    foot={spend.notice ?? (costs.length ? 'An estimate at API prices.' : undefined)}
                >
                    {costs.length ? (
                        <List
                            items={costs.map((c) => c.item)}
                            trailing={(i) => <CounterFigure>{formatUsd(costOf(i))}</CounterFigure>}
                        />
                    ) : usageStillLoading && !unavailable ? (
                        <Loading presentation="status" label="Loading usage…" />
                    ) : (
                        <EmptyState
                            size="inline"
                            title={
                                unavailable
                                    ? 'Usage is unavailable, so nothing is priced.'
                                    : 'No priced agent work yet.'
                            }
                        />
                    )}
                </Counter>
            )}
        </>
    );
}
