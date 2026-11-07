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
import { CircleDollarSign } from '@lar-works/design-system/icons';

import { Counter, Dash, Empty, LimitBars, List, spendFace } from './CounterParts';
import { StatusGlyph, useStatusActivity } from '@/features/items';
import { useBoardStore } from '@/services/board/board.hooks';
import { Loader } from '@/shared/ui/loading/Loader';

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
    const countOf = (n: number) => (unknown(n) ? <Dash /> : n);
    const hintFor = (n: number, hint: string) => (unknown(n) ? 'Still loading Projects' : hint);
    const subFor = (n: number) => (unknown(n) ? undefined : n);
    const empty = (none: string) => <Empty>{reading ? <Loader label="Loading Projects…" /> : none}</Empty>;
    const listOf = (items: Item[], none: string) => (items.length ? <List items={items} now={now} /> : empty(none));

    return (
        <div className="counters flex shrink-0 items-center gap-0.5 whitespace-nowrap">
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
                    <div className="grid gap-1">
                        {[...new Set(s.needsYou.map((i) => i.status))].map((status) => {
                            const items = s.needsYou.filter((i) => i.status === status);

                            return (
                                <section key={status}>
                                    <h3 className="m-0 flex h-7 items-center gap-1 px-2 text-xs font-medium text-(--muted-foreground)">
                                        {status} <span className="tabular-nums">{items.length}</span>
                                    </h3>
                                    <List items={items} now={now} />
                                </section>
                            );
                        })}
                    </div>
                ) : (
                    empty('Nothing waits on you.')
                )}
            </Counter>

            <Counter
                label="shaping"
                value={countOf(s.shaping.length)}
                icon={glyph('Shaping')}
                hideBelow="hidden @min-[54rem]:inline-flex"
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
                    <>
                        {countOf(building.length)}
                        {limit !== undefined && <span className="font-normal text-(--muted-foreground)">/{limit}</span>}
                    </>
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
                        <span className="inline-flex items-center gap-2">
                            <LimitBars used={building.length} limit={limit} />
                            {building.length}/{limit}
                        </span>
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
                hideBelow="hidden @min-[54rem]:inline-flex"
                title="Shipped"
                sub="last 7 days"
                hint={hintFor(s.done.length, 'Done in the last 7 days')}
            >
                {listOf(s.done, 'Nothing shipped this week.')}
            </Counter>

            <span aria-hidden="true" className="mx-1 hidden h-4 w-px shrink-0 bg-(--border) @min-[66rem]:block" />

            <Counter
                label="spend"
                value={spend.value}
                width="spend"
                hideBelow="hidden @min-[66rem]:inline-flex"
                title="Agent spend"
                sub={spend.sub}
                icon={<CircleDollarSign className="shrink-0" strokeWidth={2.25} />}
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
                        trailing={(i) => (
                            <span className="font-medium text-(--foreground)">{formatUsd(costOf(i))}</span>
                        )}
                    />
                ) : (
                    <Empty>
                        {unavailable ? (
                            'Usage is unavailable, so nothing is priced.'
                        ) : usageStillLoading ? (
                            <Loader label="Loading usage…" />
                        ) : (
                            'No priced agent work yet.'
                        )}
                    </Empty>
                )}
            </Counter>
        </div>
    );
}
