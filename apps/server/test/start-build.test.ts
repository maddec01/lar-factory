import { buildMessage, type Item } from '@lar-factory/shared';
import type { BoardData, DriftChoice, RawItem, SkillCheckOutcome } from '@lar-factory/shared';
import { boardIssue, rawIssue, sliceRef } from '@lar-factory/shared/test/raw-items';
import { openWorkRecords, workRecordsPath, writeShapingThreadCleanup } from '@lar-factory/work-records';
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { renameSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { test } from 'vite-plus/test';
import type { TestContext } from 'vite-plus/test';

import { testEnv } from './repo-support.ts';
import {
    changeRecords,
    testFactoryContext,
    withRunPrompt,
    DEFAULT_SELECTION,
    recordBlockers,
    SAMPLE_MODELS,
    settleDecisions,
    startableEnv,
    startBoard,
    until,
} from './server-support.ts';
import type { Board } from './server-support.ts';

/** A Ready issue in lar-factory, with labels and, optionally, a parent. */
const readyIssue = (number: number, labels: string[], parent?: number): RawItem =>
    rawIssue(`I_${number}`, number, 'Ready', labels, parent ? { parent: sliceRef(parent, 'OPEN') } : {});

/** A board that can start lar-factory builds, and the home it runs in; `skillCheck` answers its skill checks as the board app. */
async function buildBoard(
    t: TestContext,
    items: object[],
    options: object = {},
    env: Record<string, string> = {},
    skillCheck?: (drift?: DriftChoice) => string | null | SkillCheckOutcome,
) {
    const startable = startableEnv(t);
    const board = await startBoard(
        t,
        { items, ...options },
        false,
        false,
        { ...startable, ...env },
        undefined,
        skillCheck,
    );

    await until(board, (d) => d.items.length === items.length);

    return { board, home: startable.HOME! };
}

const startBuild = (board: Board, itemId: string, model?: unknown, origin = board.url, drift?: unknown) =>
    board.postSession({ itemId, model, drift }, '/api/start-build', origin);

/** The commit on main in the repository fake-ssh.sh answers fetches from. */
const originTip = (home: string) =>
    execFileSync('git', ['-C', join(home, 'origin.git'), 'rev-parse', 'main'], {
        env: testEnv(),
        encoding: 'utf8',
    }).trim();

const message = (home: string, workId: string, dataDir?: string) =>
    withRunPrompt(
        dataDir ?? testFactoryContext(home).dataDir,
        workId,
        buildMessage({ id: workId, number: 12, title: 'Issue 12' } as Item, `${home}/.agents/skills/lar-build`, {
            ...testFactoryContext(home),
            ...(dataDir ? { dataDir } : {}),
        }),
    );

/** The issue edits Start build might make, which it never does: its work records hold the moves. */
const writes = async (board: Board) =>
    (await board.calls()).filter((args) => args[0] === 'issue' && args[1] === 'edit');

test("Start build moves its concept's work record to In progress, writes nothing to GitHub and starts the build thread in a new worktree", async (t) => {
    const { board, home } = await buildBoard(t, [
        readyIssue(12, ['build'], 40),
        boardIssue(40, 'Ready', undefined, ['concept']),
    ]);
    const response = await startBuild(board, board.id(12));

    assert.equal(response.status, 200);

    const answer = await response.json();

    assert.equal(answer.thread.threadId, 'thread-1');
    assert.equal(answer.board.startedBuilds[board.id(12)].threadId, 'thread-1');
    assert.equal(answer.board.items.find((i: { id: string }) => i.id === board.id(40)).status, 'In progress');

    const records = await openWorkRecords(workRecordsPath(board.dataDir));

    try {
        assert.equal(records.read(board.id(40)).status, 'In progress');
    } finally {
        records.close();
    }

    assert.deepEqual(await writes(board), []);
    assert.deepEqual(await board.t3Calls(), [
        [
            'launch',
            'project-factory',
            await message(home, board.id(12)),
            DEFAULT_SELECTION,
            { type: 'worktree', baseRef: originTip(home), branch: 'chore/12-issue-12' },
            'full-access',
        ],
    ]);
});

test('a fetch that fails refuses Start build, starts no thread and lets a retry start it', async (t) => {
    const { board, home } = await buildBoard(t, [readyIssue(12, ['build'])]);
    const origin = join(home, 'origin.git');

    renameSync(origin, `${origin}.away`);

    const refused = await startBuild(board, board.id(12));

    assert.equal(refused.status, 409);
    assert.equal(
        (await refused.json()).error,
        'Could not fetch main from origin. Check the network and your Git login, then start the build again.',
    );
    assert.deepEqual(await board.t3Calls(), []);
    renameSync(`${origin}.away`, origin);
    assert.equal((await startBuild(board, board.id(12))).status, 200);
    assert.equal(((await board.t3Calls())[0]![4] as unknown as { baseRef: string }).baseRef, originTip(home));
});

test('a refused skill check refuses Start build with its reason, writes nothing to GitHub and runs no t3', async (t) => {
    let refusal: string | null = "Lar Factory can't check the skill tdd: a folder it didn't install has its name.";
    const { board } = await buildBoard(
        t,
        [readyIssue(12, ['feature'], 40), boardIssue(40, 'Ready', undefined, ['concept'])],
        {},
        { BOARD_SKILL_CHECK: '1' },
        () => refusal,
    );
    const refused = await startBuild(board, board.id(12));

    assert.equal(refused.status, 409);
    assert.equal((await refused.json()).error, refusal);
    assert.deepEqual([...(await writes(board)), ...(await board.t3Calls())], []);
    refusal = null;
    assert.equal((await startBuild(board, board.id(12))).status, 200);
    assert.equal(board.skillChecks(), 2);
});

test('Drift asks for a choice before Start build writes anything, then starts on the choice the User sends', async (t) => {
    const choices: (DriftChoice | undefined)[] = [];
    const { board, home } = await buildBoard(
        t,
        [readyIssue(12, ['feature'], 40), boardIssue(40, 'Ready', undefined, ['concept'])],
        {},
        { BOARD_SKILL_CHECK: '1' },
        (drift) => {
            choices.push(drift);

            return drift
                ? null
                : { refusal: 'Some skills changed: lar-build. Replace them or start anyway.', drift: ['lar-build'] };
        },
    );
    const asked = await startBuild(board, board.id(12));

    assert.equal(asked.status, 409);

    const answer = await asked.json();

    assert.deepEqual(
        [answer.error, answer.drift, answer.thread],
        ['Some skills changed: lar-build. Replace them or start anyway.', ['lar-build'], null],
    );
    assert.deepEqual([...(await writes(board)), ...(await board.t3Calls())], []);
    assert.equal((await startBuild(board, board.id(12), undefined, board.url, 'keep')).status, 200);
    assert.deepEqual(choices, [undefined, 'keep']);
    assert.deepEqual(
        (await board.t3Calls()).map((args) => args[2]),
        [await message(home, board.id(12))],
    );
});

test('Start build runs the thread on the picked model choice', async (t) => {
    const { board, home } = await buildBoard(t, [readyIssue(12, ['bug', 'build'])], {}, SAMPLE_MODELS);
    const response = await startBuild(board, board.id(12), {
        instanceId: 'claudeAgent_personal',
        model: 'claude-opus-5-5',
    });

    assert.equal(response.status, 200);
    assert.deepEqual(await board.t3Calls(), [
        [
            'launch',
            'project-factory',
            await message(home, board.id(12)),
            { instanceId: 'claudeAgent_personal', model: 'claude-opus-5-5', options: [] },
            { type: 'worktree', baseRef: originTip(home), branch: 'fix/12-issue-12' },
            'full-access',
        ],
    ]);
    assert.match(
        (await (await startBuild(board, board.id(12), { instanceId: 'codex', model: '--help' })).json()).error,
        /isn't offered/,
    );
});

test('Start build is refused while a blocker is incomplete, naming it, and runs once it completes', async (t) => {
    const { board } = await buildBoard(t, [readyIssue(12, ['build'])]);
    const blockers = await recordBlockers(board, board.id(12), ['Decision 5']);
    const refused = await startBuild(board, board.id(12));

    assert.equal(refused.status, 409);
    assert.equal(
        (await refused.json()).error,
        'Blocked by Decision 5 until it completes; use Start after to start it then.',
    );
    assert.deepEqual([...(await writes(board)), ...(await board.t3Calls())], []);
    await settleDecisions(board, board.id(12), blockers);
    assert.equal((await startBuild(board, board.id(12))).status, 200);
});

const LIVE_SHAPING = 'A shaping thread is still at work on this item. Wait for it to finish, then start the build.';
const SHAPING = 'shaping';
const turn = (status?: string) => ({
    id: 'turn',
    startedAt: '2026-11-01T08:00:00Z',
    ...(status && { status, completedAt: '2026-11-01T08:01:00Z' }),
});
const idleShaping = { id: SHAPING, turns: [turn('completed')] };
const child = (status?: string) => ({ id: 'child', rootThreadId: SHAPING, turns: [turn(status)] });

/** A board with Ready #12 and its shaping thread recorded, T3 showing `threads` and `requests`, if any; waits for the first read. */
async function shapingBoard(t: TestContext, threads?: object[], requests: object[] = []) {
    const env = startableEnv(t);

    if (threads) {
        writeFileSync(env.T3_STATE_DB + '.execution.json', JSON.stringify(threads));
        writeFileSync(env.T3_STATE_DB + '.requests.json', JSON.stringify(requests));
    }

    const { board } = await buildBoard(
        t,
        [readyIssue(12, ['build'])],
        { threads: { 'maddec01/lar-factory#12': [SHAPING] } },
        env,
    );

    await until(board, (d) => d.items[0]!.threads !== undefined);

    return board;
}

for (const [name, threads, requests] of [
    ['is running', [{ id: SHAPING, turns: [turn()] }]],
    ['is waiting', [{ id: SHAPING, turns: [turn('waiting')] }]],
    ['needs the user', [{ id: SHAPING, turns: [turn()] }], [{ turnId: 'turn', createdAt: '2026-11-01T08:01:00Z' }]],
    ['is queued', [{ id: SHAPING, turns: [turn('queued')] }]],
    ['has a running child', [idleShaping, child()]],
    ['has a queued child', [idleShaping, child('queued')]],
] as [string, object[], object[]?][]) {
    test(`Start build is refused while a shaping thread ${name}, writing no record and launching nothing`, async (t) => {
        const board = await shapingBoard(t, threads, requests);
        const records = await openWorkRecords(workRecordsPath(board.dataDir));
        const before = await (async () => {
            try {
                // The first ticket observation is a legitimate background write. Wait for it before measuring
                // the refused command, keeping revision and updatedAt in the full-record equality below.
                await until(
                    board,
                    (data) =>
                        records.observations(board.id(12)).some((observation) => observation.of === 'ticket') &&
                        data.items[0]?.revision === records.read(board.id(12)).revision,
                );

                return records.read(board.id(12));
            } finally {
                records.close();
            }
        })();
        const refused = await startBuild(board, board.id(12));

        assert.equal(refused.status, 409);
        assert.equal((await refused.json()).error, LIVE_SHAPING);

        const again = await openWorkRecords(workRecordsPath(board.dataDir));

        try {
            assert.deepEqual(again.read(board.id(12)), before);
        } finally {
            again.close();
        }

        assert.deepEqual(await board.t3Calls(), []);
    });
}

for (const [name, threads] of [
    ['idle', [idleShaping]],
    ['stopped', [{ id: SHAPING, turns: [turn('interrupted')] }]],
    ['unreadable, T3 being down', undefined],
    ['last seen running, T3 being down', [{ id: SHAPING, turns: [turn()], retainedAt: '2026-11-01T08:02:00Z' }]],
] as [string, object[] | undefined][]) {
    test(`Start build runs while the shaping thread is ${name}`, async (t) => {
        const board = await shapingBoard(t, threads);

        assert.equal((await startBuild(board, board.id(12))).status, 200);
    });
}

test('once Delete records a shaping thread as deleted, a fresh stats read replaces the retained figures with no restart', async (t) => {
    const minutes = (id: string, count: number) => ({
        id,
        turns: [
            {
                id: `${id}-turn`,
                startedAt: '2026-11-01T08:00:00Z',
                completedAt: new Date(Date.parse('2026-11-01T08:00:00Z') + count * 60_000).toISOString(),
                status: 'completed',
            },
        ],
    });
    const env = startableEnv(t);

    writeFileSync(env.T3_STATE_DB + '.execution.json', JSON.stringify([minutes(SHAPING, 60)]));
    writeFileSync(env.T3_STATE_DB + '.requests.json', '[]');

    const { board } = await buildBoard(
        t,
        [readyIssue(12, ['build'])],
        { threads: { 'maddec01/lar-factory#12': [SHAPING] }, t3: { deletedThreads: [SHAPING] } },
        { ...env, FAKE_THREAD_CLEANUP: '1' },
    );
    const agentMs = (data: BoardData) => {
        const { stats } = data.items[0]!;

        return typeof stats === 'object' ? stats.agentMs : undefined;
    };

    await until(board, (d) => agentMs(d) === 60 * 60_000);
    writeShapingThreadCleanup('delete', board.dataDir);
    assert.equal((await startBuild(board, board.id(12))).status, 200);
    await until(board, (d) => agentMs(d) === 60 * 60_000);
    writeFileSync(env.T3_STATE_DB + '.execution.json', JSON.stringify([minutes('thread-1', 10)]));

    const data = await until(board, (d) => agentMs(d) === 10 * 60_000);
    const [item] = data.items;

    assert.deepEqual(
        (item!.threads as { id: string }[]).map((thread) => thread.id),
        ['thread-1'],
        'details has no link for the deleted thread and keeps the build thread',
    );
    assert.equal(item!.needsYou, undefined, 'no Start again notice');
    assert.deepEqual(data.startCheckFailures ?? {}, {});

    const records = await openWorkRecords(workRecordsPath(board.dataDir));

    try {
        assert.ok(records.threads(board.id(12)).find((thread) => thread.threadId === SHAPING)?.deletedAt);
        assert.deepEqual(records.pendingShapingThreadCleanups(), []);
    } finally {
        records.close();
    }
});

const cleanupProblem = (data: BoardData) => data.items[0]?.shapingCleanupProblem;

/** Starts #12's build and returns its status then, which a cleanup problem never changes. */
async function startedStatus(board: Board): Promise<string> {
    const response = await startBuild(board, board.id(12));

    assert.equal(response.status, 200);

    return ((await response.json()) as { board: BoardData }).board.items[0]!.status;
}

test('a corrupt cleanup setting at Start build starts the build and shows a problem until a sweep applies the fixed setting', async (t) => {
    const board = await shapingBoard(t, [idleShaping]);

    writeFileSync(join(board.dataDir, 'shaping-thread-cleanup.json'), '{');

    const status = await startedStatus(board);
    const shown = await until(board, (d) => cleanupProblem(d) !== undefined);

    assert.equal(
        cleanupProblem(shown),
        "The board couldn't clean up the shaping threads. It can't read the shaping thread cleanup setting. It keeps trying.",
    );
    assert.equal(shown.items[0]!.status, status);
    assert.equal(shown.items[0]!.needsYou, undefined);
    writeShapingThreadCleanup('keep', board.dataDir);
    await until(board, (d) => cleanupProblem(d) === undefined);

    const records = await openWorkRecords(workRecordsPath(board.dataDir));

    try {
        assert.deepEqual(records.pendingShapingThreadCleanups(), []);
    } finally {
        records.close();
    }
});

test('a saved cleanup failure leaves the build running, shows a problem and clears once the thread is cleaned', async (t) => {
    const board = await shapingBoard(t, [idleShaping]);
    const status = await startedStatus(board);
    const item = board.id(12);
    const data = await changeRecords(
        board,
        (records) => records.saveShapingThreadFailure(SHAPING, 'T3 refused it.'),
        item,
        (shown) => shown.shapingCleanupProblem !== undefined,
    );

    assert.equal(
        cleanupProblem(data),
        "The board couldn't clean up the shaping threads. T3 refused it. It keeps trying.",
    );
    assert.equal(data.items[0]!.status, status);
    assert.equal(data.items[0]!.needsYou, undefined);
    await changeRecords(
        board,
        (records) => records.markShapingThreadCleaned(SHAPING),
        item,
        (shown) => shown.shapingCleanupProblem === undefined,
    );
});

test('a double press, a retry or another page starts no second build thread', async (t) => {
    const { board } = await buildBoard(t, [readyIssue(12, ['build'])], { t3: { delay: 100 } });
    const responses = await Promise.all([startBuild(board, board.id(12)), startBuild(board, board.id(12))]);

    assert.deepEqual(
        responses.map((r) => r.status),
        [200, 200],
    );
    assert.equal((await startBuild(board, board.id(12))).status, 200);
    assert.equal((await board.t3Calls()).length, 1);
});

for (const fail of ['killed', 'garbage']) {
    test(`an unconfirmed build start (${fail}) is never retried as a new thread`, async (t) => {
        const { board } = await buildBoard(t, [readyIssue(12, ['build'])], { t3: { fail } });

        assert.equal((await (await startBuild(board, board.id(12))).json()).uncertain, true);
        assert.equal((await (await startBuild(board, board.id(12))).json()).uncertain, true);
        assert.equal((await board.t3Calls()).filter((args) => args[0] === 'launch').length, 1);
    });
}

test('Start build only runs for Ready issues from this board page and session', async (t) => {
    const { board } = await buildBoard(t, [boardIssue(12, 'Queued')]);

    assert.match(
        (await (await startBuild(board, board.id(12))).json()).error,
        /^Only Ready items can start a build; this one is in Queued\.$/,
    );
    assert.equal((await startBuild(board, 'I_missing')).status, 404);

    const restarted = await board.post({ session: 'old', itemId: board.id(12) }, board.url, '/api/start-build');

    assert.equal(restarted.status, 409);
    assert.match((await restarted.json()).error, /Press Start build again/);
    assert.equal((await startBuild(board, board.id(12), undefined, 'https://evil.example')).status, 403);

    const sample = await startBoard(t, {}, true);

    assert.equal((await startBuild(sample, 'I_sample05')).status, 403);
    assert.deepEqual([...(await writes(board)), ...(await board.t3Calls()), ...(await sample.t3Calls())], []);
});

test('recovery endpoints validate item and options before starting a thread', async (t) => {
    const { board } = await buildBoard(t, [readyIssue(12, ['build'])]);

    assert.equal((await board.postSession({}, '/api/inspect-recovery')).status, 400);
    assert.equal(
        (await board.postSession({ itemId: board.id(12), options: { branchChoice: 'erase' } }, '/api/start-again'))
            .status,
        422,
    );
    assert.equal((await board.postSession({ itemId: board.id(12) }, '/api/inspect-recovery')).status, 409);
});
