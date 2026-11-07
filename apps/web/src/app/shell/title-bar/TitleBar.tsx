// The board's title bar, laid out as lar-server's AppTitleBar on the design system's TitleBar. On the left, the brand, then how
// the board is doing: a strip with the Refreshed time and the counters. Beside the actions, the board search's field,
// up to 26rem wide. On the right is what you can do, at the bar's right edge: List, Add item (the bar's Main action), a
// divider, then Update while there's an update, and Settings. Every control is an App control from the button kinds, 28
// px tall and 24 px inside the strip. The bar starts past the traffic lights and drags the window, except on its
// controls. Above the missing-t3 notice there's no board to search, count or add to, so it holds only the brand and
// Settings.
// Every control keeps its own width, and the bar folds by its own width (the design system's TitleBar is the container
// queried) instead: the List and Add item labels (kept for screen readers) go first, then Spend, Shaping and Shipped,
// then the Refreshed text, and on a narrow page the Refreshed dot. The field fits itself in what's left.

import { clock, failedCheck, inMacApp, isStale, shortAgo } from '@lar-factory/shared';
import type { BoardData } from '@lar-factory/shared';
import {
    BoardBrand,
    BoardTitleBar,
    type RefreshHealth,
    RefreshIndicator,
    TitleBarDivider,
} from '@lar-works/design-system';
import { useEffect, useRef, useState } from 'react';

import { Counters } from './Counters';
import { useLightsHidden } from './WindowControls';
import { AddItem } from '@/features/add-item';
import { BoardSearch } from '@/features/board-search';
import { ListButton } from '@/features/list';
import { SettingsButton } from '@/features/settings';
import { UpdateButton } from '@/features/updates';
import { useBoardStore } from '@/services/board/board.hooks';

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
                    'Loading Projects'
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
    const lightsHidden = useLightsHidden();

    return (
        <BoardTitleBar
            nativeWindow={inMacApp()}
            pastLights={!lightsHidden}
            brand={<BoardBrand product="Factory" />}
            // The missing-t3 notice has its own heading.
            heading={board ? 'Lar Factory' : undefined}
            refreshed={board && <Refreshed data={data} />}
            counters={board && <Counters />}
            search={board && <BoardSearch />}
            actions={
                <>
                    {board && (
                        <>
                            <ListButton />
                            <AddItem />
                            <TitleBarDivider />
                            <UpdateButton />
                        </>
                    )}
                    <SettingsButton />
                </>
            }
        />
    );
}
