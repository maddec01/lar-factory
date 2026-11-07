import type { TrackerLabel } from '@lar-factory/shared';
import { useEffect, useState } from 'react';

import { postAction } from '@/services/board/board.service';

/** The tracker's labels by name, read again by `retry` while the last read stays on screen. */
export function useTrackerLabels(repo: string) {
    const [labels, setLabels] = useState<TrackerLabel[] | null>(null);
    const [error, setError] = useState<string | null>(null);
    const [attempt, setAttempt] = useState(0);

    useEffect(() => {
        let current = true;

        void postAction<{ labels: TrackerLabel[] }>('/api/repositories/labels', { repo, change: 'list' }).then(
            (result) => {
                if (!current) return;

                setError(result.error ?? (result.labels ? null : 'The board sent no labels.'));
                setLabels(result.labels ? [...result.labels].sort((a, b) => a.name.localeCompare(b.name)) : null);
            },
        );

        return () => {
            current = false;
        };
    }, [repo, attempt]);

    return { labels, error, retry: () => setAttempt((n) => n + 1) };
}
