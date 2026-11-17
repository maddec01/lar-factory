import type { Item } from '@lar-factory/shared';
import { useState } from 'react';
import { flushSync } from 'react-dom';

import { showToast } from '@/features/notices';
import { postAction, receive } from '@/services/board/board.service';

/** The same saved pick powers selection in details and one-click dismissal on the desk. */
export function useRetroChoice(item: Item) {
    const [pending, setPending] = useState(false);
    const choose = async (selection: number[]) => {
        if (pending) return;

        setPending(true);

        const answer = await postAction('/api/choose-retro', {
            itemId: item.id,
            revision: item.revision,
            selected: selection,
        });

        flushSync(() => {
            receive(answer);
            setPending(false);

            if (answer.error)
                showToast({
                    slot: `retro-${item.id}`,
                    failed: true,
                    what: 'Follow-ups',
                    body: (
                        <>
                            <b>Follow-ups</b> {answer.error}
                        </>
                    ),
                });
        });
    };

    return { pending, choose };
}
