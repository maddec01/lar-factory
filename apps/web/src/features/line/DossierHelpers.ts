// What the dossier rows share: opening a part's item, keeping a control's click from the row, and what a part waits on.

import { blockerRef } from '@lar-factory/shared';
import type { Item } from '@lar-factory/shared';
import type { MouseEvent } from 'react';

import { openWaits } from './DossierParts';
import type { Part } from './DossierParts';
import { useItemDialogStore } from '@/features/item-dialog';

export const open = (item: Item) => useItemDialogStore.getState().open(item.id);
/** Keeps a click on a control from opening the item underneath it, nor do clicks in the menu it opens. */
export const stop = (e: MouseEvent) => e.stopPropagation();
export const usePicked = (item: Item) => useItemDialogStore((state) => state.itemId === item.id);

/** Finds the issue `#n` names in `repo`, the dossier's own repository when the reference names none. */
export type FindRef = (repo: string | undefined, n: number) => Item | undefined;

/** What a part waits on, as plain muted text: `waits on #305, #306`. */
export const waitsOn = (part: Part) =>
    `waits on ${openWaits(part)
        .map((b) => blockerRef(part.item, b))
        .join(', ')}`;
