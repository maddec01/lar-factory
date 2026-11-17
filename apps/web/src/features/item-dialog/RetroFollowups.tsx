import { retroWaits, type Item } from '@lar-factory/shared';
import { Disclosure } from '@lar-works/design-system';
import { useState } from 'react';

import { useRetroChoice } from '@/features/items';
import { RetroChoices } from '@/ui/board';

/** The optional pick stays in details after merge; the desk can open or dismiss it. A refused pick or failed follow-up is a toast. */
export function RetroFollowups({ item }: { item: Item }) {
    const [selected, setSelected] = useState<number[]>([]);
    const { pending, choose } = useRetroChoice(item);

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
