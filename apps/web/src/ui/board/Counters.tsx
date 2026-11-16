import { Popover, PopoverHeader, ToolbarCounter } from '@lar-works/design-system';
import { scrollFadeClassName, useScrollFade } from '@lar-works/design-system/primitives';
import { type ReactNode, useRef, useState } from 'react';

import { OverflowCount } from './OverflowCount';
import { COMPACT_ROW, pickedRow } from './RowStyles';
import { tooltipWhenCut } from './TooltipWhenCut';

interface BoardCounterProps {
    icon: ReactNode;
    value: ReactNode;
    track?: { used: number; limit: number };
    width?: 'count' | 'track' | 'figure';
    label: string;
    hint: string;
    fold?: 'never' | 'medium' | 'wide';
    title: string;
    count?: number | string;
    detail?: ReactNode;
    foot?: ReactNode;
    children: ReactNode;
    onActivate?: () => boolean;
}

export function BoardCounter({
    icon,
    value,
    track,
    width,
    label,
    hint,
    fold = 'never',
    title,
    count,
    detail,
    foot,
    children,
    onActivate,
}: BoardCounterProps) {
    const [open, setOpen] = useState(false);

    return (
        <ToolbarCounter
            open={open}
            onOpenChange={(next) => setOpen(next && onActivate?.() ? false : next)}
            icon={icon}
            label={label}
            value={value}
            hint={hint}
            fold={fold}
            {...(track && { track })}
            {...(width && { width })}
        >
            <CounterPopover title={title} count={count} detail={detail} foot={foot}>
                {children}
            </CounterPopover>
        </ToolbarCounter>
    );
}

function CounterPopover({
    title,
    count,
    detail,
    foot,
    children,
}: Pick<BoardCounterProps, 'title' | 'count' | 'detail' | 'foot' | 'children'>) {
    const content = useRef<HTMLDivElement>(null);
    const { setViewport } = useScrollFade();

    return (
        <Popover.Content
            ref={content}
            onOpenAutoFocus={(event) => {
                event.preventDefault();
                content.current?.focus();
            }}
            side="bottom"
            align="start"
            sideOffset={8}
            height="capped"
            layout="fill"
            presentation="flush"
        >
            <PopoverHeader title={title} count={count} detail={detail} />
            <div
                ref={setViewport}
                tabIndex={0}
                className={`${scrollFadeClassName} focus-ring-inset flex min-h-0 flex-1 flex-col gap-1 overflow-y-auto overscroll-contain p-2 ${foot ? '' : 'rounded-b-[inherit]'}`}
            >
                <div data-counter-list className="contents">
                    {children}
                </div>
            </div>
            {foot && (
                <div
                    data-slot="status-popover-footer"
                    className="border-line text-fg-muted shrink-0 border-t px-4 py-2 text-xs"
                >
                    {foot}
                </div>
            )}
        </Popover.Content>
    );
}

export function CounterList({ children }: { children: ReactNode }) {
    return <ul className="m-0 grid list-none grid-cols-[minmax(0,1fr)] gap-px p-0">{children}</ul>;
}

interface CounterItemProps {
    item: string;
    picked?: boolean;
    label: string;
    leading: ReactNode;
    title: ReactNode;
    trailing?: ReactNode;
    onOpen: () => void;
    sub?: ReactNode;
}

export function CounterItem({ item, picked = false, label, leading, title, trailing, onOpen, sub }: CounterItemProps) {
    const whenCut = tooltipWhenCut(label, (row) => row.querySelector('[data-counter-title]'));

    return (
        <li>
            <Popover.Close asChild aria-label={undefined} aria-description={label}>
                <button
                    type="button"
                    onClick={onOpen}
                    onPointerEnter={whenCut}
                    data-item={item}
                    className={`${COMPACT_ROW} ${pickedRow(picked)} text-fg focus-visible:bg-fill-hover grid min-h-8 w-full cursor-pointer ${trailing ? 'grid-cols-[auto_minmax(0,1fr)_auto]' : 'grid-cols-[auto_minmax(0,1fr)]'} items-start gap-x-2.5 text-left text-sm outline-none`}
                >
                    <span className="flex h-5 items-center gap-2">{leading}</span>
                    <span className={`grid min-w-0 content-start ${sub ? 'min-h-14' : 'min-h-10'}`}>
                        <span className="line-clamp-2 wrap-anywhere" data-counter-title>
                            {title}
                        </span>
                        {sub && <span className="text-fg-muted flex min-w-0 items-center gap-1.5 text-xs">{sub}</span>}
                    </span>
                    {trailing && (
                        <span className="text-fg-muted flex h-5 min-w-16 items-center justify-end gap-1.5 text-xs tabular-nums">
                            {trailing}
                        </span>
                    )}
                </button>
            </Popover.Close>
        </li>
    );
}

export function CounterAge({ project, age }: { project: ReactNode; age?: ReactNode }) {
    return (
        <>
            {project}
            {age && (
                <>
                    <span aria-hidden="true">·</span>
                    <span className="whitespace-nowrap">{age}</span>
                </>
            )}
        </>
    );
}

export function CounterFigure({ children }: { children: ReactNode }) {
    return <span className="text-fg font-medium">{children}</span>;
}

export function QuietGlyph({ children }: { children: ReactNode }) {
    return <span className="text-fg-muted inline-flex grayscale">{children}</span>;
}

export function CounterDash() {
    return <span className="text-fg-muted font-normal">–</span>;
}

export function CounterPartial({ figure }: { figure: string }) {
    return (
        <>
            {figure}
            <span className="text-warning-fg font-normal">+</span>
        </>
    );
}

const MOST_BARS = 5;

export function LimitBars({ used, limit, children }: { used: number; limit: number; children?: ReactNode }) {
    const bar = (n: number, on: boolean) => (
        <span key={n} className={`bar h-1.5 w-3 rounded-full ${on ? 'bg-board-active' : 'bg-line'}`} />
    );

    const within = Math.min(limit, MOST_BARS);
    const past = Math.min(Math.max(used - limit, 0), MOST_BARS - within);
    const more = Math.max(limit, used) - within - past;

    return (
        <span className="inline-flex items-center gap-2">
            <span aria-hidden className="inline-flex items-center gap-1">
                {Array.from({ length: within }, (_, n) => bar(n, n < used))}
                {past > 0 && (
                    <span className="ml-1 inline-flex gap-1">
                        {Array.from({ length: past }, (_, n) => (
                            <span key={limit + n} className="bar bg-warning h-1.5 w-3 rounded-full" />
                        ))}
                    </span>
                )}
                {more > 0 && (
                    <span className="ml-1 flex">
                        <OverflowCount n={more} />
                    </span>
                )}
            </span>
            {children}
        </span>
    );
}
