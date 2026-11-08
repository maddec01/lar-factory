// Whether an item already has a live thread, so starting another would create a second one.

import { isLiveThread } from '@lar-factory/shared';
import type { Item } from '@lar-factory/shared';

/** Whether a thread on the item is running, queued or waits on you, so starting another would make a second one. */
export const hasLiveThread = (item: Item): boolean => Array.isArray(item.threads) && item.threads.some(isLiveThread);
