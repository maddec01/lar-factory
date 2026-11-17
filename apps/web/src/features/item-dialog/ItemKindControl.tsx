// The item dialog's Kind control, and what the last kind change did.

import { SWAP_KINDS, kindCanChange, visibleKind } from '@lar-factory/shared';
import type { Item, SwapKind } from '@lar-factory/shared';
import { Alert, OptionSelect, Text } from '@lar-works/design-system';
import { useEffect, useRef, type ReactNode } from 'react';

import { OPEN_ITEM_DIALOG } from './ItemDialogStore';
import { useKindChangeStore } from './KindChangeStore';
import { KIND_BADGES } from '@/features/items';
import { SAMPLE_READ_ONLY } from '@/services/board/board.service';
import { ChangeFailed, RetryAction } from '@/ui/board';

// Each kind's icon, name and hue: the dialog marks kind in its colour, as the board and Add item do.
const KIND_CHOICES = SWAP_KINDS.map((value) => {
    const { name, icon: Icon, hue } = KIND_BADGES[value]!;

    return { value, label: name, icon: <Icon aria-hidden="true" />, hue };
});

/**
 * The control that changes an ordinary item's kind, and what the last change did: the line it answered with, or why it stopped,
 * what it changed on the ticket before that, and Retry for the same change. Builds with a retained Kind keep it;
 * concepts, decisions and unclassified builds have no control.
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

    if (item.setAside || !kindCanChange(visibleKind(item))) return fallback;

    return (
        <span data-kind-control>
            {/* An inline select, its icon and word in the text colour, as the board marks kind without colour. */}
            <OptionSelect
                presentation="inline"
                ref={control}
                writesOnPick
                label="Kind"
                placeholder="No kind"
                value={visibleKind(item) === 'issue' ? '' : visibleKind(item)}
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
                            <RetryAction busy={change.saving} onRetry={() => void start(item.id, change.kind)} />
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
