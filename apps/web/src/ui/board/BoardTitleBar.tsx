import {
    BrandMark,
    StatusIndicator,
    type StatusTone,
    TitleBar,
    Tooltip,
    TooltipPopup,
    TooltipTrigger,
} from '@lar-works/design-system';
import { GlassBarBase } from '@lar-works/design-system/primitives';
import type { ReactNode } from 'react';

/** The window drags from the bar, but never from a control in it. */
const drag = '[-webkit-app-region:drag] [&_:is(button,a,[tabindex])]:[-webkit-app-region:no-drag]';

interface BoardTitleBarProps {
    /** The lockup on the left, such as BoardBrand. */
    brand: ReactNode;
    /** The page's heading, for screen readers only, as the brand is hidden from them. A closing dialog whose opener
     *  went away can put the focus on it. */
    heading?: string;
    /** How the board is doing, in the status strip: the Refreshed time, then the counters after a divider. */
    refreshed?: ReactNode;
    /** The board's counters, a BoardCounters, in the status strip. */
    counters?: ReactNode;
    /** The search field, up to 26rem wide beside the actions. */
    search?: ReactNode;
    /** What you can do, at the bar's end, such as Add item. */
    actions: ReactNode;
    /** In the Mac app, whose window macOS draws its traffic lights over (a hidden-inset title bar). A browser has no
     *  traffic lights, so the bar draws none and keeps only its own padding. */
    nativeWindow: boolean;
    /** Starts the bar past the native traffic lights; off while full screen hides them. Only the Mac app has them, so
     *  outside it this changes nothing. */
    pastLights: boolean;
}

/**
 * Lar Factory's title bar, laid out as lar-server's on the design system's TitleBar: the brand and how the board is
 * doing on the left, the search field and what you can do on the right. The bar drags the window, except on its
 * controls, and folds by its own width: below 48rem the actions take their own row and the status strip goes.
 */
export function BoardTitleBar({
    brand,
    heading,
    refreshed,
    counters,
    search,
    actions,
    nativeWindow,
    pastLights,
}: BoardTitleBarProps) {
    const status = refreshed || counters;
    const inset = nativeWindow && pastLights;

    return (
        <GlassBarBase
            data-native-window={nativeWindow || undefined}
            data-past-lights={inset || undefined}
            className={`title-bar select-none ${inset ? 'pl-18.5' : ''} ${drag}`}
        >
            {heading ? (
                <h1 className="sr-only" tabIndex={-1}>
                    {heading}
                </h1>
            ) : null}
            <TitleBar
                brand={brand}
                title={
                    status || search ? (
                        <>
                            {status ? (
                                <div className="status-strip border-line bg-surface-sunken flex shrink-0 items-center gap-0.5 rounded-lg border pr-0.5 pl-1.5">
                                    {refreshed}
                                    {refreshed && counters ? (
                                        <span aria-hidden="true" className="bg-line @max-pane:hidden mx-0.5 h-4 w-px" />
                                    ) : null}
                                    {counters}
                                </div>
                            ) : null}
                            {search}
                        </>
                    ) : null
                }
                actions={actions}
            />
        </GlassBarBase>
    );
}

/** The product's lockup in the title bar: the Lar mark, "ar" and the product's name. Screen readers skip it: the
 *  page's heading names the page. */
export function BoardBrand({
    product,
}: {
    /** The product's name after "Lar", such as "Factory". */
    product: string;
}) {
    return (
        <span className="brand inline-flex shrink-0" aria-hidden="true">
            <BrandMark label={`Lar ${product}`} product={product} />
        </span>
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
 * How fresh the board is, in the title bar's status strip: a dot in the health's colour (amber when stale, red while
 * the page has lost the board server) and the time since the last read, with more in a tooltip. A tab stop, so
 * keyboard users reach its tooltip. It names its health in `data-health`.
 */
export function RefreshIndicator({ health, label, landed, detail, secondaryDetail }: RefreshIndicatorProps) {
    return (
        <Tooltip>
            <TooltipTrigger asChild>
                <span
                    tabIndex={0}
                    data-health={health}
                    className="refreshed text-fg-muted focus-ring @max-pane:hidden inline-flex h-6 shrink-0 items-center gap-1.5 rounded-sm px-1 text-xs whitespace-nowrap tabular-nums @3xl:min-w-30"
                >
                    <span className="relative grid size-2.5 place-items-center">
                        {landed > 0 && health === 'live' && (
                            <span
                                key={landed}
                                data-ping
                                className="bg-success absolute size-1.5 rounded-full motion-safe:animate-[refreshed-ping_1.2s_ease-out_forwards]"
                            />
                        )}
                        <StatusIndicator size="sm" tone={tones[health]} />
                    </span>
                    <span className="@max-3xl:sr-only">{label}</span>
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
