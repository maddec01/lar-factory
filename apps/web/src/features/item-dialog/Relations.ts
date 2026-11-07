// Whether the item dialog has a sidebar, and the work records the item's record waits on, which the sidebar lists.

import type { Item } from '@lar-factory/shared';

import type { ItemDetailsRead } from './useItemDetails';
import { dependenciesOf } from '@/features/items';

/** The work records the item's record waits on, as the board holds them. */
export const waitsOn = (item: Item) => item.blockers.filter((b) => b.workId);

/** Whether the sidebar has anything: work it waits on, Dependencies, pull requests, or sub-tickets (as many as the board counts while the details load). */
export const hasRelations = (item: Item, read: ItemDetailsRead): boolean =>
    item.linkedPrs.length > 0 ||
    waitsOn(item).length > 0 ||
    dependenciesOf(item).length > 0 ||
    (read.state === 'loaded'
        ? read.details.subTickets.length > 0 ||
          Boolean(
              read.details.attachments?.length ||
              read.details.related?.length ||
              read.details.blockers?.length ||
              read.details.relationsError,
          )
        : read.state === 'loading' && item.subIssues.total > 0);
