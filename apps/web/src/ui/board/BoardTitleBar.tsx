import {
    StatusIndicator,
    type StatusTone,
    TitleBar,
    type TitleBarHome,
    Tooltip,
    TooltipPopup,
    TooltipTrigger,
} from '@lar-works/design-system';
import type { ReactNode } from 'react';

interface BoardTitleBarProps {
    /** Where the lockup leads: the board's home, with its accessible name and what a click does there. */
    home: TitleBarHome;
    /** The board search's trigger, first in the end group. */
    search?: ReactNode;
    /** How the board is doing: a ToolbarStatusGroup of the Refreshed time and the counters. */
    status?: ReactNode;
    /** What you can do from anywhere, such as List and Add item. */
    actions?: ReactNode;
    /** The Settings button, after the actions. */
    settings: ReactNode;
}

/**
 * Lar Factory's title bar: the design system's TitleBar, as every Lar app's, with the "Lar Factory" lockup (a link to
 * the board's top), then search · status · List, Add item and Update · Settings at its end. It never wraps: search
 * folds to its icon, the counters fold by the bar's width and, under 40rem, into one "Board status" popover. It sits in
 * the board's AppShell, whose glass bar drags the window past the traffic lights. Its wrapper is `.title-bar`, for an
 * app's tests.
 */
export function BoardTitleBar({ home, search, status, actions, settings }: BoardTitleBarProps) {
    return (
        <div className="title-bar">
            <TitleBar
                product="Factory"
                home={home}
                search={search}
                status={status}
                statusLabel="Board status"
                actions={actions}
                settings={settings}
            />
        </div>
    );
}

export type RefreshHealth = 'waiting' | 'live' | 'stale' | 'disconnected';

const tones: Record<RefreshHealth, StatusTone> = {
    waiting: 'neutral',
    live: 'success',
    stale: 'warning',
    disconnected: 'danger',
};

interface RefreshIndicatorProps {
    /** How fresh the board is: `waiting`, `live`, `stale` or `disconnected`. */
    health: RefreshHealth;
    /** What the time says, such as "12s" or "Stale · 2m"; hidden on a narrow bar, where the dot speaks alone. */
    label: ReactNode;
    /** A count of reads landed while this page was open: each new one pings the dot once, while live. */
    landed: number;
    /** The tooltip's two lines: when the board last read, then how it reads or what went wrong. */
    detail: string;
    /** More on the health, in the tooltip. */
    secondaryDetail: string;
}

/**
 * How fresh the board is, first in the title bar's status group: a dot in the health's colour (amber when stale, red
 * while the page has lost the board server) and the time since the last read, with more in a glass tooltip. A tab
 * stop, so keyboard users reach its tooltip. It names its health in `data-health`. Each newer read pings the dot once
 * (`refreshed-ping` in refreshed.css), which pauses behind an open overlay as the design system's loops do.
 */
export function RefreshIndicator({ health, label, landed, detail, secondaryDetail }: RefreshIndicatorProps) {
    return (
        <Tooltip>
            <TooltipTrigger asChild>
                <span
                    tabIndex={0}
                    data-health={health}
                    className="refreshed text-fg-muted focus-ring inline-flex h-7 shrink-0 items-center gap-1.5 rounded-md px-1.5 text-xs whitespace-nowrap tabular-nums"
                >
                    <span className="relative grid size-2.5 place-items-center">
                        {landed > 0 && health === 'live' && (
                            <span
                                key={landed}
                                data-ping
                                className="bg-success absolute size-1.5 rounded-full motion-safe:animate-[refreshed-ping_1.2s_var(--ease-standard)_forwards]"
                            />
                        )}
                        <StatusIndicator size="sm" tone={tones[health]} />
                    </span>
                    {/* As wide as "59m ago", so the strip holds still as the time ticks; longer words widen it. */}
                    <span className="@max-3xl:sr-only @3xl:min-w-[7ch]">{label}</span>
                </span>
            </TooltipTrigger>
            <TooltipPopup side="bottom">
                <span className="flex flex-col gap-0.5">
                    <span data-line>{detail}</span>
                    <span data-line className="text-fg-muted">
                        {secondaryDetail}
                    </span>
                </span>
            </TooltipPopup>
        </Tooltip>
    );
}
