// The loading screen's line for the first read's progress.

import type { FirstRead } from '@lar-factory/shared';

const STEP_TEXT: Record<FirstRead['step'], string> = {
    repositories: 'Loading Projects',
    items: 'Loading Projects',
    finishing: 'Finishing up',
};

/** Keep loading copy stable as individual projects finish. */
export function stepText(read: FirstRead): string {
    return read.running.length ? 'Loading Projects' : STEP_TEXT[read.step];
}
