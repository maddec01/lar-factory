// The item dialog's label edit: opening the picker reads the tracker's labels, as the tracker holds the only list, and
// each toggle writes one label through the board. The row changes from the board the write answers with, so a failed
// write leaves it as it was and keeps its error. One write runs at a time, as an Azure write fails if another changed
// the work item since its read.

import { sameLabel } from '@lar-factory/shared';
import type { Item } from '@lar-factory/shared';
import type { LabelChoice } from '@lar-works/design-system';
import { useCallback, useRef, useState } from 'react';

import { postAction, receive } from '@/services/board/board.service';
import { readItemLabels } from '@/services/items/items.service';

export function useLabelEdit(item: Pick<Item, 'id' | 'labels'>) {
    const [choices, setChoices] = useState<LabelChoice[] | null>(null);
    const [error, setError] = useState<string | null>(null);
    const [saving, setSaving] = useState(false);
    /** Set at once, so a second toggle before the render that follows the first still waits. */
    const writing = useRef(false);
    const itemId = item.id;
    const read = useCallback(async () => {
        setChoices(null);
        setError(null);

        const labels = await readItemLabels(itemId);

        if (typeof labels === 'string') setError(labels);
        else setChoices(labels.map(({ color, ...label }) => ({ ...label, ...(color && { color: `#${color}` }) })));
    }, [itemId]);
    const toggle = async (label: string) => {
        if (writing.current) return;

        writing.current = true;
        setSaving(true);
        setError(null);

        const result = await postAction('/api/item-labels', {
            itemId,
            label,
            action: item.labels.some((name) => sameLabel(name, label)) ? 'remove' : 'add',
        });

        if (result.error) setError(result.error);
        else receive(result);

        writing.current = false;
        setSaving(false);
    };

    return { choices, error, saving, read, toggle };
}
