import { buildMessage, type Item } from '@lar-factory/shared';
import type { RawItem } from '@lar-factory/shared';
import { boardIssue, rawIssue, sliceRef } from '@lar-factory/shared/test/raw-items';
import { openWorkRecords, workRecordsPath } from '@lar-factory/work-records';
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { test } from 'vite-plus/test';
import type { TestContext } from 'vite-plus/test';

import { testEnv } from './repo-support.ts';
import {
    approveReadyBuilds,
    changeRecords,
    testFactoryContext,
    withRunPrompt,
    DEFAULT_SELECTION,
    startableEnv,
    startBoard,
    until,
} from './server-support.ts';
import type { Board } from './server-support.ts';

/** A Ready issue in lar-factory, with labels and, optionally, a parent. */
const readyIssue = (number: number, labels: string[], parent?: number): RawItem =>
    rawIssue(`I_${number}`, number, 'Ready', labels, parent ? { parent: sliceRef(parent, 'OPEN') } : {});

/** A board that can start lar-factory builds, and the home it runs in. */
async function buildBoard(t: TestContext, items: object[], options: object = {}, env: Record<string, string> = {}) {
    const startable = startableEnv(t);
    const board = await startBoard(
        t,
        { localSetups: { 'maddec01/lar-factory': { writeRefinedSpec: false } }, items, ...options },
        false,
        true,
        // These tests await local record/thread changes, not provider refresh timing.
        { ...startable, FAST_LOCAL_REFRESH_ONLY: '1', ...env },
    );

    await until(board, (d) => d.items.length === items.length);

    // The first ticket observation is a legitimate background write; let it land before seeding gated fixtures.
    const records = await openWorkRecords(workRecordsPath(board.dataDir));

    try {
        await until(
            board,
            (data) =>
                data.items.length === items.length &&
                data.items.every(
                    (item) =>
                        records.observations(item.id).some((observation) => observation.of === 'ticket') &&
                        item.revision === records.read(item.id).revision,
                ),
        );
    } finally {
        records.close();
    }

    await approveReadyBuilds(board);

    return { board, home: startable.HOME! };
}

const startBuild = (board: Board, itemId: string) => board.postSession({ itemId }, '/api/start-build');

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

    await changeRecords(
        board,
        (records) => {
            const work = records.read(board.id(12));
            const brief = records.setBody(work.workId, work.revision, 'brief', 'Build the approved destination.');

            records.recordGate(work.workId, brief.revision, {
                briefDigest: records.gate(work.workId).briefDigest!,
                approvedBy: 'Pedro',
                evidence: 'Doubt clean; approved.',
            });
            records.update(work.workId, records.read(work.workId).revision, { status: 'Ready' });
        },
        board.id(12),
        (item) => item.passingBrief === true,
    );

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

const LIVE_SHAPING = 'A shaping thread is still at work on this item. Wait for it to finish, then start the build.';
const SHAPING = 'shaping';
const turn = () => ({ id: 'turn', startedAt: '2026-11-01T08:00:00Z' });

/** A board with Ready #12 and its shaping thread recorded, T3 showing `threads`; waits for the first read. */
async function shapingBoard(t: TestContext, threads: object[]) {
    const env = startableEnv(t);

    writeFileSync(env.T3_STATE_DB + '.execution.json', JSON.stringify(threads));
    writeFileSync(env.T3_STATE_DB + '.requests.json', '[]');

    const { board } = await buildBoard(
        t,
        [readyIssue(12, ['build'])],
        { threads: { 'maddec01/lar-factory#12': [SHAPING] } },
        env,
    );

    await until(board, (d) => d.items[0]!.threads !== undefined);

    return board;
}

test('Start build is refused while a shaping thread is running, writing no record and launching nothing', async (t) => {
    const board = await shapingBoard(t, [{ id: SHAPING, turns: [turn()] }]);
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

test('a double press, a retry or another page starts no second build thread', async (t) => {
    const { board } = await buildBoard(t, [readyIssue(12, ['build'])], { t3: { delay: 100 } });
    const responses = await Promise.all([startBuild(board, board.id(12)), startBuild(board, board.id(12))]);

    assert.deepEqual(
        responses.map((r) => r.status),
        [200, 200],
    );

    const duplicate = await startBuild(board, board.id(12));

    assert.equal(duplicate.status, 409);
    assert.match((await duplicate.json()).error, /already owns.*build.*Open thread/);
    assert.equal((await board.t3Calls()).length, 1);
});
