import { pendingPedroReleaseStep, type Item } from '@lar-factory/shared';
import { useState } from 'react';

import { postAction, receive } from '@/services/board/board.service';
import { ReleaseStepForm } from '@/ui/board';

/** Only the first pending human step can be completed, with evidence on its current parent revision. */
export function CompleteReleaseStep({ item }: { item: Item }) {
    const step = pendingPedroReleaseStep(item.releasePlan);
    const [evidence, setEvidence] = useState('');
    const [pending, setPending] = useState(false);
    const [error, setError] = useState<string | null>();

    if (!step) return null;

    const complete = async () => {
        setPending(true);

        const result = await postAction('/api/complete-release-step', {
            itemId: item.id,
            revision: item.revision,
            stepId: step.id,
            evidence,
        });

        receive(result);
        setError(result.error);
        setPending(false);

        if (!result.error) setEvidence('');
    };

    return (
        <ReleaseStepForm
            what={step.what}
            evidence={evidence}
            onEvidence={setEvidence}
            onComplete={() => void complete()}
            pending={pending}
            error={error}
        />
    );
}
