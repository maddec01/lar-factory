// The page's header: the logo, when the data was read, the counts, the app's update button, Add item, its Settings,
// and the banners for a gh the board can't use, stale data and an unreachable server, which closes.

import { useEffect, useState } from 'react';
import { countsOf, isStale } from '../model.ts';
import type { BoardData } from '../model.ts';
import { ago, clock, shortAgo } from '../format.ts';
import { BRAND_MARK_PATH, BRAND_MARK_VIEWBOX } from '../brand-mark.ts';
import { AddItem } from './AddItem.tsx';
import { inMacApp } from './board-app.ts';
import { useBoardStore } from './board-store.ts';
import { ClosableBanner } from './ClosableBanner.tsx';
import { CLIENT_ERROR } from './live-data.ts';
import { Settings } from './Settings.tsx';
import { GhBanner } from './ToolNotices.tsx';
import { UpdateButton } from './UpdateButton.tsx';

export function BrandMark() {
  return (
    <svg className="brand-mark" role="img" aria-label="Mux" viewBox={BRAND_MARK_VIEWBOX} fill="none">
      <path d={BRAND_MARK_PATH} stroke="currentColor" strokeWidth="5.5" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  );
}

/** Counts up each second on its own timer, so the rest of the board keeps the store's slower clock. */
function Refreshed({ fetchedAt }: { fetchedAt: string | null }) {
  const [now, setNow] = useState(Date.now);
  useEffect(() => {
    setNow(Date.now());
    const timer = setInterval(() => setNow(Date.now()), 1_000);
    return () => clearInterval(timer);
  }, [fetchedAt]);
  return (
    <p className="refreshed">
      {fetchedAt ? <>Refreshed <time dateTime={fetchedAt}>{shortAgo(fetchedAt, now)}</time></> : 'Not read yet'}
    </p>
  );
}

function StaleBanner({ data, now }: { data: BoardData; now: number }) {
  const since = data.fetchedAt
    ? `Showing data from ${clock(data.fetchedAt, undefined)} (${ago(data.fetchedAt, now)}).`
    : 'No data yet.';
  const why = data.error
    ? <> The last read through <code>gh</code> failed: <code className="err">{data.error}</code></>
    : ' The server has not refreshed it in a while.';
  return <div className="banner" role="alert"><strong>Stale.</strong> {since}{why}</div>;
}

export function Header() {
  const { data, now, clientError } = useBoardStore();
  const counts = countsOf(data);
  return (
    <header className="top">
      <div className="title-row">
        {/* In the Mac app the title bar shows the logo, so the heading stays for screen readers only. */}
        <h1 className={inMacApp() ? 'sr-only' : undefined}><BrandMark /><span>factory</span></h1>
        <Refreshed fetchedAt={data.fetchedAt} />
        <span className="header-actions"><UpdateButton /><AddItem /><Settings /></span>
      </div>
      <ul className="totals" aria-label="Counts">
        <li className={counts.needsYou ? 'amber' : ''}><b>{counts.needsYou}</b> need you</li>
        <li><b>{counts.inFlight}</b> in flight</li>
        <li><b>{counts.queued}</b> queued</li>
        <li><b>{counts.list}</b> in List</li>
        <li><b>{counts.total}</b> items</li>
      </ul>
      {clientError && (
        <ClosableBanner dismissKey={CLIENT_ERROR} what=": can't reach the board server">
          <strong>Can't reach the board server.</strong> {clientError} Showing the last data this page received.
        </ClosableBanner>
      )}
      {/* A gh that can't read explains the old data itself. */}
      {data.tools?.gh ? <GhBanner problem={data.tools.gh} /> : isStale(data, now) && <StaleBanner data={data} now={now} />}
    </header>
  );
}
