// The title bar's five counters, in its status group after the Refreshed time: need you, shaping, building, shipped and
// spend, in the board's order, as the design system's ToolbarCounters, always for the whole factory whatever repository
// or filters the board shows. Each shows only its glyph, in the status's own colour, and its number (Building with its
// track against the automatic limit); its label is its accessible name and its tooltip says more. Each opens a wide
// status popover of every item behind the number in a list that scrolls; picking one opens the item dialog. The row
// holds its width as values load; the title bar's width decides what shows: Spend goes first, then Shaping and
// Shipped, and under 40rem they all fold into the bar's status popover.

import { boardSections, formatUsd, plural, readingScope, usageFailed, usageIncomplete } from '@lar-factory/shared';
import type { Item, Status } from '@lar-factory/shared';
import { Loading, StatusIndicator } from '@lar-works/design-system';
import { CircleDollarSign } from '@lar-works/design-system/icons';

import { List } from './CounterParts';
import { spendFace } from './SpendFace';
import { StatusGlyph, useBuilds, useItemStates } from '@/features/items';
import { useBoardStore } from '@/services/board/board.hooks';
import {
    BoardCounter as Counter,
    CounterDash,
    CounterEmpty as Empty,
    CounterFigure,
    CounterGroup,
    CounterGroups,
} from '@/ui/board';

const costOf = (item: Item) => (item.stats && item.stats !== 'unavailable' ? (item.stats.costUsd ?? 0) : 0);

export function Counters() {
    const { data, now, clientError } = useBoardStore();
    const s = boardSections(data, now, clientError);
    const builds = useBuilds();
    const { items: building, limit } = builds;
    const states = useItemStates();
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
    const glyph = (status: Status) => (
        <StatusGlyph status={status} running={status === 'In progress' && builds.running > 0} />
    );
    // Needs you's groups name what each item asks, as its row does, under the counter's own title.
    const asks = (item: Item) => {
        const { word } = states(item);

        return word === 'Needs you' ? 'Questions' : word;
    };
    // Nothing has been read yet, so a zero would be a claim.
    const unknown = (n: number) => reading && !n;
    const countOf = (n: number) => (unknown(n) ? <CounterDash /> : n);
    const hintFor = (n: number, hint: string) => (unknown(n) ? 'Still loading projects' : hint);
    const countFor = (n: number) => (unknown(n) ? undefined : n);
    const empty = (none: string) => (
        <Empty>{reading ? <Loading presentation="inline" label="Loading projects…" /> : none}</Empty>
    );
    const listOf = (items: Item[], none: string) => (items.length ? <List items={items} now={now} /> : empty(none));

    return (
        <>
            <Counter
                label="need you"
                value={countOf(s.needsYou.length)}
                title="Needs you"
                icon={<StatusIndicator state="waiting" />}
                count={countFor(s.needsYou.length)}
                hint={hintFor(
                    s.needsYou.length,
                    s.needsYou.length
                        ? `${plural(s.needsYou.length, 'item')} waiting on your answer, verification or merge`
                        : 'Nothing waits on you',
                )}
            >
                {s.needsYou.length ? (
                    <CounterGroups>
                        {[...new Set(s.needsYou.map(asks))].map((status) => {
                            const items = s.needsYou.filter((i) => asks(i) === status);

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
                count={countFor(s.shaping.length)}
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
                title="Building"
                count={countFor(building.length)}
                value={countOf(building.length)}
                {...(limit !== undefined && { track: { used: building.length, limit } })}
                hint={hintFor(building.length, builds.text)}
                detail={limit === undefined ? undefined : `Shared limit ${limit}`}
                foot={
                    reading
                        ? undefined
                        : 'Concept builds, manual starts, Start after and Auto-build share this limit. At capacity, manual starts are refused; scheduled starts wait for a slot.'
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
                count={countFor(s.done.length)}
                detail="Last 7 days"
                hint={hintFor(s.done.length, 'Done in the last 7 days')}
            >
                {listOf(s.done, 'Nothing shipped this week.')}
            </Counter>

            <Counter
                label="spend"
                value={spend.value}
                width="figure"
                fold="wide"
                title="Agent spend"
                detail={spend.sub}
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
                            <Loading presentation="inline" label="Loading usage…" />
                        ) : (
                            'No priced agent work yet.'
                        )}
                    </Empty>
                )}
            </Counter>
        </>
    );
}
