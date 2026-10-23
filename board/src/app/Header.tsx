// The page's header: the logo, when the data was read, the counts, Add item and Update, and the
// banners for an update, stale data and an unreachable server, which closes.

import { countsOf, isStale } from '../model.ts';
import type { BoardData } from '../model.ts';
import { ago, clock } from '../format.ts';
import { BRAND_MARK_PATH, BRAND_MARK_VIEWBOX } from '../brand-mark.ts';
import { AddItem } from './AddItem.tsx';
import { useBoardStore } from './board-store.ts';
import { ClosableBanner } from './ClosableBanner.tsx';
import { CLIENT_ERROR } from './live-data.ts';
import { HeaderUpdateButton, UpdateBanners } from './Update.tsx';

function BrandMark() {
  return (
    <svg className="brand-mark" role="img" aria-label="Mux" viewBox={BRAND_MARK_VIEWBOX} fill="none">
      <path d={BRAND_MARK_PATH} stroke="currentColor" strokeWidth="5.5" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  );
}

function Refreshed({ data, now }: { data: BoardData; now: number }) {
  const project = data.project.url
    ? <a href={data.project.url} target="_blank" rel="noopener">{data.project.title} project</a>
    : data.project.title;
  return (
    <p className="refreshed">
      {data.fetchedAt
        ? <>Refreshed <time dateTime={data.fetchedAt}>{clock(data.fetchedAt, undefined)}</time> <span className="age">({ago(data.fetchedAt, now)})</span></>
        : 'Not read yet'}
      {' · '}{project}
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
        <h1><BrandMark /><span>factory</span></h1>
        <Refreshed data={data} now={now} />
        <span className="header-actions"><AddItem /><HeaderUpdateButton /></span>
      </div>
      <ul className="totals" aria-label="Counts">
        <li className={counts.needsYou ? 'amber' : ''}><b>{counts.needsYou}</b> need you</li>
        <li><b>{counts.inFlight}</b> in flight</li>
        <li><b>{counts.queued}</b> queued</li>
        <li><b>{counts.list}</b> in List</li>
        <li><b>{counts.total}</b> items</li>
      </ul>
      <UpdateBanners />
      {clientError && (
        <ClosableBanner dismissKey={CLIENT_ERROR} what=": can't reach the board server">
          <strong>Can't reach the board server.</strong> {clientError} Showing the last data this page received.
        </ClosableBanner>
      )}
      {isStale(data, now) && <StaleBanner data={data} now={now} />}
    </header>
  );
}
