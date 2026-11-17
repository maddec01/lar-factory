import { currentBuildThread, type BoardData, type Item } from '@lar-factory/shared';
import { Alert, Button, Inline } from '@lar-works/design-system';
import { useState } from 'react';

import { writeState } from './ActionAvailability';
import { OpenThread } from './OpenThread';
import { postAction, receive } from '@/services/board/board.service';
import { buttonKind } from '@/ui/board';

/** The decision applies only to comments on this card; the server rereads unresolved threads before dispatch. */
export function PrFeedback({ item, data }: { item: Item; data: BoardData }) {
    const [pending, setPending] = useState<'address' | 'dismiss' | null>(null);
    const [error, setError] = useState<string>();
    const comments = item.linkedPrs[0]?.review?.comments ?? [];
    const choose = async (action: 'address' | 'dismiss') => {
        if (pending) return;

        setPending(action);
        setError(undefined);

        const result = await postAction('/api/pr-feedback', {
            itemId: item.id,
            action,
            events: comments.map((c) => c.id),
        });

        receive(result);
        setError(result.error ?? undefined);
        setPending(null);
    };

    return (
        <Inline space="tight" align="center">
            <Button
                {...buttonKind('open')}
                {...writeState(data)}
                busy={pending === 'address'}
                aria-disabled={!!pending || undefined}
                onClick={() => void choose('address')}
            >
                {pending === 'address' ? 'Sending…' : 'Address it'}
            </Button>
            <OpenThread item={item} data={data} threadId={currentBuildThread(item)?.id} label="Open thread" iconOnly />
            <Button
                {...buttonKind('open')}
                {...writeState(data)}
                busy={pending === 'dismiss'}
                aria-disabled={!!pending || undefined}
                onClick={() => void choose('dismiss')}
            >
                {pending === 'dismiss' ? 'Dismissing…' : 'Dismiss'}
            </Button>
            {error && <Alert tone="warning">{error}</Alert>}
        </Inline>
    );
}
