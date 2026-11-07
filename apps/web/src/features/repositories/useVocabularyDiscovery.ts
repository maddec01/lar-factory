import type { VocabularyDiscovery } from '@lar-factory/shared/vocabulary';
import { useEffect, useState } from 'react';

import { useEditStore } from './EditStore';
import { postAction } from '@/services/board/board.service';

/** Discovery stays read-only; suggestions never become a mapping until the user chooses them. A label change reads it again. */
export function useVocabularyDiscovery(repo: string, onboarding = false) {
    const labelChanges = useEditStore((s) => s.labelChanges);
    const [read, setRead] = useState<{ repo: string; discovery: VocabularyDiscovery } | null>(null);
    const discovery = read?.repo === repo ? read.discovery : null;
    const [attempt, retry] = useState(0);
    // Why the read failed, for the read it answers; a newer read shows no error until it fails too.
    const request = JSON.stringify([repo, onboarding, attempt, labelChanges]);
    const [failure, setFailure] = useState<{ request: string; error: string } | null>(null);
    const error = failure?.request === request ? failure.error : null;

    useEffect(() => {
        const read = new AbortController();

        void postAction<{ discovery: VocabularyDiscovery }>(
            onboarding ? '/api/onboarding/vocabulary' : '/api/repositories/settings',
            onboarding ? { repo } : { repo, change: 'discover-vocabulary' },
        ).then((result) => {
            if (read.signal.aborted) return;

            if (result.error || !result.discovery)
                setFailure({ request, error: result.error ?? 'The board sent no vocabulary.' });
            else setRead({ repo, discovery: result.discovery });
        });

        return () => read.abort();
    }, [repo, onboarding, attempt, labelChanges, request]);

    return { discovery, error, retry: () => retry((n) => n + 1) };
}
