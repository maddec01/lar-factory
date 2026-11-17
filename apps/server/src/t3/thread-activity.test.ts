import { threadActivityLine, type ItemThread } from '@lar-factory/shared';
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

for (const toolName of ['AskUserQuestion', 'mcp__t3-code__delegate_task'])
    test(`a continuation after ${toolName} says Resuming until its next action, while a new owner says Starting`, (t) => {
        const path = activityDb(t);
        const writer = new DatabaseSync(path);
        const owner: ItemThread = { id: 'shape', title: 'Shape', purpose: 'shape', state: 'running', updated: AT };
        const action = () => {
            const reads = activityReads(
                () => new DatabaseSync(path, { readOnly: true }),
                () => activityFamilies([{ id: 'shape', status: 'running', updatedAt: AT }]),
            );

            try {
                return threadActivityLine(reads.read(owner), Date.parse(AT))?.action;
            } finally {
                reads.close();
            }
        };

        t.onTestFinished(() => writer.close());
        writer.exec("INSERT INTO orchestration_v2_projection_runs VALUES ('shape-1', 'shape', 1, 'running')");
        expect(action()).toBe('Starting');
        writer
            .prepare('INSERT INTO orchestration_v2_projection_turn_items VALUES (?, ?, ?, ?, ?, ?, ?)')
            .run(
                'question-or-child',
                'shape',
                'shape-1',
                1,
                'dynamic_tool',
                'completed',
                JSON.stringify({ toolName, completedAt: AT }),
            );
        writer.exec("UPDATE orchestration_v2_projection_runs SET status='completed' WHERE run_id='shape-1'");
        writer.exec("INSERT INTO orchestration_v2_projection_runs VALUES ('shape-2', 'shape', 2, 'running')");
        expect(action()).toBe('Resuming');
        writer
            .prepare('INSERT INTO orchestration_v2_projection_turn_items VALUES (?, ?, ?, ?, ?, ?, ?)')
            .run(
                'next-action',
                'shape',
                'shape-2',
                2,
                'command_execution',
                'running',
                JSON.stringify({ input: 'pnpm test', startedAt: AT }),
            );
        expect(action()).toBe('Running tests');
    });

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
            { title: 'Slice', model: 'opus', action: 'Running tests', actionDetail: 'CI=1 pnpm test', actionAt: AT },
            { title: 'explorer', action: 'Reading b.ts', actionDetail: 'Read /a/b.ts', actionAt: AT },
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

    expect(first.read(atWork).activity).toMatchObject({
        agents: [
            { action: 'Running tests', actionDetail: 'CI=1 pnpm test' },
            { action: 'Reading b.ts', actionDetail: 'Read /a/b.ts' },
        ],
    });
    first.close();
    writer
        .prepare('UPDATE orchestration_v2_projection_turn_items SET payload_json = ? WHERE turn_item_id = ?')
        .run(JSON.stringify({ input: 'pnpm run typecheck', startedAt: AT, updatedAt: AT }), 'i1');
    writer.exec("UPDATE orchestration_v2_projection_subagents SET status = 'completed' WHERE subagent_id = 's2'");

    const next = pass();

    expect(next.read(atWork).activity).toMatchObject({
        agents: [{ action: 'Checking types', actionDetail: 'pnpm run typecheck' }],
    });
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
        agents: [{ action: 'Checking types', actionDetail: 'pnpm run typecheck' }],
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

test('a transient shell or database failure retains the same run’s last action without renewing it, then expires or recovers', (t) => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date(AT));
    t.onTestFinished(() => {
        vi.useRealTimers();
    });

    const path = activityDb(t);
    const open = () => new DatabaseSync(path, { readOnly: true });
    const first = activityReads(open, () => activityFamilies(shells));
    const seen = first.read(atWork);

    first.close();
    expect(seen.activity?.available).toBe(true);

    const failed = () => {
        throw Error('brief read failure');
    };
    const pass = (thread: ItemThread, previous: ItemThread, shell = false) => {
        const reads = activityReads(failed, () => (shell ? undefined : activityFamilies(shells)), undefined, [
            previous,
        ]);
        const shown = reads.read(shell ? { ...thread, observedAt: AT } : thread);

        reads.close();

        return shown;
    };

    vi.advanceTimersByTime(4_000);

    const cached = pass(atWork, seen, true);

    expect(cached.observedAt).toBe(AT);
    expect(cached.activity).toEqual(seen.activity);
    expect(threadActivityLine(cached, Date.now())?.state).toBe('working');
    expect(pass(atWork, seen).activity).toEqual(seen.activity);
    expect(pass({ ...atWork, updated: new Date().toISOString() }, seen).activity).toEqual({ available: false });
    vi.advanceTimersByTime(11_000);
    expect(threadActivityLine(cached, Date.now())?.state).toBe('unavailable');
    expect(pass(atWork, cached).activity).toEqual({ available: false });

    const recovered = activityReads(open, () => activityFamilies(shells), undefined, [cached]);

    expect(recovered.read(atWork).activity).toMatchObject({ available: true, readAt: new Date().toISOString() });
    recovered.close();
});

test('activity describes the action and retains its original command or file detail', (t) => {
    const path = activityDb(t);
    const writer = new DatabaseSync(path);

    t.onTestFinished(() => writer.close());
    for (const [type, payload, action, actionDetail] of [
        [
            'command_execution',
            { input: '/bin/zsh -lc "export EXAMPLE=value; CI=1 pnpm test"' },
            'Running tests',
            '/bin/zsh -lc "export EXAMPLE=value; CI=1 pnpm test"',
        ],
        ['command_execution', { input: 'node scripts/work.mjs' }, 'Running a command', 'node scripts/work.mjs'],
        ['file_change', { fileName: '/sandbox/src/greeting.js' }, 'Editing greeting.js', '/sandbox/src/greeting.js'],
    ] as const) {
        writer
            .prepare('UPDATE orchestration_v2_projection_turn_items SET type=?, payload_json=? WHERE turn_item_id=?')
            .run(type, JSON.stringify({ ...payload, startedAt: AT, updatedAt: AT }), 'i1');

        const reads = activityReads(
            () => new DatabaseSync(path, { readOnly: true }),
            () => activityFamilies(shells),
        );

        try {
            expect(reads.read(atWork).activity).toMatchObject({ agents: [{ action, actionDetail }, {}] });
        } finally {
            reads.close();
        }
    }
});
