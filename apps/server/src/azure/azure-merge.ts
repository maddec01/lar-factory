import { decodePart, type MergeMethod } from '@lar-factory/shared';
import { assertAzureWriteAllowed, assertAzureCommandAllowed } from '@lar-factory/shared/azure-safety';

import type { MergeProvider } from '../config/pr-merge.ts';
import { API_VERSION, az, azureGet, orgFlags, withFile, type Az } from './azure-items.ts';
import { readAzureReadiness } from './azure-readiness.ts';

const STRATEGIES = { merge: 'noFastForward', squash: 'squash', rebase: 'rebase', rebaseMerge: 'rebaseMerge' } as const;
const MERGE_POLICY = 'fa4e907d-c16b-4a4c-9dfa-4916e5d171ab';
const NAMESPACE = '2e9eb7ed-3c0a-47d4-87c1-0ffdd275fd87';

/** https://learn.microsoft.com/en-us/rest/api/azure/devops/git/pull-requests/update?view=azure-devops-rest-7.1 */
export function azureMerge(run: Az = az): MergeProvider {
    return {
        async read(repo, number) {
            const [organization, project, repository] = repo.split('/').map(decodePart) as [string, string, string];
            const evidence = await readAzureReadiness(organization, project, repository, number, run);

            if (!evidence.available || !evidence.pullRequest)
                throw new Error('Azure readiness is unavailable. Open PR or refresh to try again.');

            const metadata = JSON.parse(
                await run([
                    'devops',
                    'invoke',
                    '--area',
                    'git',
                    '--resource',
                    'pullRequests',
                    '--route-parameters',
                    `project=${project}`,
                    `repositoryId=${repository}`,
                    `pullRequestId=${number}`,
                    '--api-version',
                    API_VERSION,
                    ...orgFlags(organization),
                ]),
            ) as {
                pullRequestId: number;
                lastMergeSourceCommit: { commitId: string };
                targetRefName: string;
                completionQueueTime?: string;
                mergeFailureType?: string;
                repository: { id: string; project: { id: string } };
            };

            if (
                metadata.pullRequestId !== number ||
                metadata.lastMergeSourceCommit?.commitId !== evidence.sourceRevision ||
                !metadata.targetRefName?.startsWith('refs/heads/') ||
                !metadata.repository?.id ||
                !metadata.repository.project?.id
            )
                throw new Error('Azure source revision or PR identity changed. Refresh readiness.');

            const blockers = evidence.blockers.map((b) => `Azure requirement ${b}. Open PR to review it.`);

            if (
                metadata.completionQueueTime &&
                (!metadata.mergeFailureType || ['none', 'unknown'].includes(metadata.mergeFailureType)) &&
                evidence.pullRequest.state === 'open'
            )
                blockers.push('Azure is still completing this PR. Open PR to check its outcome.');

            // Evaluate Contribute on the target branch, including branch-level denies. No bypass permission is requested.
            // https://devblogs.microsoft.com/devops/git-repo-tokens-for-the-security-service/
            const branch = metadata.targetRefName.slice('refs/heads/'.length);
            const encodedBranch = branch
                .split('/')
                .map((segment) => Buffer.from(segment, 'utf16le').toString('hex'))
                .join('/');
            const token = `repoV2/${metadata.repository.project.id}/${metadata.repository.id}/refs/heads/${encodedBranch}/`;
            const permission = await azureGet<{ value: unknown[] }>(
                `https://dev.azure.com/${repo.split('/')[0]}/_apis/permissions/${NAMESPACE}/4?tokens=${encodeURIComponent(token)}&api-version=${API_VERSION}`,
                run,
            );

            if (permission.value?.length !== 1 || typeof permission.value[0] !== 'boolean')
                throw new Error('Azure merge permission is unavailable.');

            if (!permission.value[0])
                blockers.push('Your Azure login has no permission to merge to the target branch.');

            let methods = Object.keys(STRATEGIES) as MergeMethod[];

            for (const policy of evidence.policies.filter(
                (p) =>
                    p.configuration.isEnabled &&
                    p.configuration.isBlocking &&
                    p.configuration.type?.id.toLowerCase() === MERGE_POLICY,
            )) {
                const settings = policy.configuration.settings;

                if (!settings) throw new Error('Azure merge method policy is unavailable.');

                const keys = {
                    merge: 'allowNoFastForward',
                    squash: 'allowSquash',
                    rebase: 'allowRebase',
                    rebaseMerge: 'allowRebaseMerge',
                } as const;

                if (Object.values(keys).some((key) => typeof settings[key] !== 'boolean'))
                    throw new Error('Azure merge method policy is unknown.');

                methods = methods.filter((m) => settings[keys[m]] === true);
            }

            return {
                pr: {
                    ...evidence.pullRequest,
                    checks: evidence.progress?.checks ?? null,
                    checkProgress: evidence.progress
                        ? {
                              state: 'current',
                              coverage: evidence.progress.coverage,
                              observedAt: evidence.progress.observedAt,
                              prWideChecks: evidence.progress.prWideChecks,
                          }
                        : { state: 'unavailable' },
                },
                methods,
                blockers,
            };
        },
        async merge(repo, number, revision, method) {
            assertAzureWriteAllowed();

            const [organization, project, repository] = repo.split('/').map(decodePart) as [string, string, string];

            await withFile(
                {
                    status: 'completed',
                    lastMergeSourceCommit: { commitId: revision },
                    completionOptions: {
                        mergeStrategy: STRATEGIES[method],
                        bypassPolicy: false,
                        deleteSourceBranch: false,
                        transitionWorkItems: false,
                    },
                },
                async (file) => {
                    const args = [
                        'devops',
                        'invoke',
                        '--area',
                        'git',
                        '--resource',
                        'pullRequests',
                        '--route-parameters',
                        `project=${project}`,
                        `repositoryId=${repository}`,
                        `pullRequestId=${number}`,
                        '--http-method',
                        'PATCH',
                        '--in-file',
                        file,
                        '--api-version',
                        API_VERSION,
                        ...orgFlags(organization),
                    ];

                    assertAzureCommandAllowed(args);
                    await run(args);
                },
            );
        },
    };
}
