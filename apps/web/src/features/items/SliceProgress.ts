import { openBlockers, type Item } from '@lar-factory/shared';

/** A blocked parent cannot have an active slice. Keep the recorded state for all other slices. */
export const shownSliceProgress = (item: Item, progress: Item['slices'][number]['progress']) =>
    openBlockers(item).length && progress === 'active' ? 'blocked' : progress;
