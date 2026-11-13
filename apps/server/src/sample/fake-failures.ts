/** These names are shared by the adapters and the local sample controls F02 supplies. */
export const FAKE_OPERATIONS = [
    'labels.list',
    'labels.create',
    'labels.update',
    'labels.delete',
    'labels.addToTicket',
    'labels.removeFromTicket',
    'kinds.read',
    'kinds.setType',
    'kinds.boardTypes',
    'issues.list',
    'issues.read',
    'issues.search',
    'issues.create',
    'issues.edit',
    'links.parent',
    'links.related',
    'links.blocked-by',
] as const;

export type FakeOperation = (typeof FAKE_OPERATIONS)[number];

export interface FakeFailure {
    fail?: 'next' | 'always';
    message?: string;
    latencyMs?: number;
}

/** In-process only: no environment switches, HTTP routes, provider commands or persistent controls. */
export function fakeFailures() {
    const rules = new Map<FakeOperation, FakeFailure>();
    let generation = 0;

    return {
        set(this: void, operation: FakeOperation, rule: FakeFailure | null) {
            if (!FAKE_OPERATIONS.includes(operation)) throw new Error('Choose a named sample operation.');

            if (rule?.fail !== undefined && !['next', 'always'].includes(rule.fail))
                throw new Error('Choose fail-next or fail-always.');

            if (
                rule?.latencyMs !== undefined &&
                (!Number.isFinite(rule.latencyMs) || rule.latencyMs < 0 || rule.latencyMs > 30_000)
            )
                throw new Error('Sample latency must be between 0 and 30000 milliseconds.');

            if (rule) rules.set(operation, { ...rule });
            else rules.delete(operation);
        },
        clear(this: void) {
            rules.clear();
            generation++;
        },
        async run<T>(operation: FakeOperation, action: () => T): Promise<T> {
            const started = generation;
            const rule = rules.get(operation);

            // Consume before waiting: concurrent calls must not both take fail-next.
            if (rule?.fail === 'next') rules.set(operation, { latencyMs: rule.latencyMs });

            if (rule?.latencyMs) await new Promise<void>((resolve) => setTimeout(resolve, rule.latencyMs));

            if (started !== generation) throw new Error('The sample tracker was reset. Retry the request.');

            if (rule?.fail) throw new Error(rule.message ?? `Sample tracker refused ${operation}.`);

            return structuredClone(action());
        },
    };
}
