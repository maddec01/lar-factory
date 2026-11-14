import { outcomeNeedsPedro, type Item } from '@lar-factory/shared';
import { useState } from 'react';

import { postAction, receive } from '@/services/board/board.service';
import { OutcomeForm } from '@/ui/board';

export function RecordOutcome({ item, items }: { item: Item; items: Item[] }) {
    const [evidence, setEvidence] = useState('');
    const [pending, setPending] = useState(false);
    const [error, setError] = useState<string | null>();

    if (!outcomeNeedsPedro(item, items)) return null;

    const record = async (result: 'passed' | 'failed') => {
        setPending(true);

        const reply = await postAction('/api/record-outcome-check', {
            itemId: item.id,
            revision: item.revision,
            inputDigest: item.outcomeCheck!.digest,
            result,
            evidence,
        });

        receive(reply);
        setError(reply.error);
        setPending(false);

        if (!reply.error) setEvidence('');
    };

    return (
        <OutcomeForm
            evidence={evidence}
            onEvidence={setEvidence}
            pending={pending}
            error={error}
            onResult={(result) => void record(result)}
        />
    );
}
