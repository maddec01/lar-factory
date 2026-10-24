// The board's own `~/lib/utils` for the Copies. T3's imports its contracts, Effect and the composer's
// draft store, so only its `cn` is taken (pingdotgg/t3code apps/web/src/lib/utils.ts at d53873b).

import { type CxOptions, cx } from 'class-variance-authority';
import { extendTailwindMerge } from 'tailwind-merge';

// The theme's extra font sizes (styles.css). Unregistered, tailwind-merge reads text-2xs as a colour
// and drops it next to text-muted-foreground.
const twMerge = extendTailwindMerge({ extend: { theme: { text: ['2xs', '3xs', '4xs', '5xs'] } } });

export function cn(...inputs: CxOptions) {
  return twMerge(cx(inputs));
}
