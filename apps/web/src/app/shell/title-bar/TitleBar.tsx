// The board's title bar, the design system's TitleBar as every Lar app's: the "Lar Factory" lockup, a link that takes
// the board back to its top and clears the scope; then, at the end, the board search, how the board is doing (the
// Refreshed time and the counters, one status group that folds into a "Board status" popover on a narrow bar), what
// you can do (List, Add item, Update while there's an update) and Settings. Every control is the bar's 28px one with a
// glass tooltip. Above the missing-t3 notice there's no board to search, count or add to, so it holds only the lockup
// and Settings; before the first project it holds the lockup, the Refreshed light, Update and Settings.

import { clock, failedCheck, isStale, noneOnboarded, shortAgo } from '@lar-factory/shared';
import type { BoardData } from '@lar-factory/shared';
import { ToolbarStatusGroup } from '@lar-works/design-system';
import { useEffect, useState } from 'react';

import { Counters } from './Counters';
import { useWideBar } from './useWideBar';
import { AddItem } from '@/features/add-item';
import { BoardSearch } from '@/features/board-search';
import { useScopeStore } from '@/features/filters';
import { ListButton } from '@/features/list';
import { SettingsButton } from '@/features/settings';
import { UpdateButton } from '@/features/updates';
import { useBoardStore } from '@/services/board/board.hooks';
import { BoardTitleBar, type RefreshHealth, RefreshIndicator, scrollBoardToTop } from '@/ui/board';

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
    // Before the first project there is nothing to count, search, list or add to.
    const work = board && !noneOnboarded(data);
    const wide = useWideBar();

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
            search={work && <BoardSearch />}
            status={
                board &&
                wide && (
                    <>
                        {/* Need you leads; on a narrow bar, which keeps to it, it stands among the actions. */}
                        {work && <Counters part="need you" />}
                        <ToolbarStatusGroup role="group" aria-label="Board status">
                            <Refreshed data={data} />
                            {work && <Counters part="routine" />}
                        </ToolbarStatusGroup>
                    </>
                )
            }
            actions={
                board && (
                    <>
                        {work && !wide && <Counters part="need you" narrow />}
                        {work && <ListButton />}
                        {work && <AddItem />}
                        <UpdateButton />
                    </>
                )
            }
            settings={<SettingsButton />}
        />
    );
}
