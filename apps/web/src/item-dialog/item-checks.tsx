import type { ItemChecks } from '@lar-factory/shared';
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
        <details
            data-checks
            className="w-full min-w-0 text-sm"
            onToggle={(event) => {
                if (event.currentTarget.open) void read();
            }}
        >
            <summary className="min-h-11 cursor-pointer py-3 font-medium">Checks</summary>
            <div className="grid gap-3 pt-2">
                {error ? (
                    <p role="alert">Could not load checks: {error}</p>
                ) : !record ? (
                    <p role="status">Loading checks…</p>
                ) : (
                    <>
                        {record.runs.length === 0 && <p>No checks are recorded.</p>}
                        {record.runs.map((run) => (
                            <section key={run.checkId} className="min-w-0 rounded border border-(--border) p-2">
                                <code className="wrap-anywhere whitespace-pre-wrap">
                                    {run.command.map((arg) => JSON.stringify(arg)).join(' ')}
                                </code>
                                <p>
                                    {run.folder} · {run.outcome} · Run by {run.role}
                                    {run.reason ? `: ${run.reason}` : ''}
                                </p>
                                {run.outcome === 'passed' && !run.eligible && (
                                    <p>Ineligible as passing evidence: {run.snapshotState} snapshot.</p>
                                )}
                                {record.reuses
                                    .filter((reuse) => reuse.checkId === run.checkId)
                                    .map((reuse, index) => (
                                        <p key={index}>
                                            Reused by {reuse.role}: {reuse.reason}
                                        </p>
                                    ))}
                                {run.failureState === 'open' && (
                                    <div>
                                        <p>Open failure</p>
                                        {run.failure ? (
                                            <>
                                                <ul>
                                                    {run.failure.tests.map((name) => (
                                                        <li key={name}>{name}</li>
                                                    ))}
                                                </ul>
                                                <p>{run.failure.diagnosis}</p>
                                            </>
                                        ) : (
                                            <p>No failure names recorded.</p>
                                        )}
                                    </div>
                                )}
                            </section>
                        ))}
                    </>
                )}
            </div>
        </details>
    );
}
