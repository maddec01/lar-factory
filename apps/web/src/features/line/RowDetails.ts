// What a row's facts share: opening its item beside the controls, choosing the item's or dossier's figures, and the
// note on its blocked or working slices.

import { itemTotal } from '@lar-factory/shared';
import type { BoardData, Item, ItemStats } from '@lar-factory/shared';
import type { MouseEvent } from 'react';

import { statsOf } from './StageStatus';
import { useItemDialogStore } from '@/features/item-dialog';

/** A click on a second line beside its controls opens the item, as its first line's button does, or calls `onOpen` in
 *  its place; letting go of a drag that selected text doesn't. */
export const opensItem = (item: Item, onOpen?: () => void) => (e: MouseEvent<HTMLElement>) => {
    if ((e.target as Element).closest('button, a') || !window.getSelection()?.isCollapsed) return;

    if (onOpen) onOpen();
    else useItemDialogStore.getState().open(item.id);
};

/** The agent figures: a Dossier's total (parent plus parts), else the item's own; null when there are none. A total with no figures to show is empty and incomplete. */
export const figuresOf = (item: Item, data: BoardData, total?: boolean): ItemStats | null => {
    const sum = total ? itemTotal(item, data.items) : null;

    return sum === null ? statsOf(item) : sum === 'unavailable' ? { agentMs: 0, tokens: 0, incomplete: true } : sum;
};

/** The blocked slices, then the active ones. */
export const sliceNote = (item: Item) => {
    const b = item.slices.filter((s) => s.progress === 'blocked');
    const a = item.slices.filter((s) => s.progress === 'active');

    return [
        ...b.map((s) => ({ s, word: 'blocked', tone: 'blocked' as const })),
        ...a.map((s) => ({ s, word: 'working', tone: 'active' as const })),
    ];
};

/** The slice note: the first blocked slice by name, so the row says what's stuck, then how many more are blocked and
 *  how many work, in counts that can't be misread ("Bandwidth probe blocked · 2 working"); every name in the tooltip. */
export const sliceCounts = (note: ReturnType<typeof sliceNote>) => {
    const blocked = note.filter((n) => n.tone === 'blocked').length;
    const working = note.length - blocked;
    const rest = [blocked > 1 && `${blocked - 1} more blocked`, working > 0 && `${working} working`].filter(Boolean);

    return { name: note[0]!.s.title, more: rest.length ? ` · ${rest.join(' · ')}` : undefined };
};
