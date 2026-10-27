// The List's search: an item matches when its title or ref holds the query.

import { ref } from '@lar-factory/shared';
import type { Item } from '@lar-factory/shared';

/** `query` is lower case and trimmed; an empty one matches every item. */
export const matchesSearch = (item: Item, query: string): boolean => !query || `${item.title} ${ref(item)}`.toLowerCase().includes(query);
