import type { Item, Status } from '@lar-factory/shared';
import assert from 'node:assert/strict';
import { test } from 'vite-plus/test';

import { repoIssues } from './repo-issues.ts';

const REPO = 'maddec01/lar-apple';

const item = (statuses: Status[]): Item => ({
    id: 'I_7',
    status: statuses[0] ?? 'List',
    statuses,
    content: 'ticket',
    revision: 0,
    kind: 'issue',
    parentId: null,
    flow: 'single',
    number: 7,
    title: 'Seek',
    url: `https://github.com/${REPO}/issues/7`,
    repo: REPO,
    labels: [],
    state: 'open',
    closedAs: null,
    parent: null,
    subIssues: { total: 0, completed: 0 },
    blockers: [],
    updatedAt: '2026-10-21T08:00:00Z',
    closedAt: null,
    linkedPrs: [],
    slices: [],
});

/** A fake gh: records each call, and answers it from `reply`, which throws to fail the call. */
function fakeGh(reply: (args: string[]) => string = () => '{}') {
    const calls: string[][] = [];
    const run = async (args: string[]) => {
        calls.push(args);

        return reply(args);
    };

    return { calls, run };
}

test('a ticket observation reads its state and assignees, and a confirmed not-found, but throws on any other failure', async () => {
    const answers: Record<string, () => string> = {
        7: () => JSON.stringify({ state: 'OPEN', assignees: [{ login: 'pedro' }, { login: 'ana' }] }),
        8: () => JSON.stringify({ state: 'CLOSED', assignees: [] }),
        9: () => {
            throw new Error(
                'gh issue view failed: GraphQL: Could not resolve to an issue or pull request with the number of 9.',
            );
        },
        10: () => {
            throw new Error('gh issue view failed: HTTP 502');
        },
    };
    const gh = fakeGh((args) => answers[args[2]!]!());
    const issues = repoIssues(REPO, gh.run);

    assert.deepEqual(await issues.observeTicket(REPO, 7), { state: 'open', assignee: 'ana, pedro' });
    assert.deepEqual(gh.calls[0], ['issue', 'view', '7', '-R', REPO, '--json', 'state,assignees']);
    assert.deepEqual(await issues.observeTicket(REPO, 8), { state: 'closed' });
    assert.deepEqual(await issues.observeTicket(REPO, 9), { state: 'not-found' });
    await assert.rejects(issues.observeTicket(REPO, 10), /HTTP 502/);
});

test("a change check lists the issues and PRs updated since, and can't tell once every one it lists changed", async () => {
    const updated = (number: number, at: string, pr = false) => ({
        html_url: `https://github.com/${REPO}/${pr ? 'pull' : 'issues'}/${number}`,
        updated_at: at,
        closed_at: null,
    });
    let page = [
        updated(9, '2026-10-21T08:10:00Z', true),
        updated(7, '2026-10-21T08:09:45Z'),
        updated(5, '2026-10-21T08:00:00Z'),
    ];
    const gh = fakeGh((args) => `HTTP/2.0 200 OK\r\nEtag: W/"${args.length}"\r\n\r\n${JSON.stringify(page)}`);
    const issues = repoIssues(REPO, gh.run);

    assert.deepEqual(
        await issues.changes!(Date.parse('2026-10-21T08:10:00Z')),
        [`https://github.com/${REPO}/pull/9`, `https://github.com/${REPO}/issues/7`],
        'it looks 30 seconds further back, for a clock behind GitHub',
    );
    assert.deepEqual(gh.calls[0], [
        'api',
        '-i',
        `repos/${REPO}/issues?state=all&sort=updated&direction=desc&per_page=30`,
    ]);
    page = Array.from({ length: 30 }, (_, i) => updated(i + 1, '2026-10-21T09:00:00Z'));
    assert.equal(await issues.changes!(Date.parse('2026-10-21T08:30:00Z')), null);
    assert.deepEqual(gh.calls[1]!.slice(2, 4), ['-H', 'If-None-Match: W/"3"'], 'the next check sends the last ETag');
});

test('Abandon closes an issue as not planned and reports close failures', async () => {
    const gh = fakeGh();

    assert.equal(await repoIssues(REPO, gh.run).abandon(item(['List'])), null);
    assert.deepEqual(gh.calls, [['issue', 'close', '7', '-R', REPO, '--reason', 'not planned']]);

    const failed = fakeGh(() => {
        throw new Error('GitHub unavailable');
    });

    assert.equal(
        await repoIssues(REPO, failed.run).abandon(item(['Queued'])),
        'Could not abandon #7. GitHub unavailable',
    );
});
