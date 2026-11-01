// Why the work waits on the user, from its work record, in the item dialog: the reason and the choices the board
// offers for it, then Clear for after the user checked, such as T3 after an uncertain start. Set aside is Abandon.

import { itemName } from '@lar-factory/shared';
import type { BoardData, Item, NeedsYouOffer } from '@lar-factory/shared';
import { Button } from '@lar-factory/ui/design-system/Button';
import { useItemAction } from './action-store.ts';
import { askAbandon, resolveNeedsYou } from './card-actions.ts';
import { writeState } from './item-actions.tsx';
import { kind } from '../buttons/button-kinds.tsx';

const LABELS: Record<NeedsYouOffer, string> = {
  'start-again': 'Start again', 'back-to-queue': 'Back to Queue', 'back-to-list': 'Back to List',
  'reopen-pr': 'Reopen PR', 'replace-pr': 'Start a replacement build', 'set-aside': 'Set aside', 'reopen-work': 'Reopen the work',
};

export function NeedsYou({ item, data }: { item: Item; data: BoardData }) {
  const action = useItemAction(item.id);
  if (!item.needsYou) return null;
  const state = writeState(data, action);
  return (
    <div className="grid gap-2 rounded-xl border border-[color-mix(in_srgb,var(--warning)_35%,transparent)] bg-(--warning-surface) px-3 py-2.5" data-needs-you-reason>
      <p className="m-0 font-medium text-(--warning-foreground)">Needs you: {item.needsYou.reason}</p>
      <span className="flex flex-wrap gap-1.5">
        {item.needsYou.offers.map((offer) => (
          <Button {...kind('other')} key={offer} {...state} disabled={state.disabled || item.needsYou?.deletedThread} aria-label={`${LABELS[offer]}: ${itemName(item)}`}
            {...offer === 'set-aside' ? { 'data-abandon': item.id, onClick: () => askAbandon(item.id) }
              : { 'data-needs-you': item.id, onClick: () => void resolveNeedsYou(item.id, offer) }}>{LABELS[offer]}</Button>
        ))}
        {!item.needsYou.deletedThread && <Button {...kind('other')} {...state} data-needs-you={item.id} aria-label={`Clear Needs you on ${itemName(item)}`}
          onClick={() => void resolveNeedsYou(item.id, 'clear')}>Clear</Button>}
      </span>
    </div>
  );
}
