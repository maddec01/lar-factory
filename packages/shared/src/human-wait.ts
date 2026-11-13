import { deskWait } from './desk-wait.ts';
import type { Item } from './item-domain.ts';
import { prReadiness } from './presentation.ts';
import { retroWaits } from './retro.ts';
import { openQuestionThread, stoppedRunThread, workingAgain } from './thread-domain.ts';

/** The same human wait determines desk placement and group attention. */
export function humanWait(item: Item, unavailable = false, all: readonly Item[] = []) {
    const waiting =
        retroWaits(item.retro) ||
        !!item.briefApproval ||
        item.status === 'Needs you' ||
        (item.status !== 'Done' && !!openQuestionThread(item)) ||
        (!unavailable && !!stoppedRunThread(item)) ||
        !!item.needsYou ||
        (item.status !== 'Done' &&
            Array.isArray(item.threads) &&
            item.threads.some((thread) => thread.childNeedsYou && !thread.observedAt)) ||
        ((item.status === 'Verify' || item.status === 'Ready to merge') &&
            !workingAgain(item, unavailable) &&
            prReadiness(item)?.state !== 'active');

    return waiting ? deskWait(item, unavailable, all) : null;
}
