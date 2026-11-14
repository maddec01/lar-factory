import type { Item } from '@lar-factory/shared';
import { Alert, Button } from '@lar-works/design-system';
import { useState } from 'react';

import { canStopShaping } from './can-stop-shaping';
import { postAction, receive } from '@/services/board/board.service';
import { buttonKind } from '@/ui/board';

export function StopShaping({ item }: { item: Item }) {
    const [pending, setPending] = useState(false);
    const [error, setError] = useState<string | null>(null);

    if (!canStopShaping(item)) return null;

    const stop = async () => {
        setPending(true);

        const result = await postAction('/api/stop-shaping', { itemId: item.id });

        receive(result);
        setError(result.error);
        setPending(false);
    };

    return (
        <>
            {error && <Alert tone="danger">{error}</Alert>}
            <Button {...buttonKind('other')} disabled={pending} onClick={() => void stop()}>
                Stop
            </Button>
        </>
    );
}
