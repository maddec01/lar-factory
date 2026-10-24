// The banners above the desk: an unreachable server, which closes, then a gh the board can't use or stale data.

import { ago, clock, isStale } from '@mux-factory/shared';
import type { BoardData } from '@mux-factory/shared';
import { useBoardStore } from '../board/board-store.ts';
import { CLIENT_ERROR } from '../board/live-data.ts';
import { Banner, ClosableBanner } from './banner.tsx';
import { GhBanner } from './tool-notices.tsx';

function StaleBanner({ data, now }: { data: BoardData; now: number }) {
  const since = data.fetchedAt
    ? `Showing data from ${clock(data.fetchedAt, undefined)} (${ago(data.fetchedAt, now)}).`
    : 'No data yet.';
  const why = data.error
    ? <> The last read through <code>gh</code> failed: <code className="err">{data.error}</code></>
    : ' The server has not refreshed it in a while.';
  return <Banner title="Stale.">{since}{why}</Banner>;
}

export function Banners() {
  const { data, now, clientError } = useBoardStore();
  return (
    // Hidden while empty, so it takes no gap in the page's grid.
    <div className="banners grid gap-2.5 empty:hidden">
      {clientError && (
        <ClosableBanner dismissKey={CLIENT_ERROR} what=": can't reach the board server" title="Can't reach the board server.">
          {clientError} Showing the last data this page received.
        </ClosableBanner>
      )}
      {/* A gh that can't read explains the old data itself. */}
      {data.tools?.gh ? <GhBanner problem={data.tools.gh} /> : isStale(data, now) && <StaleBanner data={data} now={now} />}
    </div>
  );
}
