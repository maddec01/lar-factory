// The page's title bar, copied from T3 Code: a 52 px drag bar with the logo, a grey "Factory" and a "for T3 Code" pill.
// In the Mac app it leaves room for the window's traffic lights (app/src/WindowTitleBar.ts puts them at x 16, centred in
// the bar). Sizes from pingdotgg/t3code apps/web/src/components/sidebar/SidebarChrome.tsx (the brand row) and
// ui/badge.tsx (Badge size "sm"); the drag rule from apps/web/src/index.css.
// The right end is the factory's own: the Refreshed time, then Update, Add item and Settings. Clicks on those buttons
// never drag the window; the rest of the bar, Refreshed and the gaps between the buttons included, does.

import { useEffect, useState } from 'react';
import { shortAgo, BRAND_MARK_PATH, BRAND_MARK_VIEWBOX, inMacApp } from '@mux-factory/shared';
import { AddItem } from '../add-item/add-item.tsx';
import { useBoardStore } from '../board/board-store.ts';
import { Settings } from '../settings/settings.tsx';
import { UpdateButton } from '../updates/UpdateButton.tsx';

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

export function TitleBar() {
  const data = useBoardStore((state) => state.data);
  // Above the missing-t3 notice there's no board to refresh or add to, so only Settings shows.
  const board = !data.tools?.t3;
  return (
    // The outer box holds the bar's place in the page; the bar stays at the top as the page scrolls.
    <div className="h-[52px]">
      <div className={`title-bar fixed inset-x-0 top-0 z-50 flex h-[52px] select-none items-center gap-2 border-b border-(--bd) bg-(--bg) pr-4 [-webkit-app-region:drag] ${inMacApp() ? 'pl-[89px]' : 'pl-4'}`}>
        {/* Screen readers skip the brand: the header's hidden h1 already names the page. */}
        <span className="title-bar-brand inline-flex items-center gap-2" aria-hidden="true">
          <span className="inline-flex items-baseline gap-1 text-sm font-medium tracking-tight">
            {/* The logo sits on the baseline and the µ's tail hangs below, as in the page header (index.css .brand-mark). */}
            <svg className="relative top-[calc(12.5px*8.75/32)] h-[12.5px] w-[22px] shrink-0" role="img" aria-label="Mux" viewBox={BRAND_MARK_VIEWBOX} fill="none">
              <path d={BRAND_MARK_PATH} stroke="currentColor" strokeWidth="5.5" strokeLinecap="round" strokeLinejoin="round" />
            </svg>
            <span className="text-(--muted)">Factory</span>
          </span>
          {/* T3's secondary badge is zinc-50 on the zinc-25 page, which barely shows; zinc-100 reads. */}
          <span className="ml-1 inline-flex h-4 items-center rounded-[.25rem] border border-transparent bg-(--accent) px-[3px] text-[.625rem] font-medium leading-none whitespace-nowrap">
            for T3 Code
          </span>
        </span>
        <span className="title-bar-actions ml-auto flex items-center gap-2 [&_button]:[-webkit-app-region:no-drag]">
          {board && <><Refreshed fetchedAt={data.fetchedAt} /><UpdateButton /><AddItem /></>}
          <Settings />
        </span>
      </div>
    </div>
  );
}
