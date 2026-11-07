// A section of the board's work by stage: a titled list that takes the height of its rows, so a section with none stays
// small and the page scrolls past them all.

import { readingScope } from '@lar-factory/shared';
import type { Status } from '@lar-factory/shared';
import type { ReactNode } from 'react';

import { useShownScope } from '@/features/filters/ScopeStore';
import { StatusGlyph } from '@/features/items/StatusGlyph';
import { useBoardStore } from '@/services/board/board.hooks';
import { Loader } from '@/shared/ui/loading/Loader';

export function Pane({
    id,
    title,
    status,
    running,
    count,
    right,
    className = '',
    children,
}: {
    id: string;
    title: string;
    status?: Status;
    running?: boolean;
    count: number;
    right?: ReactNode;
    className?: string;
    children: ReactNode;
}) {
    return (
        <section
            data-stage={id}
            aria-labelledby={`${id}-h`}
            className={`min-w-0 overflow-hidden rounded-xl border border-(--border) bg-(--card) shadow-xs ${className}`}
        >
            <header className="flex min-h-10 flex-wrap items-center gap-x-2 gap-y-1 border-b border-(--border) px-3 py-1">
                {status && <StatusGlyph status={status} running={running} />}
                <h3 id={`${id}-h`} className="m-0 text-[13px] font-medium whitespace-nowrap">
                    {title} <span className="font-normal text-(--muted-foreground) tabular-nums">{count}</span>
                </h3>
                {right && <span className="row-action ml-auto flex max-w-full min-w-0 items-center">{right}</span>}
            </header>
            <div className="@container">{children}</div>
        </section>
    );
}

/** What a section says with no row: that it's loading while the first read may still add rows to the scope, else `children` while a filter hides every row it has. */
export function PaneEmpty({ filtered, none, children }: { filtered: boolean; none: string; children: string }) {
    const scope = useShownScope();
    const reading = useBoardStore((state) => readingScope(state.data, scope ?? undefined));

    return (
        <p data-pane-empty className="m-0 px-3 py-3 text-[12px] text-(--muted-foreground)">
            {reading ? <Loader label="Loading Projects…" /> : filtered ? children : none}
        </p>
    );
}
