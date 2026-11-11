// A section of the board's work by stage, on the board's StagePane: a titled list that takes the height of its rows,
// and a section with none collapses to its header line, so the page scrolls past them all.

import { readingScope } from '@lar-factory/shared';
import type { Status } from '@lar-factory/shared';
import { Loading } from '@lar-works/design-system';
import type { ReactNode } from 'react';

import { useShownScope } from '@/features/filters';
import { StatusGlyph } from '@/features/items';
import { useBoardStore } from '@/services/board/board.hooks';
import { StagePane, StagePaneEmpty } from '@/ui/board';

export function Pane({
    id,
    title,
    status,
    running,
    count,
    right,
    empty,
    children,
}: {
    id: string;
    title: string;
    status?: Status;
    running?: boolean;
    count: number;
    right?: ReactNode;
    /** What the lane says with no rows, a PaneEmpty: it collapses to its header line. */
    empty?: ReactNode;
    children?: ReactNode;
}) {
    return (
        <StagePane
            id={id}
            title={title}
            glyph={status && <StatusGlyph status={status} running={running} />}
            count={count}
            right={right}
            empty={empty || undefined}
        >
            {children}
        </StagePane>
    );
}

/** What a section says with no row: that it's loading while the first read may still add rows to the scope, else `children` while a filter hides every row it has. */
export function PaneEmpty({ filtered, none, children }: { filtered: boolean; none: string; children: string }) {
    const scope = useShownScope();
    const reading = useBoardStore((state) => readingScope(state.data, scope ?? undefined));

    return (
        <StagePaneEmpty>
            {reading ? <Loading presentation="inline" label="Loading projects…" /> : filtered ? children : none}
        </StagePaneEmpty>
    );
}
