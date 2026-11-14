// The item dialog's Kind control, and what the last kind change did.

import { SWAP_KINDS, kindCanChange } from '@lar-factory/shared';
import type { Item, SwapKind } from '@lar-factory/shared';
import { Alert, Button, OptionSelect, Text } from '@lar-works/design-system';
import { useEffect, useRef, type ReactNode } from 'react';

import { OPEN_ITEM_DIALOG } from './ItemDialogStore';
import { useKindChangeStore } from './KindChangeStore';
import { KIND_BADGES } from '@/features/items';
import { SAMPLE_READ_ONLY } from '@/services/board/board.service';
import { buttonKind, ChangeFailed } from '@/ui/board';

// Each kind's icon and name without its hue: the dialog marks kind without colour, as the board does.
const KIND_CHOICES = SWAP_KINDS.map((value) => {
    const { name, icon: Icon } = KIND_BADGES[value]!;

    return { value, label: name, icon: <Icon aria-hidden="true" /> };
});

/**
 * The control that changes an ordinary item's kind, and what the last change did: the line it answered with, or why it stopped,
 * what it changed on the ticket before that, and Retry for the same change. Concepts, decisions and builds don't have it.
 * A write disables this control and takes away the button that answered, which drops focus to the page or the dialog, so it comes
 * back here when the write ends. A control the user has moved to since keeps it.
 */
export function ItemKindControl({ item, fallback }: { item: Item; fallback: ReactNode }) {
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

    if (item.setAside || !kindCanChange(item.kind)) return fallback;

    return (
        <span data-kind-control>
            {/* An inline select, its icon and word in the text colour, as the board marks kind without colour. */}
            <OptionSelect
                presentation="inline"
                ref={control}
                writesOnPick
                label="Kind"
                placeholder="No kind"
                value={item.kind === 'issue' ? '' : item.kind}
                options={KIND_CHOICES}
                disabled={change?.saving}
                onChange={(kind) => void start(item.id, kind as SwapKind)}
            />
        </span>
    );
}

export function ItemKindFeedback({ item }: { item: Item }) {
    const change = useKindChangeStore((state) => state.changes[item.id]);
    const { start } = useKindChangeStore.getState();

    return (
        <>
            {change?.error === SAMPLE_READ_ONLY ? (
                <Alert size="sm" tone="warning" message={SAMPLE_READ_ONLY} />
            ) : change?.error ? (
                <ChangeFailed
                    data-kind-change-failed
                    lines={[
                        change.error,
                        change.line ? `Changed on the ticket so far: ${change.line}` : 'Nothing changed on the ticket.',
                    ]}
                    action={
                        // A sample board refuses every write, so trying again would only refuse again.
                        change.error !== SAMPLE_READ_ONLY && (
                            <Button
                                {...buttonKind('other')}
                                loading={change.saving}
                                onClick={() => void start(item.id, change.kind)}
                            >
                                Try again
                            </Button>
                        )
                    }
                />
            ) : (
                change?.line && (
                    <Text variant="caption" tone="muted" role="status" ownLine data-kind-change-line>
                        {change.line}
                    </Text>
                )
            )}
        </>
    );
}
