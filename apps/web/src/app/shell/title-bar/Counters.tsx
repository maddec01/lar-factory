// The title bar's counters: need you, which leads the bar, then in its status group after the Refreshed light shaping,
// building, shipped and spend, in the board's order, each only while it has something to count, so a quiet board shows
// little, and none until the first read has landed. They are the design system's ToolbarCounters, always for the whole
// factory whatever repository or filters the board shows. Each is an indicator: its glyph (need you's in amber, the
// routine ones without colour) and its number, what it counts in its tooltip and accessible name, as the board's other
// lights are; a phone's bar keeps need you's words, where it stands alone. Its label is its accessible name and its
// tooltip says more. Each opens a wide status popover of every item behind the
// number in a list that scrolls; picking one opens the item dialog. The row holds its width as values load; the title
// bar's width decides what shows: Spend goes first, then Shaping and Shipped, and under 40rem the routine ones fold
// into the bar's status popover while need you stays beside the actions.

import { boardSections, formatUsd, plural, readingScope, usageFailed, usageIncomplete } from '@lar-factory/shared';
import type { Item, Status } from '@lar-factory/shared';
import { EmptyState, Loading, StatusIndicator } from '@lar-works/design-system';
import { CircleDollarSign } from '@lar-works/design-system/icons';
import { useState } from 'react';

import { List } from './CounterParts';
import { spendFace, spendScope } from './SpendFace';
import { StatusGlyph, useBuilds, useItemStates } from '@/features/items';
import { useBoardStore } from '@/services/board/board.hooks';
import {
    BoardCounter as Counter,
    bringDeskIntoView,
    CounterDash,
    CounterWords,
    QuietGlyph,
    CounterFigure,
    WaitWord,
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
    const total = costs.reduce((t, c) => t + c.cost, 0);
    // The last total summed with nothing loading or unavailable, which the bar keeps while a read sums again.
    const [settled, setSettled] = useState<number | null>(null);

    if (!unavailable && !usageStillLoading && settled !== total) setSettled(total);

    const spend = spendFace({ total, known: costs.length > 0, unavailable, loading: usageStillLoading, settled });
    const glyph = (status: Status) => (
        <StatusGlyph status={status} running={status === 'In progress' && builds.running > 0} />
    );
    // Needs you's groups name what each item asks, as its row does, under the counter's own title.
    const asks = (item: Item) => {
        const { word } = states(item);

        return word === 'Needs you' ? 'Question' : word;
    };
    // Nothing has been read yet, so a zero would be a claim.
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

    // Spend shows once it has a figure: never the dash of usage still loading before a first complete total.
    const spendShown = costs.length > 0 && !(usageStillLoading && !unavailable && settled === null);

    // While the first read lands the counts are partial, so the bar shows none of them until it settles; the lanes
    // say they are loading.
    if (reading) return null;

    return (
        <>
            {part === 'need you' && s.needsYou.length > 0 && (
                <Counter
                    label="need you"
                    value={
                        <>
                            {countOf(s.needsYou.length)}
                            {narrow && <CounterWords always>need you</CounterWords>}
                        </>
                    }
                    title="Your desk"
                    // A press brings Your desk into view rather than listing the cards it already shows.
                    onActivate={bringDeskIntoView}
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
                        // One flat list, each row saying what it waits for at its end.
                        <List items={s.needsYou} asks trailing={(item) => <WaitWord>{asks(item)}</WaitWord>} />
                    ) : (
                        empty('Nothing waits on you.')
                    )}
                </Counter>
            )}
            {part === 'routine' && (
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

                    {building.length > 0 && (
                        <Counter
                            label="building"
                            icon={<QuietGlyph>{glyph('In progress')}</QuietGlyph>}
                            title="Building"
                            count={countFor(building.length)}
                            value={<>{countOf(building.length)}</>}
                            hint={hintFor(building.length, builds.text)}
                            detail={limit === undefined ? undefined : `Shared limit ${limit}`}
                            foot={
                                reading
                                    ? undefined
                                    : 'All builds count toward this limit. At capacity, you can start an item over the limit; automatic starts wait for a slot.'
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
                            foot={
                                s.done.length
                                    ? 'Newest first. Work leaves this list 7 days after it’s done.'
                                    : undefined
                            }
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
                            // What the total covers beside it; the foot says it is an estimate.
                            detail={
                                costs.length ? `${spend.sub} · ${spendScope(data.retention?.hideAfterDays)}` : spend.sub
                            }
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
            )}
        </>
    );
}
