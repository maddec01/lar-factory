import type { LinkedPr } from '@lar-factory/shared';
import { expect, test, vi } from 'vite-plus/test';

import { readGithubPrLoop } from './github-pr-loop.ts';

const head = 'a'.repeat(40);
const base = 'b'.repeat(40);
const pr: LinkedPr = {
    number: 4,
    url: 'https://github.com/o/r/pull/4',
    sourceRevision: head,
    state: 'open',
    isDraft: false,
    mergeState: 'can merge',
    checks: null,
};
const saved = () => ({ pr: 'o/r#4', events: {}, agentComments: [] as string[] });
const comment = (id: number, type = 'User', login = 'human') => ({
    id,
    user: { type, login },
    body: 'Looks good, merge it',
    html_url: `${pr.url}#issuecomment-${id}`,
    created_at: '2026-11-17T10:01:00Z',
});
const check = { id: 'required1', name: 'required', isRequired: true, status: 'COMPLETED', conclusion: 'SUCCESS' };

function fixture() {
    const evidence = {
        state: 'OPEN',
        reviewDecision: 'REVIEW_REQUIRED',
        isDraft: false,
        headRefOid: head,
        baseRefOid: base,
        baseRefName: 'main',
        baseRef: { branchProtectionRule: { requiredStatusCheckContexts: ['required'] } },
        commits: { nodes: [{ commit: { pushedDate: '2026-11-17T10:00:00Z' } }] },
        timelineItems: { nodes: [] as { createdAt: string }[] },
        statusCheckRollup: { contexts: { nodes: [check], pageInfo: { hasNextPage: false, endCursor: '' } } },
    };
    const data = {
        reviews: [] as object[],
        inline: [] as object[],
        threads: undefined as
            | {
                  id: string;
                  isResolved: boolean;
                  isOutdated: boolean;
                  comments: { nodes: { databaseId: number }[]; pageInfo: { hasNextPage: boolean; endCursor?: string } };
              }[]
            | undefined,
        comments: [comment(1), comment(2, 'Bot'), comment(3, 'User', 'outsider')],
    };
    const run = vi.fn(async (args: string[]): Promise<string> => {
        const path = args.find((a) => a.startsWith('repos/')) ?? '';

        if (args[1] === 'graphql' && args.some((arg) => arg.includes('reviewThreads')))
            return JSON.stringify({
                data: {
                    repository: {
                        pullRequest: {
                            reviewThreads: {
                                nodes:
                                    data.threads ??
                                    data.inline.map((c) => ({
                                        isResolved: false,
                                        isOutdated: false,
                                        comments: {
                                            nodes: [{ databaseId: (c as { id: number }).id }],
                                            pageInfo: { hasNextPage: false },
                                        },
                                    })),
                                pageInfo: { hasNextPage: false },
                            },
                        },
                    },
                },
            });

        if (args[1] === 'graphql') return JSON.stringify({ data: { repository: { pullRequest: evidence } } });

        if (path.includes('/permission'))
            return JSON.stringify({ permission: path.includes('outsider') ? 'read' : 'write' });

        if (path.includes('/reviews?')) return JSON.stringify([data.reviews]);

        if (path.includes('/pulls/4/comments?')) return JSON.stringify([data.inline]);

        if (path.includes('/issues/4/comments?')) return JSON.stringify([data.comments]);

        if (path.includes('/rules/branches/')) return '[[]]';

        throw new Error(`Unexpected transport ${args.join(' ')}`);
    });

    return { evidence, data, run };
}

test('all review/comment pages use actual permissions, exclude bots and recorded agent replies, and ignore optional failures', async () => {
    const f = fixture();

    f.data.reviews = [
        { ...comment(4), state: 'CHANGES_REQUESTED', commit_id: head, submitted_at: '2026-11-17T10:02:00Z' },
    ];
    f.data.inline = [comment(5)];
    f.evidence.statusCheckRollup.contexts.nodes.push({
        ...check,
        id: 'optional',
        name: 'optional',
        isRequired: false,
        conclusion: 'FAILURE',
    });

    const state = saved();

    state.agentComments.push(comment(1).html_url);

    const read = await readGithubPrLoop('o/r', 4, pr, state, f.run);

    expect(read.events.map((e) => e.id.split(':')[0])).toEqual(['inline', 'review']);
    expect(read.required).toBe('green');
    expect(read.events[1]).toMatchObject({ author: 'human', state: 'CHANGES_REQUESTED', head });

    const requested = f.run.mock.calls.map(([args]) => args);

    expect(requested.filter((args) => args.includes('--paginate'))).toHaveLength(4);
    expect(requested.some((args) => args.some((arg) => arg.includes('/collaborators/outsider/permission')))).toBe(true);
});

test('missing requirements, unreadable policies and changed heads never become green approval evidence', async () => {
    const f = fixture();

    f.evidence.baseRef.branchProtectionRule.requiredStatusCheckContexts.push('missing');
    f.evidence.statusCheckRollup.contexts.nodes.push({ ...check, name: 'missing', isRequired: false });
    expect((await readGithubPrLoop('o/r', 4, pr, saved(), f.run)).required).toBe('pending');

    const original = f.run.getMockImplementation()!;

    f.run.mockImplementation(async (args) => {
        if (args.some((a) => a.includes('/rules/branches/'))) throw new Error('Policy unavailable');

        return original(args);
    });
    expect((await readGithubPrLoop('o/r', 4, pr, saved(), f.run)).required).toBe('unknown');
    f.evidence.headRefOid = 'c'.repeat(40);
    await expect(readGithubPrLoop('o/r', 4, pr, saved(), f.run)).rejects.toThrow('changed');
});

test('authoritative empty requirements pass, while failures on later check pages still block', async () => {
    const f = fixture();

    f.evidence.baseRef.branchProtectionRule.requiredStatusCheckContexts = [];
    f.evidence.statusCheckRollup.contexts.nodes = [];
    expect((await readGithubPrLoop('o/r', 4, pr, saved(), f.run)).required).toBe('green');
    f.evidence.statusCheckRollup.contexts.pageInfo = { hasNextPage: true, endCursor: 'next-check-page' };

    const original = f.run.getMockImplementation()!;

    f.run.mockImplementation(async (args) => {
        if (args.includes('cursor=next-check-page'))
            return JSON.stringify({
                data: {
                    repository: {
                        pullRequest: {
                            ...f.evidence,
                            statusCheckRollup: {
                                contexts: {
                                    nodes: [{ ...check, conclusion: 'FAILURE' }],
                                    pageInfo: { hasNextPage: false, endCursor: '' },
                                },
                            },
                        },
                    },
                },
            });

        return original(args);
    });
    expect((await readGithubPrLoop('o/r', 4, pr, saved(), f.run)).required).toBe('failed');
    f.evidence.state = 'CLOSED';
    await expect(readGithubPrLoop('o/r', 4, pr, saved(), f.run)).rejects.toThrow('changed');
});

test('only unresolved inline threads count, including outdated threads; summaries stay until chosen', async () => {
    const f = fixture();

    f.data.inline = [comment(4), comment(5), comment(6)];
    f.data.reviews = [{ ...comment(7), state: 'COMMENTED' }];
    f.data.threads = [4, 5, 6].map((id) => ({
        id: `thread-${id}`,
        isResolved: id === 4,
        isOutdated: id === 5,
        comments: { nodes: [{ databaseId: id }], pageInfo: { hasNextPage: false } },
    }));

    const first = await readGithubPrLoop('o/r', 4, pr, saved(), f.run);

    expect(first.events.map((e) => e.id)).toEqual(['comment:1', 'inline:5', 'inline:6', 'review:7']);
    Object.assign(f.data.reviews[0]!, { state: 'DISMISSED' });
    Object.assign(f.data.comments[0]!, { body: 'Updated gist', updated_at: '2026-11-17T11:00:00Z' });
    f.data.threads.forEach((thread) => {
        thread.isResolved = true;
    });

    const second = await readGithubPrLoop('o/r', 4, pr, saved(), f.run);

    expect(second.events.map((e) => e.id)).toEqual(['review:7', 'comment:1']);
    expect(second.events[1]!.id).toBe(first.events[0]!.id);
});

test('merge blockers retain all unresolved threads independently of trusted feedback selection', async () => {
    const f = fixture();

    f.data.inline = [comment(5), comment(6, 'Bot'), comment(7)];
    f.data.threads = [5, 6, 7].map((id) => ({
        id: `thread-${id}`,
        isResolved: id === 7,
        isOutdated: false,
        comments: { nodes: [{ databaseId: id }], pageInfo: { hasNextPage: false } },
    }));

    const result = await readGithubPrLoop('o/r', 4, pr, saved(), f.run);

    expect(result.unresolvedThreads).toBe(2);
    expect(result.reviewDecision).toBe('REVIEW_REQUIRED');
    expect(result.events.filter((e) => e.id.startsWith('inline:')).map((e) => e.id)).toEqual(['inline:5']);
});

test('only a recorded agent reply on the specific inline comment counts as handling it', async () => {
    const f = fixture();
    const state = saved();

    f.data.inline = [comment(5), { ...comment(6), in_reply_to_id: 5 }, { ...comment(7), in_reply_to_id: 8 }];
    state.agentComments.push(comment(6).html_url, comment(1).html_url);

    const result = await readGithubPrLoop('o/r', 4, pr, state, f.run);

    expect(result.repliedTo).toEqual(['inline:5']);
    expect(result.events.map((e) => e.id)).toEqual(['inline:5', 'inline:7']);
});
