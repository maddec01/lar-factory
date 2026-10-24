// PROTOTYPE, throwaway. Brand variant C, "Paired marks": a co-branded lockup, like "Raycast × Linear". The Mux mark and
// a muted "Factory", a hairline, then T3's wordmark muted, all on one cap height; the T3 mark is a (mock) button that
// would open T3 Code, and a tooltip spells the pairing out.
//
// Alignment: everything is centred, not baseline-aligned. Baseline alignment sat the mark's box bottom on the text's
// baseline, so the 12.5 px mark rode ~1.25 px above the ~9.9 px cap band the toggle centres on. Here "Factory" is
// trimmed to its cap band ([text-box:trim-both_cap_alphabetic], as T3 trims "Code"), the hairline and T3's wordmark are
// exactly 1cap tall, and the row's items-center puts every box's centre on the cap band's centre, y = 26.

import { BRAND_MARK_PATH, BRAND_MARK_VIEWBOX } from '@mux-factory/shared';
import { Tooltip, TooltipPopup, TooltipTrigger } from '@mux-factory/ui/tooltip';
import { noDrag } from '../chrome.tsx';
import { T3Wordmark } from './brand-c-t3-wordmark.tsx';

export const NAME = 'C: Paired marks (Mux Factory | T3)';

export function BrandC() {
  return (
    <Tooltip>
      <TooltipTrigger render={<span className={`inline-flex min-w-0 shrink-0 items-center gap-1.5 text-sm font-medium tracking-tight ${noDrag}`} />}>
        <span className="inline-flex items-center gap-1">
          <svg className="h-[12.5px] w-[22px] shrink-0" viewBox={BRAND_MARK_VIEWBOX} fill="none" aria-label="Mux">
            <path d={BRAND_MARK_PATH} stroke="currentColor" strokeWidth="5.5" strokeLinecap="round" strokeLinejoin="round" />
          </svg>
          <span className="whitespace-nowrap text-(--muted-foreground) [text-box:trim-both_cap_alphabetic]">Factory</span>
        </span>
        <span aria-hidden="true" className="h-[1cap] w-px shrink-0 bg-(--muted-foreground)/40" />
        {/* Mock: the app would open T3 Code here. */}
        <button type="button" aria-label="Open T3 Code" onClick={() => {}}
          className="-mx-1 inline-flex h-6 shrink-0 items-center rounded-md px-1 text-(--muted-foreground) outline-hidden transition-colors hover:bg-(--accent) hover:text-(--foreground) focus-visible:ring-2 focus-visible:ring-(--ring)">
          <T3Wordmark aria-hidden="true" className="h-[1cap] w-auto" />
        </button>
      </TooltipTrigger>
      <TooltipPopup side="bottom">Mux Factory, a companion app for T3 Code</TooltipPopup>
    </Tooltip>
  );
}
