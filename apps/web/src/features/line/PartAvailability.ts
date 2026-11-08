// Whether a dossier part can start now, from its status, open blockers and live threads.

import { openWaits, type Part } from './DossierParts';
import { hasLiveThread } from '@/features/items';

/** Whether PartStart offers the part a Start now: it is Ready or Queued, waits on no open issue, has no live thread
 *  and carries one status. The dossier's "Ready to start" row and its header's "what's next" both read it. */
export const startable = (part: Part): boolean =>
    (part.item.status === 'Ready' || part.item.status === 'Queued') &&
    !openWaits(part).length &&
    !hasLiveThread(part.item);
