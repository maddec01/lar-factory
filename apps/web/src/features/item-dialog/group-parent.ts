import type { Item } from '@lar-factory/shared';

/** Linked children remain builds, even though they share their parent's flow. */
export const isGroupParent = (item: Item, items: readonly Item[]) =>
    item.kind === 'concept' ||
    (item.flow === 'linked' && (!item.parentId || items.some((part) => part.parentId === item.id)));
