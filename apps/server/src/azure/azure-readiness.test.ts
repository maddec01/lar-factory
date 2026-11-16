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
test('blocks a required policy that is not approved', async () =>
    expect(await read('rejected')).toMatchObject({ available: true, blockers: ['policy:p:rejected'] }));
test('invalidates revision races', async () =>
    expect(await read('approved', 10, 'succeeded', true)).toMatchObject({ available: false }));

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
