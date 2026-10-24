// The build slots: the builds in progress, against a limit the board shows but doesn't enforce. The title bar's
// building counter and the Queue's header both count them. A concept in progress isn't a build in a slot.

import { kindOf } from '@mux-factory/shared';
import type { Item } from '@mux-factory/shared';

export const BUILD_LIMIT = 2;

/** The items in progress that take a build slot: everything but concepts. */
export const buildsInSlots = (items: readonly Item[]): Item[] =>
  items.filter((i) => i.status === 'In progress' && kindOf(i) !== 'concept');
