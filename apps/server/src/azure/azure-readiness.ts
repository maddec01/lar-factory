import type { Checks, LinkedPr } from '@lar-factory/shared';

import { azureChecks, latestStatuses, type Policy, type PrStatus } from './azure-checks.ts';
import { az, orgFlags, problemOf, type Az } from './azure-items.ts';
import { linkedPr, type AzurePr } from './azure-prs.ts';

interface Reviewer {
    id: string;
    vote: number;
    isRequired?: boolean;
}
export type AzureReadiness = {
    pullRequest?: LinkedPr;
    progress?: {
        sourceRevision: string;
        observedAt: string;
        coverage: 'all' | 'build-validation';
        checks: Checks | null;
        prWideChecks: Checks | null;
    };
} & (
    | {
          available: true;
          observedAt: string;
          sourceRevision: string;
          policies: Policy[];
          statuses: PrStatus[];
          reviewers: Reviewer[];
          blockers: string[];
      }
    | { available: false; reason: string }
);

/** Only immutable iteration-to-revision mappings may be reused by progress polling. */
export type AzureRevisionCache = Map<string, { iteration?: number; latest: number; expires: number }>;

const object = (value: unknown): value is Record<string, unknown> => typeof value === 'object' && value !== null;
const malformed = (): never => {
    throw new Error('Malformed Azure PR evidence');
};
const list = (value: unknown): unknown[] => (object(value) && Array.isArray(value.value) ? value.value : malformed());

/** Revision-bound provider evidence. No factory Status is inferred or written. */
export async function readAzureReadiness(
    organization: string,
    project: string,
    repositoryId: string,
    pullRequestId: number,
    run: Az = az,
    revisionCache?: AzureRevisionCache,
): Promise<AzureReadiness> {
    const call = async (area: string, resource: string, query: string[] = []): Promise<unknown> =>
        JSON.parse(
            await run([
                'devops',
                'invoke',
                '--area',
                area,
                '--resource',
                resource,
                '--route-parameters',
                `project=${project}`,
                ...(area === 'git' ? [`repositoryId=${repositoryId}`, `pullRequestId=${pullRequestId}`] : []),
                ...(query.length ? ['--query-parameters', ...query] : []),
                '--api-version',
                area === 'policy' ? '7.1-preview' : '7.1',
                ...orgFlags(organization),
            ]),
        );
    const head = async () => {
        const pr = await call('git', 'pullRequests');

        if (
            !object(pr) ||
            !object(pr.lastMergeSourceCommit) ||
            typeof pr.lastMergeSourceCommit.commitId !== 'string' ||
            !pr.lastMergeSourceCommit.commitId ||
            !object(pr.repository) ||
            !object(pr.repository.project) ||
            typeof pr.repository.project.id !== 'string'
        )
            return malformed();

        let observed: LinkedPr | undefined;

        if (
            pr.pullRequestId === pullRequestId &&
            typeof pr.status === 'string' &&
            ['active', 'completed', 'abandoned'].includes(pr.status) &&
            typeof pr.repository.webUrl === 'string' &&
            (pr.isDraft === undefined || typeof pr.isDraft === 'boolean')
        ) {
            const { body: _body, mergedAt: _mergedAt, ...summary } = linkedPr(pr as unknown as AzurePr);

            observed = summary;
        }

        return {
            revision: pr.lastMergeSourceCommit.commitId,
            target: JSON.stringify([
                pr.targetRefName,
                object(pr.lastMergeTargetCommit) ? pr.lastMergeTargetCommit.commitId : null,
            ]),
            projectId: pr.repository.project.id,
            pr: observed,
        };
    };

    let pullRequest: LinkedPr | undefined;

    try {
        if (!Number.isSafeInteger(pullRequestId) || pullRequestId <= 0) throw new Error('Invalid pull request id');

        const before = await head();

        pullRequest = before.pr;

        const metadataKey = JSON.stringify([
            organization,
            project,
            repositoryId,
            pullRequestId,
            before.revision,
            before.target,
        ]);

        for (const [key, entry] of revisionCache ?? []) if (entry.expires <= Date.now()) revisionCache!.delete(key);

        const cached = revisionCache?.get(metadataKey);
        let metadata: { iteration?: number; latest: number; expires: number } | undefined;

        const policies: Policy[] = [];
        const pages = new Set<string>();

        for (;;) {
            if (policies.length >= 2000) throw new Error('Azure policy page limit reached');

            const page = list(
                await call('policy', 'evaluations', [
                    `artifactId=vstfs:///CodeReview/CodeReviewId/${before.projectId}/${pullRequestId}`,
                    'includeNotApplicable=true',
                    '$top=100',
                    `$skip=${policies.length}`,
                ]),
            );

            for (const p of page) {
                if (
                    !object(p) ||
                    typeof p.evaluationId !== 'string' ||
                    typeof p.status !== 'string' ||
                    !object(p.configuration) ||
                    typeof p.configuration.isBlocking !== 'boolean' ||
                    typeof p.configuration.isEnabled !== 'boolean' ||
                    (p.configuration.id !== undefined && !Number.isSafeInteger(p.configuration.id)) ||
                    (p.configuration.type !== undefined &&
                        (!object(p.configuration.type) || typeof p.configuration.type.id !== 'string'))
                )
                    return malformed();

                policies.push(p as unknown as Policy);
            }

            if (page.length < 100) break;

            const fingerprint = JSON.stringify(page.map((p) => (p as Policy).evaluationId));

            if (pages.has(fingerprint)) throw new Error('Azure repeated a policy page');

            pages.add(fingerprint);
        }

        let statuses: PrStatus[] = [];
        let currentIteration: number | undefined;
        let limited = false;

        try {
            statuses = list(await call('git', 'pullRequestStatuses')).map((s) => {
                if (
                    !object(s) ||
                    !Number.isSafeInteger(s.id) ||
                    (s.state !== undefined && typeof s.state !== 'string') ||
                    !object(s.context) ||
                    typeof s.context.name !== 'string' ||
                    (s.context.genre !== undefined && typeof s.context.genre !== 'string') ||
                    (s.updatedDate !== undefined &&
                        (typeof s.updatedDate !== 'string' || !Number.isFinite(Date.parse(s.updatedDate)))) ||
                    (s.iterationId !== undefined && !Number.isSafeInteger(s.iterationId))
                )
                    return malformed();

                return { ...s, state: s.state ?? 'notSet' } as unknown as PrStatus;
            });

            if (statuses.some((s) => s.iterationId)) {
                if (cached && statuses.every((s) => !s.iterationId || s.iterationId <= cached.latest)) {
                    metadata = cached;
                } else {
                    let latest = 0;

                    for (const i of list(await call('git', 'pullRequestIterations'))) {
                        if (
                            !object(i) ||
                            !Number.isSafeInteger(i.id) ||
                            !object(i.sourceRefCommit) ||
                            typeof i.sourceRefCommit.commitId !== 'string'
                        )
                            return malformed();

                        latest = Math.max(latest, i.id as number);

                        if (i.sourceRefCommit.commitId === before.revision)
                            currentIteration = Math.max(currentIteration ?? 0, i.id as number);
                    }

                    metadata = { iteration: currentIteration, latest, expires: Date.now() + 5 * 60_000 };
                }

                currentIteration = metadata.iteration;

                if (currentIteration === undefined) limited = true;
            }
        } catch {
            limited = true;
        }

        const current = latestStatuses(
            statuses.filter((s) => !!currentIteration && s.iterationId === currentIteration),
        );
        const wide = latestStatuses(statuses.filter((s) => !s.iterationId));
        let reviewers: Reviewer[] = [];
        let reviewersUnavailable = false;

        try {
            reviewers = list(await call('git', 'pullRequestReviewers')).map((r) => {
                if (
                    !object(r) ||
                    typeof r.id !== 'string' ||
                    typeof r.vote !== 'number' ||
                    (r.isRequired !== undefined && typeof r.isRequired !== 'boolean')
                )
                    return malformed();

                return r as unknown as Reviewer;
            });
        } catch {
            reviewersUnavailable = true;
        }

        const after = await head();

        if (before.revision !== after.revision || before.target !== after.target) {
            revisionCache?.delete(metadataKey);

            return { available: false, reason: 'PR source or target revision changed while reading evidence' };
        }

        if (metadata && !limited && revisionCache) {
            if (revisionCache.size >= 500) revisionCache.delete(revisionCache.keys().next().value!);

            revisionCache.set(metadataKey, metadata);
        }

        const progress = policies.some((p) => p.configuration.isEnabled && !p.configuration.type)
            ? undefined
            : {
                  ...azureChecks(policies, current, wide),
                  sourceRevision: before.revision,
                  observedAt: new Date().toISOString(),
                  coverage: limited ? ('build-validation' as const) : ('all' as const),
              };

        if (limited || reviewersUnavailable)
            return {
                available: false,
                reason: limited ? 'Status check coverage unavailable' : 'Reviewer evidence unavailable',
                progress,
                pullRequest,
            };

        const blockers = policies
            .filter(
                (p) =>
                    p.configuration.isEnabled &&
                    p.configuration.isBlocking &&
                    !['approved', 'notApplicable'].includes(p.status),
            )
            .map((p) => `policy:${p.evaluationId}:${p.status}`);

        for (const r of reviewers)
            if (r.vote < 0 || (r.isRequired && ![5, 10].includes(r.vote)) || ![-10, -5, 0, 5, 10].includes(r.vote))
                blockers.push(`reviewer:${r.id}:${r.vote}`);
        for (const s of [...current, ...wide])
            if (!['succeeded', 'notApplicable'].includes(s.state))
                blockers.push(`status:${s.context.genre ?? ''}/${s.context.name}:${s.state}`);

        return {
            available: true,
            progress,
            pullRequest,
            observedAt: new Date().toISOString(),
            sourceRevision: before.revision,
            policies,
            statuses,
            reviewers,
            blockers,
        };
    } catch (error) {
        const problem = problemOf(error);

        return { available: false, reason: problem instanceof Error ? problem.message : String(problem), pullRequest };
    }
}
