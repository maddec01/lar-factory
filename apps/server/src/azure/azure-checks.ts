import type { Checks } from '@lar-factory/shared';

export interface Policy {
    evaluationId: string;
    status: string;
    configuration: { id?: number; type?: { id: string }; isBlocking: boolean; isEnabled: boolean };
}
export interface PrStatus {
    id: number;
    state: string;
    context: { name: string; genre?: string };
    iterationId?: number;
    updatedDate?: string;
}

/** Azure build-validation policy type, independent of its localized display name. */
const BUILD_VALIDATION = '0609b952-1397-4640-95ec-e00a01b2c241';

export function latestStatuses(statuses: PrStatus[]): PrStatus[] {
    const latest = new Map<string, PrStatus>();

    for (const status of statuses) {
        const key = JSON.stringify([status.context.genre ?? '', status.context.name]);
        const previous = latest.get(key);
        const newer =
            previous && status.updatedDate && previous.updatedDate
                ? Date.parse(status.updatedDate) > Date.parse(previous.updatedDate) ||
                  (Date.parse(status.updatedDate) === Date.parse(previous.updatedDate) && status.id > previous.id)
                : !previous || status.id > previous.id;

        if (newer) latest.set(key, status);
    }

    return [...latest.values()];
}

function counts(states: string[]): Checks | null {
    if (!states.length) return null;

    return {
        passed: states.filter((s) => ['approved', 'succeeded', 'notApplicable'].includes(s)).length,
        failed: states.filter((s) => ['rejected', 'broken', 'failed', 'error'].includes(s)).length,
        running: states.filter((s) => ['queued', 'running', 'pending'].includes(s)).length,
        total: states.length,
        since: null,
    };
}

/** Votes, non-build policies and old iterations never contribute to check counts. */
export function azureChecks(policies: Policy[], current: PrStatus[], wide: PrStatus[]) {
    const builds = new Map<string | number, Policy>();

    for (const policy of policies) {
        if (
            policy.configuration.isEnabled &&
            policy.configuration.type?.id.toLowerCase() === BUILD_VALIDATION &&
            policy.status !== 'notApplicable'
        )
            builds.set(policy.configuration.id ?? policy.evaluationId, policy);
    }

    return {
        checks: counts([...builds.values()].map((p) => p.status).concat(current.map((s) => s.state))),
        prWideChecks: counts(wide.map((s) => s.state)),
    };
}
