import {
    buildActivity,
    buildBranch,
    visibleKind,
    effectiveVocabulary,
    deskItems,
    deskWait,
    normalizeItems,
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

import { completeBrief } from '../../test/complete-brief.ts';
import shapingHold from '../../test/fixtures/s07-shaping-hold.json' with { type: 'json' };
import { legacyApprovalNotice } from '../../test/legacy-notice.ts';
import { sampleReviewControls } from '../sample/sample-review-controls.ts';
import { archivedItems, recordItems, recordItemsReader } from './record-items.ts';

const REPO = 'maddec01/lar-factory';
const OTHER_REPO = 'maddec01/lar-web';
const opened: { records: WorkRecords; dir: string }[] = [];

test('S07 repeat 6 preserves all saved runtime notices and identifies the completed held Doubt packages', async () => {
    const records = await open();
    const parent = records.create({ title: 'G', repository: REPO, kind: 'concept' });
    const parts = ['A1', 'A2', 'B1'].map((title) =>
        records.createPart({
            parentId: parent.workId,
            parentRevision: records.read(parent.workId).revision,
            title,
            repository: REPO,
            kind: 'build',
            body: completeBrief(title),
            blockerIds: [],
        }),
    );
    let decision = records.create({ title: 'DEC', repository: REPO, kind: 'decision' });

    decision = records.setParent(decision.workId, decision.revision, parent.workId);
    records.snapshotRun(decision.workId, decision.revision, {
        runId: 'decision',
        kind: 'decision',
        skills: [],
        packaged: {
            version: 'test',
            reviewers: { code: 'Code', security: 'Security', ui: 'UI', performance: 'Performance' },
        },
    });

    let partIndex = 0;
    const summary = shapingHold.doubt.summary.replaceAll(
        /packageDigest `([a-f0-9]+)`/g,
        () => `packageDigest \`${records.doubtPackage(parts[partIndex++]!.workId).packageDigest}\``,
    );
    const builds = records.children(parent.workId).filter((r) => r.kind === 'build');

    records.startRoleRun(decision.workId, records.read(decision.workId).revision, {
        runId: 'decision',
        executionId: 'doubt',
        role: 'doubt',
    });
    records.finishRoleRun(decision.workId, records.read(decision.workId).revision, {
        executionId: 'doubt',
        result: 'completed',
        report: null,
        summary,
    });
    for (const r of [parent, ...builds])
        records.waitForUser(r.workId, records.read(r.workId).revision, shapingHold.notice);

    const items = recordItems(records, [], [REPO]);

    assert.deepEqual(
        deskItems({ items }, false)
            .map((i) => i.title)
            .sort(),
        ['A1', 'A2', 'B1', 'G'],
    );
    for (const item of items.filter((i) => i.kind !== 'decision')) {
        assert.equal(item.needsYou?.reason, shapingHold.notice);
        assert.equal(item.briefApproval, undefined);
        assert.equal(deskWait(item, false, items).label, 'Decision needed');

        if (item.kind === 'build') assert.equal(buildActivity(item).label, `Doubt held: ${shapingHold.notice}`);
    }

    const changed = builds[0]!;

    records.setBody(changed.workId, records.read(changed.workId).revision, 'brief', completeBrief('Changed package'));

    const stale = recordItems(records, [], [REPO]).find((i) => i.id === changed.workId)!;

    assert.equal(buildActivity(stale).label, "Brief changed; Doubt hasn't run");
    assert.equal(stale.needsYou?.reason, shapingHold.notice);
});

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

test.each([
    [REPO, `https://github.com/${REPO}/issues/`],
    ['contoso/Mobile%20App/web', 'https://dev.azure.com/contoso/Mobile%20App/_workitems/edit/'],
])(
    "a %s ticket missing from its tracker's read still links the item and its parent to their pages",
    async (repository, page) => {
        const records = await open();
        let parent = records.importTicket({
            title: 'Parent',
            repository,
            kind: 'concept',
            ticket: `${repository}#7`,
        }).record;
        const child = records.importTicket({
            title: 'Child',
            repository,
            kind: 'build',
            ticket: `${repository}#8`,
        }).record;
        let local = records.create({ title: 'Local', repository, kind: 'build' });

        records.setParent(child.workId, child.revision, parent.workId);
        parent = records.create({ title: 'Local parent', repository, kind: 'concept' });
        local = records.setParent(local.workId, local.revision, parent.workId);

        const items = recordItems(records, [], [repository]);
        const shown = (title: string) => items.find((i) => i.title === title)!;

        assert.deepEqual(
            [shown('Child').url, shown('Child').parent?.url, shown('Local').url, shown('Local').parent?.url],
            [`${page}8`, `${page}7`, null, ''],
        );
    },
);

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

test("a build's row carries the reviewers chosen for its current round, without the skipped ones", async () => {
    const records = await open();
    const repo = 'lar-factory-sample/greeting';
    const { reviewId } = sampleReviewControls(records).seed(repo);

    const item = recordItems(records, [], [repo]).find((i) => i.id === reviewId)!;

    assert.deepEqual(item.reviewers, [
        { id: 'code', name: 'Code', status: 'Running' },
        { id: 'security', name: 'Security', status: 'Completed' },
    ]);
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
                proofState: 'pending',
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

test('each cause decides the text and the exact offers of its notice', async () => {
    const rows: [NeedsYouCause[], string, NeedsYouOffer[]][] = [
        [[{ type: 'pr-closed' }], PR_CLOSED, ['reopen-pr', 'replace-pr', 'set-aside']],
        [[{ type: 'ticket-closed' }], TICKET_CLOSED, ['keep-working', 'set-aside']],
    ];

    for (const [causes, reason, offers] of rows) {
        const records = await open();
        const record = observedBuild(records, {});

        records.setNeedsYouCauses(record.workId, record.revision, causes);
        assert.deepEqual(noticeOf(records, record.workId)?.reason, reason);
        assert.deepEqual(noticeOf(records, record.workId)?.offers, offers);
    }
});

const OLD_PR = `Its PR ${REPO}#40 closed without merging. Reopen it, start a replacement build from the same brief, or set the work aside.`;
const OLD_TICKET = `Its ticket ${REPO}#12 closed in its provider. Set the work aside, or clear this to keep working.`;

test('saved old wording reads as causes and shows new wording, with no reason to clear anything', async () => {
    const rows: [string, Parameters<typeof observedBuild>[1], string, NeedsYouCause[]][] = [
        [OLD_PR, { pr: 'closed' }, PR_CLOSED, [{ type: 'pr-closed' }]],
        [OLD_TICKET, { ticket: 'closed' }, TICKET_CLOSED, [{ type: 'ticket-closed' }]],
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
    // Guards the old-wording matcher against catastrophic backtracking on saved free text.
    const reason = `Its ticket a#1${' moved from x to'.repeat(2200)} y. Check who owns the work, then clear this!`;
    const records = await open();
    const record = observedBuild(records, {});

    records.setNeedsYou(record.workId, record.revision, reason);

    const started = performance.now();
    const notice = noticeOf(records, record.workId);

    assert.ok(performance.now() - started < 1000, 'matching stays fast');
    assert.deepEqual([notice?.reason, notice?.causes], [reason, []]);
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

    ready = records.setBody(ready.workId, ready.revision, 'brief', completeBrief('A private passing brief.'));
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
        ['decision', 'Done', [], { complete: true, reasons: [] }],
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

test('a board read after a kind swap keeps the new kind', async () => {
    const vocabulary: VocabularyMapping = {
        bug: { type: null, labels: ['type: bug'] },
        feature: { type: null, labels: ['type: feature'] },
    };
    const records = await open();
    const { workId, revision } = records.importTicket({
        title: 'Swapped',
        repository: REPO,
        kind: 'bug',
        ticket: `${REPO}#12`,
    }).record;
    let onTicket: string[] = ['type: bug', 'docs'];
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
        ['docs', 'type: feature'],
    );
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

test('a read with no commit since the last and the same inputs gives its items again without mapping', async () => {
    const records = await open();

    for (let i = 0; i < 60; i++) records.create({ title: `Work ${i}`, repository: REPO, kind: 'bug' });

    const read = recordItemsReader(await openReader());
    // The tickets an item source read last, which the board keeps until the next read.
    const lastRead = tickets([12, 'List']);
    let turns = 0;
    const turn = async () => {
        turns++;
    };
    const first = await read(lastRead, [REPO], [], new Set(), [], turn);

    assert.equal(turns, 2);
    assert.equal(await read(lastRead, [REPO], [], new Set(), [], turn), first);
    assert.equal(turns, 2, 'no turn and no mapping');
    assert.equal(await read(tickets([12, 'List']), [REPO], [], new Set(), [], turn), first);
    assert.equal(turns, 2, 'a provider read that brought the same tickets maps nothing');

    const hidden = await read(lastRead, [REPO], [], new Set([first[0]!.id]), [], turn);

    assert.equal(hidden.length, 60, 'other inputs map again');

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

test('a stale gate at Ready explains the hold and asks for renewed board approval', async () => {
    const records = await open();
    let work = records.create({ title: 'Held', repository: REPO, kind: 'build', status: 'Ready' });

    work = records.setBody(work.workId, work.revision, 'brief', completeBrief('Approved brief.'));
    records.recordGate(work.workId, work.revision, {
        briefDigest: records.gate(work.workId).briefDigest!,
        approvedBy: 'Pedro',
        evidence: 'Board approval.',
    });
    work = records.setBody(work.workId, work.revision, 'brief', completeBrief('Changed brief.'));

    const reviewed = records.doubtPackage(work.workId);

    records.recordDoubt(work.workId, reviewed.packageDigest, 'Doubt', 'Clean.');

    const item = recordItems(records, [], [REPO]).find((entry) => entry.id === work.workId)!;

    assert.equal(item.status, 'Shaping');
    assert.equal(item.passingBrief, false);
    assert.equal(item.staleGate, 'brief');
    assert.equal(item.briefApproval!.reason, 'Brief changed. Review and approve the current product content.');
    assert.equal(item.briefApproval!.digest, records.displayGate(item.id).approvalDigest);
});

test('S03 amended gate waits for Doubt on its current digest before advertising approval', async () => {
    const records = await open();
    let work = records.create({ title: 'Build', repository: REPO, kind: 'build', status: 'In progress' });

    work = records.setBody(work.workId, work.revision, 'brief', completeBrief('Approved D1.'));
    records.recordGate(work.workId, work.revision, {
        briefDigest: records.gate(work.workId).briefDigest!,
        approvedBy: 'Pedro',
        evidence: 'Board approval.',
    });
    work = records.setBuildBranch(work.workId, work.revision, 'build/same');
    work = records.setBody(work.workId, work.revision, 'brief', completeBrief('Proposed D2.'));
    legacyApprovalNotice(records, work.workId, 'Revised brief needs approval');

    const shown = () => recordItems(records, [], [REPO]).find((entry) => entry.id === work.workId)!;

    assert.equal(shown().briefApproval, undefined);
    assert.equal(shown().briefReviewing, true);

    const review = records.doubtPackage(work.workId);

    records.recordDoubt(work.workId, review.packageDigest, 'Doubt', 'Clean.');
    assert.equal(shown().briefReviewing, undefined);
    assert.equal(shown().briefApproval!.digest, records.displayGate(work.workId).approvalDigest);
    work = records.setBody(work.workId, records.read(work.workId).revision, 'brief', completeBrief('Proposed D3.'));
    assert.equal(shown().briefApproval, undefined);
    assert.equal(shown().briefReviewing, true);
});

test('S06: an unknown-provenance ticket edit stays on Your desk until board acceptance', async () => {
    const records = await open();
    let x = records.create({ title: 'x envelope', repository: REPO, kind: 'build' });

    x = records.attachTicket(x.workId, x.revision, `${REPO}#891`);
    records.setBody(x.workId, x.revision, 'brief', completeBrief('Extensible envelope.'));

    const state = records.specState(x.workId);

    records.saveSpecState(x.workId, state.generation, {
        ...state,
        held: { title: 'x envelope', body: 'Authorized created ticket.', version: '2', digest: 'unknown' },
    });

    let items = recordItems(records, [], [REPO]);

    assert.equal(
        deskItems({ items }, false).some((i) => i.id === x.workId),
        true,
    );
    assert.equal(
        deskWait(
            items.find((i) => i.id === x.workId)!,
            false,
            items,
        ).label,
        'Ticket edit',
    );

    const held = records.specState(x.workId);

    records.saveSpecState(x.workId, held.generation, { ...held, held: null });
    items = recordItems(records, [], [REPO]);
    assert.equal(
        deskItems({ items }, false).some((i) => i.id === x.workId),
        false,
    );
});

test('stale approval names the changed cited answer, contract or brief', async () => {
    const records = await open();
    const group = records.create({ title: 'G', repository: REPO, kind: 'concept' }).workId;
    const revision = (id: string) => records.read(id).revision;
    const part = (title: string, kind: 'build' | 'decision', body: string) =>
        records.createPart({
            parentId: group,
            parentRevision: revision(group),
            title,
            repository: REPO,
            kind,
            body,
            blockerIds: [],
        }).workId;
    const decision = part('DEC', 'decision', 'Method: grill\nChoose label.');
    const contract = part('X', 'build', '## What\nExport formatLabel.');
    const build = part(
        'A2',
        'build',
        `${completeBrief('Trim labels.')}\nConsumes: \`${contract}\`\nChosen answer: ${decision}\nConsumption test: ${JSON.stringify({ source: contract, test: 'test/labels.test.ts: feeds greeting into label', output: 'greeting string', input: 'label(greeting)' })}`,
    );
    const write = (id: string, body: 'brief' | 'answer', text: string) => records.setBody(id, revision(id), body, text);
    const approve = () => {
        records.recordDoubt(build, records.doubtPackage(build).packageDigest, 'Doubt', 'Checked.');
        records.recordGate(build, revision(build), {
            briefDigest: records.gate(build).briefDigest!,
            approvedBy: 'Pedro',
            evidence: 'Yes.',
        });
    };
    const shown = () => recordItems(records, [], [REPO]).find((item) => item.id === build)!;

    write(decision, 'answer', '## Product\nUse AMBER.');
    records.setBuildBranch(build, revision(build), 'fix/labels');
    approve();
    write(decision, 'answer', '## Product\nUse BLUE.');
    assert.equal(shown().staleGateDetail, 'Cited answer DEC changed.');
    records.recordDoubt(build, records.doubtPackage(build).packageDigest, 'Doubt', 'Rechecked.');
    assert.equal(
        shown().briefApproval?.reason,
        'Cited answer DEC changed. Review and approve the current product content.',
    );
    approve();
    write(contract, 'brief', '## What\nExport a renamed helper.');
    assert.equal(shown().staleGateDetail, 'Contract X changed.');
    approve();
    write(build, 'brief', `${records.body(build, 'brief')}\nA new acceptance criterion.`);
    assert.equal(shown().staleGateDetail, 'Brief changed.');
});

test('recorded work is linked only as a concept, a concept part or a group across repositories', async () => {
    const records = await open();
    const group = (kind: 'concept' | 'feature', repositories: readonly string[]) => {
        const parent = records.create({ title: `${kind} group`, repository: REPO, kind });
        const parts = repositories.map((repository, at) =>
            records.createPart({
                parentId: parent.workId,
                parentRevision: records.read(parent.workId).revision,
                title: `Part ${at}`,
                repository,
                kind: 'build',
                body: completeBrief('Build it'),
                blockerIds: [],
            }),
        );

        return [parent, ...parts].map((record) => record.workId);
    };
    const groups = {
        concept: group('concept', [REPO]),
        split: group('feature', [REPO, OTHER_REPO]),
        sameRepo: group('feature', [REPO, REPO]),
    };
    const flow = new Map(recordItems(records, [], [REPO, OTHER_REPO]).map((item) => [item.id, item.flow]));

    assert.deepEqual(
        Object.fromEntries(Object.entries(groups).map(([name, ids]) => [name, ids.map((id) => flow.get(id))])),
        {
            concept: ['linked', 'linked'],
            split: ['linked', 'linked', 'linked'],
            sameRepo: ['single', 'single', 'single'],
        },
    );
});

const singleScope = {
    tests: [],
    behaviour: ['Greet the visitor.'],
    excluded: [],
    size: null,
    verify: { required: false, visibleUi: null },
    repositories: [REPO],
    openDecisions: [],
};

test.each(['bug', 'feature'] as const)(
    'single-flow %s keeps its Kind through shaping, reads and later edits',
    async (kind) => {
        const records = await open();
        const r = records.create({ title: 'Greeting', repository: REPO, kind, status: 'Shaping', ticket: `${REPO}#7` });

        records.confirmScope(r.workId, r.revision, singleScope, 'Pedro', 'Yes.');
        assert.equal(records.chooseStructure(r.workId).structure, 'single');

        const reader = await openReader();
        const saved = reader.read(r.workId);

        assert.equal(saved.kind, 'build');
        assert.equal(saved.deliveryKind, kind);

        const item = recordItems(reader, [], [REPO]).find((i) => i.id === r.workId)!;

        assert.equal(visibleKind(item), kind);
        assert.equal(item.flow, 'single');
        assert.equal(buildBranch(item), kind === 'bug' ? 'fix/7-greeting' : 'feat/7-greeting');

        const revision = saved.revision;

        records.chooseStructure(r.workId);
        assert.equal(reader.read(r.workId).revision, revision, 'repeating the choice preserves classification');

        const result = await changeKind(records, r.workId, revision, 'improvement', {
            kinds: {
                read: async () => ({ labels: [], type: null }),
                boardTypes: async () => null,
                setType: async () => {
                    throw new Error('Unexpected tracker write');
                },
            },
        });

        assert.equal(result.error, null);
        assert.equal(result.record.kind, 'build');
        assert.equal(result.record.deliveryKind, 'improvement');
        assert.equal(visibleKind(recordItems(reader, [], [REPO]).find((i) => i.id === r.workId)!), 'improvement');
    },
);

test.each([{ structure: 'linked', openDecisions: [], kind: 'build' }] as const)(
    'multi-repository $structure keeps grouping without assigning a delivery Kind',
    async (choice) => {
        const records = await open();
        const r = records.create({ title: 'Greeting', repository: REPO, kind: 'feature' });

        records.confirmScope(
            r.workId,
            r.revision,
            { ...singleScope, repositories: [REPO, OTHER_REPO], openDecisions: choice.openDecisions },
            'Pedro',
            'Yes.',
        );
        assert.equal(records.chooseStructure(r.workId).structure, choice.structure);
        assert.equal(records.read(r.workId).kind, choice.kind);
        assert.equal(records.read(r.workId).deliveryKind, null);
    },
);

test('a linked PR amendment shows no duplicate gate before or after fresh Doubt, but retains a real question', async () => {
    const records = await open();
    let work = records.create({ title: 'Build', repository: REPO, kind: 'build', status: 'In progress' });

    work = records.setBody(work.workId, work.revision, 'brief', completeBrief('Original scope.'));
    records.recordGate(work.workId, work.revision, {
        briefDigest: records.gate(work.workId).briefDigest!,
        approvedBy: 'Pedro',
        evidence: 'Approved.',
    });

    const id = work.workId;
    const rev = () => records.read(id).revision;

    records.setPullRequest(id, rev(), `${REPO}#4`);

    const state = records.prLoop(id);

    state.amendment = {
        source: 'https://github.com/example/repo/pull/4#issuecomment-1',
        by: 'Pedro',
        evidence: 'Enter too.',
    };
    records.savePrLoop(id, state);

    const parent = records.create({ title: 'Group', repository: REPO, kind: 'concept' }).workId;
    let consumer = records.create({ title: 'Consumer', repository: OTHER_REPO, kind: 'build', status: 'Ready' });

    records.setParent(id, rev(), parent);
    consumer = records.setParent(consumer.workId, consumer.revision, parent);
    consumer = records.setBody(consumer.workId, consumer.revision, 'brief', completeBrief('Original scope.'));
    records.recordGate(consumer.workId, consumer.revision, {
        briefDigest: records.gate(consumer.workId).briefDigest!,
        approvedBy: 'Pedro',
        evidence: 'Approved.',
    });
    records.beginLinkedPrAmendment(id, state.amendment, [consumer.workId]);
    records.setBody(id, rev(), 'brief', completeBrief('Enter too.'));
    records.setBody(consumer.workId, records.read(consumer.workId).revision, 'brief', completeBrief('Enter too.'));

    const all = () => recordItems(records, [], [REPO, OTHER_REPO]);
    const shown = () => all().find((item) => item.id === id)!;
    const noConsumerGate = () => {
        const item = all().find((item) => item.id === consumer.workId)!;

        assert.equal(item.briefApproval, undefined);
        assert.equal(item.staleGate, undefined);
        assert.equal(item.needsYou, undefined);
        assert.equal(
            deskItems({ items: all() }, false).some((item) => item.id === consumer.workId),
            false,
        );
    };

    noConsumerGate();

    assert.equal(shown().briefApproval, undefined);
    assert.equal(shown().needsYou, undefined);

    const input = records.doubtPackage(id);

    records.recordDoubt(id, input.packageDigest, 'Doubt', 'No conflict.');
    records.recordDoubt(consumer.workId, records.doubtPackage(consumer.workId).packageDigest, 'Doubt', 'No conflict.');
    noConsumerGate();
    assert.equal(shown().briefApproval, undefined);
    assert.equal(shown().staleGate, undefined);
    assert.equal(shown().needsYou, undefined);
    records.setNeedsYou(id, rev(), 'Should Enter submit while a menu is open?');
    assert.match(shown().needsYou!.reason, /menu is open/);
});

test('work closed during shaping keeps its reason and identity in Archive even without ticket context', async () => {
    const records = await open();
    let work = records.create({
        title: 'Trim greeting',
        repository: REPO,
        kind: 'bug',
        status: 'Shaping',
        ticket: `${REPO}#47`,
    });

    work = records.observe(work.workId, work.revision, { of: 'ticket', state: 'closed' });
    records.setAside(work.workId, work.revision, [], 'as already fixed on main @88490ab');

    assert.equal(recordItems(records, [], [REPO]).length, 0);

    const archived = archivedItems(records, [], [REPO], new Set());

    assert.equal(archived.length, 1);
    assert.equal(archived[0]?.id, work.workId);
    assert.equal(archived[0]?.number, 47);
    assert.equal(archived[0]?.closeReason, 'as already fixed on main @88490ab');
    assert.equal(archived[0]?.completion?.complete, false);
    assert.equal(archived[0]?.archived?.setAside, true);

    const restored = records.restore(work.workId, records.read(work.workId).revision);

    assert.equal(recordItems(records, [], [REPO])[0]?.closeReason, undefined);
    records.setAside(work.workId, restored.revision);
    assert.equal(archivedItems(records, [], [REPO], new Set())[0]?.closeReason, undefined);
});
