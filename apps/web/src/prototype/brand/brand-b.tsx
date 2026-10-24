// PROTOTYPE, throwaway. Brand variant B, "Two-line lockup": the Mux mark and a muted "Factory" on top, as T3 shows its
// mark and "Code", and a smaller "for [T3] Code" under it in T3's own wordmark, the pair centred on the toggle (y=26).
// Alignment: no baselines guessed. Both lines trim their text to the cap box ([text-box:trim-both_cap_alphabetic]), so
// each line's box is its ink: line 1 centres the 12.5 px mark on "Factory"'s cap height (the mark overhangs the caps by
// 1.25 px each side, instead of sitting on the baseline and riding 1.25 px high); line 2 is just its caps, the T3 mark
// at 1cap on the baseline. The column's box is then the lockup's ink, and the row's items-center puts it at y=26.

import { BRAND_MARK_PATH, BRAND_MARK_VIEWBOX } from '@mux-factory/shared';

export const NAME = 'Two-line lockup, "for [T3] Code" under the mark';

const trim = '[text-box:trim-both_cap_alphabetic] whitespace-nowrap';

/** T3's wordmark, copied from T3 Code's T3Wordmark.tsx. */
const T3_VIEWBOX = '15.5309 37 94.3941 56.96';
const T3_PATH = 'M33.4509 93V47.56H15.5309V37H64.3309V47.56H46.4109V93H33.4509ZM86.7253 93.96C82.832 93.96 78.9653 93.4533 75.1253 92.44C71.2853 91.3733 68.032 89.88 65.3653 87.96L70.4053 78.04C72.5386 79.5867 75.0186 80.8133 77.8453 81.72C80.672 82.6267 83.5253 83.08 86.4053 83.08C89.6586 83.08 92.2186 82.44 94.0853 81.16C95.952 79.88 96.8853 78.12 96.8853 75.88C96.8853 73.7467 96.0586 72.0667 94.4053 70.84C92.752 69.6133 90.0853 69 86.4053 69H80.4853V60.44L96.0853 42.76L97.5253 47.4H68.1653V37H107.365V45.4L91.8453 63.08L85.2853 59.32H89.0453C95.9253 59.32 101.125 60.8667 104.645 63.96C108.165 67.0533 109.925 71.0267 109.925 75.88C109.925 79.0267 109.099 81.9867 107.445 84.76C105.792 87.48 103.259 89.6933 99.8453 91.4C96.432 93.1067 92.0586 93.96 86.7253 93.96Z';

export function BrandB() {
  return (
    <span className="flex min-w-0 flex-col gap-[5px] tracking-tight" role="img" aria-label="Mux Factory, for T3 Code">
      <span className="flex items-center gap-1 text-sm font-medium" aria-hidden="true">
        <svg className="h-[12.5px] w-[22px] shrink-0" viewBox={BRAND_MARK_VIEWBOX} fill="none">
          <path d={BRAND_MARK_PATH} stroke="currentColor" strokeWidth="5.5" strokeLinecap="round" strokeLinejoin="round" />
        </svg>
        <span className={`${trim} text-(--muted-foreground)`}>Factory</span>
      </span>
      <span className="flex items-baseline gap-[3px] text-[11px] font-medium text-(--muted-foreground)" aria-hidden="true">
        <span className={trim}>for</span>
        <svg className="h-[1cap] w-auto shrink-0 text-(--foreground)" viewBox={T3_VIEWBOX}><path d={T3_PATH} fill="currentColor" /></svg>
        <span className={trim}>Code</span>
      </span>
    </span>
  );
}
