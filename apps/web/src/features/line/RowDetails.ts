// What a row's second line shares: opening its item beside the controls, and choosing the item's or dossier's figures.

import { itemTotal } from '@lar-factory/shared';
import type { BoardData, Item, ItemStats } from '@lar-factory/shared';
import type { MouseEvent } from 'react';

import { statsOf } from './StageStatus';
import { useItemDialogStore } from '@/features/item-dialog';

/** A click on a second line beside its controls opens the item, as its first line's button does; letting go of a drag that selected text doesn't. */
export const opensItem = (item: Item) => (e: MouseEvent<HTMLElement>) => {
    if ((e.target as Element).closest('button, a') || !window.getSelection()?.isCollapsed) return;

    useItemDialogStore.getState().open(item.id);
};

/** The agent figures: a Dossier's total (parent plus parts), else the item's own; null when there are none. A total with no figures to show is empty and incomplete. */
export const figuresOf = (item: Item, data: BoardData, total?: boolean): ItemStats | null => {
    const sum = total ? itemTotal(item, data.items) : null;

    return sum === null ? statsOf(item) : sum === 'unavailable' ? { agentMs: 0, tokens: 0, incomplete: true } : sum;
};
