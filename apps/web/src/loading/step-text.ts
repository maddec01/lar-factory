// The loading screen's line for the first read's progress.

import type { FirstRead } from '@lar-factory/shared';

const STEP_TEXT: Record<FirstRead['step'], string> = {
  repositories: 'Checking repositories',
  items: 'Reading items',
  finishing: 'Finishing up',
};

/** "a", "a and b", "a, b and c". */
function listed(names: string[]): string {
  return names.length < 2 ? names.join('') : `${names.slice(0, -1).join(', ')} and ${names.at(-1)}`;
}

/** What the first read is doing now: the reads still running when there are any, else its step. */
export function stepText(read: FirstRead): string {
  return read.running.length ? `Reading ${listed(read.running)}` : STEP_TEXT[read.step];
}
