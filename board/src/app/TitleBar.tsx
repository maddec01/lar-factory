// The Mac app's title bar, copied from T3 Code: a 52 px drag bar under the window's traffic lights
// (app/src/WindowTitleBar.ts puts them at x 16, centred in the bar), then the logo, a grey "Factory" and a
// "for T3 Code" pill. Sizes from pingdotgg/t3code apps/web/src/components/sidebar/SidebarChrome.tsx
// (the brand row) and ui/badge.tsx (Badge size "sm"); the drag rule from apps/web/src/index.css.
// Nothing in the bar is clickable, so all of it drags the window.

import { BRAND_MARK_PATH, BRAND_MARK_VIEWBOX } from '../brand-mark.ts';

export function TitleBar() {
  return (
    // The outer box holds the bar's place in the page; the bar stays at the top as the page scrolls.
    // Screen readers skip it: the header's hidden h1 already names the page.
    <div className="h-[52px]" aria-hidden="true">
      <div className="title-bar fixed inset-x-0 top-0 z-50 flex h-[52px] select-none items-center gap-2 border-b border-(--bd) bg-(--bg) pl-[89px] [-webkit-app-region:drag]">
        <span className="inline-flex items-baseline gap-1 text-sm font-medium tracking-tight">
          {/* The logo sits on the baseline and the µ's tail hangs below, as in the page header (styles.css .brand-mark). */}
          <svg className="relative top-[calc(12.5px*8.75/32)] h-[12.5px] w-[22px] shrink-0" role="img" aria-label="Mux" viewBox={BRAND_MARK_VIEWBOX} fill="none">
            <path d={BRAND_MARK_PATH} stroke="currentColor" strokeWidth="5.5" strokeLinecap="round" strokeLinejoin="round" />
          </svg>
          <span className="text-(--muted)">Factory</span>
        </span>
        {/* T3's secondary badge is zinc-50 on the zinc-25 page, which barely shows; zinc-100 reads. */}
        <span className="ml-1 inline-flex h-4 items-center rounded-[.25rem] border border-transparent bg-(--accent) px-[3px] text-[.625rem] font-medium leading-none whitespace-nowrap">
          for T3 Code
        </span>
      </div>
    </div>
  );
}
