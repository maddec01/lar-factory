// The title bar's counters: need you, which leads the bar, then in its status group after the Refreshed light shaping,
// building, shipped and spend, in the board's order, each only while it has something to count, so a quiet board shows
// little. They are the design system's ToolbarCounters, always for the whole factory whatever repository or filters the
// board shows. Each shows its glyph (need you's in amber, the routine ones without colour), its number and, on a wide
// bar, what it counts in words, muted but for need you's; Build's header shows the occupancy against the limit. Its
// label is its accessible name and its tooltip says more. Each opens a wide status popover of every item behind the
// number in a list that scrolls; picking one opens the item dialog. The row holds its width as values load; the title
// bar's width decides what shows: Spend goes first, then Shaping and Shipped, and under 40rem the routine ones fold
// into the bar's status popover while need you stays beside the actions.

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
    CounterWords,
    QuietGlyph,
    CounterEmpty as Empty,
    CounterFigure,
    CounterGroup,
    CounterGroups,
} from '@/ui/board';

const costOf = (item: Item) => (item.stats && item.stats !== 'unavailable' ? (item.stats.costUsd ?? 0) : 0);

/** `part` picks need you alone, which the bar keeps out of its folding status group, or the routine counts; `narrow`
 *  keeps need you's words, where it stands alone on a phone's bar. */
export function Counters({ part, narrow = false }: { part: 'need you' | 'routine'; narrow?: boolean }) {
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
            {part === 'need you' && (reading || s.needsYou.length > 0) && (
                <Counter
                    label="need you"
                    value={
                        <>
                            {countOf(s.needsYou.length)}
                            <CounterWords always={narrow}>need you</CounterWords>
                        </>
                    }
                    title="Needs you"
                    // Amber only while something waits on you.
                    icon={<StatusIndicator state={s.needsYou.length ? 'waiting' : 'off'} />}
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
                                        <List items={items} now={now} asks />
                                    </CounterGroup>
                                );
                            })}
                        </CounterGroups>
                    ) : (
                        empty('Nothing waits on you.')
                    )}
                </Counter>
            )}
            {part === 'routine' && (
                <>
                    {(reading || s.shaping.length > 0) && (
                        <Counter
                            label="shaping"
                            value={
                                <>
                                    {countOf(s.shaping.length)}
                                    <CounterWords quiet>shaping</CounterWords>
                                </>
                            }
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

                    {(reading || building.length > 0) && (
                        <Counter
                            label="building"
                            icon={<QuietGlyph>{glyph('In progress')}</QuietGlyph>}
                            title="Building"
                            count={countFor(building.length)}
                            value={
                                <>
                                    {countOf(building.length)}
                                    <CounterWords quiet>building</CounterWords>
                                </>
                            }
                            hint={hintFor(building.length, builds.text)}
                            detail={limit === undefined ? undefined : `Shared limit ${limit}`}
                            foot={
                                reading
                                    ? undefined
                                    : 'All builds count toward this limit. At capacity, Pedro can start an item over the limit; automatic starts wait for a slot.'
                            }
                        >
                            {listOf(building, 'Nothing building right now.')}
                        </Counter>
                    )}

                    {(reading || s.done.length > 0) && (
                        <Counter
                            label="shipped"
                            value={
                                <>
                                    {countOf(s.done.length)}
                                    <CounterWords quiet>shipped</CounterWords>
                                </>
                            }
                            icon={<QuietGlyph>{glyph('Done')}</QuietGlyph>}
                            fold="medium"
                            title="Shipped"
                            count={countFor(s.done.length)}
                            detail="Last 7 days"
                            hint={hintFor(s.done.length, 'Done in the last 7 days')}
                        >
                            {listOf(s.done, 'Nothing shipped this week.')}
                        </Counter>
                    )}

                    {(reading || costs.length > 0) && (
                        <Counter
                            label="spend"
                            value={spend.value}
                            width="figure"
                            fold="wide"
                            title="Agent spend"
                            detail={spend.sub}
                            icon={
                                <QuietGlyph>
                                    <CircleDollarSign strokeWidth={2.25} />
                                </QuietGlyph>
                            }
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
                    )}
                </>
            )}
        </>
    );
}
