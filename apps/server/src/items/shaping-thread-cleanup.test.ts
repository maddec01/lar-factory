import type { ShapingThreadCleanup } from '@lar-factory/shared';
import { openWorkRecords, type WorkRecords } from '@lar-factory/work-records';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, test } from 'vite-plus/test';

import type { ThreadCleanupState } from '../t3/item-execution.ts';
import type { ThreadCommand, ThreadCommandResult } from '../t3/thread-commands.ts';
import {
    createShapingThreadCleanup,
    createShapingThreadSweep,
    shapingThreadCleanupProblems,
} from './shaping-thread-cleanup.ts';

const dirs: string[] = [];
const opened: WorkRecords[] = [];
afterEach(() => {
    for (const records of opened.splice(0)) records.close();
    for (const dir of dirs.splice(0)) rmSync(dir, { recursive: true, force: true });
});

async function setUp() {
    const dir = mkdtempSync(join(tmpdir(), 'shaping-thread-cleanup-'));
    dirs.push(dir);
    const records = await openWorkRecords(join(dir, 'work-records.db'));
    opened.push(records);
    let changes = 0;
    const cleanup = createShapingThreadCleanup({
        records,
        dir,
        changed: () => {
            changes += 1;
        },
    });
    return { dir, cleanup, changes: () => changes };
}

test('a saved choice shows in the state and reaches the board', async () => {
    const { cleanup, changes } = await setUp();
    assert.deepEqual(cleanup.state(), { choice: 'settle' });
    assert.deepEqual(cleanup.save({ choice: 'delete' }), { status: 200, body: { error: null } });
    assert.deepEqual(cleanup.state(), { choice: 'delete' });
    assert.equal(changes(), 1);
});

test('an invalid choice is refused with a 400 and changes nothing', async () => {
    const { cleanup, changes } = await setUp();
    cleanup.save({ choice: 'settle' });
    for (const choice of ['shred', 7, null, undefined])
        assert.equal(cleanup.save({ choice }).status, 400, String(choice));
    assert.deepEqual(cleanup.state(), { choice: 'settle' });
    assert.equal(changes(), 1);
});

test('an unreadable setting shows why, and a valid choice replaces the file', async () => {
    const { dir, cleanup } = await setUp();
    writeFileSync(join(dir, 'shaping-thread-cleanup.json'), '{');
    const state = cleanup.state();
    assert.ok('problem' in state && state.problem.includes("isn't JSON"));
    assert.equal(cleanup.save({ choice: 'keep' }).status, 200);
    assert.deepEqual(cleanup.state(), { choice: 'keep' });
});

test('a board with no work records refuses the choice', () => {
    const cleanup = createShapingThreadCleanup({ records: null, dir: 'unused' });
    assert.equal(cleanup.save({ choice: 'keep' }).status, 409);
});

const IDLE = { archived: false, settled: false, live: false };

/** Records with shaping threads `shaped` whose Start build saved `choice`, and a sweep over stubs: nothing reaches T3. */
async function sweepOver(choice: ShapingThreadCleanup | 'unreadable' = 'archive', shaped = ['shape-1']) {
    const { dir, cleanup } = await setUp();
    if (choice === 'unreadable') writeFileSync(join(dir, 'shaping-thread-cleanup.json'), 'not json');
    const path = join(dir, 'sweep.db');
    let records = await openWorkRecords(path);
    opened.push(records);
    const work = records.create({ title: 'Build', repository: 'a/b', kind: 'build' });
    for (const thread of shaped) records.addThread(work.workId, records.read(work.workId).revision, thread, 'shape');
    const { intent } = records.recordLaunchIntent(
        work.workId,
        records.read(work.workId).revision,
        'build',
        undefined,
        choice,
    );
    records.resolveLaunchIntent(work.workId, records.read(work.workId).revision, intent.intentId, {
        threadId: 'build-1',
    });
    const stub = {
        state: IDLE as ThreadCleanupState,
        lookup: 'unknown' as 'live' | 'deleted' | 'unknown',
        result: { outcome: 'accepted', sequence: 1 } as ThreadCommandResult,
        lookups: 0,
        reads: 0,
        now: 0,
        sent: [] as ThreadCommand[],
        deleted: [] as string[],
    };
    const sweepOn = (on: WorkRecords) =>
        createShapingThreadSweep({
            records: on,
            dir,
            now: () => stub.now,
            deleted: (workId) => stub.deleted.push(workId),
            stateOf: () => {
                stub.reads += 1;
                return stub.state;
            },
            lookup: async () => {
                stub.lookups += 1;
                return stub.lookup;
            },
            send: async (command) => {
                stub.sent.push(command);
                return stub.result;
            },
        });
    return {
        cleanup,
        stub,
        workId: work.workId,
        records: () => records,
        sweep: sweepOn(records),
        reopen: async () => {
            opened.splice(opened.indexOf(records), 1);
            records.close();
            records = await openWorkRecords(path);
            opened.push(records);
            return sweepOn(records);
        },
    };
}

test('archives each shaping thread once, with the recorded thread ID and its stable command ID', async () => {
    const { stub, records, sweep } = await sweepOver('archive', ['shape-1', 'shape-2']);
    const commandIds = records()
        .pendingShapingThreadCleanups()
        .map((row) => row.commandId);
    await sweep();
    assert.deepEqual(stub.sent, [
        { type: 'thread.archive', commandId: commandIds[0], threadId: 'shape-1' },
        { type: 'thread.archive', commandId: commandIds[1], threadId: 'shape-2' },
    ]);
    assert.deepEqual(records().pendingShapingThreadCleanups(), []);
    await sweep();
    assert.equal(stub.sent.length, 2);
});

test('Keep sends nothing and reads nothing', async () => {
    const { stub, sweep } = await sweepOver('keep');
    await sweep();
    assert.deepEqual([stub.sent, stub.reads], [[], 0]);
});

test('settles each thread once, with the recorded thread ID and its stable command ID', async () => {
    const { stub, records, sweep } = await sweepOver('settle', ['mcp:shape-1', 'shape-2']);
    const commandIds = records()
        .pendingShapingThreadCleanups()
        .map((row) => row.commandId);
    await sweep();
    assert.deepEqual(stub.sent, [
        { type: 'thread.settle', commandId: commandIds[0], threadId: 'mcp:shape-1' },
        { type: 'thread.settle', commandId: commandIds[1], threadId: 'shape-2' },
    ]);
    assert.deepEqual(records().pendingShapingThreadCleanups(), []);
    await sweep();
    assert.equal(stub.sent.length, 2);
});

test('Settle sends nothing for an archived or already settled thread, and each counts as cleaned', async () => {
    for (const state of [
        { ...IDLE, archived: true },
        { ...IDLE, settled: true },
        { ...IDLE, archived: true, settled: true },
    ]) {
        const { stub, records, sweep } = await sweepOver('settle');
        records().saveShapingThreadFailure('shape-1', 'Earlier failure.');
        stub.state = state;
        await sweep();
        assert.deepEqual(stub.sent, []);
        assert.deepEqual(records().pendingShapingThreadCleanups(), []);
    }
});

test('Settle and Archive count a confirmed deletion as cleaned with no command and leave its record to the start check', async () => {
    for (const choice of ['settle', 'archive'] as const) {
        const { stub, records, sweep, workId } = await sweepOver(choice);
        stub.state = 'absent';
        stub.lookup = 'deleted';
        await sweep();
        assert.deepEqual([stub.sent, stub.deleted], [[], []]);
        assert.deepEqual(records().pendingShapingThreadCleanups(), []);
        assert.equal(records().threads(workId)[0]?.deletedAt, null);
    }
});

const deletedAt = (records: WorkRecords, workId: string, threadId = 'shape-1') =>
    records.threads(workId).find((thread) => thread.threadId === threadId)?.deletedAt;

test('Delete sends one command for an archived or settled thread too, then records the deletion with no revision bump', async () => {
    for (const state of [IDLE, { ...IDLE, archived: true }, { ...IDLE, settled: true }]) {
        const { stub, records, sweep, workId } = await sweepOver('delete');
        const [{ commandId } = { commandId: '' }] = records().pendingShapingThreadCleanups();
        const revision = records().read(workId).revision;
        stub.state = state;
        await sweep();
        assert.deepEqual(stub.sent, [{ type: 'thread.delete', commandId, threadId: 'shape-1' }]);
        assert.deepEqual(records().pendingShapingThreadCleanups(), []);
        assert.ok(deletedAt(records(), workId));
        assert.equal(records().read(workId).revision, revision);
        assert.deepEqual(stub.deleted, [workId]);
        await sweep();
        assert.equal(stub.sent.length, 1);
    }
});

test('a Delete whose answer was lost finishes with the same writes once the lookup confirms it, and sends the same command ID before that', async () => {
    const { stub, records, sweep, workId } = await sweepOver('delete');
    const [{ commandId } = { commandId: '' }] = records().pendingShapingThreadCleanups();
    stub.result = { outcome: 'unconfirmed', reason: 'No answer.' };
    await sweep();
    assert.equal(records().pendingShapingThreadCleanups()[0]?.failure, 'No answer.');
    assert.equal(deletedAt(records(), workId), null);
    assert.deepEqual(stub.deleted, []);
    stub.now = 30_000;
    await sweep();
    assert.deepEqual(
        stub.sent.map((command) => command.commandId),
        [commandId, commandId],
    );
    stub.now = 60_000;
    stub.state = 'absent';
    stub.lookup = 'deleted';
    await sweep();
    assert.equal(stub.sent.length, 2);
    assert.deepEqual(records().pendingShapingThreadCleanups(), []);
    assert.ok(deletedAt(records(), workId));
    assert.deepEqual(stub.deleted, [workId]);
});

test('a rejected Delete leaves the thread on the record', async () => {
    const { stub, records, sweep, workId } = await sweepOver('delete');
    stub.result = { outcome: 'rejected', reason: 'T3 refused it.' };
    await sweep();
    assert.equal(deletedAt(records(), workId), null);
    assert.deepEqual(stub.deleted, []);
    assert.equal(records().pendingShapingThreadCleanups()[0]?.failure, 'T3 refused it.');
});

test('Settle and Delete send nothing to a live thread, archived or not, until it is idle', async () => {
    for (const choice of ['settle', 'delete'] as const) {
        for (const live of [
            { ...IDLE, live: true },
            { ...IDLE, archived: true, live: true },
            { ...IDLE, settled: true, live: true },
        ]) {
            const { stub, records, sweep } = await sweepOver(choice);
            stub.state = live;
            await sweep();
            assert.deepEqual(stub.sent, []);
            assert.equal(records().pendingShapingThreadCleanups()[0]?.failure, null);
        }
        const { stub, sweep } = await sweepOver(choice);
        stub.state = { ...IDLE, live: true };
        await sweep();
        stub.state = IDLE;
        await sweep();
        assert.deepEqual(
            stub.sent.map((command) => command.type),
            [`thread.${choice}`],
        );
    }
});

test('a replacement build leaves cleaned threads alone', async () => {
    for (const choice of ['settle', 'delete'] as const) {
        const { stub, records, sweep, workId } = await sweepOver(choice);
        await sweep();
        const { intent } = records().recordLaunchIntent(
            workId,
            records().read(workId).revision,
            'build',
            undefined,
            choice,
        );
        records().resolveLaunchIntent(workId, records().read(workId).revision, intent.intentId, {
            threadId: 'build-2',
        });
        await sweep();
        assert.equal(stub.sent.length, 1);
        assert.deepEqual(records().pendingShapingThreadCleanups(), []);
    }
});

test('an unreadable setting sends nothing and reads no thread until a sweep can read it', async () => {
    const { stub, records, sweep } = await sweepOver('unreadable');
    await sweep();
    assert.deepEqual([stub.sent, stub.reads], [[], 0]);
    assert.equal(records().pendingShapingThreadCleanups().length, 1);
});

test('the first value a sweep reads becomes the saved action and is applied, and a later Settings change leaves it', async () => {
    const { cleanup, stub, records, sweep } = await sweepOver('unreadable');
    await sweep();
    stub.state = { ...IDLE, live: true };
    assert.equal(cleanup.save({ choice: 'archive' }).status, 200);
    await sweep();
    assert.equal(records().pendingShapingThreadCleanups()[0]?.action, 'archive');
    assert.equal(cleanup.save({ choice: 'delete' }).status, 200);
    stub.state = IDLE;
    await sweep();
    assert.deepEqual(
        stub.sent.map((command) => command.type),
        ['thread.archive'],
    );
    assert.deepEqual(records().pendingShapingThreadCleanups(), []);
});

test('Keep read after an unreadable setting sends nothing and cleans the row', async () => {
    const { cleanup, stub, records, sweep } = await sweepOver('unreadable');
    await sweep();
    assert.equal(cleanup.save({ choice: 'keep' }).status, 200);
    await sweep();
    assert.deepEqual([stub.sent, stub.reads], [[], 0]);
    assert.deepEqual(records().pendingShapingThreadCleanups(), []);
});

test('a later change to the setting leaves a pending row with its saved action', async () => {
    const { cleanup, stub, records, sweep } = await sweepOver('archive');
    assert.equal(cleanup.save({ choice: 'keep' }).status, 200);
    assert.equal(records().pendingShapingThreadCleanups()[0]?.action, 'archive');
    await sweep();
    assert.equal(stub.sent[0]?.type, 'thread.archive');
});

test('T3 being unreadable saves no failure and tries again on the next pass', async () => {
    const { stub, records, sweep } = await sweepOver();
    stub.state = 'unavailable';
    await sweep();
    assert.deepEqual(stub.sent, []);
    assert.equal(records().pendingShapingThreadCleanups()[0]?.failure, null);
    stub.state = IDLE;
    await sweep();
    assert.equal(stub.sent.length, 1);
});

test('a live thread gets no command and no failure, and is archived on a later pass once idle', async () => {
    const { stub, records, sweep } = await sweepOver();
    stub.state = { ...IDLE, live: true };
    await sweep();
    assert.deepEqual(stub.sent, []);
    assert.equal(records().pendingShapingThreadCleanups()[0]?.failure, null);
    stub.state = IDLE;
    await sweep();
    assert.equal(stub.sent.length, 1);
    assert.deepEqual(records().pendingShapingThreadCleanups(), []);
});

test('a thread still live counts as live even once archived', async () => {
    const { stub, records, sweep } = await sweepOver();
    stub.state = { ...IDLE, archived: true, live: true };
    await sweep();
    assert.equal(records().pendingShapingThreadCleanups().length, 1);
});

test('an archived thread counts as cleaned with no command, and clears an earlier failure', async () => {
    const { stub, records, sweep } = await sweepOver();
    records().saveShapingThreadFailure('shape-1', 'Earlier failure.');
    stub.state = { ...IDLE, archived: true };
    await sweep();
    assert.deepEqual(stub.sent, []);
    assert.deepEqual(records().pendingShapingThreadCleanups(), []);
});

test('only a confirmed deletion cleans an absent thread, and an unconfirmed answer waits 30 seconds', async () => {
    const { stub, records, sweep } = await sweepOver();
    stub.state = 'absent';
    await sweep();
    assert.equal(stub.lookups, 1);
    assert.equal(records().pendingShapingThreadCleanups().length, 1);
    stub.now = 29_999;
    await sweep();
    assert.equal(stub.lookups, 1);
    stub.now = 30_000;
    stub.lookup = 'deleted';
    await sweep();
    assert.equal(stub.lookups, 2);
    assert.deepEqual(stub.sent, []);
    assert.deepEqual(records().pendingShapingThreadCleanups(), []);
});

test('a thread absent while the CLI still shows it stays pending with no command', async () => {
    const { stub, records, sweep } = await sweepOver();
    stub.state = 'absent';
    stub.lookup = 'live';
    await sweep();
    assert.deepEqual(stub.sent, []);
    assert.equal(records().pendingShapingThreadCleanups()[0]?.failure, null);
});

test('an unconfirmed command keeps its failure, retries after 30 seconds with the same command ID, and survives a restart', async () => {
    const { stub, records, sweep, reopen } = await sweepOver();
    const [{ commandId } = { commandId: '' }] = records().pendingShapingThreadCleanups();
    stub.result = { outcome: 'unconfirmed', reason: 'No answer.' };
    await sweep();
    assert.equal(records().pendingShapingThreadCleanups()[0]?.failure, 'No answer.');
    stub.now += 29_999;
    await sweep();
    assert.equal(stub.sent.length, 1, 'no retry before 30 seconds');
    stub.now += 1;
    await sweep();
    stub.result = { outcome: 'accepted', sequence: 2 };
    const restarted = await reopen();
    assert.equal(records().pendingShapingThreadCleanups()[0]?.failure, 'No answer.');
    await restarted();
    assert.deepEqual(
        stub.sent.map((command) => command.commandId),
        [commandId, commandId, commandId],
    );
    assert.deepEqual(records().pendingShapingThreadCleanups(), []);
});

test('a rejected command retries with a new command ID, since T3 answers a rejected ID with the same rejection', async () => {
    const { stub, records, sweep, reopen } = await sweepOver();
    const [{ commandId: first } = { commandId: '' }] = records().pendingShapingThreadCleanups();
    stub.result = { outcome: 'rejected', reason: 'T3 refused it.' };
    await sweep();
    assert.equal(records().pendingShapingThreadCleanups()[0]?.failure, 'T3 refused it.');
    const [{ commandId: second } = { commandId: '' }] = records().pendingShapingThreadCleanups();
    assert.notEqual(second, first);
    stub.now += 30_000;
    stub.result = { outcome: 'unconfirmed', reason: 'No answer.' };
    await sweep();
    stub.result = { outcome: 'accepted', sequence: 2 };
    stub.now += 30_000;
    await (
        await reopen()
    )();
    assert.deepEqual(
        stub.sent.map((command) => command.commandId),
        [first, second, second],
    );
    assert.deepEqual(records().pendingShapingThreadCleanups(), []);
});

test('a thread T3 keeps rejecting waits twice as long each time, up to an hour, keeping its notice', async () => {
    const { stub, records, sweep, workId } = await sweepOver();
    stub.result = { outcome: 'rejected', reason: 'T3 refused it.' };
    await sweep();
    for (const wait of [30_000, 60_000, 120_000, 240_000, 480_000, 960_000, 1_920_000, 3_600_000, 3_600_000]) {
        const sent = stub.sent.length;
        stub.now += wait - 1;
        await sweep();
        assert.equal(stub.sent.length, sent, `no retry before ${wait} ms`);
        stub.now += 1;
        await sweep();
        assert.equal(stub.sent.length, sent + 1, `a retry after ${wait} ms`);
        assert.deepEqual(
            [...shapingThreadCleanupProblems(records())].map(([id]) => id),
            [workId],
        );
    }
    assert.equal(new Set(stub.sent.map((command) => command.commandId)).size, stub.sent.length);
    stub.result = { outcome: 'accepted', sequence: 1 };
    stub.now += 3_600_000;
    await sweep();
    assert.deepEqual(records().pendingShapingThreadCleanups(), []);
    assert.deepEqual([...shapingThreadCleanupProblems(records())], []);
});

test('an unconfirmed retry between rejections waits a flat 30 seconds with its stable ID, and the next rejection keeps doubling', async () => {
    const { stub, sweep } = await sweepOver();
    stub.result = { outcome: 'rejected', reason: 'T3 refused it.' };
    await sweep();
    stub.now += 30_000;
    await sweep();
    stub.result = { outcome: 'unconfirmed', reason: 'No answer.' };
    stub.now += 60_000;
    await sweep();
    const unconfirmed = stub.sent.at(-1)?.commandId;
    stub.now += 30_000;
    await sweep();
    assert.equal(stub.sent.length, 4, 'an unconfirmed answer waits 30 seconds');
    assert.equal(stub.sent.at(-1)?.commandId, unconfirmed);
    stub.result = { outcome: 'rejected', reason: 'T3 refused it.' };
    stub.now += 30_000;
    await sweep();
    stub.now += 119_999;
    await sweep();
    assert.equal(stub.sent.length, 5, 'no retry before the doubled wait');
    stub.now += 1;
    await sweep();
    assert.equal(stub.sent.length, 6);
});

test('a send that throws is saved as a failure like any other', async () => {
    const { stub, records } = await sweepOver();
    const sweep = createShapingThreadSweep({
        records: records(),
        stateOf: () => IDLE,
        lookup: async () => 'unknown',
        now: () => stub.now,
        deleted: () => {},
        send: async () => {
            throw new Error('Socket closed.');
        },
    });
    await sweep();
    assert.equal(records().pendingShapingThreadCleanups()[0]?.failure, 'Socket closed.');
});

test('allows one sweep at a time', async () => {
    const { stub, records } = await sweepOver();
    let answer = (_: ThreadCommandResult) => {};
    const sends: ThreadCommand[] = [];
    const sweep = createShapingThreadSweep({
        records: records(),
        stateOf: () => IDLE,
        lookup: async () => 'unknown',
        now: () => stub.now,
        deleted: () => {},
        send: (command) => {
            sends.push(command);
            return new Promise((resolve) => {
                answer = resolve;
            });
        },
    });
    const first = sweep();
    await sweep();
    assert.equal(sends.length, 1);
    answer({ outcome: 'accepted', sequence: 1 });
    await first;
    await sweep();
    assert.equal(sends.length, 1);
});

test('a set-aside record still retries, and deleting a record stops its retries', async () => {
    const { stub, records, sweep, workId } = await sweepOver();
    records().setAside(workId, records().read(workId).revision);
    stub.result = { outcome: 'rejected', reason: 'Refused.' };
    await sweep();
    assert.equal(stub.sent.length, 1);
    const revision = records().read(workId).revision;
    stub.now = 30_000;
    await sweep();
    assert.equal(stub.sent.length, 2);
    assert.equal(records().read(workId).revision, revision, 'a background retry never bumps the revision');
    records().deleteExpired({ hideAfterDays: 0, deleteAfterDays: 0 }, new Date(Date.now() + 86_400_000));
    stub.now = 90_000;
    await sweep();
    assert.equal(stub.sent.length, 2);
});

const FAILED = "The board couldn't clean up the shaping threads. T3 refused it. It keeps trying.";

test('a failed command shows a problem that survives a restart and clears once a retry succeeds', async () => {
    const { stub, records, sweep, reopen, workId } = await sweepOver();
    assert.deepEqual([...shapingThreadCleanupProblems(records())], []);
    stub.result = { outcome: 'rejected', reason: 'T3 refused it.' };
    await sweep();
    assert.deepEqual([...shapingThreadCleanupProblems(records())], [[workId, FAILED]]);
    const restarted = await reopen();
    assert.deepEqual([...shapingThreadCleanupProblems(records())], [[workId, FAILED]]);
    stub.result = { outcome: 'accepted', sequence: 1 };
    await restarted();
    assert.deepEqual([...shapingThreadCleanupProblems(records())], []);
});

test('a reason with no full stop still reads as a sentence, and threads with one reason show it once', async () => {
    const { stub, records, sweep, workId } = await sweepOver('archive', ['shape-1', 'shape-2']);
    stub.result = { outcome: 'rejected', reason: 'T3 refused it' };
    await sweep();
    assert.deepEqual([...shapingThreadCleanupProblems(records())], [[workId, FAILED]]);
});

test('a thread held back or gone shows no problem, and a failure saved earlier stays while a thread is held back', async () => {
    for (const state of [{ ...IDLE, live: true }, 'unavailable', 'absent'] as const) {
        const { stub, records, sweep, workId } = await sweepOver();
        stub.state = state;
        await sweep();
        assert.deepEqual([...shapingThreadCleanupProblems(records())], []);
        if (state === 'absent') {
            stub.lookup = 'deleted';
            stub.now = 30_000;
            await sweep();
            assert.deepEqual(records().pendingShapingThreadCleanups(), []);
            continue;
        }
        records().saveShapingThreadFailure('shape-1', 'T3 refused it.');
        await sweep();
        assert.deepEqual([...shapingThreadCleanupProblems(records())], [[workId, FAILED]]);
    }
});

test('an unreadable setting shows a problem naming it until a sweep can apply the setting, and Keep shows none', async () => {
    const { cleanup, records, sweep, workId } = await sweepOver('unreadable');
    await sweep();
    assert.deepEqual(
        [...shapingThreadCleanupProblems(records())],
        [
            [
                workId,
                "The board couldn't clean up the shaping threads. It can't read the shaping thread cleanup setting. It keeps trying.",
            ],
        ],
    );
    assert.equal(cleanup.save({ choice: 'archive' }).status, 200);
    await sweep();
    assert.deepEqual([...shapingThreadCleanupProblems(records())], []);
    const kept = await sweepOver('keep');
    assert.deepEqual([...shapingThreadCleanupProblems(kept.records())], []);
});
