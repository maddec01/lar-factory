// Attach a ticket, in the item dialog of captured work that has none: the ticket picker for the item's repository.
// The work keeps its work ID, and its ticket then adds the ticket's link and context.

import type { Item } from '@lar-factory/shared';
import { Button } from '@lar-works/design-system';
import { useState } from 'react';

import { TicketPicker } from '@/features/add-item';
import { useBoardStore } from '@/services/board/board.hooks';
import { postAction, receive } from '@/services/board/board.service';
import { buttonKind, SummaryPanel } from '@/ui/board';

export function AttachTicket({ item }: { item: Item }) {
    const [open, setOpen] = useState(false);
    const enabled = useBoardStore((state) => state.data.capture?.enabled !== false);

    if (item.number || !item.repo || !enabled) return null;

    if (!open)
        return (
            <Button
                // A quiet control, as the sidebar's other properties are values, not calls to act.
                {...buttonKind('control')}
                data-attach-ticket={item.id}
                title="Attach an existing ticket"
                onClick={() => setOpen(true)}
            >
                Attach
            </Button>
        );

    const attach = async (number: number) => {
        const result = await postAction('/api/attach-ticket', { itemId: item.id, number });

        receive(result);

        return result.error;
    };

    return (
        <SummaryPanel label="Attach a ticket">
            <TicketPicker id="attach" repo={item.repo} onPick={(ticket) => attach(ticket.number)} />
        </SummaryPanel>
    );
}
