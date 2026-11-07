import type { ItemChecks } from '@lar-factory/shared';
import { CheckRun, ChecksDisclosure, Text } from '@lar-works/design-system';
import { useRef, useState } from 'react';

/** One read per mounted section; collapsing and board refreshes keep its result. */
export function ItemChecksSection({ itemId }: { itemId: string }) {
    const requested = useRef(false);
    const [record, setRecord] = useState<ItemChecks | null>(null);
    const [error, setError] = useState<string | null>(null);

    async function read() {
        if (requested.current) return;

        requested.current = true;

        try {
            const response = await fetch(`/api/item-checks?itemId=${encodeURIComponent(itemId)}`, {
                cache: 'no-store',
            });
            const body = (await response.json()) as { checks?: ItemChecks; error?: string };

            if (!response.ok || !body.checks) throw new Error(body.error ?? 'The board did not return checks.');

            setRecord(body.checks);
        } catch (error) {
            setError(error instanceof Error ? error.message : 'Could not read checks.');
        }
    }

    return (
        <ChecksDisclosure summary="Checks" onOpen={() => void read()} data-checks>
            {error ? (
                <Text variant="inherit" role="alert">
                    Could not load checks: {error}
                </Text>
            ) : !record ? (
                <Text variant="inherit" role="status">
                    Loading checks…
                </Text>
            ) : (
                <>
                    {record.runs.length === 0 && <Text variant="inherit">No checks are recorded.</Text>}
                    {record.runs.map((run) => (
                        <CheckRun key={run.checkId} command={run.command.map((arg) => JSON.stringify(arg)).join(' ')}>
                            <Text variant="inherit">
                                {run.folder} · {run.outcome} · Run by {run.role}
                                {run.reason ? `: ${run.reason}` : ''}
                            </Text>
                            {run.outcome === 'passed' && !run.eligible && (
                                <Text variant="inherit">
                                    Ineligible as passing evidence: {run.snapshotState} snapshot.
                                </Text>
                            )}
                            {record.reuses
                                .filter((reuse) => reuse.checkId === run.checkId)
                                .map((reuse, index) => (
                                    <Text variant="inherit" key={index}>
                                        Reused by {reuse.role}: {reuse.reason}
                                    </Text>
                                ))}
                            {run.failureState === 'open' && (
                                <div>
                                    <Text variant="inherit">Open failure</Text>
                                    {run.failure ? (
                                        <>
                                            <ul>
                                                {run.failure.tests.map((name) => (
                                                    <li key={name}>{name}</li>
                                                ))}
                                            </ul>
                                            <Text variant="inherit">{run.failure.diagnosis}</Text>
                                        </>
                                    ) : (
                                        <Text variant="inherit">No failure names recorded.</Text>
                                    )}
                                </div>
                            )}
                        </CheckRun>
                    ))}
                </>
            )}
        </ChecksDisclosure>
    );
}
