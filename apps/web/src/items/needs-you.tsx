import { useState } from 'react';
// Why the work waits on the user, from its work record, in the item dialog: the reason and the choices the board
// offers for it. Each choice asks in its confirmation first. Set aside is Abandon.

import { itemName } from '@lar-factory/shared';
import type { BoardData, Item, NeedsYouAction, NeedsYouOffer } from '@lar-factory/shared';
import { Button } from '@lar-works/design-system';
import { useActionStore, useItemAction } from './action-store.ts';
import { askAbandon } from './card-actions.ts';
import { writeState } from './item-actions.tsx';
import { NeedsYouDialog } from './needs-you-dialog.tsx';
import { kind } from '../buttons/button-kinds.tsx';

const LABELS: Record<NeedsYouOffer, string> = {
  'start-again': 'Start again', 'back-to-queue': 'Back to Queue', 'back-to-list': 'Move to List',
  'reopen-pr': 'Reopen PR', 'replace-pr': 'Start a replacement build', 'keep-working': 'Keep working', 'mark-handled': 'Mark as handled',
  'set-aside': 'Abandon',
};

export function NeedsYou({ item, data }: { item: Item; data: BoardData }) {
  const cleanupResult = useActionStore(state => state.cleanupResults[item.id]);
  if (!item.needsYou) return cleanupResult ? <p role="alert">{cleanupResult}</p> : null;
  return <Notice item={item} notice={item.needsYou} data={data} cleanupResult={cleanupResult} />;
}

function Notice({ item, notice, data, cleanupResult }: { item: Item; notice: NonNullable<Item['needsYou']>; data: BoardData; cleanupResult?: string }) {
  const [asking, setAsking] = useState<NeedsYouAction | null>(null);
  const state = writeState(data, useItemAction(item.id));
  return (
    <div className="grid gap-2 rounded-xl border border-[color-mix(in_srgb,var(--warning)_35%,transparent)] bg-(--warning-surface) px-3 py-2.5" data-needs-you-reason>
      <p className="m-0 font-medium text-(--warning-foreground)">Needs you: {notice.reason}</p>
      <span className="flex flex-wrap gap-1.5">
        {notice.offers.map((offer) => (
          <Button {...kind('other')} key={offer} {...state} aria-label={`${LABELS[offer]}: ${itemName(item)}`}
            {...offer === 'set-aside' ? { 'data-abandon': item.id, onClick: () => askAbandon(item.id) }
              : { 'data-needs-you': item.id, onClick: () => setAsking(offer) }}>{LABELS[offer]}</Button>
        ))}
      </span>
      {cleanupResult && <p role="alert">{cleanupResult}</p>}
      {asking && notice.offers.includes(asking) && <NeedsYouDialog item={item} data={data} offer={asking} label={LABELS[asking]} onClose={() => setAsking(null)} />}
    </div>
  );
}
