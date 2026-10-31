// Attach a ticket, in the item dialog of captured work that has none: the ticket picker for the item's repository.
// The work keeps its work ID, and its ticket then adds the ticket's link and context.

import { useState } from 'react';
import type { Item } from '@lar-factory/shared';
import { Button } from '@lar-factory/ui/design-system/Button';
import { useBoardStore } from '../board/board-store.ts';
import { kind } from '../buttons/button-kinds.tsx';
import { TicketPicker } from '../add-item/ticket-picker.tsx';
import { postAction, receive } from '../items/card-actions.ts';

export function AttachTicket({ item }: { item: Item }) {
  const [open, setOpen] = useState(false);
  const enabled = useBoardStore((state) => state.data.capture?.enabled !== false);
  if (item.number || !item.repo || !enabled) return null;
  if (!open) return <Button {...kind('other')} className="justify-self-start" data-attach-ticket={item.id} onClick={() => setOpen(true)}>Attach a ticket</Button>;
  const attach = async (number: number) => {
    const result = await postAction('/api/attach-ticket', { itemId: item.id, number });
    receive(result);
    return result.error;
  };
  return (
    <section aria-label="Attach a ticket" className="grid gap-1.5 pt-1">
      <span className="text-xs font-medium text-base-content">Attach a ticket</span>
      <TicketPicker id="attach" repo={item.repo} onPick={(ticket) => attach(ticket.number)} />
    </section>
  );
}
