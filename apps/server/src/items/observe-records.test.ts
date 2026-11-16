import { openWorkRecords, type PullRequestState, type WorkRecord, type WorkRecords } from '@lar-factory/work-records';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, test } from 'vite-plus/test';

import { observePr } from '../config/pr-host.ts';
import { observeIssue } from '../github/github.ts';
import type { TicketObservation } from './item-source.ts';
import { finishCompleted, observeRecords, type ObserveReads } from './observe-records.ts';
import { recordItems } from './record-items.ts';

const REPO = 'maddec01/lar-factory';
const opened: { records: WorkRecords; dir: string }[] = [];

afterEach(() => {
    for (const { records, dir } of opened.splice(0)) {
        records.close();
        rmSync(dir, { recursive: true, force: true });
    }
});

async function open(): Promise<WorkRecords> {
    const dir = mkdtempSync(join(tmpdir(), 'observe-records-'));
    const records = await openWorkRecords(join(dir, 'work-records.db'));

    opened.push({ records, dir });

    return records;
}

/** Provider reads that answer what `ticket` and `pr` hold now, or throw the error they hold. */
function provider(answers: { ticket?: TicketObservation | Error; pr?: PullRequestState | Error }) {
    const asked: string[] = [];
    const answer = <T>(value: T | Error | undefined, what: string): T => {
        if (value instanceof Error) throw value;

        if (value === undefined) throw new Error(`no ${what} answer`);

        return value;
    };

    return {
        answers,
        asked,
        reads: {
            ticket: async (repo: string, number: number) => (
                asked.push(`ticket ${repo}#${number}`),
                answer(answers.ticket, 'ticket')
            ),
            pr: async (repo: string, number: number) => (asked.push(`pr ${repo}#${number}`), answer(answers.pr, 'PR')),
        },
    };
}

function build(
    records: WorkRecords,
    status: WorkRecord['status'] = 'Review',
    ticket: string | null = `${REPO}#12`,
): WorkRecord {
    const created = ticket
        ? records.importTicket({ title: 'Build', repository: REPO, kind: 'build', status, ticket }).record
        : records.create({ title: 'Build', repository: REPO, kind: 'build', status });

    return records.setPullRequest(created.workId, created.revision, `${REPO}#40`);
}

test('a merged PR finishes the build and makes it Done', async () => {
    const records = await open();
    const { workId } = build(records);
    const { reads } = provider({ pr: 'merged', ticket: { state: 'closed' } });

    await observeRecords(records, [REPO], reads);

    const record = records.read(workId);

    assert.equal(record.status, 'Done');
    assert.ok(record.finishedAt);
    assert.equal(record.needsYou, null, 'the ticket the merge closed flags nothing');
    assert.ok(records.completion(workId).complete);
});

test('a PR closed unmerged sets Needs you once, leaving the Status as it was', async () => {
    const records = await open();
    const { workId } = build(records, 'Review', null);
    const { reads, asked } = provider({ pr: 'closed' });

    await observeRecords(records, [REPO], reads);

    const record = records.read(workId);

    assert.equal(record.status, 'Review');
    assert.deepEqual([record.needsYou, record.needsYouCauses], [null, [{ type: 'pr-closed' }]]);
    assert.deepEqual(asked, [`pr ${REPO}#40`], 'ticketless work reads only its PR');
    records.setNeedsYouCauses(workId, record.revision, []);
    await observeRecords(records, [REPO], reads);
    assert.deepEqual(records.read(workId).needsYouCauses, [], 'a PR that stays closed flags nothing again');
});

test('a ticket closing elsewhere sets Needs you without moving the Status', async () => {
    const records = await open();
    const { workId } = records.importTicket({
        title: 'Bug',
        repository: REPO,
        kind: 'bug',
        status: 'Queued',
        ticket: `${REPO}#12`,
    }).record;
    const { reads, answers } = provider({ ticket: { state: 'open' } });

    await observeRecords(records, [REPO], reads);
    assert.equal(records.read(workId).needsYou, null);
    answers.ticket = { state: 'closed' };
    await observeRecords(records, [REPO], reads);

    const record = records.read(workId);

    assert.deepEqual([record.status, record.setAside], ['Queued', false]);
    assert.deepEqual(record.needsYouCauses, [{ type: 'ticket-closed' }]);
});

test('a reopened PR, a reopened ticket and an assignee changed back each remove their cause, and the notice goes with the last', async () => {
    const records = await open();
    const { workId } = build(records);
    const { reads, answers } = provider({ pr: 'open', ticket: { state: 'open', assignee: 'pedro' } });

    await observeRecords(records, [REPO], reads);
    answers.pr = 'closed';
    answers.ticket = { state: 'closed', assignee: 'ana' };
    await observeRecords(records, [REPO], reads);

    const causes = () => records.read(workId).needsYouCauses;

    assert.deepEqual(causes(), [
        { type: 'pr-closed' },
        { type: 'ticket-closed' },
        { type: 'assignee-changed', from: 'pedro', to: 'ana' },
    ]);
    answers.pr = 'open';
    await observeRecords(records, [REPO], reads);
    assert.deepEqual(causes(), [{ type: 'ticket-closed' }, { type: 'assignee-changed', from: 'pedro', to: 'ana' }]);
    answers.ticket = { state: 'open', assignee: 'ana' };
    await observeRecords(records, [REPO], reads);
    assert.deepEqual(causes(), [{ type: 'assignee-changed', from: 'pedro', to: 'ana' }]);
    answers.ticket = { state: 'open', assignee: 'bo' };
    await observeRecords(records, [REPO], reads);
    assert.deepEqual(
        causes(),
        [{ type: 'assignee-changed', from: 'pedro', to: 'bo' }],
        'a second move keeps who owned it first',
    );
    answers.ticket = { state: 'open', assignee: 'pedro' };
    await observeRecords(records, [REPO], reads);
    assert.deepEqual(causes(), []);
    assert.equal(recordItems(records, [], [REPO])[0]!.needsYou, undefined);
});

test('a read turns saved old wording into causes and drops the old text', async () => {
    const records = await open();
    const made = build(records);
    const { reads, answers } = provider({ pr: 'open', ticket: { state: 'open' } });

    await observeRecords(records, [REPO], reads);
    answers.pr = 'closed';
    answers.ticket = new Error('HTTP 502');

    const { workId } = made;
    const observed = records.observe(workId, records.read(workId).revision, { of: 'pr', state: 'closed' });

    records.setNeedsYou(
        workId,
        observed.revision,
        `Its PR ${REPO}#40 closed without merging. Reopen it, start a replacement build from the same brief, or set the work aside.`,
    );
    await observeRecords(records, [REPO], reads);
    answers.ticket = { state: 'closed' };
    await observeRecords(records, [REPO], reads);

    const record = records.read(workId);

    assert.deepEqual(
        [record.needsYou, record.needsYouCauses],
        [null, [{ type: 'pr-closed' }, { type: 'ticket-closed' }]],
    );
    answers.pr = 'open';
    await observeRecords(records, [REPO], reads);
    assert.deepEqual(records.read(workId).needsYouCauses, [{ type: 'ticket-closed' }]);
});

test('free text stays free text when the same read raises a cause, and a slice stays free text only', async () => {
    const records = await open();
    const { workId } = build(records);
    const slice = records.importTicket({
        title: 'Slice',
        repository: REPO,
        kind: 'slice',
        status: 'List',
        ticket: `${REPO}#99`,
    }).record;
    const { reads } = provider({ pr: 'closed', ticket: { state: 'closed' } });

    records.setNeedsYou(workId, records.read(workId).revision, 'Merge conflict.');
    await observeRecords(records, [REPO], reads);
    assert.deepEqual(
        [records.read(workId).needsYou, records.read(workId).needsYouCauses],
        ['Merge conflict.', [{ type: 'pr-closed' }, { type: 'ticket-closed' }]],
    );
    assert.deepEqual(
        [records.read(slice.workId).needsYou, records.read(slice.workId).needsYouCauses],
        [`Its ticket ${REPO}#99 closed in its provider.`, []],
    );
});

test('a confirmed not-found sets the work aside, and the record can be restored', async () => {
    const records = await open();
    const { workId } = records.importTicket({
        title: 'Bug',
        repository: REPO,
        kind: 'bug',
        status: 'List',
        ticket: `${REPO}#12`,
    }).record;

    await observeRecords(records, [REPO], provider({ ticket: { state: 'not-found' } }).reads);

    const record = records.read(workId);

    assert.equal(record.setAside, true);
    assert.equal(record.status, 'List');
    assert.deepEqual(record.needsYouCauses, [{ type: 'ticket-missing' }]);
    assert.equal(records.restore(workId, record.revision).setAside, false);
});

test('a temporary provider error keeps the last observation and changes nothing else', async () => {
    const records = await open();
    const { workId } = build(records);
    const { reads, answers } = provider({ pr: 'open', ticket: { state: 'open', assignee: 'pedro' } });

    await observeRecords(records, [REPO], reads);

    const before = records.read(workId);

    answers.pr = new Error('HTTP 502');
    answers.ticket = new Error('HTTP 502');
    await observeRecords(records, [REPO], reads);

    const after = records.read(workId);

    assert.deepEqual(
        [after.status, after.needsYou, after.setAside, after.finishedAt],
        [before.status, before.needsYou, before.setAside, before.finishedAt],
    );
    assert.deepEqual(
        records.observations(workId).map((o) => [o.of, o.state, o.assignee, o.failure]),
        [
            ['ticket', 'open', 'pedro', 'HTTP 502'],
            ['pr', 'open', null, 'HTTP 502'],
        ],
    );
});

test('a settled decision finishes while a concept without delivery stays unfinished', async () => {
    const records = await open();
    let decision = records.create({ title: 'Which store', repository: REPO, kind: 'decision', status: 'Shaping' });

    decision = records.setBody(decision.workId, decision.revision, 'answer', 'SQLite.');

    let concept = records.create({ title: 'Records', repository: REPO, kind: 'concept', status: 'Shaping' });

    finishCompleted(records, [REPO]);
    assert.deepEqual(
        [records.read(decision.workId).status, records.read(concept.workId).status],
        ['Shaping', 'Shaping'],
        'incomplete work keeps its Status',
    );
    records.setBody(decision.workId, decision.revision, 'domain-drafts', 'None.');
    concept = records.setFogGone(concept.workId, concept.revision, true);
    finishCompleted(records, [REPO]);
    for (const { workId } of [decision]) {
        const record = records.read(workId);

        assert.equal(record.status, 'Done');
        assert.ok(record.finishedAt);
    }
    assert.equal(records.read(concept.workId).status, 'Shaping');
    assert.equal(records.read(concept.workId).finishedAt, null);
});

/** A Dependency on `owner`'s ticket #5 and PR #9, held by a concept on the board with no ticket or PR of its own. */
function dependencyOn(records: WorkRecords, owner: string): string {
    const concept = records.create({ title: 'Concept', repository: REPO, kind: 'concept' });

    return records.addDependency(concept.workId, {
        need: 'A sign-in endpoint',
        owner,
        ticket: `${owner}#5`,
        pullRequests: [`${owner}#9`],
        handover: '# Handover',
    }).dependencyId;
}

/** What each of the Dependency's subjects was last read as, ticket first. */
const kinds = (records: WorkRecords, id: string) => records.dependency(id).observations.map((o) => o.kind);

/** A fake gh answering the Dependency's issue view and pr view from `answers`, each throwing to fail the call. */
function ghAnswering(answers: { ticket: () => string; pr: () => string }) {
    const calls: string[][] = [];
    const run = async (args: string[]) => (calls.push(args), args[0] === 'issue' ? answers.ticket() : answers.pr());
    const reads: ObserveReads = {
        ticket: (repo, number) => observeIssue(repo, number, run),
        pr: (repo, number) => observePr(repo, number, run),
    };

    return { calls, reads };
}

const issue = (state: string) => () => JSON.stringify({ state, assignees: [] });
const fails = (message: string) => () => {
    throw new Error(message);
};

test("a Dependency's GitHub ticket and PR read as each kind, and the reads write nothing", async () => {
    const records = await open();
    const id = dependencyOn(records, 'acme/auth');
    const answers = { ticket: issue('OPEN'), pr: () => 'OPEN' };
    const gh = ghAnswering(answers);
    const observed = async (ticket: () => string, pr: () => string) => {
        Object.assign(answers, { ticket, pr });
        await observeRecords(records, [REPO], gh.reads);

        return kinds(records, id);
    };

    assert.deepEqual(await observed(issue('OPEN'), () => 'OPEN'), ['open', 'open']);
    assert.deepEqual(await observed(issue('CLOSED'), () => 'MERGED'), ['closed', 'merged']);
    assert.deepEqual(await observed(issue('OPEN'), () => 'CLOSED'), ['reopened', 'closed']);
    assert.deepEqual(
        await observed(issue('OPEN'), () => 'OPEN'),
        ['reopened', 'reopened'],
        'it stays reopened while it stays open',
    );
    assert.deepEqual(
        await observed(
            fails('GraphQL: Could not resolve to an issue or pull request with the number of 5.'),
            fails('GraphQL: Could not resolve to a PullRequest with the number of 9.'),
        ),
        ['deleted', 'deleted'],
    );
    assert.deepEqual(
        await observed(
            fails('HTTP 403: Resource not accessible by personal access token'),
            fails('HTTP 401: Bad credentials'),
        ),
        ['access-lost', 'access-lost'],
    );
    assert.deepEqual(
        await observed(
            fails('HTTP 502: Bad Gateway'),
            fails("GraphQL: Could not resolve to a Repository with the name 'acme/auth'."),
        ),
        ['read-failed', 'read-failed'],
        "a repository GitHub doesn't resolve may be deleted or hidden, so it is a failed read",
    );
    assert.deepEqual(
        records.dependency(id).observations.map((o) => [o.detail, o.lastGood?.kind]),
        [
            ['HTTP 502: Bad Gateway', 'deleted'],
            ["GraphQL: Could not resolve to a Repository with the name 'acme/auth'.", 'deleted'],
        ],
    );
    assert.deepEqual(
        [...new Set(gh.calls.map((call) => call.slice(0, 2).join(' ')))],
        ['issue view', 'pr view'],
        'only views, never an edit',
    );
});

test('a read never changes the met mark: an outage leaves it unflagged, and a reopened ticket flags it for review', async () => {
    const records = await open();
    const id = dependencyOn(records, 'acme/auth');
    const answers = { ticket: issue('CLOSED'), pr: () => 'MERGED' };
    const { reads } = ghAnswering(answers);

    await observeRecords(records, [REPO], reads);
    records.markDependencyMet(id, records.dependency(id).revision, 'pedro');

    Object.assign(answers, { ticket: fails('HTTP 502: Bad Gateway'), pr: fails('HTTP 502: Bad Gateway') });
    await observeRecords(records, [REPO], reads);

    const outage = records.dependency(id);

    assert.deepEqual([outage.met?.by, outage.needsReview, outage.handover], ['pedro', false, '# Handover']);
    assert.deepEqual(
        outage.observations.map((o) => [o.kind, o.lastGood?.kind]),
        [
            ['read-failed', 'closed'],
            ['read-failed', 'merged'],
        ],
    );

    Object.assign(answers, { ticket: issue('OPEN'), pr: () => 'MERGED' });
    await observeRecords(records, [REPO], reads);

    const reopened = records.dependency(id);

    assert.deepEqual(
        [reopened.met?.by, reopened.needsReview, kinds(records, id)],
        ['pedro', true, ['reopened', 'merged']],
    );
});

test("a read showing the record and its ticket agree keeps that kind, so a later ticket change is the ticket's", async () => {
    const records = await open();
    const { workId } = records.importTicket({ title: 'T', repository: REPO, kind: 'bug', ticket: `${REPO}#12` }).record;
    const { reads } = provider({ ticket: { state: 'open' } });
    let agreed: 'bug' | null = null;
    const observing = { ...reads, agreedKind: () => agreed };

    await observeRecords(records, [REPO], observing);
    assert.equal(records.read(workId).agreedTicketKind, null);
    agreed = 'bug';
    await observeRecords(records, [REPO], observing);
    assert.equal(records.read(workId).agreedTicketKind, 'bug');
});

test('an open ticket read begun before merge cannot overwrite the merge-time refresh', async () => {
    const records = await open();
    const { workId } = build(records);
    let release!: (ticket: TicketObservation) => void;
    let started!: () => void;
    const reading = new Promise<void>((resolve) => {
        started = resolve;
    });
    const stale = observeRecords(records, [REPO], {
        pr: async () => 'open',
        ticket: () => {
            started();

            return new Promise<TicketObservation>((resolve) => {
                release = resolve;
            });
        },
    });

    await reading;
    records.observe(workId, records.read(workId).revision, { of: 'pr', state: 'merged' });
    records.update(workId, records.read(workId).revision, { status: 'Done' });
    records.observe(workId, records.read(workId).revision, { of: 'ticket', state: 'closed' });
    release({ state: 'open' });
    await stale;
    assert.equal(records.observations(workId).find((o) => o.of === 'ticket')?.state, 'closed');
});
