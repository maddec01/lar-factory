// The item dialog's Kind control, and what the last kind change did.

import { SWAP_KINDS, kindCanChange } from '@lar-factory/shared';
import type { Item, SwapKind } from '@lar-factory/shared';
import { BoardNote, Button, buttonKind, ChangeFailed, DetailFact as Fact, FormSelect } from '@lar-works/design-system';
import { useEffect, useRef } from 'react';

import { OPEN_ITEM_DIALOG } from './ItemDialogStore';
import { useKindChangeStore } from './KindChangeStore';
import { KIND_BADGES } from '@/features/items';

const KIND_CHOICES = SWAP_KINDS.map((value) => {
    const { name, icon: Icon } = KIND_BADGES[value]!;

    return { value, name, icon: <Icon aria-hidden="true" /> };
});

/**
 * The control that changes an ordinary item's kind, and what the last change did: the line it answered with, or why it stopped,
 * what it changed on the ticket before that, and Retry for the same change. Concepts, decisions and builds don't have it.
 * A write disables this control and takes away the button that answered, which drops focus to the page or the dialog, so it comes
 * back here when the write ends. A control the user has moved to since keeps it.
 */
export function ItemKindControl({ item }: { item: Item }) {
    const change = useKindChangeStore((state) => state.changes[item.id]);
    const saving = useKindChangeStore((state) =>
        Boolean(state.changes[item.id]?.saving || state.answers[item.id]?.saving),
    );
    const control = useRef<HTMLButtonElement>(null);
    const wasSaving = useRef(false);

    useEffect(() => {
        if (
            wasSaving.current &&
            !saving &&
            (document.activeElement === document.body || document.activeElement?.matches(OPEN_ITEM_DIALOG))
        )
            control.current?.focus();

        wasSaving.current = saving;
    }, [saving]);

    const { start } = useKindChangeStore.getState();

    if (!kindCanChange(item.kind)) return null;

    return (
        <>
            <Fact label="Kind">
                <FormSelect
                    presentation="setting"
                    ref={control}
                    writesOnPick
                    aria-label="Kind"
                    placeholder="No kind"
                    value={item.kind === 'issue' ? '' : item.kind}
                    choices={KIND_CHOICES}
                    disabled={change?.saving}
                    onChange={(kind) => void start(item.id, kind as SwapKind)}
                />
            </Fact>
            {change?.error ? (
                <ChangeFailed
                    data-kind-change-failed
                    lines={[
                        change.error,
                        change.line ? `Changed on the ticket so far: ${change.line}` : 'Nothing changed on the ticket.',
                    ]}
                    action={
                        <Button
                            {...buttonKind('other')}
                            loading={change.saving}
                            onClick={() => void start(item.id, change.kind)}
                        >
                            Retry
                        </Button>
                    }
                />
            ) : (
                change?.line && (
                    <BoardNote role="status" ownLine data-kind-change-line>
                        {change.line}
                    </BoardNote>
                )
            )}
        </>
    );
}
