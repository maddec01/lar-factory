import type { Item, LinkedPr } from '@lar-factory/shared';
import { Button } from '@lar-works/design-system';
import { useEffect, useId, useRef, useState } from 'react';

import { useBoardStore } from '@/services/board/board.hooks';
import { readPrReadiness, type PrEvidence } from '@/services/items/items.service';
import { buttonKind, PullRequestReadiness, ReadinessDetails } from '@/ui/board';

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
                    '0': 'hasn’t approved',
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
    const [evidence, setEvidence] = useState<PrEvidence>();
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

        void readPrReadiness(item.id, pr.number, controller.signal).then(
            (next) => {
                if (sequence.current === sent && !controller.signal.aborted) {
                    setEvidence(next);
                    setAnswered(request);
                }
            },
            // Only an abort rejects, once the request has moved on.
            () => {},
        );

        return () => {
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
