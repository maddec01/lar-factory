import { assertAzureCommandAllowed } from '@lar-factory/shared/azure-safety';
import { expect, test, vi } from 'vite-plus/test';

import { fakeAz } from '../azure/fake-az.ts';
import { readObservedPr, createPrProgressReader } from './pr-progress.ts';

test('GitHub reads head revision, state and complete check counts together without a ticket', async () => {
    const run = vi.fn<(args: string[]) => Promise<string>>(async () =>
        JSON.stringify({
            data: {
                pr0: {
                    pullRequest: {
                        number: 4,
                        url: 'https://github.com/o/r/pull/4',
                        state: 'OPEN',
                        isDraft: false,
                        headRefOid: 'head',
                        mergeStateStatus: 'BLOCKED',
                        statusCheckRollup: {
                            contexts: {
                                checkRunCountsByState: [
                                    { state: 'SUCCESS', count: 30 },
                                    { state: 'IN_PROGRESS', count: 2 },
                                ],
                                statusContextCountsByState: [{ state: 'FAILURE', count: 1 }],
                                nodes: [],
                            },
                        },
                    },
                },
            },
        }),
    );

    expect(await readObservedPr('o/r', 4, run)).toMatchObject({
        sourceRevision: 'head',
        checks: { passed: 30, running: 2, failed: 1, total: 33 },
        mergeState: 'blocked',
        checkProgress: { state: 'current' },
    });
    expect(run).toHaveBeenCalledTimes(1);
    expect(run.mock.calls[0]?.[0]).toContain('number0=4');
});

test('one GitHub batch reads many delivery PRs while keeping an individual failure distinct', async () => {
    const refs = Array.from({ length: 20 }, (_, number) => ({ repo: 'o/r', number: number + 1 }));
    const run = vi.fn(async () =>
        JSON.stringify({
            data: Object.fromEntries(
                refs.map(({ number }, i) => [
                    `pr${i}`,
                    {
                        pullRequest:
                            i === 1
                                ? null
                                : {
                                      number,
                                      url: `https://github.com/o/r/pull/${number}`,
                                      state: 'OPEN',
                                      isDraft: false,
                                      headRefOid: `head${number}`,
                                      mergeStateStatus: 'CLEAN',
                                      statusCheckRollup: i === 2 ? {} : null,
                                  },
                    },
                ]),
            ),
            errors: [{ path: ['pr1', 'pullRequest'], message: 'PR unavailable' }],
        }),
    );
    const results = await createPrProgressReader(run)(refs);

    expect(run).toHaveBeenCalledTimes(1);
    expect(results.get('o/r#1')).toMatchObject({ status: 'fulfilled', value: { sourceRevision: 'head1' } });
    expect(results.get('o/r#2')?.status).toBe('rejected');
    expect(results.get('o/r#3')?.status).toBe('rejected');
    expect(results.get('o/r#20')).toMatchObject({ status: 'fulfilled', value: { sourceRevision: 'head20' } });
});

test('Azure progress reads work through the read-only command boundary', async () => {
    const fake = fakeAz({
        items: [],
        pullRequests: [{ pullRequestId: 4, status: 'active', sourceRefName: 'refs/heads/work' }],
    });
    const run = async (args: string[]) => {
        assertAzureCommandAllowed(args, { LAR_FACTORY_AZURE_READ_ONLY: '1' });

        return fake.run(args);
    };

    expect(await readObservedPr('contoso/Fabrikam%20Fiber/lar-api', 4, run)).toMatchObject({
        number: 4,
        state: 'open',
        sourceRevision: 'source-head',
        checks: null,
        checkProgress: { state: 'current', coverage: 'all' },
    });
    expect(fake.calls.length).toBeLessThanOrEqual(6);
});

test('Azure polling reuses revision metadata, reads changing checks and invalidates a new head', async () => {
    let head = 'head1';
    let iteration = 1;
    let state = 'pending';
    const run = vi.fn(async (args: string[]) => {
        const resource = args[args.indexOf('--resource') + 1];

        return JSON.stringify(
            resource === 'pullRequests'
                ? {
                      pullRequestId: 4,
                      status: 'active',
                      mergeStatus: 'succeeded',
                      lastMergeSourceCommit: { commitId: head },
                      repository: { webUrl: 'https://dev.azure.com/o/p/_git/r', project: { id: 'p' } },
                  }
                : {
                      value:
                          resource === 'pullRequestStatuses'
                              ? [{ id: 1, iterationId: iteration, state, context: { name: 'ci' } }]
                              : resource === 'pullRequestIterations'
                                ? [{ id: iteration, sourceRefCommit: { commitId: head } }]
                                : [],
                  },
        );
    });
    const reader = createPrProgressReader(run);
    const refs = [{ repo: 'o/p/r', number: 4 }];

    expect((await reader(refs)).get('o/p/r#4')).toMatchObject({
        status: 'fulfilled',
        value: { sourceRevision: 'head1', checks: { running: 1 } },
    });
    state = 'succeeded';
    expect((await reader(refs)).get('o/p/r#4')).toMatchObject({
        status: 'fulfilled',
        value: { sourceRevision: 'head1', checks: { passed: 1 } },
    });
    expect(run.mock.calls.filter(([args]) => args.includes('pullRequestIterations'))).toHaveLength(1);
    iteration = 2;
    state = 'pending';
    expect((await reader(refs)).get('o/p/r#4')).toMatchObject({
        status: 'fulfilled',
        value: { sourceRevision: 'head1', checks: { running: 1 } },
    });
    expect(run.mock.calls.filter(([args]) => args.includes('pullRequestIterations'))).toHaveLength(2);
    head = 'head2';
    iteration = 3;
    state = 'failed';
    expect((await reader(refs)).get('o/p/r#4')).toMatchObject({
        status: 'fulfilled',
        value: { sourceRevision: 'head2', checks: { failed: 1 } },
    });
    expect(run.mock.calls.filter(([args]) => args.includes('pullRequestIterations'))).toHaveLength(3);
});
