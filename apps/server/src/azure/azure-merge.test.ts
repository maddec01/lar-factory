import { readFileSync } from 'node:fs';
import { afterEach, expect, test, vi } from 'vite-plus/test';

import { createPrProgressReader } from '../items/pr-progress.ts';
import { azureMerge } from './azure-merge.ts';

afterEach(() => vi.unstubAllEnvs());

const fake = (
    permission = true,
    settings: Record<string, unknown> = {
        allowNoFastForward: false,
        allowSquash: true,
        allowRebase: false,
        allowRebaseMerge: false,
    },
    changes = {},
) => {
    const pr = {
        pullRequestId: 8,
        status: 'active',
        isDraft: false,
        mergeStatus: 'succeeded',
        lastMergeSourceCommit: { commitId: 'abc' },
        targetRefName: 'refs/heads/main',
        repository: { id: 'rid', webUrl: 'https://dev.azure.com/o/p/_git/r', project: { id: 'pid' } },
        ...changes,
    };
    const writes: unknown[] = [];
    const run = vi.fn(async (args: string[]) => {
        if (args.includes('PATCH')) {
            writes.push(JSON.parse(readFileSync(args[args.indexOf('--in-file') + 1]!, 'utf8')));

            return '{}';
        }

        if (args[0] === 'rest') return JSON.stringify({ value: [permission] });

        if (args[0] === 'repos') return JSON.stringify(pr);

        const resource = args[args.indexOf('--resource') + 1];

        return JSON.stringify(
            resource === 'pullRequests'
                ? pr
                : {
                      value:
                          resource === 'evaluations'
                              ? [
                                    {
                                        evaluationId: 'merge-policy',
                                        status: 'approved',
                                        configuration: {
                                            isEnabled: true,
                                            isBlocking: true,
                                            type: { id: 'fa4e907d-c16b-4a4c-9dfa-4916e5d171ab' },
                                            settings,
                                        },
                                    },
                                ]
                              : [],
                  },
        );
    });

    return { run, writes };
};

test('Azure reads permitted methods and target-branch permission, then sends a guarded completion without policy bypass', async () => {
    const { run, writes } = fake();
    const provider = azureMerge(run);

    expect((await provider.read('o/p/r', 8)).methods).toEqual(['squash']);
    expect(run.mock.calls.find(([args]) => args[0] === 'rest')![0].join(' ')).toContain('6d00610069006e00');
    await provider.merge('o/p/r', 8, 'abc', 'squash');
    expect(writes).toEqual([
        {
            status: 'completed',
            lastMergeSourceCommit: { commitId: 'abc' },
            completionOptions: {
                mergeStrategy: 'squash',
                bypassPolicy: false,
                deleteSourceBranch: false,
                transitionWorkItems: false,
            },
        },
    ]);
    expect((await azureMerge(fake(false).run).read('o/p/r', 8)).blockers.join(' ')).toContain('permission');
});

test('merge eligibility rereads revision metadata, checks and permission after cached progress polls', async () => {
    const base = fake();
    let state = 'succeeded';
    let permission = true;
    const run = vi.fn(async (args: string[]) => {
        if (args.includes('pullRequestStatuses'))
            return JSON.stringify({ value: [{ id: 1, iterationId: 1, state, context: { name: 'ci' } }] });

        if (args.includes('pullRequestIterations'))
            return JSON.stringify({ value: [{ id: 1, sourceRefCommit: { commitId: 'abc' } }] });

        if (args[0] === 'rest') return JSON.stringify({ value: [permission] });

        return base.run(args);
    });
    const poll = createPrProgressReader(run);

    await poll([{ repo: 'o/p/r', number: 8 }]);
    await poll([{ repo: 'o/p/r', number: 8 }]);
    expect(run.mock.calls.filter(([args]) => args.includes('pullRequestIterations'))).toHaveLength(1);
    state = 'failed';
    permission = false;

    const result = await azureMerge(run).read('o/p/r', 8);

    expect(result.pr.checks).toMatchObject({ failed: 1 });
    expect(result.blockers.join(' ')).toContain('status:/ci:failed');
    expect(result.blockers.join(' ')).toContain('permission');
    expect(run.mock.calls.filter(([args]) => args.includes('pullRequestIterations'))).toHaveLength(2);
    expect(run.mock.calls.filter(([args]) => args.includes('evaluations'))).toHaveLength(3);
    expect(run.mock.calls.filter(([args]) => args.includes('pullRequestReviewers'))).toHaveLength(3);
});

test('Azure refuses unknown method policies and blocks a completion still in flight', async () => {
    await expect(azureMerge(fake(true, {}).run).read('o/p/r', 8)).rejects.toThrow('policy is unknown');
    expect(
        (await azureMerge(fake(true, undefined, { completionQueueTime: 'now' }).run).read('o/p/r', 8)).blockers.join(
            ' ',
        ),
    ).toContain('still completing');
});

test('Azure read-only sessions retain reads and refuse completion before invoking even a fake provider', async () => {
    vi.stubEnv('LAR_FACTORY_AZURE_READ_ONLY', '1');

    const { run, writes } = fake();
    const provider = azureMerge(run);

    expect((await provider.read('o/p/r', 8)).methods).toEqual(['squash']);

    const count = run.mock.calls.length;

    await expect(provider.merge('o/p/r', 8, 'abc', 'squash')).rejects.toThrow('read-only');
    expect(run.mock.calls).toHaveLength(count);
    expect(writes).toEqual([]);
});

test('Azure evaluates the exact nested branch token with slash separators and UTF-16 little-endian encoding', async () => {
    const { run } = fake(true, undefined, { targetRefName: 'refs/heads/user/mattc/feature1' });

    await azureMerge(run).read('o/p/r', 8);

    const args = run.mock.calls.find(([args]) => args[0] === 'rest')![0];
    const url = new URL(args[args.indexOf('--url') + 1]!);

    expect(url.searchParams.get('tokens')).toBe(
        'repoV2/pid/rid/refs/heads/7500730065007200/6d006100740074006300/66006500610074007500720065003100/',
    );
});
