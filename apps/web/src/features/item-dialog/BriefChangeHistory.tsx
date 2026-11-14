import type { BriefChangeRequest } from '@lar-factory/shared';
import { Alert, Button, Stack, Text } from '@lar-works/design-system';
import { useState } from 'react';

import { postAction, receive } from '@/services/board/board.service';
import { buttonKind, DetailFact, FactList } from '@/ui/board';

export function BriefChangeHistory({
    itemId,
    requests,
    refresh,
}: {
    itemId: string;
    requests: BriefChangeRequest[];
    refresh?: () => Promise<unknown>;
}) {
    const [pending, setPending] = useState(false);
    const [error, setError] = useState<string | null>(null);
    const retry = async () => {
        setPending(true);

        const result = await postAction('/api/retry-brief-changes', { itemId });

        receive(result);
        setError(result.error);
        await refresh?.();
        setPending(false);
    };

    return (
        <Stack space="tight">
            <FactList>
                {requests.map((request) => (
                    <DetailFact
                        key={request.requestId}
                        label={`Changes requested by ${request.by} · ${new Date(request.at).toLocaleString()}`}
                    >
                        <Text>{request.note}</Text>
                        <Text variant="caption" tone="muted">
                            {request.delivery.sent
                                ? 'Sent to shaping owner'
                                : (request.delivery.error ?? 'Waiting to send to shaping owner')}
                        </Text>
                    </DetailFact>
                ))}
            </FactList>
            {error && <Alert tone="danger">{error}</Alert>}
            {requests.some((request) => !request.delivery.sent) && (
                <Button {...buttonKind('other')} disabled={pending} onClick={() => void retry()}>
                    Retry change request
                </Button>
            )}
        </Stack>
    );
}
