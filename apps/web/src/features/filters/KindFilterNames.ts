// The kind filter's visible names, using the board's badges and a separate name for items with no kind.

import type { KindFilter } from './ItemFilters';
import { KIND_BADGES } from '@/features/items';

/** The kind filter's visible name, including items with no kind. */
export const kindName = (choice: KindFilter) => (choice === 'no-kind' ? 'No kind' : KIND_BADGES[choice]!.name);
