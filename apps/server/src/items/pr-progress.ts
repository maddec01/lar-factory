import { decodePart, onAzure, mapConcurrent, type LinkedPr } from '@lar-factory/shared';

import { readAzureReadiness, type AzureRevisionCache } from '../azure/azure-readiness.ts';
import { readPrProgressBatch } from '../github/github.ts';

/** One provider read supplies both state and check progress to the existing PR observer. */
export async function readObservedPr(
    repo: string,
    number: number,
    run?: (args: string[]) => Promise<string>,
    revisionCache?: AzureRevisionCache,
): Promise<LinkedPr> {
    if (!onAzure(repo)) {
        const result = (await readPrProgressBatch([{ repo, number }], run)).get(`${repo}#${number}`.toLowerCase())!;

        if (result.status === 'rejected') throw result.reason;

        return result.value;
    }

    const [organization, project, repository] = repo.split('/').map(decodePart) as [string, string, string];
    const evidence = await readAzureReadiness(organization, project, repository, number, run, revisionCache);
    const pr = evidence.pullRequest;

    if (!pr) throw new Error('Azure PR progress unavailable.');

    const progress = evidence.progress;

    return {
        ...pr,
        // Repository identity comes from the work record, not provider-supplied command arguments.
        url: `https://dev.azure.com/${repo.split('/')[0]}/${repo.split('/')[1]}/_git/${repo.split('/')[2]}/pullrequest/${number}`,
        checks: progress?.checks ?? null,
        mergeState: !evidence.available ? 'checking' : evidence.blockers.length ? 'blocked' : pr.mergeState,
        checkProgress: progress
            ? {
                  state: 'current',
                  coverage: progress.coverage,
                  observedAt: progress.observedAt,
                  prWideChecks: progress.prWideChecks,
              }
            : { state: 'unavailable' },
    };
}

/** Polling caches belong to this observer. Merge eligibility uses its own fresh provider reads. */
export function createPrProgressReader(run?: (args: string[]) => Promise<string>) {
    const revisionCache: AzureRevisionCache = new Map();

    return async (refs: readonly { repo: string; number: number }[]) => {
        const unique = [...new Map(refs.map((ref) => [`${ref.repo}#${ref.number}`.toLowerCase(), ref])).values()];
        const results = new Map<string, PromiseSettledResult<LinkedPr>>();
        const github = readPrProgressBatch(
            unique.filter(({ repo }) => !onAzure(repo)),
            run,
        );

        await mapConcurrent(
            unique.filter(({ repo }) => onAzure(repo)),
            async ({ repo, number }) => {
                try {
                    results.set(`${repo}#${number}`.toLowerCase(), {
                        status: 'fulfilled',
                        value: await readObservedPr(repo, number, run, revisionCache),
                    });
                } catch (reason) {
                    results.set(`${repo}#${number}`.toLowerCase(), { status: 'rejected', reason });
                }
            },
            4,
        );

        for (const [key, result] of await github) results.set(key, result);

        return results;
    };
}
