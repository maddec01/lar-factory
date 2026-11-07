// The parts of the title bar's counters: one counter and its panel, the item rows its panel lists, the build limit's
// bars and the spend counter's face.

import { itemName, repoKey, shortAgo } from '@lar-factory/shared';
import type { Item } from '@lar-factory/shared';
import { Button, Popover, Tooltip, TooltipPopup, TooltipTrigger } from '@lar-works/design-system';
import type { ReactNode } from 'react';

import { useItemDialogStore } from '@/features/item-dialog';
import { ItemTitle, SourceIcon, ItemStatusGlyph, STATUS_COLOR } from '@/features/items';
import { ProjectIcon } from '@/features/repositories';
import { kind } from '@/shared/ui/buttons/ButtonKinds';
import { Loader } from '@/shared/ui/loading/Loader';

/** How wide a counter's value stays from dash or loader to number: a count, a count over a limit, or a spend under $1,000 with its plus. */
const VALUE_WIDTH = { count: 'min-w-[2ch]', limit: 'min-w-[4ch]', spend: 'min-w-[8ch]' };

/** One toolbar counter: an App control with a glyph and a tabular count, named by its label, and its panel. */
export function Counter({
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

export function Empty({ children }: { children: ReactNode }) {
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

export function List({ items, now, trailing }: { items: Item[]; now: number; trailing?: (item: Item) => ReactNode }) {
    return (
        <ul className="m-0 grid list-none grid-cols-[minmax(0,1fr)] gap-px p-0">
            {items.map((item) => (
                <Row key={item.id} item={item} now={now} trailing={trailing?.(item)} />
            ))}
        </ul>
    );
}

/** The build limit as bars: one per build it allows, filled for each build at work, extra builds past it after a gap. */
export function LimitBars({ used, limit }: { used: number; limit: number }) {
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

export const Dash = () => <span className="font-normal text-(--muted-foreground)">–</span>;

/** What the spend counter says: a figure once it knows one, marked with a plus while it covers only part of the usage. */
export function spendFace(figure: string, known: boolean, unavailable: boolean, loading: boolean) {
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
