import type { ItemChecks } from '@lar-factory/shared';
import { EmptyState, Disclosure, Stack, Text, Loading } from '@lar-works/design-system';
import { useRef, useState } from 'react';

import { checkCommands } from './check-list';
import { readItemChecks } from '@/services/items/items.service';
import { CheckRun, LoadFailed, MetaLine } from '@/ui/board';

type Run = ItemChecks['runs'][number];

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
            setError(error instanceof Error ? error.message : 'Couldn’t load checks.');
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
                    <LoadFailed what="checks" reason={error} onRetry={() => void read()} />
                ) : !record ? (
                    <Loading presentation="status" label="Loading checks…" />
                ) : (
                    <>
                        {record.runs.length === 0 && <EmptyState size="inline" title="No checks yet." />}
                        {checkCommands(record.runs).map((check) => (
                            <CheckRun key={check.latest.checkId} command={check.command}>
                                <RunLines run={check.latest} folder={check.folder} reuses={record.reuses} />
                                <OpenFailure run={check.latest} />
                                {check.openFailures.map((run) => (
                                    <OpenFailure key={run.checkId} run={run} />
                                ))}
                                {check.earlier.length > 0 && (
                                    <Disclosure presentation="section" label={`Earlier runs (${check.earlier.length})`}>
                                        {check.earlier.map((run) => (
                                            <RunLines
                                                key={run.checkId}
                                                run={run}
                                                folder={check.folder}
                                                reuses={record.reuses}
                                            />
                                        ))}
                                    </Disclosure>
                                )}
                            </CheckRun>
                        ))}
                    </>
                )}
            </Stack>
        </Disclosure>
    );
}

/** What a check says of one run: where and how it ran, its evidence and who reused it. */
function RunLines({ run, folder, reuses }: { run: Run; folder: string | null; reuses: ItemChecks['reuses'] }) {
    return (
        <>
            <Text variant="inherit">
                <MetaLine parts={[folder, run.outcome, `Run by ${run.role}${run.reason ? `: ${run.reason}` : ''}`]} />
            </Text>
            {run.outcome === 'passed' && !run.eligible && (
                <Text variant="inherit">Ineligible as passing evidence: {run.snapshotState} snapshot.</Text>
            )}
            {reuses
                .filter((reuse) => reuse.checkId === run.checkId)
                .map((reuse, index) => (
                    <Text variant="inherit" key={index}>
                        Reused by {reuse.role}: {reuse.reason}
                    </Text>
                ))}
        </>
    );
}

/** A run's open failure: the failing tests and diagnosis, shown even when the run itself is collapsed. */
function OpenFailure({ run }: { run: Run }) {
    if (run.failureState !== 'open') return null;

    return (
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
    );
}
