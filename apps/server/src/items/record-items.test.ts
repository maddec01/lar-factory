import {
    effectiveVocabulary,
    normalizeItems,
    type Item,
    type NeedsYouCause,
    type NeedsYouOffer,
    type RepositorySetup,
    type Status,
    type VocabularyMapping,
} from '@lar-factory/shared';
import { boardIssue } from '@lar-factory/shared/test/raw-items';
import { DEFAULT_RETENTION, openWorkRecords, type WorkRecords } from '@lar-factory/work-records';
import { changeKind } from '@lar-factory/work-records/change-kind';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, test } from 'vite-plus/test';

import { agreedKind, archivedItems, recordItems, recordItemsReader, ticketsByReference } from './record-items.ts';

const REPO = 'maddec01/lar-factory';
const opened: { records: WorkRecords; dir: string }[] = [];

afterEach(() => {
    for (const { records, dir } of opened.splice(0)) {
        records.close();
        rmSync(dir, { recursive: true, force: true });
    }
});

async function open(): Promise<WorkRecords> {
    const dir = mkdtempSync(join(tmpdir(), 'record-items-'));
    const records = await openWorkRecords(join(dir, 'work-records.db'));

    opened.push({ records, dir });

    return records;
}

/** A second connection to the records opened last, which reads them in turns as the board's does. */
async function openReader(): Promise<WorkRecords> {
    const { dir } = opened.at(-1)!;
    const records = await openWorkRecords(join(dir, 'work-records.db'));

    opened.push({ records, dir });

    return records;
}

const tickets = (...issues: Parameters<typeof boardIssue>[]) =>
    normalizeItems(issues.map((args) => boardIssue(...args)));

test('ticketless decisions expose their local method as soon as it is written', async () => {
    const records = await open();
    const decision = records.create({ title: 'Choose the layout', repository: REPO, kind: 'decision' });

    assert.equal(recordItems(records, [], [REPO])[0]?.decisionMethod, null);
    records.setBody(decision.workId, decision.revision, 'decision', 'Method: prototype\nChoose the stage layout.');
    assert.equal(recordItems(records, [], [REPO])[0]?.decisionMethod, 'prototype');
});

test("a ticketless build's recorded PR is its linked PR, from the record's last observation, with its pipeline unread", async () => {
    const records = await open();
    let build = records.create({ title: 'Ticketless', repository: REPO, kind: 'build' });

    build = records.setPullRequest(build.workId, build.revision, `${REPO}#835`);

    const pr = {
        number: 835,
        url: `https://github.com/${REPO}/pull/835`,
        isDraft: false,
        checks: null,
        mergeState: 'checking',
        pipelineUnread: true,
    };

    assert.deepEqual(
        recordItems(records, [], [REPO])[0]!.linkedPrs,
        [{ ...pr, state: 'open' }],
        'open until an observation says otherwise',
    );
    records.observe(build.workId, build.revision, { of: 'pr', state: 'closed' });
    assert.deepEqual(recordItems(records, [], [REPO])[0]!.linkedPrs, [{ ...pr, state: 'closed' }]);
});

test("a ticket's linked PRs follow the recorded PR, and the ticket's read of that same PR is the one kept, first", async () => {
    const records = await open();
    const linked = (number: number) => ({
        number,
        url: `https://github.com/${REPO}/pull/${number}`,
        state: 'open' as const,
        isDraft: false,
        checks: null,
        mergeState: 'can merge' as const,
    });
    const [ticket] = tickets([12, 'Review']);
    const read = { ...ticket!, linkedPrs: [linked(40), linked(41)] };
    let work = records.importTicket({
        title: 'With a ticket',
        repository: REPO,
        kind: 'feature',
        status: 'Review',
        ticket: `${REPO}#12`,
    }).record;

    assert.deepEqual(
        recordItems(records, [read], [REPO])[0]!.linkedPrs,
        [linked(40), linked(41)],
        'no recorded PR leaves the ticket links alone',
    );
    work = records.setPullRequest(work.workId, work.revision, `${REPO}#41`);
    assert.deepEqual(recordItems(records, [read], [REPO])[0]!.linkedPrs, [linked(41), linked(40)]);
    work = records.setPullRequest(work.workId, work.revision, `${REPO.toUpperCase()}#42`);
    assert.deepEqual(
        recordItems(records, [read], [REPO])[0]!.linkedPrs.map((pr) => [pr.number, pr.pipelineUnread]),
        [
            [42, true],
            [40, undefined],
            [41, undefined],
        ],
    );
});

test('recorded work keeps its progress and unpicked tracker issues appear fresh in List', async () => {
    const records = await open();
    const recorded = records.importTicket({
        title: 'Recorded',
        repository: REPO,
        kind: 'feature',
        status: 'Queued',
        ticket: `${REPO}#12`,
    }).record;

    records.create({ title: 'Elsewhere', repository: 'maddec01/other', kind: 'bug' });

    const items = recordItems(records, tickets([12, 'List'], [13, 'Shaping']), [REPO]);

    assert.deepEqual(
        items.map((i) => [i.id, i.number, i.status, i.kind, i.revision]),
        [
            [recorded.workId, 12, 'Queued', 'feature', recorded.revision],
            [items[1]!.id, 13, 'List', 'issue', 0],
        ],
    );
    assert.equal(items[0]!.url, `https://github.com/${REPO}/issues/12`);
});

test("a ticket edit never changes the record's Status, kind or title", async () => {
    const records = await open();

    records.importTicket({
        title: 'Kept title',
        repository: REPO,
        kind: 'feature',
        status: 'Ready',
        ticket: `${REPO}#12`,
    });

    const [item] = recordItems(records, tickets([12, 'Review', REPO, ['bug']]), [REPO]);

    assert.deepEqual(
        [item!.status, item!.statuses, item!.kind, item!.title],
        ['Ready', ['Ready'], 'feature', 'Kept title'],
    );
    assert.ok(item!.labels.includes('bug'), 'the ticket supplies its labels as context');
});

test("a recorded item takes its ticket's labels and colours from the read, and the record stores neither", async () => {
    const records = await open();
    const { record } = records.importTicket({
        title: 'Coloured',
        repository: REPO,
        kind: 'feature',
        status: 'Queued',
        ticket: `${REPO}#12`,
    });
    const [ticket] = tickets([12, 'Queued', REPO, ['area: web']]);
    const [item] = recordItems(records, [{ ...ticket!, labelColors: { 'area: web': '#BFDADC' } }], [REPO]);

    assert.deepEqual(item!.labelColors, { 'area: web': '#BFDADC' });
    assert.deepEqual(recordItems(records, [], [REPO]).find((i) => i.id === record.workId)!.labelColors, undefined);
    assert.equal(JSON.stringify(records.read(record.workId)).includes('BFDADC'), false);
});

test('a ticketless record and a record whose ticket the read did not list show from the record alone', async () => {
    const records = await open();
    const local = records.create({ title: 'Local', repository: REPO, kind: 'improvement', status: 'Shaping' });

    records.importTicket({ title: 'Unread', repository: REPO, kind: 'bug', ticket: `${REPO}#40` });

    const items = recordItems(records, [], [REPO]);

    assert.deepEqual(
        items.map((i) => [i.title, i.number, i.url, i.status, i.state]),
        [
            ['Local', 0, null, 'Shaping', 'open'],
            ['Unread', 40, null, 'List', 'open'],
        ],
    );
    assert.equal(items[0]!.id, local.workId);
});

test('set-aside work and slices are no board items; a Done record is closed as done', async () => {
    const records = await open();
    const build = records.create({ title: 'Build', repository: REPO, kind: 'build', status: 'Done' });
    const aside = records.create({ title: 'Aside', repository: REPO, kind: 'bug' });

    records.setAside(aside.workId, aside.revision);

    const slice = records.create({ title: 'Slice', repository: REPO, kind: 'slice' });

    records.setParent(slice.workId, slice.revision, build.workId);

    const items = recordItems(records, [], [REPO]);

    assert.deepEqual(
        items.map((i) => [i.title, i.state, i.closedAs]),
        [['Build', 'closed', 'done']],
    );
});

test('finished work retention hides leaves the board for Archive, and set-aside work is in Archive until Restore brings it back', async () => {
    const records = await open();
    const finished = records.create({ title: 'Finished', repository: REPO, kind: 'build', status: 'Done' });

    records.recordFinished(finished.workId, finished.revision);

    const aside = records.importTicket({ title: 'Aside', repository: REPO, kind: 'bug', ticket: `${REPO}#12` }).record;

    records.setAside(aside.workId, aside.revision);

    const read = tickets([12, 'List']);
    const week = new Set(records.hidden(DEFAULT_RETENTION).map((r) => r.workId));

    assert.deepEqual(
        recordItems(records, read, [REPO], [], week).map((i) => i.title),
        ['Finished'],
        'finished work stays for seven days',
    );

    const later = new Set(
        records.hidden(DEFAULT_RETENTION, new Date(Date.now() + 8 * 86_400_000)).map((r) => r.workId),
    );

    assert.deepEqual(recordItems(records, read, [REPO], [], later), []);
    assert.deepEqual(
        archivedItems(records, read, [REPO], later).map((i) => [i.title, i.archived]),
        [
            ['Finished', { setAside: false, hidden: true, ticketOpen: false }],
            ['Aside', { setAside: true, hidden: true, ticketOpen: true }],
        ],
    );
    records.restore(aside.workId, records.read(aside.workId).revision);
    assert.deepEqual(
        recordItems(records, read, [REPO], [], new Set(records.hidden(DEFAULT_RETENTION).map((r) => r.workId))).map(
            (i) => i.title,
        ),
        ['Finished', 'Aside'],
    );
});

test("a record's structure, blockers and slices come from records", async () => {
    const records = await open();
    const concept = records.create({ title: 'Concept', repository: REPO, kind: 'concept', status: 'Shaping' });
    let build = records.create({ title: 'Build', repository: REPO, kind: 'build', status: 'In progress' });

    build = records.setParent(build.workId, build.revision, concept.workId);

    const blocker = records.importTicket({
        title: 'Blocker',
        repository: REPO,
        kind: 'decision',
        ticket: `${REPO}#5`,
    }).record;

    build = records.addBlocker(build.workId, build.revision, blocker.workId);

    const slice = records.create({ title: 'First slice', repository: REPO, kind: 'slice', status: 'In progress' });

    records.setParent(slice.workId, slice.revision, build.workId);
    records.setBody(
        concept.workId,
        records.read(concept.workId).revision,
        'map',
        '## Destination\n\nWhere it goes.\n\n## Fog\n\n- What is left\n',
    );

    const items = recordItems(records, [], [REPO]);
    const shown = (title: string) => items.find((i) => i.title === title)!;

    assert.equal(shown('Build').parentId, concept.workId);
    assert.deepEqual(shown('Build').parent && [shown('Build').parent!.title, shown('Build').parent!.number], [
        'Concept',
        0,
    ]);
    assert.deepEqual(shown('Build').blockers, [
        { number: 5, repo: REPO, state: 'open', workId: blocker.workId, title: 'Blocker' },
    ]);
    assert.deepEqual(
        shown('Build').slices.map((s) => [s.title, s.progress]),
        [['First slice', 'waiting']],
    );
    assert.deepEqual(shown('Concept').subIssues, { total: 1, completed: 0 });
    assert.deepEqual(shown('Concept').map, { destination: 'Where it goes.', decisions: [], fog: ['What is left'] });
});

test("only the record's blockers hold it: its ticket's provider blockers never do", async () => {
    const records = await open();

    records.importTicket({
        title: 'Ticketed',
        repository: REPO,
        kind: 'feature',
        status: 'Queued',
        ticket: `${REPO}#12`,
    });

    const [ticket] = tickets([12, 'Queued']);
    const [item] = recordItems(
        records,
        [{ ...ticket!, blockers: [{ number: 11, repo: REPO, state: 'open' }] }],
        [REPO],
    );

    assert.deepEqual(item!.blockers, []);
});

test('a Dependency blocking a build is one of its blockers, open until the user marks it met, whatever its ticket shows', async () => {
    const records = await open();
    const concept = records.create({ title: 'Concept', repository: REPO, kind: 'concept', status: 'Shaping' });
    const build = records.create({ title: 'Build', repository: REPO, kind: 'build', status: 'Ready' });

    records.setParent(build.workId, build.revision, concept.workId);

    let dependency = records.addDependency(concept.workId, {
        need: 'An export endpoint',
        owner: 'server team',
        evidence: 'It answers in staging',
        ticket: 'maddec01/lar-server#40',
        pullRequests: ['maddec01/lar-server#41'],
    });

    dependency = records.addDependencyBlock(dependency.dependencyId, dependency.revision, build.workId);
    dependency = records.observeDependency(dependency.dependencyId, dependency.revision, {
        subject: 'maddec01/lar-server#41',
        kind: 'open',
    });
    dependency = records.observeDependency(dependency.dependencyId, dependency.revision, {
        subject: 'maddec01/lar-server#40',
        kind: 'closed',
    });

    const shown = () => recordItems(records, [], [REPO]).find((i) => i.id === build.workId)!.blockers;
    const [blocker] = shown();

    assert.deepEqual(
        {
            ...blocker,
            dependency: {
                ...blocker!.dependency,
                observation: { ...blocker!.dependency!.observation, observedAt: '' },
            },
        },
        {
            number: 40,
            repo: 'maddec01/lar-server',
            state: 'open',
            title: 'An export endpoint',
            dependency: {
                dependencyId: dependency.dependencyId,
                revision: dependency.revision,
                owner: 'server team',
                need: 'An export endpoint',
                ticket: 'maddec01/lar-server#40',
                named: [
                    { reference: 'maddec01/lar-server#40', url: 'https://github.com/maddec01/lar-server/issues/40' },
                    { reference: 'maddec01/lar-server#41', url: 'https://github.com/maddec01/lar-server/pull/41' },
                ],
                evidence: 'It answers in staging',
                met: null,
                needsReview: false,
                observation: {
                    subject: 'maddec01/lar-server#40',
                    kind: 'closed',
                    detail: null,
                    observedAt: '',
                    lastGood: null,
                },
            },
        },
    );
    dependency = records.markDependencyMet(dependency.dependencyId, dependency.revision, 'pedro');
    assert.deepEqual(
        shown().map((b) => [b.state, b.dependency!.met?.by]),
        [['closed', 'pedro']],
    );
    records.observeDependency(dependency.dependencyId, dependency.revision, {
        subject: 'maddec01/lar-server#40',
        kind: 'reopened',
    });
    assert.deepEqual(
        shown().map((b) => [b.state, b.dependency!.needsReview]),
        [['closed', true]],
        'a changed observation asks for a review and keeps the mark',
    );
});

test("a Dependency's Azure work item and PR link to their pages", async () => {
    const records = await open();
    const build = records.create({ title: 'Build', repository: REPO, kind: 'build', status: 'Ready' });
    const API = 'contoso/Fabrikam%20Fiber/Web%20Api';
    const dependency = records.addDependency(build.workId, {
        need: 'An export endpoint',
        owner: API,
        ticket: `${API}#5`,
        pullRequests: [`${API}#9`],
    });

    records.addDependencyBlock(dependency.dependencyId, dependency.revision, build.workId);

    const [blocker] = recordItems(records, [], [REPO]).find((i) => i.id === build.workId)!.blockers;

    assert.deepEqual(blocker!.dependency!.named, [
        { reference: `${API}#5`, url: 'https://dev.azure.com/contoso/Fabrikam%20Fiber/_workitems/edit/5' },
        { reference: `${API}#9`, url: 'https://dev.azure.com/contoso/Fabrikam%20Fiber/_git/Web%20Api/pullrequest/9' },
    ]);
});

test("in a repository whose source hasn't read yet, only a record with a ticket waits for it", async () => {
    const records = await open();

    records.importTicket({ title: 'Unread', repository: REPO, kind: 'bug', ticket: `${REPO}#40` });
    records.create({ title: 'Local', repository: REPO, kind: 'feature' });
    assert.deepEqual(
        recordItems(records, [], [REPO], [REPO]).map((i) => i.title),
        ['Local'],
    );
    assert.deepEqual(
        recordItems(records, tickets([40, 'List']), [REPO], [REPO]).map((i) => i.title),
        ['Unread', 'Local'],
    );
});

/** A build on REPO with ticket #12 and PR #40, with `pr` and `ticket` as its last reads. */
function observedBuild(
    records: WorkRecords,
    {
        pr,
        ticket,
        assignee,
        status = 'Review',
    }: { pr?: 'open' | 'closed'; ticket?: 'open' | 'closed' | 'not-found'; assignee?: string; status?: Status },
) {
    const made = records.importTicket({
        title: 'Build',
        repository: REPO,
        kind: 'build',
        status,
        ticket: `${REPO}#12`,
    }).record;
    let record = records.setPullRequest(made.workId, made.revision, `${REPO}#40`);

    if (pr) record = records.observe(made.workId, record.revision, { of: 'pr', state: pr });

    if (ticket)
        record = records.observe(made.workId, record.revision, {
            of: 'ticket',
            state: ticket,
            ...(assignee && { assignee }),
        });

    return record;
}

const noticeOf = (records: WorkRecords, workId: string) =>
    recordItems(records, [], [REPO]).find((item) => item.id === workId)?.needsYou;

const PR_CLOSED = `Its PR ${REPO}#40 closed without merging.`;
const TICKET_CLOSED = `Its ticket ${REPO}#12 closed in its provider.`;
const NO_THREAD_NOW =
    'The board asked T3 for a thread, but T3 shows no thread for it. Check its T3 project in T3 Code.';
const MISSING = `Its ticket ${REPO}#12 wasn't found in its provider, so the board set the work aside. Restore it from Settings › Archive once the ticket is back.`;

test('a no-thread notice names the purpose of the start that failed, and other notices name none', async () => {
    const records = await open();
    const record = observedBuild(records, {});
    const { record: asked, intent } = records.recordLaunchIntent(record.workId, record.revision, 'build');
    const failed = records.resolveLaunchIntent(record.workId, asked.revision, intent.intentId, {
        failure: NO_THREAD_NOW,
    }).record;
    const waiting = records.setNeedsYouCauses(record.workId, failed.revision, [{ type: 'no-thread' }]);

    assert.equal(noticeOf(records, record.workId)?.startAgainPurpose, 'build');
    records.setNeedsYouCauses(record.workId, waiting.revision, [{ type: 'ticket-closed' }]);
    assert.equal(noticeOf(records, record.workId)?.startAgainPurpose, undefined);
});

test('each cause decides the text and the exact offers of its notice', async () => {
    const moved = { type: 'assignee-changed', from: 'pedro', to: null } as const;
    const rows: [NeedsYouCause[], string, NeedsYouOffer[]][] = [
        [[{ type: 'pr-closed' }], PR_CLOSED, ['reopen-pr', 'replace-pr', 'set-aside']],
        [
            [{ type: 'ticket-closed' }, { type: 'pr-closed' }],
            `${PR_CLOSED} ${TICKET_CLOSED}`,
            ['reopen-pr', 'replace-pr', 'set-aside'],
        ],
        [[{ type: 'ticket-closed' }], TICKET_CLOSED, ['keep-working', 'set-aside']],
        [[moved], `Its ticket ${REPO}#12 moved from pedro to no one.`, ['keep-working', 'set-aside']],
        [[{ type: 'no-thread' }], NO_THREAD_NOW, ['start-again', 'set-aside']],
        [[{ type: 'ticket-missing' }], MISSING, ['mark-handled', 'set-aside']],
    ];

    for (const [causes, reason, offers] of rows) {
        const records = await open();
        const record = observedBuild(records, {});

        records.setNeedsYouCauses(record.workId, record.revision, causes);
        assert.deepEqual(noticeOf(records, record.workId)?.reason, reason);
        assert.deepEqual(noticeOf(records, record.workId)?.offers, offers);
    }
});

test('free text and causes show together, and the first matching row of causes decides the offers', async () => {
    const records = await open();
    const record = observedBuild(records, { ticket: 'closed' });
    const written = records.setNeedsYou(record.workId, record.revision, 'Merge conflict.');

    assert.deepEqual(noticeOf(records, record.workId), {
        reason: 'Merge conflict.',
        offers: ['mark-handled', 'set-aside'],
        causes: [],
        ticketOpen: false,
        hasOtherNote: true,
    });
    records.setNeedsYouCauses(record.workId, written.revision, [{ type: 'ticket-closed' }]);
    assert.deepEqual(noticeOf(records, record.workId), {
        reason: `${TICKET_CLOSED} Merge conflict.`,
        offers: ['keep-working', 'set-aside'],
        causes: [{ type: 'ticket-closed' }],
        ticketOpen: false,
        hasOtherNote: true,
    });
});

test('a notice says whether the ticket reads open', async () => {
    const records = await open();
    const record = observedBuild(records, { pr: 'closed', ticket: 'open' });

    records.setNeedsYouCauses(record.workId, record.revision, [{ type: 'pr-closed' }]);
    assert.deepEqual(noticeOf(records, record.workId), {
        reason: PR_CLOSED,
        offers: ['reopen-pr', 'replace-pr', 'set-aside'],
        causes: [{ type: 'pr-closed' }],
        ticketOpen: true,
    });
});

test('a stale closed PR adds nothing to an unrelated reason', async () => {
    const records = await open();
    const record = observedBuild(records, { pr: 'closed', ticket: 'closed' });

    records.setNeedsYou(record.workId, record.revision, 'Its PR closed without merging.');
    assert.deepEqual(noticeOf(records, record.workId), {
        reason: 'Its PR closed without merging.',
        offers: ['mark-handled', 'set-aside'],
        causes: [],
        ticketOpen: false,
        hasOtherNote: true,
    });
});

test('no notice saved on Done work shows, whatever it holds', async () => {
    const typed = await open();
    const cause = observedBuild(typed, { ticket: 'open', status: 'Done' });

    typed.setNeedsYouCauses(cause.workId, cause.revision, [{ type: 'ticket-closed' }]);
    assert.equal(noticeOf(typed, cause.workId), undefined);
    for (const saved of [
        'Merge conflict.',
        `Its ticket ${REPO}#12 reopened after the work was Done. Reopen the work, or clear this.`,
    ]) {
        const records = await open();
        const record = observedBuild(records, { ticket: 'open', status: 'Done' });

        records.setNeedsYou(record.workId, record.revision, saved);
        assert.equal(noticeOf(records, record.workId), undefined);
    }
});

const OLD_PR = `Its PR ${REPO}#40 closed without merging. Reopen it, start a replacement build from the same brief, or set the work aside.`;
const OLD_TICKET = `Its ticket ${REPO}#12 closed in its provider. Set the work aside, or clear this to keep working.`;

test('saved old wording reads as causes and shows new wording, with no reason to clear anything', async () => {
    const rows: [string, Parameters<typeof observedBuild>[1], string, NeedsYouCause[]][] = [
        [OLD_PR, { pr: 'closed' }, PR_CLOSED, [{ type: 'pr-closed' }]],
        [OLD_TICKET, { ticket: 'closed' }, TICKET_CLOSED, [{ type: 'ticket-closed' }]],
        [
            `Its ticket ${REPO}#12 moved from pedro to no one. Check who owns the work, then clear this.`,
            { ticket: 'open', assignee: 'ana' },
            `Its ticket ${REPO}#12 moved from pedro to no one.`,
            [{ type: 'assignee-changed', from: 'pedro', to: null }],
        ],
        [MISSING, { ticket: 'not-found' }, MISSING, [{ type: 'ticket-missing' }]],
        [
            "The board asked T3 for a thread, but T3 shows no thread for it. Check the repository's project in T3 Code, then clear Needs you to start again.",
            {},
            NO_THREAD_NOW,
            [{ type: 'no-thread' }],
        ],
    ];

    for (const [saved, observed, reason, causes] of rows) {
        const records = await open();
        const record = observedBuild(records, observed);

        records.setNeedsYou(record.workId, record.revision, saved);
        assert.deepEqual(
            [noticeOf(records, record.workId)?.reason, noticeOf(records, record.workId)?.causes],
            [reason, causes],
        );
        assert.doesNotMatch(noticeOf(records, record.workId)!.reason, /clear/i);
    }
});

test('a crafted reason reads as free text at once, whatever its length', async () => {
    const crafted = (repeats: number) =>
        `Its ticket a#1${' moved from x to'.repeat(repeats)} y. Check who owns the work, then clear this!`;

    for (const reason of [crafted(2200), crafted(25)]) {
        const records = await open();
        const record = observedBuild(records, {});

        records.setNeedsYou(record.workId, record.revision, reason);

        const started = performance.now();
        const notice = noticeOf(records, record.workId);

        assert.ok(performance.now() - started < 1000, 'matching stays fast');
        assert.deepEqual([notice?.reason, notice?.causes], [reason, []]);
    }
});

test('a saved cause whose observation now reads ended no longer counts', async () => {
    const rows: [string, Parameters<typeof observedBuild>[1]][] = [
        [OLD_PR, { pr: 'open' }],
        [OLD_TICKET, { ticket: 'open' }],
        [
            `Its ticket ${REPO}#12 moved from pedro to ana. Check who owns the work, then clear this.`,
            { ticket: 'open', assignee: 'pedro' },
        ],
        [MISSING, { ticket: 'open' }],
    ];

    for (const [saved, observed] of rows) {
        const records = await open();
        const record = observedBuild(records, observed);

        records.setNeedsYou(record.workId, record.revision, saved);
        assert.equal(noticeOf(records, record.workId), undefined);
    }
});

test('concept counts completed decision facts while its Status remains Shaping, and recovered structure starts with no local completion', async () => {
    const records = await open();
    const concept = records.create({ repository: REPO, kind: 'concept', title: 'Naming concept', status: 'Shaping' });
    let first = records.create({ repository: REPO, kind: 'decision', title: 'Choose the name', status: 'Shaping' });

    first = records.setParent(first.workId, first.revision, concept.workId);

    let second = records.create({
        repository: REPO,
        kind: 'decision',
        title: 'Choose the visibility',
        status: 'Shaping',
    });

    second = records.setParent(second.workId, second.revision, concept.workId);
    first = records.setBody(first.workId, first.revision, 'answer', 'Use the native issue title.');
    first = records.setBody(first.workId, first.revision, 'domain-drafts', 'none');
    records.setBody(
        concept.workId,
        records.read(concept.workId).revision,
        'map',
        '## Destination\nClear names.\n\n## Decisions so far\n- Use the native issue title.\n\n## Fog\n- Visibility remains open.\n',
    );

    let ready = records.create({ repository: REPO, kind: 'build', title: 'Ready work', status: 'Ready' });

    ready = records.setBody(ready.workId, ready.revision, 'brief', 'A private passing brief.');
    records.recordGate(ready.workId, ready.revision, {
        briefDigest: records.gate(ready.workId).briefDigest!,
        approvedBy: 'reviewer',
        evidence: 'Checks passed.',
    });
    assert.deepEqual(records.completion(first.workId), { complete: true, reasons: [] });

    const items = recordItems(records, [], [REPO]);
    const shown = (id: string) => items.find((item) => item.id === id)!;

    assert.deepEqual(shown(concept.workId).subIssues, { total: 2, completed: 1 });
    assert.deepEqual(
        [
            shown(first.workId).kind,
            shown(first.workId).status,
            shown(first.workId).labels,
            shown(first.workId).completion,
        ],
        ['decision', 'Shaping', [], { complete: true, reasons: [] }],
    );
    assert.equal(shown(second.workId).completion?.complete, false);
    assert.deepEqual(
        [shown(ready.workId).status, shown(ready.workId).completion?.complete, records.gate(ready.workId).current],
        ['Ready', false, true],
    );

    const snapshot = records.trackerSnapshot(concept.workId);
    const encoded = JSON.stringify(snapshot);

    for (const localOnly of ['"completion":', '"status":', '"answer":', '"domain-drafts":', 'A private passing brief.'])
        assert.ok(!encoded.includes(localOnly));

    const fresh = await open();
    const restored = fresh.trackerRestore(snapshot, 'a'.repeat(64));
    const recovered = recordItems(fresh, [], [REPO]);

    assert.deepEqual(recovered.find((item) => item.id === restored)!.subIssues, { total: 2, completed: 0 });
    assert.ok(recovered.every((item) => item.status === 'List' && item.completion?.complete === false));
    assert.deepEqual(recovered.find((item) => item.id === restored)!.map?.decisions, ['Use the native issue title.']);
});

const SWAPS: [string, VocabularyMapping, string[]][] = [
    [
        'a mapping',
        { bug: { type: null, labels: ['type: bug'] }, feature: { type: null, labels: ['type: feature'] } },
        ['type: bug', 'docs'],
    ],
    ['no mapping', {}, ['bug', 'docs']],
];

for (const [name, vocabulary, labels] of SWAPS)
    test(`a board read after a kind swap keeps the new kind, with ${name}`, async () => {
        const records = await open();
        const { workId, revision } = records.importTicket({
            title: 'Swapped',
            repository: REPO,
            kind: 'bug',
            ticket: `${REPO}#12`,
        }).record;
        let onTicket: string[] = [...labels];
        const setup = {
            repo: REPO,
            access: { 'tag-ticket': 'allowed', 'type-ticket': 'allowed' },
            vocabulary: effectiveVocabulary(vocabulary).vocabulary,
        } as unknown as RepositorySetup;
        const { error } = await changeKind(records, workId, revision, 'feature', {
            setup,
            labels: {
                addToTicket: async (_, names) => {
                    onTicket.push(...names);
                },
                removeFromTicket: async (_, names) => {
                    onTicket = onTicket.filter((label) => !names.includes(label));
                },
            },
            kinds: {
                read: async () => ({ labels: onTicket, type: null }),
                setType: async () => {},
                boardTypes: async () => null,
            },
        });

        assert.equal(error, null);

        const [item] = recordItems(records, tickets([12, 'List', REPO, onTicket]), [REPO]);

        assert.equal(item!.kind, 'feature');
        assert.deepEqual(
            item!.labels.filter((label) => label !== 'status-list'),
            Object.keys(vocabulary).length ? ['docs', 'type: feature'] : ['docs'],
        );
    });

test('a board read keeps the kind even when the swap could not write, as the ticket still says the old one', async () => {
    const records = await open();
    const { workId, revision } = records.importTicket({
        title: 'Local',
        repository: REPO,
        kind: 'bug',
        ticket: `${REPO}#12`,
    }).record;
    const setup = {
        repo: REPO,
        access: { 'tag-ticket': 'refused' },
        vocabulary: effectiveVocabulary({}).vocabulary,
    } as unknown as RepositorySetup;

    await changeKind(records, workId, revision, 'feature', {
        setup,
        labels: { addToTicket: async () => {}, removeFromTicket: async () => {} },
        kinds: {
            read: async () => ({ labels: ['bug'], type: null }),
            setType: async () => {},
            boardTypes: async () => null,
        },
    });

    const [item] = recordItems(records, tickets([12, 'List', REPO, ['bug']]), [REPO]);

    assert.equal(item!.kind, 'feature');
});

const setupWith = (vocabulary: VocabularyMapping = {}) =>
    ({ repo: REPO, access: {}, vocabulary: effectiveVocabulary(vocabulary).vocabulary }) as unknown as RepositorySetup;
const MAPPED: VocabularyMapping = {
    bug: { type: null, labels: ['type: bug'] },
    feature: { type: null, labels: ['type: feature'] },
};
const importBug = (records: WorkRecords, kind: 'bug' | 'feature' | 'improvement' | 'concept' = 'bug') =>
    records.importTicket({ title: 'T', repository: REPO, kind, ticket: `${REPO}#12` }).record;
const readWith = (records: WorkRecords, labels: string[], vocabulary?: VocabularyMapping) =>
    recordItems(records, tickets([12, 'List', REPO, labels]), [REPO], [], new Set(), [setupWith(vocabulary)])[0]!;

test("a board read shows how the item's kind and its ticket's disagree, and an item that agrees has no disagreement", async () => {
    const records = await open();

    importBug(records);
    assert.deepEqual(readWith(records, ['feature']).kindDisagreement, {
        ticketKind: 'feature',
        changed: 'item',
        kept: false,
        swap: { add: [], remove: ['feature'], type: null },
    });
    assert.equal(readWith(records, ['bug']).kindDisagreement, undefined);
    assert.equal(readWith(records, ['feature', 'type: bug'], MAPPED).kindDisagreement, undefined);
});

test("a GitHub issue's type and an Azure work item's type both count", async () => {
    const records = await open();

    importBug(records);

    const [ticket] = tickets([12, 'List', REPO, []]);
    const read = (more: Partial<typeof ticket & object>) =>
        recordItems(records, [{ ...ticket!, ...more }], [REPO], [], new Set(), [setupWith()])[0]!.kindDisagreement
            ?.ticketKind;

    assert.equal(read({ issueType: 'Feature' }), 'feature');
    assert.equal(
        read({ azure: { type: 'User Story', state: 'New' } as NonNullable<typeof ticket & object>['azure'] }),
        'feature',
    );
});

test("a kept answer shows as kept until the ticket's kind changes", async () => {
    const records = await open();
    const { workId, revision } = importBug(records);

    records.recordKindAnswer(workId, revision, { answer: 'keep', ticketKind: 'feature' });
    assert.equal(readWith(records, ['feature']).kindDisagreement?.kept, true);
    assert.equal(readWith(records, ['improvement']).kindDisagreement?.kept, false);
});

for (const [name, vocabulary, labels] of SWAPS)
    test(`no disagreement shows on the board read after a swap, with ${name}`, async () => {
        const records = await open();
        const { workId, revision } = importBug(records);
        let onTicket = [...labels];
        const setup = {
            ...setupWith(vocabulary),
            access: { 'tag-ticket': 'allowed', 'type-ticket': 'allowed' },
        } as RepositorySetup;

        assert.ok(readWith(records, ['feature'], vocabulary).kindDisagreement);
        await changeKind(records, workId, revision, 'feature', {
            setup,
            labels: {
                addToTicket: async (_, names) => {
                    onTicket.push(...names);
                },
                removeFromTicket: async (_, names) => {
                    onTicket = onTicket.filter((label) => !names.includes(label));
                },
            },
            kinds: {
                read: async () => ({ labels: onTicket, type: null }),
                setType: async () => {},
                boardTypes: async () => null,
            },
        });
        assert.equal(readWith(records, onTicket, vocabulary).kindDisagreement, undefined);
    });

test('the kind a record and its ticket agree on comes from the last read and the mappings', async () => {
    const records = await open();
    const record = importBug(records);
    const byTicket = (labels: string[]) => ticketsByReference(tickets([12, 'List', REPO, labels]));
    const { vocabulary } = setupWith(MAPPED);

    assert.equal(agreedKind(record, byTicket(['feature', 'type: bug']), vocabulary), 'bug');
    assert.equal(agreedKind(record, byTicket(['feature']), vocabulary), null);
    assert.equal(agreedKind(record, new Map(), vocabulary), null);
    assert.equal(agreedKind(record, byTicket(['bug']), undefined), null);
});

test('disabled legacy settings retain pending concept content in board details', async () => {
    const records = await open();
    const concept = records.create({ repository: REPO, title: 'Retained concept', kind: 'concept' });

    records.setBody(concept.workId, concept.revision, 'map', 'Pending local map');

    const pending = records.trackerPending();
    const item = recordItems(records, [], [REPO], [], new Set(), [{ repo: REPO, structureSync: false }]).find(
        (item) => item.id === concept.workId,
    );

    assert.equal(item?.sync?.state, 'pending');
    assert.deepEqual(records.trackerPending(), pending);
});

test('concept projection separates refinement from delivery', async () => {
    const records = await open();
    const concept = records.create({ title: 'Concept', repository: REPO, kind: 'concept' });

    records.setBody(concept.workId, 1, 'map', '# Map');
    records.setFogGone(concept.workId, 2, true);

    const [item] = recordItems(records, [], [REPO]);

    assert.deepEqual(item!.refinement, { complete: true, reasons: [] });
    assert.deepEqual(item!.completion, { complete: false, reasons: ['No delivery planned.'] });
    assert.equal(item!.state, 'open');
});

test('records map fifty a turn into the same items a read in one turn shows', async () => {
    const records = await open();

    for (let i = 0; i < 250; i++) records.create({ title: `Work ${i}`, repository: REPO, kind: 'bug' });

    let turns = 0;
    const items = await recordItemsReader(await openReader())([], [REPO], [], new Set(), [], async () => {
        turns++;
    });

    assert.equal(turns, 5);
    assert.deepEqual(items, recordItems(records, [], [REPO]));
});

test('a read with no commit since the last and the same inputs gives its items again without mapping', async () => {
    const records = await open();

    for (let i = 0; i < 60; i++) records.create({ title: `Work ${i}`, repository: REPO, kind: 'bug' });

    const read = recordItemsReader(await openReader());
    // The tickets an item source read last, which the board keeps until the next read.
    const lastRead: Item[] = [];
    let turns = 0;
    const turn = async () => {
        turns++;
    };
    const first = await read(lastRead, [REPO], [], new Set(), [], turn);

    assert.equal(turns, 2);
    assert.equal(await read(lastRead, [REPO], [], new Set(), [], turn), first);
    assert.equal(turns, 2, 'no turn and no mapping');

    const hidden = await read(lastRead, [REPO], [], new Set([first[0]!.id]), [], turn);

    assert.equal(hidden.length, 59, 'other inputs map again');

    const work = records.create({ title: 'New', repository: REPO, kind: 'bug' });

    assert.ok(
        (await read(lastRead, [REPO], [], new Set([first[0]!.id]), [], turn)).some((item) => item.id === work.workId),
        'a commit maps again',
    );
});

test('commits between turns stay out of the read, which shows one state of the records in one pass', async () => {
    const records = await open();
    const first = records.create({ title: 'First', repository: REPO, kind: 'bug' });

    for (let i = 0; i < 60; i++) records.create({ title: `Work ${i}`, repository: REPO, kind: 'bug' });

    const before = recordItems(records, [], [REPO]);
    let turns = 0;
    const items = await recordItemsReader(await openReader())([], [REPO], [], new Set(), [], async () => {
        // Between the two halves of the read, the first record, already mapped, changes, and an observation adds one.
        if (++turns === 2) records.update(first.workId, first.revision, { status: 'Queued' });

        records.create({ title: `Observed ${turns}`, repository: REPO, kind: 'bug' });
    });

    assert.equal(turns, 2, 'commits that keep landing never make it read again');
    assert.deepEqual(items, before);
    assert.equal(
        recordItems(records, [], [REPO]).find((item) => item.id === first.workId)?.status,
        'Queued',
        'the next read shows them',
    );
});
