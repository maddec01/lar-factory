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
    itemName,
    readingScope,
    repoKey,
    shortAgo,
    usageFailed,
    usageIncomplete,
} from '@lar-factory/shared';
import type { Item, Status } from '@lar-factory/shared';
import { Button, Popover, Tooltip, TooltipPopup, TooltipTrigger } from '@lar-works/design-system';
import { CircleDollarSign } from '@lar-works/design-system/icons';
import type { ReactNode } from 'react';

import { useBoardStore } from '../board/board-store.ts';
import { kind } from '../buttons/button-kinds.tsx';
import { useItemDialogStore } from '../item-dialog/item-dialog-store.ts';
import { ItemTitle } from '../items/item-parts.tsx';
import { SourceIcon } from '../items/source-icon.tsx';
import { ItemStatusGlyph, StatusGlyph, STATUS_COLOR, useStatusActivity } from '../items/status-glyph.tsx';
import { Loader } from '../loading/loader.tsx';
import { ProjectIcon } from '../repositories/project-icon.tsx';

const costOf = (item: Item) => (item.stats && item.stats !== 'unavailable' ? (item.stats.costUsd ?? 0) : 0);

/** How wide a counter's value stays from dash or loader to number: a count, a count over a limit, or a spend under $1,000 with its plus. */
const VALUE_WIDTH = { count: 'min-w-[2ch]', limit: 'min-w-[4ch]', spend: 'min-w-[8ch]' };

/** One toolbar counter: an App control with a glyph and a tabular count, named by its label, and its panel. */
function Counter({
    icon,
    value,
    width = 'count',
    label,
    hint,
    hideBelow,
    title,
    sub,
    foot,
    children,
}: {
    icon: ReactNode;
    value: ReactNode;
    width?: keyof typeof VALUE_WIDTH;
    label: string;
    hint: string;
    hideBelow?: string;
    title: string;
    sub?: ReactNode;
    foot?: ReactNode;
    children: ReactNode;
}) {
    return (
        <Popover>
            <Tooltip>
                <TooltipTrigger asChild>
                    <Popover.Trigger asChild>
                        <Button
                            {...kind('control')}
                            aria-label={`${label}: ${hint}`}
                            className={`text-base-700 hover:text-base-content data-[state=open]:bg-base-300/60 data-[state=open]:text-base-content min-w-0 gap-1.5 ${hideBelow ?? ''}`}
                        >
                            <span className="counter-icon grid size-4 shrink-0 place-items-center [&_svg]:size-4">
                                {icon}
                            </span>
                            <span
                                className={`counter-value text-base-content inline-flex items-center leading-4 font-medium tabular-nums [&_[data-loader]]:w-full [&_[data-loader]]:justify-center [&_svg]:size-3 ${VALUE_WIDTH[width]}`}
                            >
                                {value}
                            </span>
                        </Button>
                    </Popover.Trigger>
                </TooltipTrigger>
                <TooltipPopup side="bottom">{hint}</TooltipPopup>
            </Tooltip>
            <Popover.Content side="bottom" align="end" layout="fill" presentation="menu">
                <div className="counter-popup flex max-h-112 min-h-0 w-96 max-w-full flex-col">
                    <div className="counter-head text-base-700 flex h-7 shrink-0 items-center gap-2 px-2 text-xs font-medium">
                        <span className="min-w-0 flex-1 truncate">{title}</span>
                        {sub !== undefined && <span className="shrink-0 font-normal tabular-nums">{sub}</span>}
                    </div>
                    <div className="min-h-0 flex-1 overflow-y-auto overscroll-contain">{children}</div>
                    {foot !== undefined && (
                        <div className="mt-1 shrink-0 border-t border-(--border) px-2 pt-1.5 pb-1 text-xs text-(--muted-foreground)">
                            {foot}
                        </div>
                    )}
                </div>
            </Popover.Content>
        </Popover>
    );
}

function Empty({ children }: { children: ReactNode }) {
    return (
        <p className="m-0 flex min-h-20 items-center justify-center px-2 py-4 text-center text-xs text-(--muted-foreground)">
            {children}
        </p>
    );
}

/** One item, as a menu's row: its status glyph, its number and title, then its repository's icon and age (or a trailing figure). Picking it opens the item dialog. */
function Row({ item, now, trailing }: { item: Item; now: number; trailing?: ReactNode }) {
    return (
        <li>
            <Popover.Close asChild aria-label={`${itemName(item)}`}>
                <button
                    type="button"
                    onClick={() => useItemDialogStore.getState().open(item.id)}
                    data-item={item.id}
                    className="text-base-content hover:bg-base-200 focus-visible:bg-base-200 flex min-h-7 w-full cursor-default items-center gap-2 rounded-[0.375rem] px-2 py-1 text-left text-sm outline-none max-lg:min-h-11 pointer-coarse:min-h-11"
                >
                    <ItemStatusGlyph item={item} />
                    <SourceIcon item={item} />
                    <span className="min-w-0 flex-1 truncate">
                        <ItemTitle item={item} />
                    </span>
                    <span className="flex shrink-0 items-center gap-1.5 text-[11px] text-(--muted-foreground) tabular-nums">
                        {trailing ?? (
                            <>
                                <ProjectIcon repo={repoKey(item)} size="small" />
                                <span className="min-w-7 text-right whitespace-nowrap">
                                    {shortAgo(item.closedAt ?? item.updatedAt, now)}
                                </span>
                            </>
                        )}
                    </span>
                </button>
            </Popover.Close>
        </li>
    );
}

function List({ items, now, trailing }: { items: Item[]; now: number; trailing?: (item: Item) => ReactNode }) {
    return (
        <ul className="m-0 grid list-none grid-cols-[minmax(0,1fr)] gap-px p-0">
            {items.map((item) => (
                <Row key={item.id} item={item} now={now} trailing={trailing?.(item)} />
            ))}
        </ul>
    );
}

/** The build limit as bars: one per build it allows, filled for each build at work, extra builds past it after a gap. */
function LimitBars({ used, limit }: { used: number; limit: number }) {
    const bar = (n: number, on: boolean) => (
        <span
            key={n}
            className="h-1.5 w-3 rounded-full"
            style={{ background: on ? STATUS_COLOR['In progress'] : 'var(--border)' }}
        />
    );
    return (
        <span className="inline-flex items-center gap-[3px]">
            {Array.from({ length: limit }, (_, n) => bar(n, n < used))}
            {used > limit && (
                <span className="ml-1 inline-flex gap-[3px]">
                    {Array.from({ length: used - limit }, (_, n) => bar(limit + n, true))}
                </span>
            )}
        </span>
    );
}

const Dash = () => <span className="font-normal text-(--muted-foreground)">–</span>;

/** What the spend counter says: a figure once it knows one, marked with a plus while it covers only part of the usage. */
function spendFace(figure: string, known: boolean, unavailable: boolean, loading: boolean) {
    const partial = known && (unavailable || loading);
    const why = unavailable ? 'Some usage is unavailable.' : 'Some usage is still loading.';
    return {
        partial,
        notice: partial
            ? `Partial figures. ${why}`
            : unavailable
              ? 'Usage is unavailable.'
              : loading
                ? 'Usage totals are still loading.'
                : null,
        value: partial ? (
            <>
                {figure}
                <span className={`font-normal ${unavailable ? 'text-(--st-amber)' : 'text-(--muted-foreground)'}`}>
                    +
                </span>
            </>
        ) : unavailable ? (
            <Dash />
        ) : loading ? (
            <Loader title="Usage totals are still loading." />
        ) : (
            figure
        ),
        sub: partial ? `${figure} so far` : unavailable ? 'Unavailable' : loading ? 'Loading' : figure,
    };
}

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
