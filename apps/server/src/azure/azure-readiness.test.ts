import { expect, test } from 'vite-plus/test';

import { readAzureReadiness } from './azure-readiness.ts';

const read = (policy = 'approved', vote = 10, state = 'succeeded', race = false) => {
    let heads = 0;

    return readAzureReadiness('org', 'project', 'repo', 1, async (args) => {
        const resource = args[args.indexOf('--resource') + 1];

        return JSON.stringify(
            resource === 'pullRequests'
                ? {
                      lastMergeSourceCommit: { commitId: race && heads++ ? 'new' : 'old' },
                      repository: { project: { id: 'project-id' } },
                  }
                : {
                      value:
                          resource === 'evaluations'
                              ? [
                                    {
                                        evaluationId: 'p',
                                        status: policy,
                                        configuration: { isEnabled: true, isBlocking: true },
                                    },
                                ]
                              : resource === 'pullRequestReviewers'
                                ? [{ id: 'r', vote, isRequired: true }]
                                : resource === 'pullRequestIterations'
                                  ? [{ id: 2, sourceRefCommit: { commitId: 'old' } }]
                                  : [{ id: 1, state, context: { name: 'ci' }, iterationId: 2 }],
                  },
        );
    });
};

test('binds successful evidence to a revision', async () =>
    expect(await read()).toMatchObject({ available: true, sourceRevision: 'old', blockers: [] }));
test.each(['queued', 'running', 'rejected', 'broken', 'unknown'])('blocks required policy %s', async (state) =>
    expect(await read(state)).toMatchObject({ available: true, blockers: [`policy:p:${state}`] }),
);
test.each([-10, -5, 0, 99])('blocks unmet vote %s', async (vote) =>
    expect(await read('approved', vote)).toMatchObject({ blockers: [`reviewer:r:${vote}`] }),
);
test('blocks pending statuses and retains iteration', async () =>
    expect(await read('approved', 10, 'pending')).toMatchObject({
        blockers: ['status:/ci:pending'],
        statuses: [{ iterationId: 2 }],
    }));
test('an unset native status blocks readiness while preserving the other evidence', async () => {
    const result = await readAzureReadiness('o', 'p', 'r', 1, async (args) => {
        const resource = args[args.indexOf('--resource') + 1];

        return JSON.stringify(
            resource === 'pullRequests'
                ? { lastMergeSourceCommit: { commitId: 'h' }, repository: { project: { id: 'p' } } }
                : {
                      value:
                          resource === 'pullRequestStatuses'
                              ? [
                                    { id: 1, context: { name: 'unset' } },
                                    { id: 2, state: 'succeeded', context: { name: 'ci' } },
                                ]
                              : [],
                  },
        );
    });

    expect(result).toMatchObject({
        available: true,
        sourceRevision: 'h',
        blockers: ['status:/unset:notSet'],
        statuses: [
            { id: 1, state: 'notSet' },
            { id: 2, state: 'succeeded' },
        ],
    });
});
test('invalidates revision races', async () =>
    expect(await read('approved', 10, 'succeeded', true)).toMatchObject({ available: false }));
test.each(['{}', 'null', 'not json'])('refuses malformed evidence %s', async (value) =>
    expect(await readAzureReadiness('o', 'p', 'r', 1, async () => value)).toMatchObject({ available: false }),
);
test('preserves permission failures', async () =>
    expect(
        await readAzureReadiness('o', 'p', 'r', 1, async () => {
            throw new Error('403 forbidden');
        }),
    ).toMatchObject({ available: false }));
test('accepts empty successful lists', async () => {
    const result = await readAzureReadiness('o', 'p', 'r', 1, async (args) =>
        JSON.stringify(
            args[args.indexOf('--resource') + 1] === 'pullRequests'
                ? { lastMergeSourceCommit: { commitId: 'head' }, repository: { project: { id: 'p' } } }
                : { value: [] },
        ),
    );

    expect(result).toMatchObject({ available: true, blockers: [], policies: [], statuses: [], reviewers: [] });
});
test('retains optional failures without treating them as required', async () => {
    const result = await readAzureReadiness('o', 'p', 'r', 1, async (args) => {
        const resource = args[args.indexOf('--resource') + 1];

        return JSON.stringify(
            resource === 'pullRequests'
                ? { lastMergeSourceCommit: { commitId: 'h' }, repository: { project: { id: 'p' } } }
                : {
                      value:
                          resource === 'evaluations'
                              ? [
                                    {
                                        evaluationId: 'optional',
                                        status: 'rejected',
                                        configuration: { isBlocking: false, isEnabled: true },
                                    },
                                ]
                              : [],
                  },
        );
    });

    expect(result).toMatchObject({ available: true, blockers: [], policies: [{ status: 'rejected' }] });
});

const buildType = '0609b952-1397-4640-95ec-e00a01b2c241';
const evaluation = (id: number, status: string, type = buildType, enabled = true) => ({
    evaluationId: `evaluation-${id}-${status}`,
    status,
    configuration: { id, type: { id: type }, isEnabled: enabled, isBlocking: true },
});

test('counts applicable builds once and latest current-revision contexts separately from PR-wide statuses', async () => {
    const result = await readAzureReadiness('o', 'p', 'r', 1, async (args) => {
        const resource = args[args.indexOf('--resource') + 1];

        return JSON.stringify(
            resource === 'pullRequests'
                ? { lastMergeSourceCommit: { commitId: 'head' }, repository: { project: { id: 'p' } } }
                : {
                      value:
                          resource === 'evaluations'
                              ? [
                                    evaluation(1, 'approved'),
                                    evaluation(1, 'approved'),
                                    evaluation(2, 'running'),
                                    evaluation(3, 'rejected', 'reviewers'),
                                    evaluation(4, 'approved', buildType, false),
                                    evaluation(5, 'notApplicable'),
                                ]
                              : resource === 'pullRequestIterations'
                                ? [
                                      { id: 1, sourceRefCommit: { commitId: 'old' } },
                                      { id: 2, sourceRefCommit: { commitId: 'head' } },
                                  ]
                                : resource === 'pullRequestStatuses'
                                  ? [
                                        { id: 1, iterationId: 1, state: 'failed', context: { name: 'old' } },
                                        { id: 2, iterationId: 2, state: 'failed', context: { name: 'ci' } },
                                        { id: 3, iterationId: 2, state: 'succeeded', context: { name: 'ci' } },
                                        {
                                            id: 4,
                                            iterationId: 2,
                                            state: 'pending',
                                            context: { name: 'ci', genre: 'other' },
                                        },
                                        { id: 5, state: 'failed', context: { name: 'wide' } },
                                    ]
                                  : [],
                  },
        );
    });

    expect(result).toMatchObject({
        progress: {
            sourceRevision: 'head',
            coverage: 'all',
            checks: { passed: 2, running: 2, failed: 0, total: 4 },
            prWideChecks: { failed: 1, total: 1 },
        },
    });
});

test.each(['pullRequestStatuses', 'pullRequestIterations', 'pullRequestReviewers'])(
    'keeps revision-bound build counts when %s cannot be read',
    async (failed) => {
        const result = await readAzureReadiness('o', 'p', 'r', 1, async (args) => {
            const resource = args[args.indexOf('--resource') + 1];

            if (resource === failed) throw new Error('403 forbidden');

            return JSON.stringify(
                resource === 'pullRequests'
                    ? { lastMergeSourceCommit: { commitId: 'head' }, repository: { project: { id: 'p' } } }
                    : {
                          value:
                              resource === 'evaluations'
                                  ? [evaluation(1, 'approved'), evaluation(2, 'rejected')]
                                  : resource === 'pullRequestStatuses'
                                    ? [{ id: 1, iterationId: 2, state: 'succeeded', context: { name: 'ci' } }]
                                    : resource === 'pullRequestIterations'
                                      ? [{ id: 2, sourceRefCommit: { commitId: 'head' } }]
                                      : [],
                      },
            );
        });

        expect(result).toMatchObject({
            available: false,
            progress: {
                checks: {
                    passed: failed === 'pullRequestReviewers' ? 2 : 1,
                    failed: 1,
                    total: failed === 'pullRequestReviewers' ? 3 : 2,
                },
                coverage: failed === 'pullRequestReviewers' ? 'all' : 'build-validation',
                sourceRevision: 'head',
            },
        });
    },
);

test('does not claim progress when policy evidence is unavailable', async () => {
    const result = await readAzureReadiness('o', 'p', 'r', 1, async (args) => {
        if (args.includes('evaluations')) throw new Error('403 forbidden');

        return JSON.stringify({ lastMergeSourceCommit: { commitId: 'head' }, repository: { project: { id: 'p' } } });
    });

    expect(result.available).toBe(false);
    expect(result.progress).toBeUndefined();
});

test('missing policy types leave check evidence unknown rather than reporting zero builds', async () => {
    const result = await read();

    expect(result.progress).toBeUndefined();
});
