// The loading screen's line for the first read's progress.

import type { FirstRead } from '@lar-factory/shared';

const STEP_TEXT: Record<FirstRead['step'], string> = {
  repositories: 'Loading projects',
  items: 'Loading projects',
  finishing: 'Finishing up',
};

/** Keep loading copy stable as individual projects finish. */
export function stepText(read: FirstRead): string {
  return read.running.length ? 'Loading projects' : STEP_TEXT[read.step];
}
