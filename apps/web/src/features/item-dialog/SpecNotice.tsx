// A Spec's sync notice in the item dialog: why the ticket's Spec waits or failed to save, and the held GitHub edit to
// accept or reject, with Retry.

import type { ItemDetails } from '@lar-factory/shared';
import { Button, Disclosure, Heading, Inline, RichText } from '@lar-works/design-system';
import { useState } from 'react';

import { postAction } from '@/services/board/board.service';
import { forgetItemDetails } from '@/services/items/items.hooks';
import { buttonKind, SpecSync } from '@/ui/board';

export function SpecNotice({
    itemId,
    spec,
    refresh,
}: {
    itemId: string;
    spec: NonNullable<ItemDetails['spec']>;
    refresh: () => Promise<boolean>;
}) {
    const [busy, setBusy] = useState(false);
    const [error, setError] = useState<string | null>(null);
    const act = async (action: 'retry' | 'accept' | 'reject') => {
        setBusy(true);
        setError(null);

        const result = await postAction('/api/item-spec', { itemId, generation: spec.generation, action });

        if (result.error) setError(result.error);
        else {
            forgetItemDetails(itemId);

            if (!(await refresh())) setError('Couldn’t reload the Spec. Reopen the item to read it.');
        }

        setBusy(false);
    };

    return (
        <SpecSync
            status={
                spec.outdated || spec.error || spec.warning || spec.pending
                    ? spec.outdated
                        ? 'The brief changed. The ticket keeps the last approved Spec until you approve the new brief.'
                        : (spec.warning ?? spec.error ?? 'The Spec is waiting to save to the tracker.')
                    : undefined
            }
            error={error}
        >
            {spec.held ? (
                <>
                    <Disclosure label="Review held GitHub edit" presentation="section">
                        <Heading as="h3" variant="title">
                            {spec.held.title}
                        </Heading>
                        <RichText text={spec.held.body} format="markdown" />
                    </Disclosure>
                    <Inline as="span">
                        <Button {...buttonKind('other')} disabled={busy} onClick={() => void act('accept')}>
                            Accept edit
                        </Button>
                        <Button {...buttonKind('other')} disabled={busy} onClick={() => void act('reject')}>
                            Reject edit
                        </Button>
                    </Inline>
                </>
            ) : (
                (spec.pending || spec.error) && (
                    <Button {...buttonKind('other')} loading={busy} onClick={() => void act('retry')}>
                        Retry Spec sync
                    </Button>
                )
            )}
        </SpecSync>
    );
}
