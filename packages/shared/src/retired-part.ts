import type { Item } from './item-domain.ts';

/** The historical outcome, including the survivor of absorbed work. */
export function retiredPartLabel(item: Item): string | null {
    if (item.supersededBy)
        return `Merged into ${item.supersededBy.number ? `#${item.supersededBy.number} ` : ''}${item.supersededBy.title}`;

    return item.setAside || item.archived?.setAside ? 'Set aside' : null;
}
