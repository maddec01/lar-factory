// PROTOTYPE, throwaway. Brand variant A, "T3 twin + badge": T3's SidebarBrandMark copied as is (mark at 1cap on the
// baseline, the muted word trimmed to its cap height), the Mux mark and "Factory", then a quiet outline badge saying
// it's for T3 Code. Alignment: the mark's viewBox is cropped to its ink (stroke included), so 1cap of mark is 1cap of
// ink and its centre is the cap's centre; the trimmed text and trimmed badge label make every box's centre its caps'
// centre, so the row's items-center puts all three on the toggle's centre line (y=26). Fit: "for T3 Code" runs ~68 px
// at the badge's 10 px, too wide for the ~114 px after x=130, so the badge says "for T3" and its tooltip says it all.

import { BRAND_MARK_PATH } from '@mux-factory/shared';
import { Badge } from '@mux-factory/ui/badge';
import { Tooltip, TooltipPopup, TooltipTrigger } from '@mux-factory/ui/tooltip';
import { noDrag } from '../chrome.tsx';

export const NAME = 'T3 twin + badge';

const trim = '[text-box:trim-both_cap_alphabetic]';
/** The mark's ink in BRAND_MARK_VIEWBOX (0 0 56 32): stroke centres 5..50 × 3.5..28.5, plus the 2.75 half stroke. */
const INK_VIEWBOX = '2.25 0.75 50.5 30.5';

export function BrandA() {
  return (
    <span className="inline-flex min-w-0 items-center gap-1.5">
      <span className="inline-flex min-w-0 items-baseline gap-1 text-sm font-medium tracking-tight">
        <svg className="h-[1cap] w-auto shrink-0" viewBox={INK_VIEWBOX} fill="none" aria-label="Mux">
          <path d={BRAND_MARK_PATH} stroke="currentColor" strokeWidth="5.5" strokeLinecap="round" strokeLinejoin="round" />
        </svg>
        <span className={`truncate text-(--muted-foreground) ${trim} supports-[text-box:trim-both_cap_alphabetic]:py-1`}>Factory</span>
      </span>
      <Tooltip>
        <TooltipTrigger render={
          <Badge variant="outline" size="sm" aria-label="For T3 Code"
            className={`bg-transparent text-muted-foreground dark:bg-transparent ${noDrag}`} />
        }>
          <span className={trim}>for T3</span>
        </TooltipTrigger>
        <TooltipPopup side="bottom">Mux Factory, a companion app for T3 Code</TooltipPopup>
      </Tooltip>
    </span>
  );
}
