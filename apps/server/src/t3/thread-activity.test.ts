import type { ItemThread } from '@lar-factory/shared';
import { join } from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import { expect, test, vi, type TestContext } from 'vite-plus/test';

import { tempDir } from '../../test/stats-db.ts';
import { createActivityDatabase } from './activity-database.ts';
import { activityFamilies } from './item-execution.ts';
import { activityReads } from './thread-activity.ts';

const AT = '2026-11-04T12:00:00.000Z';

const SCHEMA = `
CREATE TABLE orchestration_v2_projection_runs (run_id TEXT PRIMARY KEY, thread_id TEXT, ordinal INTEGER, status TEXT);
CREATE TABLE orchestration_v2_projection_subagents (subagent_id TEXT PRIMARY KEY, thread_id TEXT, run_id TEXT, child_thread_id TEXT, status TEXT, started_at TEXT, payload_json TEXT);
CREATE TABLE orchestration_v2_projection_turn_items (turn_item_id TEXT PRIMARY KEY, thread_id TEXT, run_id TEXT, ordinal INTEGER, type TEXT, status TEXT, payload_json TEXT);`;

function activityDb(t: TestContext): string {
    const path = join(tempDir(t, 'lar-activity-'), 'statev2.sqlite');
    const db = new DatabaseSync(path);

    db.exec(SCHEMA);

    const run = db.prepare('INSERT INTO orchestration_v2_projection_runs VALUES (?, ?, 1, ?)');
    const sub = db.prepare('INSERT INTO orchestration_v2_projection_subagents VALUES (?, ?, ?, ?, ?, ?, ?)');
    const turn = db.prepare('INSERT INTO orchestration_v2_projection_turn_items VALUES (?, ?, ?, ?, ?, ?, ?)');
    const payload = (over: object) => JSON.stringify({ startedAt: AT, updatedAt: AT, ...over });

    run.run('build-run', 'build', 'completed');
    run.run('impl-run', 'impl', 'running');
    // A child task working after the run that started it ended, with a native subagent of its own and one that finished.
    sub.run('s1', 'build', 'build-run', 'impl', 'running', AT, JSON.stringify({ title: 'Slice', model: 'opus' }));
    sub.run('s2', 'impl', 'impl-run', 'native', 'running', AT, JSON.stringify({ title: '/root/explorer' }));
    sub.run('s3', 'impl', 'impl-run', 'finished', 'completed', AT, JSON.stringify({ title: 'Done' }));
    // A native subagent left reading running after the build's run ended.
    sub.run('s4', 'build', 'build-run', 'stale', 'running', AT, JSON.stringify({ title: 'Stale' }));
    turn.run(
        'b1',
        'build',
        'build-run',
        1,
        'dynamic_tool',
        'completed',
        payload({ toolName: 'mcp__t3-code__delegate_task', completedAt: AT }),
    );
    turn.run('b2', 'build', 'build-run', 2, 'subagent', 'running', payload({ title: 'Slice' }));
    turn.run('i1', 'impl', 'impl-run', 1, 'command_execution', 'running', payload({ input: 'CI=1 pnpm test' }));
    turn.run(
        'n1',
        'native',
        null,
        1,
        'dynamic_tool',
        'completed',
        payload({ title: 'Read /a/b.ts', toolName: 'Read', completedAt: AT }),
    );
    db.close();

    return path;
}

const shells = [
    { id: 'build', status: 'completed', updatedAt: AT },
    { id: 'impl', status: 'running', updatedAt: AT, lineage: { parentThreadId: 'build', rootThreadId: 'build' } },
];
const atWork: ItemThread = { id: 'build', title: 'Build', state: 'done', hasRunningChildren: true, updated: AT };

test('a pass reads the agents under a build, its child tasks and their native subagents, and leaves out finished and stale ones', (t) => {
    const path = activityDb(t);
    const reads = activityReads(
        () => new DatabaseSync(path, { readOnly: true }),
        () => activityFamilies(shells),
    );

    t.onTestFinished(() => reads.close());
    expect(reads.read(atWork).activity).toEqual({
        available: true,
        readAt: expect.any(String),
        toolRunning: true,
        agents: [
            { title: 'Slice', model: 'opus', action: 'pnpm test', actionAt: AT },
            { title: 'explorer', action: 'Read b.ts', actionAt: AT },
        ],
    });
});

test('a reused activity connection reads new actions and finished agents on the very next pass', (t) => {
    const path = activityDb(t);
    const database = createActivityDatabase(path);
    const writer = new DatabaseSync(path);

    writer.exec('PRAGMA journal_mode=WAL');
    t.onTestFinished(() => {
        database.close();
        writer.close();
    });

    const pass = () => activityReads(database.open, () => activityFamilies(shells), database.release);
    const first = pass();

    expect(first.read(atWork).activity).toMatchObject({ agents: [{ action: 'pnpm test' }, { action: 'Read b.ts' }] });
    first.close();
    writer
        .prepare('UPDATE orchestration_v2_projection_turn_items SET payload_json = ? WHERE turn_item_id = ?')
        .run(JSON.stringify({ input: 'pnpm run typecheck', startedAt: AT, updatedAt: AT }), 'i1');
    writer.exec("UPDATE orchestration_v2_projection_subagents SET status = 'completed' WHERE subagent_id = 's2'");

    const next = pass();

    expect(next.read(atWork).activity).toMatchObject({ agents: [{ action: 'pnpm run typecheck' }] });
    next.close();
    // A schema failure is unavailable immediately, then a new connection can recover on the next pass.
    writer.exec('ALTER TABLE orchestration_v2_projection_turn_items RENAME TO hidden_items');

    const failed = pass();

    expect(failed.read(atWork).activity).toEqual({ available: false });
    failed.close();
    writer.exec('ALTER TABLE hidden_items RENAME TO orchestration_v2_projection_turn_items');

    const recovered = pass();

    expect(recovered.read(atWork).activity).toMatchObject({
        available: true,
        agents: [{ action: 'pnpm run typecheck' }],
    });
    recovered.close();
});

test('a read that fails, or a T3 that cannot be read, says unavailable, and no read is kept for an observation from an outage', (t) => {
    const path = activityDb(t);
    const good = () => new DatabaseSync(path, { readOnly: true });
    const failed = activityReads(
        () => {
            throw Error('no database');
        },
        () => activityFamilies(shells),
    );

    expect(failed.read(atWork).activity).toEqual({ available: false });

    const outage = activityReads(good, () => undefined);

    expect(outage.read(atWork).activity).toEqual({ available: false });

    const open = vi.fn(good);
    const retained = activityReads(open, () => activityFamilies(shells));

    t.onTestFinished(() => retained.close());
    expect(retained.read({ ...atWork, observedAt: AT }).activity).toEqual({ available: false });
    expect(open).not.toHaveBeenCalled();
});
