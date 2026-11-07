import { writeHeaders, type Item, type LinkedPr } from '@lar-factory/shared';
import { Button, buttonKind, PullRequestReadiness, ReadinessDetails } from '@lar-works/design-system';
import { useEffect, useId, useRef, useState } from 'react';

import { useBoardStore } from '@/services/board/board.hooks';

type Evidence =
    | { available: true; sourceRevision: string; observedAt: string; blockers: string[] }
    | { available: false; reason: string };

function blockerLabel(blocker: string): string {
    const [kind, ...parts] = blocker.split(':');
    const state = parts.pop() ?? 'unknown';
    const name = parts.join(':');

    if (kind === 'reviewer') {
        const vote =
            (
                {
                    '-10': 'rejected the pull request',
                    '-5': 'requested changes',
                    '0': 'has not approved',
                    '5': 'approved with suggestions',
                    '10': 'approved',
                } as Record<string, string>
            )[state] ?? 'has an unknown vote';

        return `Reviewer ${name}: ${vote}. Check reviewer requirements in Azure.`;
    }

    if (kind === 'policy') return `Required policy ${name}: ${state}. Check the policy in Azure.`;

    if (kind === 'status') return `Check ${name}: ${state}.`;

    return blocker;
}

export function PrReadiness({ item, pr }: { item: Item; pr: LinkedPr }) {
    const detailsId = useId();
    const [open, setOpen] = useState(false);
    const [attempt, setAttempt] = useState(0);
    const [evidence, setEvidence] = useState<Evidence>();
    // The request the evidence on show answers; any other request leaves it stale until its own answer.
    const [answered, setAnswered] = useState<string>();
    const sequence = useRef(0);
    const disconnected = useBoardStore(
        (s) => s.clientError || s.data.itemSourceProblems?.find((p) => p.repo === item.repo)?.problem,
    );
    const key = JSON.stringify([
        item.id,
        pr.number,
        pr.url,
        pr.sourceRevision,
        pr.state,
        pr.isDraft,
        pr.mergeState,
        pr.checks?.passed,
        pr.checks?.failed,
        pr.checks?.running,
        pr.checks?.total,
        pr.checks?.since,
        attempt,
    ]);
    const request = JSON.stringify([key, open, !!disconnected]);
    const stale = answered !== request;

    useEffect(() => {
        const sent = ++sequence.current;

        if (!open || disconnected) return;

        const controller = new AbortController();

        void fetch('/api/pr-readiness', {
            method: 'POST',
            headers: writeHeaders(),
            body: JSON.stringify({ itemId: item.id, number: pr.number }),
            signal: controller.signal,
        })
            .then(async (response) => {
                if (!response.ok) throw new Error('Azure evidence is unavailable. Refresh to try again.');

                return response.json() as Promise<{ evidence: Evidence }>;
            })
            .then(({ evidence: next }) => {
                if (sequence.current === sent) {
                    setEvidence(next);
                    setAnswered(request);
                }
            })
            .catch(() => {
                if (sequence.current === sent) {
                    setEvidence({ available: false, reason: 'Azure evidence is unavailable. Refresh to try again.' });
                    setAnswered(request);
                }
            });

        return () => {
            ++sequence.current;
            controller.abort();
        };
    }, [open, item.id, pr.number, disconnected, key, request]);

    if (!item.azure) return null;

    return (
        <PullRequestReadiness
            toggle={
                <Button
                    {...buttonKind('other')}
                    aria-expanded={open}
                    aria-controls={detailsId}
                    onClick={() => {
                        // A new attempt, so a reopened panel reads afresh.
                        setAttempt((n) => n + 1);
                        setOpen(!open);
                    }}
                >
                    Readiness details
                </Button>
            }
            details={
                open && (
                    <ReadinessDetails
                        id={detailsId}
                        status={
                            disconnected
                                ? 'Readiness unavailable: disconnected.'
                                : stale
                                  ? 'Refreshing current revision. Previous evidence is stale.'
                                  : evidence?.available
                                    ? pr.sourceRevision && evidence.sourceRevision !== pr.sourceRevision
                                        ? 'Source revision changed. Refresh readiness.'
                                        : pr.isDraft || pr.state !== 'open' || evidence.blockers.length
                                          ? 'Readiness blocked.'
                                          : 'Ready to merge based on this observation.'
                                    : evidence?.reason
                        }
                        observed={
                            evidence?.available && (
                                <>
                                    Observed <time dateTime={evidence.observedAt}>{evidence.observedAt}</time> ·
                                    revision {evidence.sourceRevision}
                                </>
                            )
                        }
                        blockers={evidence?.available ? evidence.blockers.map(blockerLabel) : []}
                        note="T3 Azure PR context is unsupported; evidence comes from Azure."
                        refresh={
                            <Button {...buttonKind('other')} onClick={() => setAttempt((n) => n + 1)}>
                                Refresh readiness
                            </Button>
                        }
                    />
                )
            }
        />
    );
}
