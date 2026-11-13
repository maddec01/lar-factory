import type { Item } from '@lar-factory/shared';
import { Button } from '@lar-works/design-system';
import { useEffect, useState } from 'react';

import { postAction, receive } from '@/services/board/board.service';
import { VerifyResult, VerifyEvidence, buttonKind } from '@/ui/board';

interface Context {
    pr: string;
    head: string;
    testSteps: string;
    revision: number;
    by: string;
}

export function VerifyBuild({ item }: { item: Item }) {
    const [inspected, setInspected] = useState<{ request: string; context?: Context }>();
    const [attempt, setAttempt] = useState(0);
    const [pending, setPending] = useState(false);
    const [note, setNote] = useState('');
    const [error, setError] = useState<string | null>();
    const awaiting = item.status === 'Verify' && !!item.verification?.required;
    const currentHead = item.linkedPrs[0]?.sourceRevision;

    const request = JSON.stringify([item.id, currentHead, attempt]);
    const loading = awaiting && inspected?.request !== request;
    const context = !loading ? inspected?.context : undefined;

    useEffect(() => {
        if (!awaiting) return;

        const controller = new AbortController();

        void postAction<{ verification: Context }>('/api/inspect-verification', { itemId: item.id }).then((result) => {
            if (controller.signal.aborted) return;

            receive(result);
            setInspected({ request, context: result.verification });
            setError(result.error);
        });

        return () => {
            controller.abort();
        };
    }, [item.id, awaiting, request]);

    const submit = async (result: 'pass' | 'fail') => {
        if (!context || pending) return;

        setPending(true);

        const answer = await postAction('/api/record-verification', {
            itemId: item.id,
            ...context,
            result,
            note: result === 'fail' ? note : '',
        });

        receive(answer);
        setError(answer.error);
        setPending(false);

        if (!answer.error) setNote('');
    };

    if (!item.verification?.required) return null;

    const latest = item.verification.latest;
    const resume = item.verification.resume;

    if (!awaiting)
        return (
            <>
                {latest && (
                    <VerifyEvidence>
                        {latest.result === 'pass' ? 'Passed' : 'Failed'} by {latest.by} at{' '}
                        {new Date(latest.at).toLocaleString()} · Tested head {latest.head.slice(0, 7)}
                        {latest.result === 'fail' && latest.note ? ` · Failed: ${latest.note}` : ''}
                    </VerifyEvidence>
                )}
                {resume && !resume.sent && (
                    <>
                        <VerifyEvidence>
                            {resume.error ?? 'Fix request is waiting to be sent to the same build thread.'}
                        </VerifyEvidence>
                        <Button
                            {...buttonKind('next')}
                            disabled={pending}
                            onClick={() => {
                                setPending(true);
                                void postAction('/api/retry-verification', { itemId: item.id }).then((answer) => {
                                    receive(answer);
                                    setError(answer.error);
                                    setPending(false);
                                });
                            }}
                        >
                            Retry build fix request
                        </Button>
                        {error && <VerifyEvidence>{error}</VerifyEvidence>}
                    </>
                )}
            </>
        );

    return (
        <VerifyResult
            head={context?.head}
            testSteps={context?.testSteps}
            loading={loading}
            pending={pending}
            error={error}
            note={note}
            onNote={setNote}
            onRefresh={() => setAttempt(attempt + 1)}
            onResult={(result) => void submit(result)}
        />
    );
}
