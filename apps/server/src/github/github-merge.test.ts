import { expect, test, vi } from 'vite-plus/test';

import { githubMerge } from './github-merge.ts';

const pr = {
    id: 'node8',
    number: 8,
    url: 'https://github.com/o/r/pull/8',
    state: 'OPEN',
    isDraft: false,
    headRefOid: 'abc',
    baseRefName: 'main',
    baseRef: { branchProtectionRule: null },
    mergeStateStatus: 'CLEAN',
    isMergeQueueEnabled: false,
    reviewDecision: 'APPROVED',
    statusCheckRollup: { state: 'SUCCESS' },
};
const repo = {
    viewerPermission: 'WRITE',
    mergeCommitAllowed: true,
    squashMergeAllowed: true,
    rebaseMergeAllowed: false,
    pullRequest: pr,
};
const fake = (changes = {}, rules: unknown[] = []) =>
    vi.fn(async (args: string[]) =>
        args[1] === 'graphql'
            ? JSON.stringify({ data: { repository: { ...repo, ...changes } } })
            : JSON.stringify([rules]),
    );

test('GitHub reads effective method rules, permission and queues; mutation uses the expected revision', async () => {
    const run = fake({}, [{ type: 'pull_request', parameters: { allowed_merge_methods: ['squash'] } }]);
    const provider = githubMerge(run);

    expect((await provider.read('o/r', 8)).methods).toEqual(['squash']);
    await provider.merge('o/r', 8, 'abc', 'squash');
    expect(run.mock.calls.at(-1)![0]).toContain('head=abc');
    expect(run.mock.calls.at(-1)![0].join(' ')).toContain('expectedHeadOid: $head');
    expect((await githubMerge(fake({ viewerPermission: 'READ' })).read('o/r', 8)).blockers.join(' ')).toContain(
        'permission',
    );
    expect(
        (await githubMerge(fake({ pullRequest: { ...pr, isMergeQueueEnabled: true } })).read('o/r', 8)).blockers.join(
            ' ',
        ),
    ).toContain('Open PR');
});

test('GitHub excludes merge commits under linear-history policies and reads every rules page', async () => {
    const run = fake({ pullRequest: { ...pr, baseRef: { branchProtectionRule: { requiresLinearHistory: true } } } });

    expect((await githubMerge(run).read('o/r', 8)).methods).toEqual(['squash']);
    expect(run.mock.calls.find(([args]) => args[1] !== 'graphql')![0]).toContain('--paginate');
    expect((await githubMerge(fake({}, [{ type: 'required_linear_history' }])).read('o/r', 8)).methods).toEqual([
        'squash',
    ]);
});

test.each([
    { reviewDecision: 'CHANGES_REQUESTED' },
    { mergeStateStatus: 'BLOCKED' },
    { mergeStateStatus: 'UNKNOWN' },
    { statusCheckRollup: { state: 'PENDING' } },
    { statusCheckRollup: { state: 'FAILURE' } },
])('GitHub retains the provider blocker %j', async (change) => {
    const evidence = await githubMerge(fake({ pullRequest: { ...pr, ...change } })).read('o/r', 8);

    expect(evidence.blockers.length).toBeGreaterThan(0);
});

test('S08 F05: behind-main readiness names the required branch update', async () => {
    const evidence = await githubMerge(fake({ pullRequest: { ...pr, mergeStateStatus: 'BEHIND' } })).read('o/r', 8);

    expect(evidence.blockers.join(' ')).toMatch(/behind main.*rebase|behind main.*update/i);
    expect(evidence.pr.mergeState).toBe('behind');
});
