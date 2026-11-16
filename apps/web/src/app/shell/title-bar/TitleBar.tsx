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
            hidden={health === 'waiting' && reading.length > 0}
            label={
                health === 'disconnected' ? (
                    fetchedAt ? (
                        <time dateTime={fetchedAt}>Disconnected · {ago}</time>
                    ) : (
                        'Disconnected'
                    )
                ) : reading.length ? (
                    'Loading projects…'
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
                    <ToolbarStatusGroup role="group" aria-label="Board status">
                        <Refreshed data={data} />
                        {work && <Counters />}
                    </ToolbarStatusGroup>
                )
            }
            actions={
                board && (
                    <>
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
