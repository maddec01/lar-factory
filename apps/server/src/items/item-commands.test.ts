import { buildsAtWork, effectiveVocabulary } from '@lar-factory/shared';
import type {
    BoardData,
    Item,
    ItemThread,
    NeedsYouCause,
    OperationAccess,
    ShapingThreadCleanup,
    StartResult,
    Status,
} from '@lar-factory/shared';
import { openWorkRecords, type WorkRecords } from '@lar-factory/work-records';
import assert from 'node:assert/strict';
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { afterEach, test, vi } from 'vite-plus/test';

import { createBoardState } from '../board/board-state.ts';
import { createItemCommands, type ItemCommands, type ItemCommandsDeps } from './item-commands.ts';
import type { ItemSource } from './item-source.ts';
import { NO_THREAD } from './needs-you-causes.ts';
import { finishCompleted, observeRecords } from './observe-records.ts';
import { archivedItems, recordItems } from './record-items.ts';

const WEB = 'contoso/Fabrikam/web';

const queued = (id: number, extra: Partial<Item> = {}): Item => ({
    id: `azure:contoso/${id}`,
    revision: 1,
    status: 'Queued',
    statuses: ['Queued'],
    kind: 'issue',
    content: 'ticket',
    number: id,
    title: `Item ${id}`,
    url: `https://dev.azure.com/contoso/Fabrikam/_workitems/edit/${id}`,
    repo: WEB,
    labels: [],
    state: 'open',
    closedAs: null,
    parent: null,
    parentId: null,
    flow: 'single',
    subIssues: { total: 0, completed: 0 },
    blockers: [],
    updatedAt: '2026-10-21T08:00:00Z',
    closedAt: null,
    linkedPrs: [],
    slices: [],
    ...extra,
});

const opened: { records: WorkRecords; dir: string }[] = [];

afterEach(() => {
    vi.unstubAllEnvs();
    for (const { records, dir } of opened.splice(0)) {
        records.close();
        rmSync(dir, { recursive: true, force: true });
    }
});

test('read-only Azure sessions refuse shaping and builds before any T3 or provider call', async () => {
    vi.stubEnv('LAR_FACTORY_AZURE_READ_ONLY', '1');

    const { commands, log } = commandsOn([
        queued(1),
        queued(2, { status: 'Ready', statuses: ['Ready'], kind: 'build' }),
    ]);

    assert.equal((await commands.start(queued(1).id, undefined)).status, 403);
    assert.equal((await commands.startBuild(queued(2).id, undefined)).status, 403);
    assert.deepEqual(log, []);
});

async function openRecords(): Promise<WorkRecords> {
    const dir = mkdtempSync(join(tmpdir(), 'item-commands-'));
    const records = await openWorkRecords(join(dir, 'work-records.db'));

    opened.push({ records, dir });

    return records;
}

/** These launch tests start from a genuinely approved brief. */
function approveBuild(records: WorkRecords, id: string) {
    if (!records.body(id, 'brief')) records.setBody(id, records.read(id).revision, 'brief', 'Exact test build.');

    records.recordGate(id, records.read(id).revision, {
        briefDigest: records.gate(id).briefDigest!,
        approvedBy: 'test',
        evidence: 'Approved fixture.',
    });

    if (records.read(id).status === 'Shaping') records.update(id, records.read(id).revision, { status: 'Ready' });
}

function refineConcept(records: WorkRecords, id: string) {
    records.setFogGone(id, records.read(id).revision, true);
    records.setBody(id, records.read(id).revision, 'map', 'Approved destination.');
}

for (const [operation, state] of [['open-pr', 'unverified']] as const) {
    test(`${state} ${operation} prevents a build intent while read-only shaping still works`, async () => {
        const records = await openRecords();
        const build = records.importTicket({
            title: 'Read-only build',
            repository: WEB,
            kind: 'build',
            status: 'Ready',
            ticket: `${WEB}#7`,
        }).record;
        const access = { 'push-branch': 'allowed', [operation]: state } as const;
        const { commands, log, reread } = commandsOn([], undefined, records, [], access);
        const reply = await commands.startBuild(build.workId, undefined);

        assert.equal(reply.status, 403);
        assert.match(JSON.stringify(reply.body), new RegExp(operation));
        assert.equal((reply.body as { hold?: true }).hold, true, 'Auto-build holds instead of pausing the build');
        assert.equal(records.read(build.workId).revision, build.revision);
        assert.deepEqual(records.launchIntents({ workId: build.workId }), []);
        assert.deepEqual(log, []);

        const shape = records.importTicket({
            title: 'Read-only shaping',
            repository: WEB,
            kind: 'issue',
            status: 'Queued',
            ticket: `${WEB}#8`,
        }).record;

        reread();
        assert.equal((await commands.start(shape.workId, undefined)).status, 200);
        assert.equal(log.length, 1);
    });
}

test('a failed fetch refuses Start build with its error and writes nothing, then a retry starts the build', async () => {
    const records = await openRecords();
    const concept = records.create({ title: 'Concept', repository: WEB, kind: 'concept', status: 'Ready' });
    const build = records.create({ title: 'Build', repository: WEB, kind: 'build', status: 'Ready' });

    records.setParent(build.workId, build.revision, concept.workId);

    const brief = records.setBody(
        build.workId,
        records.read(build.workId).revision,
        'brief',
        'Build the approved destination.',
    );

    records.recordGate(build.workId, brief.revision, {
        briefDigest: records.gate(build.workId).briefDigest!,
        approvedBy: 'Pedro',
        evidence: 'Doubt clean; approved.',
    });
    refineConcept(records, concept.workId);

    const before = records.read(build.workId);
    let offline = true;
    const { commands, log, bases } = commandsOn([], undefined, records, [], undefined, undefined, undefined, {
        fetchBase: async () => {
            if (offline) throw new Error('Could not fetch release from origin.');

            return 'release-tip';
        },
    });
    const { status, body } = await commands.startBuild(build.workId, undefined);

    assert.deepEqual(
        [status, (body as { error: string }).error, (body as { hold?: true }).hold],
        [409, 'Could not fetch release from origin.', true],
    );
    assert.deepEqual(log, []);
    assert.deepEqual(records.launchIntents({ workId: build.workId }), []);

    const after = records.read(build.workId);

    assert.deepEqual(
        [after.status, after.buildBranch, after.skills, after.revision],
        [before.status, before.buildBranch, before.skills, before.revision],
    );
    assert.equal(records.read(concept.workId).status, 'Ready');
    offline = false;
    assert.equal((await commands.startBuild(build.workId, undefined)).status, 200);
    assert.deepEqual(bases, ['release-tip']);
    assert.equal(records.read(concept.workId).status, 'In progress');
});

/**
 * Commands on a board holding `items`, whose source records each abandon it gets. Given `records`, the board shows their items and Archive with `tickets` as the source read them, and reads them
 * again after each write.
 */
function commandsOn(
    items: Item[],
    showThread?: () => Promise<'live' | 'deleted' | 'unknown'>,
    records?: WorkRecords,
    tickets: Item[] = [],
    access: Partial<Record<'push-branch' | 'open-pr', OperationAccess>> = {
        'push-branch': 'allowed',
        'open-pr': 'allowed',
    },
    whileReopening: () => void = () => {},
    provider: {
        ticket?: ItemSource['observeTicket'];
        pr?: (repo: string, number: number) => Promise<'open' | 'closed' | 'merged'>;
    } = {},
    deps: Partial<ItemCommandsDeps> = {},
) {
    const board = createBoardState({ items, repos: [], modelChoices: [] } as unknown as BoardData);
    const reread = () => {
        if (records) board.update({ items: recordItems(records, tickets, [WEB]) });
    };
    const archive = () => (records ? archivedItems(records, tickets, [WEB], new Set()) : []);

    reread();

    const log: string[] = [];
    const branches: (string | undefined)[] = [];
    const bases: (string | undefined)[] = [];
    const source = {
        readTicket: async (_repo: string, number: number) => ({
            number,
            title: `Item ${number}`,
            text: 'Description',
            kind: 'issue',
        }),
        observeTicket: provider.ticket ?? (async () => ({ state: 'open' })),
        abandon: async (item: Item) => {
            log.push(`abandon ${item.number}`);

            return null;
        },
    } as unknown as ItemSource;
    const commands = createItemCommands({
        factoryContext: null,
        checkoutOf: async () => '/repo',
        inspectWorkRecovery: async () => ({ branch: 'old', branchExists: true, worktreePath: null, pr: 'none' }),
        board,
        items: source,
        records: records ?? null,
        reread,
        archive,
        offerModelChoices: () => [],
        showThread,
        reopenPr: async (repo, number) => {
            whileReopening();
            log.push(`reopen ${repo}#${number}`);
        },
        readPr: provider.pr ?? (async () => 'open'),
        projectOf: async (repo) => ({ projectId: repo }),
        baseOf: async () => 'release',
        fetchBase: async (_project, branch) => `${branch}-tip`,
        buildAccessOf: () => access,
        startThread: async (project, message, _choice, worktree) => {
            branches.push(worktree?.branch);
            bases.push(worktree && 'base' in worktree ? worktree.base : undefined);
            log.push(`start ${project} ${message.split('\n')[1]}`);

            return { thread: { threadId: `thread-${branches.length}`, title: 't' }, error: null };
        },
        ...deps,
    });

    return { board, commands, log, branches, bases, archive, reread };
}

test('unpicked ticket abandonment saves a local record and offers Archive restore', async () => {
    const records = await openRecords();
    const ticket = queued(7);
    const { commands, board, archive } = commandsOn([], undefined, records, [ticket]);
    const reply = await commands.abandon(ticket.id);

    assert.equal(reply.status, 200);
    assert.equal(board.snapshot().items.length, 0);
    assert.equal(archive().length, 1);
    assert.notEqual(archive()[0]!.id, ticket.id);

    const restarted = await openWorkRecords(join(opened.at(-1)!.dir, 'work-records.db'));

    try {
        assert.equal(recordItems(restarted, [ticket], [WEB]).length, 0);
        assert.equal(archivedItems(restarted, [ticket], [WEB], new Set()).length, 1);
    } finally {
        restarted.close();
    }

    assert.equal((await commands.restore(archive()[0]!.id)).status, 200);
    assert.equal(board.snapshot().items.length, 1);
});

for (const failure of ['close'] as string[])
    test(`unpicked combined abandonment handles ${failure} failure without duplicate closure or records`, async () => {
        const records = await openRecords();
        const ticket = queued(7);
        const board = createBoardState({ items: [], repos: [], modelChoices: [] } as unknown as BoardData);
        const reread = () => board.update({ items: recordItems(records, [ticket], [WEB]) });

        reread();

        let closed = false;
        let closes = 0;
        let fail = true;
        const source = {
            readTicket: async () => {
                if (failure === 'read' && fail) throw new Error('Read failed');

                return {
                    number: 7,
                    title: 'Target',
                    text: 'Target description\n<!-- lar-factory:structure\n{}\n-->',
                    kind: 'issue',
                    tracker: { snapshot: 'must not restore' },
                };
            },
            observeTicket: async () => ({ state: closed ? 'closed' : 'open' }),
            abandon: async (item: Item) => {
                assert.equal(item.id, ticket.id);

                if (failure === 'close' && fail) return 'Close failed';

                closes++;
                closed = true;

                return null;
            },
        } as unknown as ItemSource;
        const commands = createItemCommands({
            factoryContext: null,
            board,
            records,
            reread,
            archive: () => archivedItems(records, [ticket], [WEB], new Set()),
            offerModelChoices: () => [],
            items: source,
        });
        const imported = records.importTicket.bind(records);
        const spy = vi.spyOn(records, 'importTicket').mockImplementation((input) => {
            if (failure === 'import' && fail) throw new Error('Disk unavailable');

            return imported(input);
        });

        try {
            const first = await commands.abandonAndClose(ticket.id);

            assert.equal(first.status, failure === 'none' ? 200 : failure === 'import' ? 409 : 502);

            if (failure !== 'none') {
                assert.equal(records.list({}).length, 0);
                assert.ok(board.find(ticket.id));
                fail = false;
                assert.equal((await commands.abandonAndClose(ticket.id)).status, 200);
            }

            assert.equal(closes, 1);
            assert.equal(records.list({}).length, 1);
            assert.equal(records.list({})[0]!.setAside, true);
            assert.equal(records.list({})[0]!.parentId, null);
            assert.equal(recordItems(records, [ticket], [WEB]).length, 0);
            assert.equal((await commands.restore(records.list({})[0]!.workId)).status, 200);
        } finally {
            spy.mockRestore();
        }
    });

test('Abandon sets the work aside on this Mac and leaves its ticket alone, which only its own close closes', async () => {
    const records = await openRecords();
    const work = records.importTicket({
        title: 'Work',
        repository: WEB,
        kind: 'bug',
        status: 'Queued',
        ticket: `${WEB}#7`,
    }).record;
    const { board, commands, log } = commandsOn([], undefined, records, [queued(7)]);

    assert.deepEqual(
        (await commands.closeTicket(work.workId)).status,
        409,
        'work Abandon never set aside has no ticket to close',
    );
    assert.equal((await commands.abandon(work.workId)).status, 200);
    assert.equal(records.read(work.workId).setAside, true);
    assert.equal(board.find(work.workId), undefined);
    assert.deepEqual(log, [], 'Abandon writes nothing to the provider');

    const [first, second] = await Promise.all([commands.closeTicket(work.workId), commands.closeTicket(work.workId)]);

    assert.deepEqual([first.status, second.status], [200, 200]);
    assert.equal((await commands.closeTicket(work.workId)).status, 200);
    assert.deepEqual(log, ['abandon 7'], 'three presses close the ticket once');
});

/** A Review build on WEB whose PR #40 is observed closed unmerged, with its build thread, waiting on the user. */
async function closedPrBuild({
    whileReopening,
}: {
    whileReopening?: (records: WorkRecords, workId: string) => void;
} = {}) {
    const records = await openRecords();
    const created = records.create({ title: 'Build', repository: WEB, kind: 'build', status: 'Review' });

    approveBuild(records, created.workId);

    let record = records.setPullRequest(created.workId, records.read(created.workId).revision, `${WEB}#40`);

    record = records.addThread(created.workId, record.revision, 'thread-0', 'build');
    record = records.observe(created.workId, record.revision, { of: 'pr', state: 'closed' });
    records.setNeedsYouCauses(created.workId, record.revision, [{ type: 'pr-closed' }]);

    return {
        records,
        workId: created.workId,
        ...commandsOn([], undefined, records, [], undefined, () => whileReopening?.(records, created.workId)),
    };
}

test('reopening a closed PR from Needs you reopens it in its provider and clears the reason', async () => {
    const { records, workId, commands, log } = await closedPrBuild();

    assert.equal((await commands.resolveNeedsYou(workId, 'reopen-pr')).status, 200);
    assert.deepEqual(log, [`reopen ${WEB}#40`]);
    assert.deepEqual([records.read(workId).needsYouCauses, records.read(workId).status], [[], 'Review']);
});

test('a replacement build from Needs you readies the work, and Start build then starts a new thread on a new branch', async () => {
    const { records, workId, commands, branches } = await closedPrBuild();

    assert.equal((await commands.resolveNeedsYou(workId, 'replace-pr')).status, 200);
    assert.deepEqual([records.read(workId).needsYouCauses, records.read(workId).status], [[], 'Ready']);
    assert.equal((await commands.startBuild(workId, undefined)).status, 200);
    assert.equal(branches.length, 1, "the closed PR's thread holds no start");
    assert.match(branches[0]!, /-retry-[a-f0-9]+$/);
});

/** Work whose last `purpose` start failed with no thread, waiting on the user. */
async function noThreadWork(purpose: 'shape' | 'build', status: Status = purpose === 'build' ? 'Ready' : 'Queued') {
    const records = await openRecords();
    const work = records.create({ title: 'Work', repository: WEB, kind: 'build', status });

    if (purpose === 'build') approveBuild(records, work.workId);

    const { record, intent } = records.recordLaunchIntent(work.workId, records.read(work.workId).revision, purpose);
    const failed = records.resolveLaunchIntent(work.workId, record.revision, intent.intentId, {
        failure: NO_THREAD,
    }).record;

    records.setNeedsYouCauses(work.workId, failed.revision, [{ type: 'no-thread' }]);

    return { records, workId: work.workId };
}

test('Start again on a no-thread notice keeps it when the start fails and removes it once a thread starts', async () => {
    const { records, workId } = await noThreadWork('shape');
    let answerWith: StartResult | null = { thread: null, error: 'T3 refused.' };
    const { commands, board, started } = recordedCommands(records, { startAnswer: () => answerWith });

    assert.equal(board.find(workId)!.needsYou!.startAgainPurpose, 'shape');

    const failed = await commands.startAgain(workId, undefined, {});

    assert.deepEqual([failed.status, (failed.body as { error: string }).error], [502, 'T3 refused.']);
    assert.deepEqual(records.read(workId).needsYouCauses, [{ type: 'no-thread' }]);
    answerWith = null;
    assert.equal((await commands.startAgain(workId, undefined, {})).status, 200);
    assert.equal(started.length, 1);
    assert.deepEqual(records.read(workId).needsYouCauses, []);
    assert.deepEqual(
        records.threads(workId).map((t) => t.purpose),
        ['shape'],
    );
});

test('Start again refuses while the board has not yet read a thread the record now holds', async () => {
    const { records, workId } = await noThreadWork('build');
    const { commands, board, started } = recordedCommands(records);

    records.addThread(workId, records.read(workId).revision, 'just-recorded', 'build');
    assert.equal(board.find(workId)?.threads, undefined, 'the board last read no threads');
    assert.equal((await commands.inspectRecovery(workId)).status, 409);
    assert.equal((await commands.startAgain(workId, undefined, {})).status, 409);
    assert.deepEqual(started, []);
});

/** An In progress feature on ticket WEB#7, read open and assigned to pedro, then read as `change`, with its observer and commands. */
async function observedTicketWork(change: { state: 'open' | 'closed'; assignee?: string }) {
    const records = await openRecords();
    const work = records.importTicket({
        title: 'Work',
        repository: WEB,
        kind: 'feature',
        status: 'In progress',
        ticket: `${WEB}#7`,
    }).record;

    records.observe(work.workId, work.revision, { of: 'ticket', state: 'open', assignee: 'pedro' });

    const { commands, log, reread, board } = commandsOn([], undefined, records);
    const read = (next: { state: 'open' | 'closed'; assignee?: string }) =>
        observeRecords(records, [WEB], { ticket: async () => next, pr: async () => 'open' }, new Set(), reread);

    await read(change);
    reread();

    return { records, workId: work.workId, commands, log, read, board };
}

/** In progress work on ticket WEB#7 and closed PR WEB#40, read open and assigned to pedro, set aside with the Needs you `causes`. */
async function archivedWork(causes: NeedsYouCause[], provider: Parameters<typeof commandsOn>[6]) {
    const records = await openRecords();
    const { record: work } = records.importTicket({
        title: 'Work',
        repository: WEB,
        kind: 'feature',
        status: 'In progress',
        ticket: `${WEB}#7`,
    });
    let record = records.setPullRequest(work.workId, work.revision, `${WEB}#40`);

    record = records.observe(work.workId, record.revision, { of: 'pr', state: 'closed' });
    record = records.observe(work.workId, record.revision, {
        of: 'ticket',
        state: causes.some((cause) => cause.type === 'ticket-closed')
            ? 'closed'
            : causes.some((cause) => cause.type === 'ticket-missing')
              ? 'not-found'
              : 'open',
        assignee: causes.some((cause) => cause.type === 'assignee-changed') ? 'sam' : 'pedro',
    });
    record = records.setNeedsYouCauses(work.workId, record.revision, causes);
    records.setAside(work.workId, record.revision);

    return { records, workId: work.workId, ...commandsOn([], undefined, records, [], undefined, undefined, provider) };
}

const TICKET_CLOSED: NeedsYouCause = { type: 'ticket-closed' };
const PR_CLOSED: NeedsYouCause = { type: 'pr-closed' };

for (const [what, causes, provider] of [
    [
        'ticket reopened',
        [TICKET_CLOSED],
        { ticket: async () => ({ state: 'open', assignee: 'pedro' }), pr: async () => 'open' },
    ],
] as [string, NeedsYouCause[], Parameters<typeof commandsOn>[6]][])
    test(`work whose ${what} while in Archive comes back with no notice`, async () => {
        const { records, workId, commands, board } = await archivedWork(causes, provider);

        assert.equal((await commands.restore(workId)).status, 200);
        assert.equal(board.find(workId)?.needsYou, undefined);
        assert.deepEqual(records.read(workId).needsYouCauses, []);
    });

test('a failed read during Restore still restores, with the notice as last saved, and the next observer pass settles it', async () => {
    const fail = async () => {
        throw new Error('Provider unavailable.');
    };
    const { records, workId, commands, board, reread } = await archivedWork([TICKET_CLOSED, PR_CLOSED], {
        ticket: fail,
        pr: fail,
    });

    assert.equal((await commands.restore(workId)).status, 200);
    assert.deepEqual(board.find(workId)?.needsYou?.causes, [TICKET_CLOSED, PR_CLOSED]);
    await observeRecords(
        records,
        [WEB],
        { ticket: async () => ({ state: 'open', assignee: 'pedro' }), pr: async () => 'open' },
        new Set(),
        reread,
    );
    assert.equal(board.find(workId)?.needsYou, undefined);
});

test('Keep working on a closed ticket removes the notice, keeps the Status and the closed read, and the same read raises nothing', async () => {
    const { records, workId, commands, log, read, board } = await observedTicketWork({
        state: 'closed',
        assignee: 'pedro',
    });

    assert.deepEqual(board.find(workId)?.needsYou?.offers, ['keep-working', 'set-aside']);
    assert.equal((await commands.resolveNeedsYou(workId, 'keep-working')).status, 200);
    assert.equal(board.find(workId)?.needsYou, undefined);
    assert.deepEqual([records.read(workId).status, records.read(workId).ticket, log], ['In progress', `${WEB}#7`, []]);
    assert.equal(records.observations(workId).find((o) => o.of === 'ticket')?.state, 'closed');
    await read({ state: 'closed', assignee: 'pedro' });
    assert.deepEqual(records.read(workId).needsYouCauses, []);
});

test('a cause raised while the PR reopens stays, since the notice the user confirmed did not name it', async () => {
    const { records, workId, commands } = await closedPrBuild({
        whileReopening: (opened, id) => {
            opened.setNeedsYouCauses(id, opened.read(id).revision, [{ type: 'pr-closed' }, { type: 'ticket-closed' }]);
        },
    });

    assert.equal((await commands.resolveNeedsYou(workId, 'reopen-pr')).status, 200);
    assert.deepEqual(records.read(workId).needsYouCauses, [{ type: 'ticket-closed' }]);
});

test('Start build reuses a live start, but a confirmed stopped build can start again once', async () => {
    const item = queued(7, { status: 'Ready', statuses: ['Ready'], labels: ['build'] });
    const { board, commands, log, branches, bases } = commandsOn([item]);

    await commands.startBuild(item.id, undefined);
    await commands.startBuild(item.id, undefined);
    assert.equal(log.length, 1, 'a repeated request reuses the original start');
    assert.deepEqual(
        bases,
        ['release-tip'],
        'builds start from the fetched commit of the resolved target, even when it is not main',
    );
    board.update({
        items: [
            {
                ...item,
                threads: [{ id: 'thread-1', title: 'Build', state: 'stopped', updated: '2026-10-29T00:00:00Z' }],
            },
        ],
    });
    await Promise.all([commands.startBuild(item.id, undefined), commands.startBuild(item.id, undefined)]);
    assert.equal(log.length, 2, 'concurrent retries start exactly one replacement');
    assert.equal(branches[0], 'chore/7-item-7');
    assert.notEqual(branches[1], branches[0], 'a replacement worktree must not reuse the stopped build branch');
});

test('Queue and Back to List move the work record and write nothing to its ticket', async () => {
    const records = await openRecords();
    const work = records.importTicket({ title: 'Work', repository: WEB, kind: 'bug', ticket: `${WEB}#7` }).record;
    const { board, commands, log } = commandsOn([], undefined, records);

    assert.equal((await commands.queue(work.workId)).status, 200);
    assert.equal(records.read(work.workId).status, 'Queued');
    assert.equal(board.find(work.workId)?.status, 'Queued', 'the board reads the record again at once');
    assert.equal(commands.backToList(work.workId).status, 200);
    assert.equal(records.read(work.workId).status, 'List');
    assert.deepEqual(log, []);
});

test('a move on a record a thread changed since the board read it is refused, and the board reads it again', async () => {
    const records = await openRecords();
    const work = records.create({ title: 'Work', repository: WEB, kind: 'feature' });
    const { board, commands } = commandsOn([], undefined, records);

    records.update(work.workId, work.revision, { kind: 'bug' });

    const refused = await commands.queue(work.workId);

    assert.equal(refused.status, 409);
    assert.match((refused.body as { error: string }).error, /read it again/);
    assert.equal(records.read(work.workId).status, 'List');
    assert.equal(board.find(work.workId)?.kind, 'bug');
    assert.equal(
        (await commands.queue(work.workId)).status,
        200,
        'the next move names the revision the board read again',
    );
});

/** A build in the board's records held by a Dependency on `server-team#40`, and the hold the board shows. */
async function heldBuild() {
    const records = await openRecords();
    const build = records.create({ title: 'Build', repository: WEB, kind: 'build', status: 'Ready' });
    let dependency = records.addDependency(build.workId, {
        need: 'An endpoint',
        owner: 'server team',
        ticket: 'maddec01/lar-server#40',
    });

    dependency = records.addDependencyBlock(dependency.dependencyId, dependency.revision, build.workId);

    const { board, commands, reread } = commandsOn([], undefined, records);
    const shown = () => board.find(build.workId)!.blockers[0]!.dependency!;

    return { records, build, dependency, commands, reread, shown };
}

/** Records the board's own observation of the Dependency's ticket as `kind`, as an observation pass does, and whether it changed the kind. */
function observe(
    records: WorkRecords,
    commands: ItemCommands,
    dependencyId: string,
    kind: 'closed' | 'reopened' = 'closed',
) {
    const before = records.dependency(dependencyId);
    const { revision } = records.observeDependency(dependencyId, before.revision, {
        subject: 'maddec01/lar-server#40',
        kind,
    });

    commands.observedDependency(dependencyId, before.revision, revision, before.observations[0]?.kind !== kind);
}

test("a met mark against the hold a page shows lands though the board's own observations wrote since", async () => {
    const { records, build, dependency, commands, reread, shown } = await heldBuild();

    observe(records, commands, dependency.dependencyId);
    reread();

    const { revision } = shown();

    // Two more observation passes commit; the board shows the first before the mark, and the page still shows neither.
    observe(records, commands, dependency.dependencyId);
    reread();
    observe(records, commands, dependency.dependencyId);

    const marked = commands.markDependencyMet(build.workId, dependency.dependencyId, revision, true);

    assert.equal(marked.status, 200, JSON.stringify(marked.body));
    assert.ok(records.dependency(dependency.dependencyId).met);
    assert.ok(shown().met, 'the board reads it again');
    assert.equal(
        commands.markDependencyMet(build.workId, dependency.dependencyId, revision, false).status,
        409,
        'the mark is no observation',
    );
});

test("a met mark is refused once another writer's change came between the board's own observations", async () => {
    const { records, build, dependency, commands, reread, shown } = await heldBuild();

    observe(records, commands, dependency.dependencyId);
    reread();

    const { revision } = shown();

    observe(records, commands, dependency.dependencyId);

    const current = records.dependency(dependency.dependencyId);

    records.updateDependency(dependency.dependencyId, current.revision, { need: 'Another endpoint' });
    observe(records, commands, dependency.dependencyId);
    assert.equal(commands.markDependencyMet(build.workId, dependency.dependencyId, revision, true).status, 409);
    assert.equal(records.dependency(dependency.dependencyId).met, null);
});

/**
 * Commands on the board of `records`, where each item shows the threads `shown` gives for its recorded thread IDs, as
 * T3 shows them. Starts record their messages in `started`, and `recover` plays T3's answer to a reconciliation.
 */
function recordedCommands(
    records: WorkRecords,
    {
        shown = (ids: string[]) =>
            ids.map((id) => ({ id, title: 't', state: 'running' as const, updated: '2026-10-31T00:00:00Z' })),
        recover = async (
            _project: string,
            _messages: readonly string[],
        ): Promise<{ threadId: string; title: string } | 'absent' | 'unknown'> => 'absent',
        lookup = async (): Promise<'live' | 'deleted' | 'unknown'> => 'unknown',
        skills = [] as string[],
        during = () => {},
        beforeLaunch = () => {},
        cleanupChoice = (): ShapingThreadCleanup => 'archive',
        startAnswer = () => null,
        resumeLaunch,
        clearedFailuresFile = null,
        outcomeSend,
    }: {
        outcomeSend?: NonNullable<ItemCommandsDeps['briefApprovalDeps']>['send'];
        clearedFailuresFile?: string | null;
        cleanupChoice?: () => ShapingThreadCleanup;
        startAnswer?: () => StartResult | null;
        resumeLaunch?: ItemCommandsDeps['resumeLaunch'];
        shown?: (ids: string[]) => Item['threads'];
        recover?: (
            project: string,
            messages: readonly string[],
        ) => Promise<{ threadId: string; title: string } | 'absent' | 'unknown'>;
        lookup?: () => Promise<'live' | 'deleted' | 'unknown'>;
        skills?: string[];
        during?: () => void;
        beforeLaunch?: (board: ReturnType<typeof createBoardState>) => void;
    } = {},
) {
    const board = createBoardState({ items: [], repos: [], modelChoices: [] } as unknown as BoardData);
    const reread = () =>
        board.update({
            items: recordItems(records, [], [WEB]).map((item) => {
                const ids = records.threads(item.id).map((t) => t.threadId);

                return ids.length ? { ...item, threads: shown(ids) } : item;
            }),
        });

    reread();

    const started: string[] = [];
    const commands = createItemCommands({
        clearedFailuresFile,
        outcomeDeps: { send: outcomeSend },
        factoryContext: null,
        checkoutOf: async () => '/repo',
        inspectWorkRecovery: async () => ({ branch: 'old', branchExists: true, worktreePath: null, pr: 'none' }),
        board,
        items: {} as ItemSource,
        records,
        reread,
        archive: () => [],
        offerModelChoices: () => [],
        showThread: lookup,
        projectOf: async (repo) => {
            beforeLaunch(board);

            return { projectId: repo };
        },
        baseOf: async () => 'release',
        fetchBase: async (_project, branch) => `${branch}-tip`,
        buildAccessOf: () => ({ 'push-branch': 'allowed', 'open-pr': 'allowed' }),
        recoverThread: recover,
        resumeLaunch,
        skillsOf: () => skills,
        shapingThreadCleanupChoice: cleanupChoice,
        startThread: async (_project, message) => {
            during();

            const answered = startAnswer();

            if (answered) return answered;

            started.push(message);

            return { thread: { threadId: `thread-${started.length}`, title: 't' }, error: null };
        },
    });

    return { board, commands, started, reread };
}

test('Start writes a launch intent before it asks T3, and records the thread T3 starts', async () => {
    const records = await openRecords();
    const work = records.create({ title: 'Tidy the docs', repository: WEB, kind: 'improvement', status: 'Queued' });
    let unresolved = -1;
    const { commands, started } = recordedCommands(records, {
        during: () => {
            unresolved = records.launchIntents({ workId: work.workId, unresolved: true }).length;
        },
    });

    assert.equal((await commands.start(work.workId, undefined)).status, 200);
    assert.equal(unresolved, 1, 'the intent is on the record while T3 starts the thread');
    assert.deepEqual(
        started.map((message) => message.split('\n').slice(0, 2)),
        [
            [
                'Shaping Tidy the docs',
                `Shape ${work.workId}. Read '${CHECKOUT_SKILLS}/lar-shape/SKILL.md' and follow it.`,
            ],
        ],
    );
    assert.deepEqual(
        records.threads(work.workId).map((t) => [t.threadId, t.purpose]),
        [['thread-1', 'shape']],
    );
    assert.deepEqual(
        records.launchIntents({ workId: work.workId }).map((i) => [i.outcome, i.threadId]),
        [['started', 'thread-1']],
    );
});

test('after a restart, an unresolved start records the thread T3 shows for it and starts no second one', async () => {
    const records = await openRecords();
    const work = records.create({ title: 'Work', repository: WEB, kind: 'feature', status: 'Queued' });

    records.recordLaunchIntent(work.workId, work.revision, 'shape');

    const { commands, started } = recordedCommands(records, {
        recover: async () => ({ threadId: 'late', title: 'Work' }),
    });
    const reply = await commands.start(work.workId, undefined);

    assert.deepEqual([reply.status, (reply.body as { thread: { threadId: string } }).thread.threadId], [200, 'late']);
    assert.deepEqual(started, []);
    assert.deepEqual(
        records.threads(work.workId).map((t) => t.threadId),
        ['late'],
    );
    assert.equal((await commands.start(work.workId, undefined)).status, 409);
    assert.deepEqual(started, [], 'the recorded running thread is the start');
});

test('Abandon is refused while a Start is in flight, uncertain or done for the item', async () => {
    const refused = 'Start is running or has run for this item. Check its T3 thread before abandoning it.';
    const records = await openRecords();
    const work = records.create({ title: 'Work', repository: WEB, kind: 'feature', status: 'Queued' });
    const unsure = records.create({ title: 'Unsure', repository: WEB, kind: 'feature', status: 'Queued' });

    records.recordLaunchIntent(unsure.workId, unsure.revision, 'shape');

    let inFlight: ReturnType<ItemCommands['abandon']> | undefined;
    const { commands } = recordedCommands(records, {
        during: () => {
            inFlight ??= commands.abandon(work.workId);
        },
    });

    assert.equal((await commands.start(work.workId, undefined)).status, 200);
    assert.deepEqual(await inFlight!.then((r) => [r.status, (r.body as { error: string }).error]), [409, refused]);
    assert.equal((await commands.abandon(work.workId)).status, 409, 'done');
    assert.deepEqual(
        await commands.abandon(unsure.workId).then((r) => [r.status, (r.body as { error: string }).error]),
        [409, refused],
        'uncertain',
    );
    assert.deepEqual(
        records.list({}).map((r) => r.setAside),
        [false, false],
    );
});

const idle = (ids: string[]) =>
    ids.map((id) => ({ id, title: 't', state: 'done' as const, updated: '2026-10-31T00:00:00Z' }));

/** A record ready to build, with one shaping thread that has stopped. */
async function shapedBuild() {
    const records = await openRecords();
    const made = records.create({ title: 'Build it', repository: WEB, kind: 'feature', status: 'Ready' });

    approveBuild(records, made.workId);
    records.addThread(made.workId, records.read(made.workId).revision, 'shape-1', 'shape');

    return { records, workId: made.workId };
}

for (const [name, live] of [['running', { state: 'running' }]] satisfies [string, Partial<ItemThread>][]) {
    test(`Start build with shaping ${name} refuses without any record write`, async () => {
        const { records, workId } = await shapedBuild();
        const { commands, started } = recordedCommands(records, {
            shown: (ids) =>
                ids.map((id) => ({
                    id,
                    title: 'Shape',
                    updated: '2026-11-01T08:00:00Z',
                    purpose: 'shape',
                    ...live,
                })),
        });
        // No provider observer runs here, so every revision change would belong to Start build itself.
        const before = records.read(workId);
        const threads = records.threads(workId);
        const reply = await commands.startBuild(workId, undefined);

        assert.equal(reply.status, 409);
        assert.equal(
            (reply.body as { error: string }).error,
            'A shaping thread is still at work on this item. Wait for it to finish, then start the build.',
        );
        assert.deepEqual(records.read(workId), before);
        assert.deepEqual(records.threads(workId), threads);
        assert.deepEqual(records.launchIntents({ workId }), []);
        assert.deepEqual(records.pendingShapingThreadCleanups(), []);
        assert.deepEqual(started, []);
    });
}

test('Start build saves the setting, and its shaping threads wait for cleanup once the build thread is recorded', async () => {
    const { records, workId } = await shapedBuild();
    let intents = -1;
    let pendingDuring = -1;
    const { commands } = recordedCommands(records, {
        shown: idle,
        during: () => {
            intents = records
                .launchIntents({ workId, unresolved: true })
                .filter((intent) => intent.shapingThreadCleanup === 'archive').length;
            pendingDuring = records.pendingShapingThreadCleanups().length;
        },
    });

    assert.equal((await commands.startBuild(workId, undefined)).status, 200);
    assert.deepEqual([intents, pendingDuring], [1, 0]);
    assert.deepEqual(
        records.pendingShapingThreadCleanups().map(({ threadId, action }) => [threadId, action]),
        [['shape-1', 'archive']],
    );
});

test('stopped shaping resumes in one new thread without changing its gate or starting a build', async () => {
    const records = await openRecords();
    let work = records.create({ title: 'Prototype', repository: WEB, kind: 'feature', status: 'Shaping' });

    work = records.addThread(work.workId, work.revision, 'old', 'shape');

    const { commands, started } = recordedCommands(records, {
        shown: (ids) =>
            ids.map((id) => ({
                id,
                title: 'Shape',
                state: id === 'old' ? 'stopped' : 'running',
                updated: '2026-10-31T00:00:00Z',
            })),
    });
    const replies = await Promise.all([commands.start(work.workId, undefined), commands.start(work.workId, undefined)]);

    assert.deepEqual(
        replies.map((reply) => reply.status),
        [200, 200],
    );
    assert.equal(started.length, 1);
    assert.equal(records.read(work.workId).status, 'Shaping');
    assert.deepEqual(
        records.threads(work.workId).map((thread) => thread.purpose),
        ['shape', 'shape'],
    );
    assert.equal(
        (await commands.start(work.workId, undefined)).status,
        409,
        'a repeated request identifies the running resumed thread',
    );
    assert.equal(started.length, 1, 'a repeated request never starts another thread');
});

test('combined requests share a transition and exclude Start while the provider is pending', async () => {
    let finish!: (error: string | null) => void;
    let transitions = 0;
    const board = createBoardState({ items: [queued(7)], repos: [], modelChoices: [] } as unknown as BoardData);
    const commands = createItemCommands({
        factoryContext: null,
        board,
        records: null,
        reread: () => {},
        archive: () => [],
        offerModelChoices: () => [],
        items: {
            observeTicket: async () => ({ state: 'open' }),
            abandon: () => {
                transitions++;

                return new Promise<string | null>((resolve) => {
                    finish = resolve;
                });
            },
        } as unknown as ItemSource,
    });
    const first = commands.abandonAndClose(queued(7).id);
    const duplicate = commands.abandonAndClose(queued(7).id);

    await new Promise((resolve) => setTimeout(resolve, 0));
    assert.equal(transitions, 1);
    assert.equal((await commands.start(queued(7).id, undefined)).status, 409);
    assert.equal((await commands.abandon(queued(7).id)).status, 409);
    finish(null);
    assert.equal((await first).status, 200);
    assert.equal((await duplicate).status, 200);
});

for (const briefChoice of ['reshape'] as ('keep' | 'reshape')[])
    test(`deleted-thread move requires a brief choice and can ${briefChoice}`, async () => {
        const records = await openRecords();
        const work = records.create({ title: 'Recover work', repository: WEB, kind: 'build', status: 'Review' });

        records.setBody(work.workId, work.revision, 'brief', 'Keep this brief.');
        records.recordGate(work.workId, records.read(work.workId).revision, {
            briefDigest: records.gate(work.workId).briefDigest!,
            approvedBy: 'test',
            evidence: 'Passed.',
        });

        const { commands, board } = recordedCommands(records);
        const item = board.find(work.workId)!;

        board.update({
            items: [
                {
                    ...item,
                    threads: [],
                    needsYou: {
                        reason: 'Deleted',
                        causes: [],
                        ticketOpen: false,
                        deletedThread: true,
                        offers: ['back-to-list'],
                    },
                },
            ],
        });
        assert.equal((await commands.resolveNeedsYou(work.workId, 'back-to-list', 'invalid')).status, 422);
        assert.equal((await commands.resolveNeedsYou(work.workId, 'back-to-list')).status, 422);
        assert.equal(records.read(work.workId).status, 'Review');
        assert.equal((await commands.resolveNeedsYou(work.workId, 'back-to-list', briefChoice)).status, 200);
        assert.equal(records.read(work.workId).status, 'List');
        assert.equal(records.body(work.workId, 'brief'), 'Keep this brief.');
        assert.equal(records.gate(work.workId).current, briefChoice === 'keep');
    });

test('Start again preserves launch intents and continues a deleted build on its branch', async () => {
    const records = await openRecords();
    const work = records.create({ title: 'Recover build', repository: WEB, kind: 'build', status: 'In progress' });

    records.addThread(work.workId, records.read(work.workId).revision, 'deleted-build', 'build');
    records.confirmThreadDeleted(work.workId, records.read(work.workId).revision, 'deleted-build');

    approveBuild(records, work.workId);

    const { board, commands, bases, branches } = commandsOn([], undefined, records);
    const item = board.find(work.workId)!;

    board.update({
        items: [
            {
                ...item,
                threads: [],
                needsYou: {
                    reason: 'Deleted',
                    causes: [],
                    ticketOpen: false,
                    deletedThread: true,
                    offers: ['start-again'],
                },
            },
        ],
    });
    assert.equal((await commands.startAgain(work.workId, undefined, {})).status, 409);
    assert.equal(records.launchIntents({ workId: work.workId }).length, 0);
    assert.equal((await commands.startAgain(work.workId, undefined, { branchChoice: 'continue' })).status, 200);
    assert.deepEqual(branches, ['old']);
    assert.deepEqual(bases, ['old']);
    assert.equal(records.threads(work.workId).length, 2);
    assert.equal(records.launchIntents({ workId: work.workId, unresolved: true }).length, 0);
});

test('a newer cleanup confirmation replaces the previous item token', async () => {
    const records = await openRecords();
    const record = records.create({ title: 'Empty', repository: WEB, kind: 'issue' });
    const { commands } = commandsOn([], undefined, records);
    const first = (await commands.inspectOwnedCleanup(record.workId)).body as { token: string };

    await commands.inspectOwnedCleanup(record.workId);
    assert.equal((await commands.executeOwnedCleanup(record.workId, { token: first.token })).status, 409);
});

test('changing the kind of an item with no record makes its record first, and a failed swap leaves it with the old kind', async () => {
    const records = await openRecords();
    const ticket = queued(9, { recorded: false, status: 'List', statuses: [], kind: 'bug', labels: ['bug'] });
    const board = createBoardState({
        items: [ticket],
        repos: [
            {
                repo: WEB,
                setup: { access: { 'tag-ticket': 'allowed' }, vocabulary: effectiveVocabulary({}).vocabulary },
            },
        ],
        modelChoices: [],
    } as unknown as BoardData);
    const source = {
        readTicket: async () => ({ number: 9, title: 'Item 9', url: ticket.url!, text: '', kind: 'bug' }),
    } as unknown as ItemSource;
    let fail = true;
    const commands = createItemCommands({
        factoryContext: null,
        board,
        items: source,
        records,
        reread: () => {},
        archive: () => [],
        offerModelChoices: () => [],
        kindTracker: () => ({
            labels: {
                addToTicket: async () => {},
                removeFromTicket: async () => {
                    if (fail) throw new Error('az failed: TF26071');
                },
            },
            kinds: {
                read: async () => ({ labels: ['bug'], type: 'Bug' }),
                setType: async () => {},
                boardTypes: async () => null,
            },
        }),
    });
    const failed = await commands.changeKind(ticket.id, 'feature');
    const { itemId } = failed.body as { itemId: string };

    assert.equal(failed.status, 502);
    assert.equal(records.read(itemId).kind, 'bug');
    assert.equal(records.read(itemId).ticket, `${WEB}#9`);
    fail = false;
    board.update({ items: recordItems(records, [], [WEB]) });

    const retried = await commands.changeKind(itemId, 'feature');

    assert.equal(retried.status, 200);
    assert.equal(records.read(itemId).kind, 'feature');
    assert.deepEqual(retried.labelChanges, [{ label: 'bug', action: 'remove' }]);
});

/** A board showing record `workId` with this disagreement. */
const disagreeing = (records: WorkRecords, kindDisagreement: Item['kindDisagreement']) => {
    const { commands, board } = commandsOn([], undefined, records);
    const { workId } = records.importTicket({
        title: 'T',
        repository: WEB,
        kind: 'feature',
        ticket: `${WEB}#9`,
    }).record;

    board.update({ items: [queued(9, { id: workId, kind: 'feature', kindDisagreement })] });

    return { commands, workId };
};
const TICKET_MOVED: NonNullable<Item['kindDisagreement']> = {
    ticketKind: 'bug',
    changed: 'ticket',
    kept: false,
    swap: { add: [], remove: [], type: null },
};

test("updating the item takes the ticket's kind, with no tracker write, and agrees with it", async () => {
    const records = await openRecords();
    const { commands, workId } = disagreeing(records, TICKET_MOVED);

    assert.equal(commands.answerKind(workId, 'update-item', 'bug').status, 200);
    assert.deepEqual(records.read(workId), {
        ...records.read(workId),
        kind: 'bug',
        agreedTicketKind: 'bug',
        kindAnswer: null,
    });
});

test('T3 answering moves Queued work to Shaping and Ready work to In progress, and pushes in that step', async () => {
    const records = await openRecords();
    const concept = records.create({ title: 'Concept', repository: WEB, kind: 'concept', status: 'Queued' });
    const build = records.create({ title: 'Build', repository: WEB, kind: 'build', status: 'Ready' });

    approveBuild(records, build.workId);

    const { commands, board } = recordedCommands(records);
    const pushed: Status[] = [];

    board.subscribe((data) => {
        const status = data.items.find((i) => i.id === build.workId)?.status;

        if (status) pushed.push(status);
    });
    assert.equal((await commands.start(concept.workId, undefined)).status, 200);
    assert.equal(records.read(concept.workId).status, 'Shaping');
    assert.equal(board.find(concept.workId)?.status, 'Shaping');
    assert.equal((await commands.startBuild(build.workId, undefined)).status, 200);
    assert.equal(records.read(build.workId).status, 'In progress');
    assert.equal(pushed.at(-1), 'In progress');
});

test('a build that reached implementation is not retried from In progress', async () => {
    const records = await openRecords();
    const build = records.create({ title: 'Build', repository: WEB, kind: 'build', status: 'Ready' });

    approveBuild(records, build.workId);

    const { commands, started, reread } = recordedCommands(records, {
        shown: (ids) =>
            ids.map((id) => ({
                id,
                title: 't',
                state: 'stopped' as const,
                purpose: 'build',
                updated: '2026-10-31T00:00:00Z',
            })),
    });

    await commands.startBuild(build.workId, undefined);
    records.setBuildPhase(build.workId, records.read(build.workId).revision, 'implement');
    reread();
    assert.equal((await commands.startBuild(build.workId, undefined)).status, 409);
    assert.equal(started.length, 1);
});

for (const kind of ['build'] as ('issue' | 'concept' | 'decision' | 'build')[])
    test(`board launch uses the frozen ${kind} target and passes role settings`, async () => {
        const { defaultFactorySettings } = await import('@lar-factory/shared/factory-settings');
        const { writeFactorySettings } = await import('@lar-factory/work-records/factory-settings');
        const { executionSettingsOf } = await import('@lar-factory/shared/execution-target');
        const records = await openRecords();
        const dir = opened.at(-1)!.dir;
        const record = records.importTicket({
            title: 'Configured',
            repository: WEB,
            kind,
            status: kind === 'build' ? 'Ready' : 'Queued',
            ticket: `${WEB}#5`,
        }).record;

        if (kind === 'build') approveBuild(records, record.workId);

        const settings = defaultFactorySettings();

        settings.threadKinds[kind === 'issue' ? 'shaping' : kind] = {
            model: { instanceId: 'claude', model: 'opus' },
            effort: 'high',
        };
        settings.roles.planner = { effort: 'low' };
        writeFactorySettings(settings, dir);

        const start = vi.fn<NonNullable<ItemCommandsDeps['startThread']>>(async (_project, _message, selection) => ({
            thread: { threadId: 'configured', title: 'Configured' },
            error: null,
            executionReport: { source: 't3', reference: 'configured', actual: executionSettingsOf(selection!) },
        }));
        let available = false;
        const { commands } = commandsOn([], undefined, records, [], undefined, undefined, undefined, {
            factoryContext: {
                dataDir: dir,
                bin: '/fixture/bin',
            },
            skillsOf: () => [],
            runLaunchDeps: {
                defaults: () => ({ selection: null, runtimeMode: 'full-access' }),
                models: async () =>
                    available
                        ? [
                              {
                                  instanceId: 'claude',
                                  model: 'opus',
                                  options: [{ id: 'effort', values: ['low', 'high'] }],
                              },
                          ]
                        : [],
                packaged: () => ({
                    version: 'fixture',
                    reviewers: { code: 'Code', security: 'Security', ui: 'UI', performance: 'Performance' },
                }),
                release: () => undefined,
            },
            startThread: start,
        });
        const held =
            kind === 'build'
                ? await commands.startBuild(record.workId, undefined)
                : await commands.start(record.workId, undefined);

        assert.equal((held.body as StartResult).hold, true);
        assert.match((held.body as StartResult).error!, /unavailable/);
        assert.equal(start.mock.calls.length, 0);

        const runId = records.runSettings(record.workId).runs[0]!.runId;

        available = true;

        const response =
            kind === 'build'
                ? await commands.startBuild(record.workId, undefined)
                : await commands.start(record.workId, undefined);

        assert.equal(response.status, 200, JSON.stringify(response.body));
        assert.equal(start.mock.calls.length, 1);
        assert.deepEqual(start.mock.calls[0]![2], {
            instanceId: 'claude',
            model: 'opus',
            options: [{ id: 'effort', value: 'high' }],
        });

        const { runs, roleRuns } = records.runSettings(record.workId);

        const message = start.mock.calls[0]![1];

        assert.equal(message.split('\n')[0], `${kind === 'build' ? 'Build' : 'Shaping'} #5 Configured`);
        assert.equal(message.match(/<!-- factory-runtime:start -->/g)?.length, 2);
        assert.equal(message.match(/<!-- factory-runtime:end -->/g)?.length, 2);
        assert.match(start.mock.calls[0]![1], new RegExp(runs[0]!.runId));
        assert.ok(
            start.mock.calls[0]![1].includes(JSON.stringify(runs[0]!.roles)),
            'all frozen roles reach the thread',
        );
        assert.equal(runs[0]!.roles.planner.effort, 'low');
        assert.equal(runs[0]!.runId, runId);
        assert.equal(roleRuns[0]!.result, 'failed');
        assert.equal(roleRuns.at(-1)!.result, 'completed');
        assert.deepEqual(roleRuns.at(-1)!.requested, roleRuns.at(-1)!.actual);
        assert.equal(records.launchIntents({ workId: record.workId, unresolved: true }).length, 0);
        assert.deepEqual(
            records.threads(record.workId).map(({ threadId, purpose }) => ({ threadId, purpose })),
            [{ threadId: 'configured', purpose: kind === 'build' ? 'build' : 'shape' }],
        );
        assert.equal(roleRuns.at(-1)!.executionId, records.launchIntents({ workId: record.workId })[0]!.intentId);
    });

/** The checkout's assembled skills, which a board without an app version reads for every run. */
const CHECKOUT_SKILLS = fileURLToPath(new URL('../../../../.assembled-skills/skills', import.meta.url));

/**
 * The build prompt of a run frozen while the app ran `captured`, started once the app runs `running`, with release
 * folders for `folders` in the data folder.
 */
async function promptAfterUpdate(captured: string | undefined, running: string | undefined, folders: string[]) {
    const { defaultFactorySettings } = await import('@lar-factory/shared/factory-settings');
    const { writeFactorySettings } = await import('@lar-factory/work-records/factory-settings');
    const { executionSettingsOf } = await import('@lar-factory/shared/execution-target');
    const records = await openRecords();
    const dir = opened.at(-1)!.dir;
    const settings = defaultFactorySettings();

    settings.threadKinds.build = { model: { instanceId: 'claude', model: 'opus' }, effort: 'high' };
    writeFactorySettings(settings, dir);

    for (const release of folders)
        for (const skill of ['lar-shape', 'lar-build']) {
            mkdirSync(join(dir, 'bundles', release, 'skills', skill), { recursive: true });
            writeFileSync(join(dir, 'bundles', release, 'skills', skill, 'SKILL.md'), skill);
        }

    const record = records.importTicket({
        title: 'Updated',
        repository: WEB,
        kind: 'build',
        status: 'Ready',
        ticket: `${WEB}#9`,
    }).record;

    approveBuild(records, record.workId);

    const start = vi.fn<NonNullable<ItemCommandsDeps['startThread']>>(async (_project, _message, selection) => ({
        thread: { threadId: 'updated', title: 'Updated' },
        error: null,
        executionReport: { source: 't3', reference: 'updated', actual: executionSettingsOf(selection!) },
    }));
    let available = false;
    const { commands } = commandsOn([], undefined, records, [], undefined, undefined, undefined, {
        factoryContext: { dataDir: dir, bin: '/fixture/bin' },
        skillsOf: () => [],
        runLaunchDeps: {
            defaults: () => ({ selection: null, runtimeMode: 'full-access' }),
            models: async () =>
                available
                    ? [{ instanceId: 'claude', model: 'opus', options: [{ id: 'effort', values: ['high'] }] }]
                    : [],
            packaged: () => ({
                version: 'fixture',
                reviewers: { code: 'Code', security: 'Security', ui: 'UI', performance: 'Performance' },
            }),
            release: () => process.env.BOARD_APP_VERSION || undefined,
        },
        startThread: start,
    });

    vi.stubEnv('BOARD_DEV_SKILLS_DIR', undefined);
    vi.stubEnv('BOARD_BUNDLE_DIR', '/app/bundle');
    vi.stubEnv('BOARD_APP_VERSION', captured);
    // The models are unavailable, so the first start freezes the run and holds before T3.
    assert.equal(((await commands.startBuild(record.workId, undefined)).body as StartResult).hold, true);
    assert.equal(records.runSettings(record.workId).runs[0]!.release, captured);

    available = true;
    vi.stubEnv('BOARD_APP_VERSION', running);
    assert.equal((await commands.startBuild(record.workId, undefined)).status, 200);

    return { prompt: start.mock.calls[0]![1], dir };
}

test("a run keeps reading its release's lar-build after the app moves to another release", async () => {
    const { prompt, dir } = await promptAfterUpdate('1.0.0', '2.0.0', ['1.0.0', '2.0.0']);

    assert.ok(prompt.includes(`Read ${join(dir, 'bundles/1.0.0/skills/lar-build')}/agents/builder.md`), prompt);
    assert.ok(prompt.includes(`LAR_FACTORY_SHAPE_SKILL='${join(dir, 'bundles/1.0.0/skills/lar-shape/SKILL.md')}'`));
    assert.ok(!prompt.includes('2.0.0'));
});

for (const [captured, why] of [
    [undefined, 'no frozen release'],
    ['1.0.0', 'a missing release folder'],
] as const)
    test(`a run with ${why} reads the running release`, async () => {
        const { prompt, dir } = await promptAfterUpdate(captured, '2.0.0', ['2.0.0']);

        assert.ok(prompt.includes(`Read ${join(dir, 'bundles/2.0.0/skills/lar-build')}/agents/builder.md`), prompt);
    });

test("a server without an app version reads the checkout's assembled skills, even for a run saved on a release", async () => {
    const { prompt } = await promptAfterUpdate('1.0.0', undefined, ['1.0.0']);

    assert.ok(prompt.includes(`Read ${CHECKOUT_SKILLS}/lar-build/agents/builder.md`), prompt);
    assert.ok(!prompt.includes('bundles'));
});

// How the owner was recorded and what T3 shows of it vary independently; the thread states are classified once, in the
// Start build and resume tests above.
for (const [launch, state] of [['skill', 'needs you']] as [
    'board' | 'skill' | 'direct handoff',
    'running' | 'unavailable' | 'needs you' | 'queued',
][])
    test(`${launch} shaping owner blocks a second Start, including after a board restart (${state})`, async () => {
        const records = await openRecords();
        let work = records.create({ title: 'Decision', repository: WEB, kind: 'decision', status: 'Queued' });
        let owner = 'skill-thread';

        if (launch === 'board') {
            await recordedCommands(records).commands.start(work.workId, undefined);
            owner = 'thread-1';
        } else if (launch === 'skill') {
            const saved = records.recordLaunchIntent(work.workId, work.revision, 'shape');

            records.resolveLaunchIntent(work.workId, saved.record.revision, saved.intent.intentId, {
                threadId: owner,
            });
        } else records.addThread(work.workId, work.revision, owner, 'shape');

        const after = recordedCommands(records, {
            shown: (ids) =>
                state === 'unavailable'
                    ? 'unavailable'
                    : ids.map((id) => ({
                          id,
                          title: 'Decision',
                          state: state === 'queued' ? 'done' : state,
                          ...(state === 'queued' && { queued: true as const }),
                          updated: '2026-10-31T00:00:00Z',
                      })),
        });
        const reply = await after.commands.start(work.workId, undefined);

        assert.equal(reply.status, 409);
        assert.match((reply.body as { error: string }).error, /already owns.*shaping.*Open thread/);
        assert.equal((reply.body as { thread: { threadId: string } }).thread.threadId, owner);
        assert.deepEqual(after.started, []);
    });

test('decision-authored drafts cannot launch through a forged Ready status', async () => {
    const records = await openRecords();
    const concept = records.create({ title: 'Destination', repository: WEB, kind: 'concept' });
    const build = records.createPart({
        parentId: concept.workId,
        parentRevision: concept.revision,
        title: 'Draft',
        repository: WEB,
        kind: 'build',
        body: 'False code claim; depends on another build (prose only).',
        blockerIds: [],
    });
    const ready = records.update(build.workId, build.revision, { status: 'Ready' });

    refineConcept(records, concept.workId);

    const { commands, log } = commandsOn([], undefined, records);
    const refused = await commands.startBuild(build.workId, undefined);

    assert.equal(refused.status, 409);
    assert.match((refused.body as { error: string }).error, /current passing gate/);
    assert.deepEqual(log, []);
    assert.deepEqual(records.launchIntents({ workId: build.workId }), []);
    assert.throws(() => records.recordLaunchIntent(build.workId, ready.revision, 'build'), /current passing gate/);

    const fixed = records.setBody(
        build.workId,
        ready.revision,
        'brief',
        'Code claim corrected; no unrecorded dependency.',
    );

    records.recordGate(build.workId, fixed.revision, {
        briefDigest: records.gate(build.workId).briefDigest!,
        approvedBy: 'Pedro',
        evidence: 'Code checked, Doubt clean; yes.',
    });
    records.update(build.workId, records.read(build.workId).revision, { status: 'Ready' });
    assert.equal((await commands.startBuild(build.workId, undefined)).status, 200);
});

test('concept run action refuses all holds and stale revisions, then saves start and pause without launching', async () => {
    const records = await openRecords();
    const group = records.create({ title: 'Deliver concept', repository: WEB, kind: 'concept' });
    const build = records.createPart({
        parentId: group.workId,
        parentRevision: group.revision,
        title: 'Build part',
        repository: WEB,
        kind: 'build',
        body: 'Exact brief',
        blockerIds: [],
    });
    const { commands, log } = commandsOn([], undefined, records);
    const rev = (id: string) => records.read(id).revision;

    assert.equal(commands.setConceptBuildRun(group.workId, rev(group.workId), 'running').status, 409);
    assert.equal(records.conceptBuildPlan(group.workId).run, null);
    records.setFogGone(group.workId, rev(group.workId), true);
    records.setBody(group.workId, rev(group.workId), 'map', 'Approved destination');
    records.update(build.workId, rev(build.workId), { status: 'Ready' });
    records.recordGate(build.workId, rev(build.workId), {
        briefDigest: records.gate(build.workId).briefDigest!,
        approvedBy: 'Pedro',
        evidence: 'Yes',
    });
    assert.equal(commands.setConceptBuildRun(group.workId, 1, 'running').status, 409);
    assert.equal(commands.setConceptBuildRun(group.workId, rev(group.workId), 'running').status, 200);
    assert.equal(records.conceptBuildPlan(group.workId).run?.state, 'running');
    assert.equal(commands.setConceptBuildRun(group.workId, rev(group.workId), 'paused').status, 200);
    assert.equal(records.conceptBuildPlan(group.workId).run?.state, 'paused');
    assert.deepEqual(log, []);
});

test('two boards share one atomic capacity claim, and independent same-repository builds can use two slots', async () => {
    for (const limit of [1, 2]) {
        const records = await openRecords();
        const a = records.create({ title: 'A', repository: WEB, kind: 'build', status: 'Ready' }).workId;
        const b = records.create({ title: 'B', repository: WEB, kind: 'build', status: 'Ready' }).workId;

        for (const id of [a, b]) approveBuild(records, id);

        const first = commandsOn([], undefined, records);
        const second = commandsOn([], undefined, records);

        for (const { board } of [first, second]) board.update({ buildLimit: { limit, automatic: limit } });

        const results = await Promise.all([
            first.commands.startBuild(a, undefined, undefined, true, { automatic: true }),
            second.commands.startBuild(b, undefined, undefined, true, { automatic: true }),
        ]);

        assert.equal(results.filter((result) => result.status === 200).length, limit);
        assert.equal(records.launchIntents({}).length, limit);
        assert.equal(
            first.log.filter((line) => line.startsWith('start')).length +
                second.log.filter((line) => line.startsWith('start')).length,
            limit,
        );
    }
});

test('a gate changed during asynchronous preparation cannot launch a different approved brief', async () => {
    const records = await openRecords();
    const build = records.create({ title: 'Exact gate', repository: WEB, kind: 'build', status: 'Ready' }).workId;

    approveBuild(records, build);

    const { commands, log } = commandsOn([], undefined, records, [], undefined, undefined, undefined, {
        fetchBase: async () => {
            records.setBody(build, records.read(build).revision, 'brief', 'Different approved scope.');
            approveBuild(records, build);

            return 'release-tip';
        },
    });
    const result = await commands.startBuild(build, undefined);

    assert.equal(result.status, 409);
    assert.match((result.body as StartResult).error!, /approved brief changed/);
    assert.deepEqual(log, []);
    assert.deepEqual(records.launchIntents({}), []);
});

for (const purpose of ['build'] as ('shape' | 'build')[]) {
    test(`an unconfirmed ${purpose} launch is accepted as pending and never launches a second thread`, async () => {
        const records = await openRecords();
        const work = records.create({
            title: 'Work',
            repository: WEB,
            kind: 'feature',
            status: purpose === 'shape' ? 'Queued' : 'Ready',
        });

        if (purpose === 'build') approveBuild(records, work.workId);

        let launched = 0;
        const { commands, board } = recordedCommands(records, {
            during: () => {
                launched++;
            },
            startAnswer: () => ({
                thread: null,
                uncertain: true,
                error: 'T3 created the thread; its first turn is not running yet. The board will resume the same launch.',
            }),
            recover: async () => 'unknown',
        });
        const press = () =>
            purpose === 'shape' ? commands.start(work.workId, undefined) : commands.startBuild(work.workId, undefined);
        const first = await press();

        assert.equal(first.status, 202);
        assert.equal((first.body as StartResult).uncertain, true);
        assert.equal(board.snapshot().startProgress?.[work.workId]?.[purpose]?.phase, 'may-have-started');
        assert.equal((await press()).status, 202);
        await commands.reconcileStarts(board.snapshot().items);
        assert.equal(launched, 1);
        assert.equal(records.launchIntents({ workId: work.workId, unresolved: true }).length, 1);
    });
}

for (const kind of ['concept'] as ('concept' | 'feature')[]) {
    test(`automatically dispatches the ${kind} Outcome once and completes after evidence`, async () => {
        const records = await openRecords();
        const parent = records.create({ title: 'Composition', repository: WEB, kind, status: 'In progress' });
        const id = parent.workId;
        const revision = () => records.read(id).revision;

        if (kind === 'concept') records.setFogGone(id, revision(), true);

        records.addThread(id, revision(), 'group-owner', 'shape');

        const part = records.createPart({
            parentId: id,
            parentRevision: revision(),
            title: 'Part',
            repository: WEB,
            kind: 'build',
            body: 'Blocked by: none',
            blockerIds: [],
        });

        records.setPullRequest(part.workId, part.revision, `${WEB}#91`);
        records.setReleasePlan(id, revision(), { steps: [], outcomeCheck: 'Check merged composition.' });

        const send = vi.fn(async () => ({ outcome: 'accepted' as const, sequence: 1 }));
        const s = recordedCommands(records, { outcomeSend: send });

        await s.commands.reconcileStarts(s.board.snapshot().items);
        assert.equal(send.mock.calls.length, 0);
        records.observe(part.workId, records.read(part.workId).revision, { of: 'pr', state: 'merged' });
        s.reread();
        await s.commands.reconcileStarts(s.board.snapshot().items);
        assert.equal(send.mock.calls.length, 1);
        assert.match(JSON.stringify(send.mock.calls), /group-owner/);

        const restarted = recordedCommands(records, { outcomeSend: send });

        await restarted.commands.reconcileStarts(restarted.board.snapshot().items);
        assert.equal(send.mock.calls.length, 1);
        records.recordOutcomeCheck(
            id,
            revision(),
            'passed',
            'Outcome owner',
            'Exact merged composition passed.',
            records.outcomeCheck(id).digest,
        );
        finishCompleted(records, [WEB]);
        assert.equal(records.read(id).status, 'Done');
        assert.ok(records.read(id).finishedAt);
    });
}

test('an unrecorded List issue with an open PR consumes no board slot or manual claim', async () => {
    const records = await openRecords();
    const build = records.create({ title: 'S01 build', repository: WEB, kind: 'build', status: 'Ready' });

    approveBuild(records, build.workId);

    const external = queued(3, {
        status: 'List',
        statuses: [],
        recorded: false,
        linkedPrs: [
            {
                number: 4,
                url: 'https://example.test/pr/4',
                state: 'open',
                isDraft: false,
                checks: null,
                mergeState: 'can merge',
            },
        ],
    });
    const { commands, board } = commandsOn([], undefined, records, [external]);

    board.update({ buildLimit: { limit: 1, automatic: 1 } });
    assert.equal(buildsAtWork(board.snapshot()).length, 0);
    assert.equal((await commands.startBuild(build.workId, undefined)).status, 200);
    assert.deepEqual(records.launchIntents({ workId: build.workId })[0]?.buildInput?.capacity, {
        source: 'manual',
        limit: 1,
        occupied: 0,
        manualOverride: false,
    });
    assert.deepEqual(
        buildsAtWork(board.snapshot()).map((item) => item.id),
        [build.workId],
    );
});
