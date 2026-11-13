import { retroWaits, type Item } from '@lar-factory/shared';
import { Disclosure } from '@lar-works/design-system';
import { useState } from 'react';

import { postAction, receive } from '@/services/board/board.service';
import { RetroChoices } from '@/ui/board';

/** The post-merge choice lives in details; the desk only opens it. */
export function RetroFollowups({ item }: { item: Item }) {
    const [selected, setSelected] = useState<number[]>([]);
    const [pending, setPending] = useState(false);
    const [error, setError] = useState<string | null>(null);
    const submit = async (selection?: number[]) => {
        if (pending) return;

        setPending(true);

        const answer = await postAction(selection ? '/api/choose-retro' : '/api/retry-retro', {
            itemId: item.id,
            revision: item.revision,
            selected: selection,
        });

        receive(answer);
        setError(answer.error);
        setPending(false);
    };

    if (!item.retro || !retroWaits(item.retro)) return null;

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
                error={error}
                onToggle={(index) =>
                    setSelected((current) =>
                        current.includes(index) ? current.filter((n) => n !== index) : [...current, index],
                    )
                }
                onChoose={(choice) => void submit(choice)}
                onRetry={() => void submit()}
            />
        </Disclosure>
    );
}
