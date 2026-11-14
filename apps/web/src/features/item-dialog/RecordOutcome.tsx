import { outcomeNeedsPedro, type Item } from '@lar-factory/shared';
import { useState } from 'react';

import { postAction, receive } from '@/services/board/board.service';
import { OutcomeForm, OutcomeFix } from '@/ui/board';

export function RecordOutcome({ item, items }: { item: Item; items: Item[] }) {
    const [evidence, setEvidence] = useState('');
    const [pending, setPending] = useState(false);
    const [error, setError] = useState<string | null>();

    if (!outcomeNeedsPedro(item, items) && !item.outcomeCheck?.run?.fixProposal?.sent) return null;

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

    if (item.releasePlan?.outcomeCheck.result === 'failed')
        return (
            <OutcomeFix
                pending={pending}
                error={error}
                sent={!!item.outcomeCheck?.run?.fixProposal?.sent}
                onPropose={() => {
                    setPending(true);
                    void postAction('/api/propose-outcome-fix', {
                        itemId: item.id,
                        revision: item.revision,
                        inputDigest: item.outcomeCheck!.digest,
                    }).then((reply) => {
                        receive(reply);
                        setError(reply.error);
                        setPending(false);
                    });
                }}
            />
        );

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
