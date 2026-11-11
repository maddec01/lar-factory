// The board's title bar, the design system's TitleBar as every Lar app's: the "Lar Factory" lockup, a link that takes
// the board back to its top and clears the scope; then, at the end, the board search, how the board is doing (the
// Refreshed time and the counters, one status group that folds into a "Board status" popover on a narrow bar), what
// you can do (List, Add item, Update while there's an update) and Settings. Every control is the bar's 28px one with a
// glass tooltip. Above the missing-t3 notice there's no board to search, count or add to, so it holds only the lockup
// and Settings.

import { clock, failedCheck, isStale, shortAgo } from '@lar-factory/shared';
import type { BoardData } from '@lar-factory/shared';
import { ToolbarStatusGroup } from '@lar-works/design-system';
import { useEffect, useRef, useState } from 'react';

import { Counters } from './Counters';
import { AddItem } from '@/features/add-item';
import { BoardSearch } from '@/features/board-search';
import { useScopeStore } from '@/features/filters';
import { ListButton } from '@/features/list';
import { SettingsButton } from '@/features/settings';
import { UpdateButton } from '@/features/updates';
import { useBoardStore } from '@/services/board/board.hooks';
import { BoardTitleBar, type RefreshHealth, RefreshIndicator, scrollBoardToTop } from '@/ui/board';

/** How many reads landed after this page opened: a newer `fetchedAt` than the one shown. */
function useLandedReads(fetchedAt: string | null) {
    const [landed, setLanded] = useState(0);
    const shown = useRef(fetchedAt);

    useEffect(() => {
        const before = shown.current;

        shown.current = fetchedAt;

        if (fetchedAt && (!before || Date.parse(fetchedAt) > Date.parse(before))) setLanded((count) => count + 1);
    }, [fetchedAt]);

    return landed;
}

/** Counts up each second on its own timer, so the rest of the board keeps the store's slower clock. Only the dot
 *  changes colour (amber when stale, red while the page has lost the board server) and only the dot pings. */
function Refreshed({ data }: { data: BoardData }) {
    const { fetchedAt } = data;
    const clientError = useBoardStore((state) => state.clientError);
    const [now, setNow] = useState(Date.now);

    useEffect(() => {
        let timer: ReturnType<typeof setInterval> | undefined;
        const followVisibility = () => {
            clearInterval(timer);

            if (document.hidden) return;

            setNow(Date.now());
            timer = setInterval(() => setNow(Date.now()), 1_000);
        };

        document.addEventListener('visibilitychange', followVisibility);
        followVisibility();

        return () => {
            clearInterval(timer);
            document.removeEventListener('visibilitychange', followVisibility);
        };
    }, [fetchedAt]);

    const landed = useLandedReads(fetchedAt);
    // A repository whose items haven't landed would show as empty, so the board says it still reads instead.
    const reading = data.firstRead.waiting ?? [];
    const health: RefreshHealth = clientError
        ? 'disconnected'
        : reading.length
          ? 'waiting'
          : isStale(data, now) || data.itemSourceProblems?.length
            ? 'stale'
            : fetchedAt
              ? 'live'
              : 'waiting';
    const ago = fetchedAt ? shortAgo(fetchedAt, now) : null;

    return (
        <RefreshIndicator
            health={health}
            landed={landed}
            label={
                health === 'disconnected' ? (
                    fetchedAt ? (
                        <time dateTime={fetchedAt}>Disconnected · {ago}</time>
                    ) : (
                        'Disconnected'
                    )
                ) : reading.length ? (
                    'Loading projects'
                ) : !fetchedAt ? (
                    'Not read yet'
                ) : (
                    <time dateTime={fetchedAt}>{health === 'stale' ? `Stale · ${ago}` : ago}</time>
                )
            }
            detail={fetchedAt ? `Updated ${shortAgo(fetchedAt, now)} · ${clock(fetchedAt, undefined)}` : 'Not read yet'}
            secondaryDetail={
                clientError
                    ? `Board disconnected: ${clientError}`
                    : data.error
                      ? `Last read failed: ${data.error.split('\n')[0]}`
                      : `Checks GitHub for changes every 5s, reads everything every ${data.refreshSeconds}s`
            }
        />
    );
}

export function TitleBar() {
    const board = useBoardStore((state) => failedCheck(state.data.tools, 't3')?.result !== 'missing');
    const data = useBoardStore((state) => state.data);

    return (
        <BoardTitleBar
            home={{
                href: '/',
                label: 'Lar Factory, home',
                onNavigate: () => {
                    useScopeStore.getState().setScope(null);
                    scrollBoardToTop();
                },
            }}
            search={board && <BoardSearch />}
            status={
                board && (
                    <ToolbarStatusGroup role="group" aria-label="Board status">
                        <Refreshed data={data} />
                        <Counters />
                    </ToolbarStatusGroup>
                )
            }
            actions={
                board && (
                    <>
                        <ListButton />
                        <AddItem />
                        <UpdateButton />
                    </>
                )
            }
            settings={<SettingsButton />}
        />
    );
}
