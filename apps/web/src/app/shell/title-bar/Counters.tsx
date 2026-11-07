// The title bar's five counters, in its status strip after the Refreshed time: need you, shaping, building, shipped and
// spend, in the board's order, as lar-server's summary buttons, always for the whole factory whatever repository or
// filters the board shows. Each shows only its glyph, in the status's own colour, and its number; its label is its
// accessible name and its tooltip says more. Each opens a popover, padded as a menu, of every item behind the number in
// a list that scrolls; picking one opens the item dialog. The row holds its width as values load; the title bar's width
// decides what shows: Spend goes first, then Shaping and Shipped.

import {
    activityUnavailable,
    boardSections,
    buildsAtWork,
    formatUsd,
    limitNumber,
    plural,
    readingScope,
    usageFailed,
    usageIncomplete,
} from '@lar-factory/shared';
import type { Item, Status } from '@lar-factory/shared';
import {
    BoardCounter as Counter,
    BoardCounters,
    CounterDash,
    CounterDivider,
    CounterEmpty as Empty,
    CounterFigure,
    CounterGroup,
    CounterGroups,
    CounterOfLimit,
    LimitBars,
    Loading,
} from '@lar-works/design-system';
import { CircleDollarSign } from '@lar-works/design-system/icons';

import { List, spendFace } from './CounterParts';
import { StatusGlyph, useStatusActivity } from '@/features/items';
import { useBoardStore } from '@/services/board/board.hooks';

const costOf = (item: Item) => (item.stats && item.stats !== 'unavailable' ? (item.stats.costUsd ?? 0) : 0);

export function Counters() {
    const { data, now, clientError } = useBoardStore();
    const s = boardSections(data, now, clientError);
    const building = buildsAtWork(data, activityUnavailable(data, now, clientError));
    const limit = data.buildLimit && limitNumber(data.buildLimit);
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
    const spend = spendFace(
        formatUsd(costs.reduce((t, c) => t + c.cost, 0)),
        costs.length > 0,
        unavailable,
        usageStillLoading,
    );
    const free = limit === undefined ? undefined : limit - building.length;
    const running = useStatusActivity();
    const glyph = (status: Status) => (
        <StatusGlyph status={status} running={status === 'In progress' && building.some(running)} />
    );
    // Nothing has been read yet, so a zero would be a claim.
    const unknown = (n: number) => reading && !n;
    const countOf = (n: number) => (unknown(n) ? <CounterDash /> : n);
    const hintFor = (n: number, hint: string) => (unknown(n) ? 'Still loading Projects' : hint);
    const subFor = (n: number) => (unknown(n) ? undefined : n);
    const empty = (none: string) => <Empty>{reading ? <Loading presentation="inline" label="Loading Projects…"  /> : none}</Empty>;
    const listOf = (items: Item[], none: string) => (items.length ? <List items={items} now={now} /> : empty(none));

    return (
        <BoardCounters>
            <Counter
                label="need you"
                value={countOf(s.needsYou.length)}
                icon={glyph('Needs you')}
                title="Needs you"
                sub={subFor(s.needsYou.length)}
                hint={hintFor(
                    s.needsYou.length,
                    s.needsYou.length
                        ? `${plural(s.needsYou.length, 'item')} waiting on your answer, verification or merge`
                        : 'Nothing waits on you',
                )}
            >
                {s.needsYou.length ? (
                    <CounterGroups>
                        {[...new Set(s.needsYou.map((i) => i.status))].map((status) => {
                            const items = s.needsYou.filter((i) => i.status === status);

                            return (
                                <CounterGroup key={status} title={status} count={items.length}>
                                    <List items={items} now={now} />
                                </CounterGroup>
                            );
                        })}
                    </CounterGroups>
                ) : (
                    empty('Nothing waits on you.')
                )}
            </Counter>

            <Counter
                label="shaping"
                value={countOf(s.shaping.length)}
                icon={glyph('Shaping')}
                fold="medium"
                title="Shaping"
                sub={subFor(s.shaping.length)}
                hint={hintFor(
                    s.shaping.length,
                    s.shaping.length ? `${plural(s.shaping.length, 'item')} being shaped` : 'Nothing shaping right now',
                )}
            >
                {listOf(s.shaping, 'Nothing shaping right now.')}
            </Counter>

            <Counter
                label="building"
                icon={glyph('In progress')}
                width={limit === undefined ? 'count' : 'limit'}
                title="Building"
                value={
                    limit === undefined ? (
                        countOf(building.length)
                    ) : (
                        <CounterOfLimit count={countOf(building.length)} limit={limit} />
                    )
                }
                hint={hintFor(
                    building.length,
                    free === undefined
                        ? `${plural(building.length, 'build')} at work`
                        : free > 0
                          ? `Room for ${plural(free, 'more build')} under the build limit of ${limit}`
                          : free === 0
                            ? 'At the build limit'
                            : `${-free} over the build limit`,
                )}
                sub={
                    limit === undefined ? (
                        subFor(building.length)
                    ) : unknown(building.length) ? (
                        `–/${limit}`
                    ) : (
                        <LimitBars used={building.length} limit={limit} />
                    )
                }
                foot={
                    reading || free === undefined
                        ? undefined
                        : free > 0
                          ? `Room for ${plural(free, 'more build')} under the build limit.`
                          : 'At the build limit. Start build and Start after still go ahead.'
                }
            >
                {listOf(building, 'Nothing building right now.')}
            </Counter>

            <Counter
                label="shipped"
                value={countOf(s.done.length)}
                icon={glyph('Done')}
                fold="medium"
                title="Shipped"
                sub="last 7 days"
                hint={hintFor(s.done.length, 'Done in the last 7 days')}
            >
                {listOf(s.done, 'Nothing shipped this week.')}
            </Counter>

            <CounterDivider />

            <Counter
                label="spend"
                value={spend.value}
                width="spend"
                fold="wide"
                title="Agent spend"
                sub={spend.sub}
                icon={<CircleDollarSign strokeWidth={2.25} />}
                hint={spend.notice ?? 'Agent cost on open and recent items, an API estimate'}
                foot={
                    spend.partial
                        ? spend.notice
                        : costs.length
                          ? `${plural(costs.length, 'priced item')}, an API estimate.`
                          : undefined
                }
            >
                {costs.length ? (
                    <List
                        items={costs.map((c) => c.item)}
                        now={now}
                        trailing={(i) => <CounterFigure>{formatUsd(costOf(i))}</CounterFigure>}
                    />
                ) : (
                    <Empty>
                        {unavailable ? (
                            'Usage is unavailable, so nothing is priced.'
                        ) : usageStillLoading ? (
                            <Loading presentation="inline" label="Loading usage…"  />
                        ) : (
                            'No priced agent work yet.'
                        )}
                    </Empty>
                )}
            </Counter>
        </BoardCounters>
    );
}
