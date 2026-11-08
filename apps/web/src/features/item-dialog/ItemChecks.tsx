import type { ItemChecks } from '@lar-factory/shared';
import { EmptyState, Disclosure, Stack, Text, PageError, Loading } from '@lar-works/design-system';
import { useRef, useState } from 'react';

import { readItemChecks } from '@/services/items/items.service';
import { CheckRun } from '@/ui/board';

/** One read per mounted section; collapsing and board refreshes keep its result. */
export function ItemChecksSection({ itemId }: { itemId: string }) {
    const requested = useRef(false);
    const [record, setRecord] = useState<ItemChecks | null>(null);
    const [error, setError] = useState<string | null>(null);

    async function read() {
        if (requested.current) return;

        requested.current = true;

        setError(null);

        try {
            setRecord(await readItemChecks(itemId));
        } catch (error) {
            requested.current = false;
            setError(error instanceof Error ? error.message : 'Couldn’t read checks.');
        }
    }

    return (
        <Disclosure
            presentation="section"
            label="Checks"
            onOpenChange={(open) => {
                if (open) void read();
            }}
            data-checks=""
        >
            <Stack space="group">
                {error ? (
                    <Stack role="alert">
                        <PageError
                            size="inline"
                            title="Couldn’t load checks"
                            description={error}
                            primaryAction={{ label: 'Try again', onAction: () => void read() }}
                        />
                    </Stack>
                ) : !record ? (
                    <Loading presentation="status" label="Loading checks…" />
                ) : (
                    <>
                        {record.runs.length === 0 && <EmptyState size="inline" title="No checks are recorded." />}
                        {record.runs.map((run) => (
                            <CheckRun
                                key={run.checkId}
                                command={run.command.map((arg) => JSON.stringify(arg)).join(' ')}
                            >
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
            </Stack>
        </Disclosure>
    );
}
