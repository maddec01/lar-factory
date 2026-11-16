import type { ShapingThreadCleanup } from '@lar-factory/shared';
import { openWorkRecords, type WorkRecords } from '@lar-factory/work-records';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync } from 'node:fs';
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

const IDLE = { archived: false, settled: false, live: false };

/** Records with shaping threads `shaped` whose Start build saved `choice`, and a sweep over stubs: nothing reaches T3. */
async function sweepOver(choice: ShapingThreadCleanup = 'archive', shaped = ['shape-1']) {
    const { dir, cleanup } = await setUp();

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
            stateOf: () => stub.state,
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

test('a later change to the setting leaves a pending row with its saved action', async () => {
    const { cleanup, stub, records, sweep } = await sweepOver('archive');

    assert.equal(cleanup.save({ choice: 'keep' }).status, 200);
    assert.equal(records().pendingShapingThreadCleanups()[0]?.action, 'archive');
    await sweep();
    assert.equal(stub.sent[0]?.type, 'thread.archive');
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
