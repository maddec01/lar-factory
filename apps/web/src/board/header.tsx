// The page's header, below the title bar: the page's heading for screen readers, the counts, and the banners for a gh
// the board can't use, stale data and an unreachable server, which closes.

import { boardSections, isStale, ago, clock, BRAND_MARK_PATH, BRAND_MARK_VIEWBOX } from '@mux-factory/shared';
import type { BoardData } from '@mux-factory/shared';
import { useBoardStore } from './board-store.ts';
import { Badge } from '@mux-factory/ui/badge';
import { Banner, ClosableBanner } from '../notices/banner.tsx';
import { CLIENT_ERROR } from './live-data.ts';
import { GhBanner } from '../notices/tool-notices.tsx';

export function BrandMark() {
  return (
    <svg className="brand-mark" role="img" aria-label="Mux" viewBox={BRAND_MARK_VIEWBOX} fill="none">
      <path d={BRAND_MARK_PATH} stroke="currentColor" strokeWidth="5.5" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  );
}

function StaleBanner({ data, now }: { data: BoardData; now: number }) {
  const since = data.fetchedAt
    ? `Showing data from ${clock(data.fetchedAt, undefined)} (${ago(data.fetchedAt, now)}).`
    : 'No data yet.';
  const why = data.error
    ? <> The last read through <code>gh</code> failed: <code className="err">{data.error}</code></>
    : ' The server has not refreshed it in a while.';
  return <Banner title="Stale.">{since}{why}</Banner>;
}

/** One of the header's counts; need you turns amber while anything needs you. */
function Count({ count, what, amber = false }: { count: number; what: string; amber?: boolean }) {
  return <Badge render={<li />} variant={amber ? 'warning' : 'outline'} size="control" className={amber ? 'amber' : undefined}><b>{count}</b> {what}</Badge>;
}

export function Header() {
  const { data, now, clientError } = useBoardStore();
  const { needsYou, inFlight, queued, list } = boardSections(data, now);
  return (
    <header className="top">
      {/* The title bar shows the logo, so the heading stays for screen readers only. */}
      <h1 className="sr-only"><BrandMark /><span>factory</span></h1>
      <ul className="totals" aria-label="Counts">
        <Count count={needsYou.length} what="need you" amber={needsYou.length > 0} />
        <Count count={inFlight.length} what="in flight" />
        <Count count={queued.length} what="queued" />
        <Count count={list.length} what="in List" />
        <Count count={data.items.length} what="items" />
      </ul>
      {clientError && (
        <ClosableBanner dismissKey={CLIENT_ERROR} what=": can't reach the board server" title="Can't reach the board server.">
          {clientError} Showing the last data this page received.
        </ClosableBanner>
      )}
      {/* A gh that can't read explains the old data itself. */}
      {data.tools?.gh ? <GhBanner problem={data.tools.gh} /> : isStale(data, now) && <StaleBanner data={data} now={now} />}
    </header>
  );
}
