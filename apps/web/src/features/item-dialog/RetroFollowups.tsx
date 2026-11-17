import { retroWaits, type Item } from '@lar-factory/shared';
import { Disclosure } from '@lar-works/design-system';
import { useState } from 'react';
import { flushSync } from 'react-dom';

import { showToast } from '@/features/notices';
import { postAction, receive } from '@/services/board/board.service';
import { RetroChoices } from '@/ui/board';

/** The pre-merge pick lives in details; the desk only opens it. A refused pick or failed follow-up is a toast. */
export function RetroFollowups({ item }: { item: Item }) {
    const [selected, setSelected] = useState<number[]>([]);
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

    if (!item.retro || !retroWaits(item.retro, item.status)) return null;

    return (
        <Disclosure
            label={`Choose follow-ups · ${item.retro.suggestions?.length ?? 0}`}
            presentation="section"
            defaultOpen
        >
            <RetroChoices
                retro={item.retro}
                selected={selected}
                pending={pending}
                onToggle={(index) =>
                    setSelected((current) =>
                        current.includes(index) ? current.filter((n) => n !== index) : [...current, index],
                    )
                }
                onChoose={(choice) => void choose(choice)}
            />
        </Disclosure>
    );
}
