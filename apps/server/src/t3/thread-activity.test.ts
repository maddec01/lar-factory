import type { Item, ItemThread } from '@lar-factory/shared';
import { join } from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import { expect, test, vi, type TestContext } from 'vite-plus/test';

import { tempDir } from '../../test/stats-db.ts';
import { createActivityDatabase } from './activity-database.ts';
import { activityFamilies } from './item-execution.ts';
import type { ActivityAgentRow, ActivityItemRow } from './t3-db.ts';
import { activityReads, agentWorking, holdsActivityRead, threadActivity, withoutReadTimes } from './thread-activity.ts';

const AT = '2026-11-04T12:00:00.000Z';
const item = (over: Partial<ActivityItemRow>): ActivityItemRow => ({
    type: 'command_execution',
    status: 'completed',
    runLive: 1,
    title: null,
    input: null,
    toolName: null,
    fileName: null,
    streaming: null,
    startedAt: AT,
    completedAt: AT,
    updatedAt: AT,
    ...over,
});
const agent = (over: Partial<ActivityAgentRow>): ActivityAgentRow => ({
    child: 'child',
    title: 'Review',
    model: 'gpt-6',
    startedAt: AT,
    runLive: 1,
    childRunLive: null,
    ...over,
});
const own = (...items: ActivityItemRow[]) =>
    threadActivity({ items, runLive: true, agents: [], commandRunning: false, readAt: AT });
const action = (over: Partial<ActivityItemRow>) => {
    const read = own(item(over));
    return read.available ? read.action : 'unavailable';
};

test('a command reads without its shell wrapper, exports and environment assignments', () => {
    expect(action({ input: 'pnpm test' })).toBe('pnpm test');
    expect(action({ input: 'CI=1 NODE_ENV="a b" pnpm test' })).toBe('pnpm test');
    expect(
        action({
            input: `export LAR_FACTORY_DATA_DIR='/Users/me/Application Support/Lar'\nexport PATH='/Users/me/bin':"$PATH"\nlar-work read 1 | jq .`,
        }),
    ).toBe('lar-work read 1 | jq .');
    expect(action({ input: 'export A=1; export B; git status' })).toBe('git status');
    expect(action({ input: 'export A=1 && git status' })).toBe('git status');
    expect(action({ input: `/bin/zsh -lc "export A='b c'\ngh pr view 847 --json \\"url\\""` })).toBe(
        'gh pr view 847 --json "url"',
    );
    expect(action({ input: 'git log\ngit status' })).toBe('git log');
    expect(action({ input: 'export A=1' }), 'nothing but an export still says what ran').toBe('export A=1');
    expect(action({ input: 'x'.repeat(300) })).toHaveLength(120);
});

test('a tool reads as its title with a path shortened, or its name without its server, and a file change as a verb and file name', () => {
    expect(action({ type: 'dynamic_tool', title: 'Read /Users/me/repo/apps/log.ts', toolName: 'Read' })).toBe(
        'Read log.ts',
    );
    expect(action({ type: 'dynamic_tool', title: 'Read /Users/me/Application Support/brief.md' })).toBe(
        'Read brief.md',
    );
    expect(action({ type: 'dynamic_tool', title: 'Search for todo items' })).toBe('Search for todo items');
    expect(action({ type: 'dynamic_tool', toolName: 'mcp__t3-code__preview_act' })).toBe('preview_act');
    expect(action({ type: 'dynamic_tool', toolName: 't3-code.link_pull_request' })).toBe('link_pull_request');
    expect(action({ type: 'file_change', fileName: '/tmp/scratch/brief.md' })).toBe('Edit brief.md');
    expect(action({ type: 'web_search' })).toBe('Search the web');
});

test('Thinking and Writing are actions only while their text streams, and finished text moves the time on', () => {
    const later = '2026-11-04T12:03:00.000Z';
    const tool = item({ input: 'pnpm test' });
    expect(
        own(item({ type: 'reasoning', status: 'running', streaming: 1, completedAt: null, updatedAt: later }), tool),
    ).toMatchObject({ action: 'Thinking', actionAt: later, toolRunning: false });
    expect(
        own(
            item({ type: 'assistant_message', status: 'running', streaming: 1, completedAt: null, updatedAt: later }),
            tool,
        ),
    ).toMatchObject({ action: 'Writing', actionAt: later });
    expect(own(item({ type: 'reasoning', streaming: 0, completedAt: later }), tool)).toMatchObject({
        action: 'pnpm test',
        actionAt: later,
    });
});

test('a stale running item does not count once its run ended, and a new run has no action until it takes one', () => {
    const stale = item({ status: 'running', input: 'pnpm test', runLive: 0, completedAt: null });
    expect(own(stale)).toEqual({ available: true, readAt: AT, toolRunning: false, agents: [] });
    const after = threadActivity({
        items: [stale, item({ type: 'reasoning', status: 'running', streaming: 1, runLive: 0, completedAt: null })],
        runLive: false,
        agents: [],
        commandRunning: false,
        readAt: AT,
    });
    expect(after, 'a thread whose agents or background work go on shows its last action, as finished').toMatchObject({
        action: 'pnpm test',
        toolRunning: false,
    });
});

test('a running tool counts for the thread or an agent, however old, but waiting on an agent does not', () => {
    const running = { status: 'running', completedAt: null };
    expect(own(item({ ...running, input: 'sleep 9' }))).toMatchObject({ toolRunning: true });
    expect(own(item({ ...running, type: 'dynamic_tool', toolName: 'mcp__t3-code__delegate_task' }))).toMatchObject({
        toolRunning: false,
    });
    expect(own(item({ ...running, type: 'dynamic_tool', toolName: 't3-code.t3_thread_wait' }))).toMatchObject({
        toolRunning: false,
    });
    expect(
        threadActivity({
            items: [],
            runLive: false,
            commandRunning: false,
            readAt: AT,
            agents: [{ row: agent({}), items: [item({ ...running, runLive: null, input: 'sleep 9' })] }],
        }),
    ).toMatchObject({ toolRunning: true });
    expect(
        threadActivity({ items: [], runLive: false, commandRunning: true, readAt: AT, agents: [] }),
        'a background command',
    ).toMatchObject({ toolRunning: true });
});

test('an agent shows "Subagent" with no title, the last segment of a path, and no missing model', () => {
    const agents = (row: Partial<ActivityAgentRow>) => {
        const read = threadActivity({
            items: [],
            runLive: true,
            commandRunning: false,
            readAt: AT,
            agents: [{ row: agent(row), items: [] }],
        });
        return read.available ? read.agents : [];
    };
    expect(agents({})).toEqual([{ title: 'Review', model: 'gpt-6', actionAt: AT }]);
    expect(agents({ title: null, model: null })).toEqual([{ title: 'Subagent', actionAt: AT }]);
    expect(agents({ startedAt: null }), 'an agent with no time still counts').toEqual([
        { title: 'Review', model: 'gpt-6' },
    ]);
    expect(agents({ title: '/root/approver' })[0]?.title).toBe('approver');
    expect(agents({ title: 'Review a/b, then c' })[0]?.title).toBe('Review a/b, then c');
});

test("an agent goes by its own runs when it has them, else the run that started it or its thread's background tasks", () => {
    expect(
        agentWorking(agent({ childRunLive: 1, runLive: 0 }), false),
        'a child task outlives the run that started it',
    ).toBe(true);
    expect(agentWorking(agent({ childRunLive: 0, runLive: 1 }), true), 'a child task whose run ended').toBe(false);
    expect(agentWorking(agent({ runLive: 1 }), false)).toBe(true);
    expect(agentWorking(agent({ runLive: 0 }), false), 'a native subagent of an ended run').toBe(false);
    expect(agentWorking(agent({ runLive: 0 }), true), 'a native subagent in the background').toBe(true);
});

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
        action: 'delegate_task',
        actionAt: AT,
        toolRunning: true,
        agents: [
            { title: 'Slice', model: 'opus', action: 'pnpm test', actionAt: AT },
            { title: 'explorer', action: 'Read b.ts', actionAt: AT },
        ],
    });
});

test('each pass stamps a read with its own time, and a pass that repeats a thread keeps that stamp', (t) => {
    vi.useFakeTimers({ toFake: ['Date'] });
    t.onTestFinished(() => {
        vi.useRealTimers();
    });
    const path = activityDb(t);
    const pass = () => {
        const reads = activityReads(
            () => new DatabaseSync(path, { readOnly: true }),
            () => activityFamilies(shells),
        );
        t.onTestFinished(() => reads.close());
        return reads;
    };
    const stamp = (read: ItemThread) => (read.activity?.available ? read.activity.readAt : undefined);
    vi.setSystemTime(AT);
    const first = pass();
    expect(stamp(first.read(atWork))).toBe(AT);
    const later = '2026-11-04T12:00:02.000Z';
    vi.setSystemTime(later);
    expect(stamp(first.read(atWork))).toBe(AT);
    expect(stamp(pass().read(atWork))).toBe(later);
});

test('comparing items without read times sees a change of action, and no change when only the time moved', () => {
    const at = (action: string, readAt: string) =>
        [
            {
                id: 'i',
                threads: [{ ...atWork, activity: { available: true, readAt, action, toolRunning: false, agents: [] } }],
            },
        ] as unknown as Item[];
    const compared = (items: Item[]) => JSON.stringify(withoutReadTimes(items));
    expect(compared(at('Read a.ts', AT))).toBe(compared(at('Read a.ts', '2026-11-04T12:00:02.000Z')));
    expect(compared(at('Read a.ts', AT))).not.toBe(compared(at('Read b.ts', AT)));
    const unavailable = [{ id: 'i', threads: [{ ...atWork, activity: { available: false } }] }] as unknown as Item[];
    expect(withoutReadTimes(unavailable)[0]).toBe(unavailable[0]);
    expect(holdsActivityRead(at('Read a.ts', AT))).toBe(true);
    expect(holdsActivityRead(unavailable)).toBe(false);
});

test('a pass opens the database once, reads each thread at work once, and reads nothing for a thread not at work', (t) => {
    const path = activityDb(t);
    const open = vi.fn(() => new DatabaseSync(path, { readOnly: true }));
    const families = vi.fn(() => activityFamilies(shells));
    const reads = activityReads(open, families);
    t.onTestFinished(() => reads.close());
    expect(reads.read({ ...atWork, id: 'idle', hasRunningChildren: undefined })).not.toHaveProperty('activity');
    expect(open).not.toHaveBeenCalled();
    const db = new DatabaseSync(path, { readOnly: true });
    const prepare = vi.spyOn(db, 'prepare');
    open.mockReturnValue(db);
    const first = reads.read(atWork);
    const queries = prepare.mock.calls.length;
    expect(queries).toBeGreaterThan(0);
    expect(reads.read(atWork).activity).toBe(first.activity);
    reads.read({ ...atWork, id: 'impl', state: 'running' });
    expect(open).toHaveBeenCalledTimes(1);
    expect(families).toHaveBeenCalledTimes(1);
    const afterImpl = prepare.mock.calls.length;
    expect(afterImpl, 'thread parameters reuse the prepared statements, never their result rows').toBe(queries);
    reads.read({ ...atWork, id: 'impl', state: 'running' });
    expect(prepare.mock.calls.length).toBe(afterImpl);
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

test("a thread at work that is also another thread's agent is read once in a pass", (t) => {
    const db = new DatabaseSync(activityDb(t), { readOnly: true });
    const prepare = db.prepare.bind(db);
    const statements: { sql: string; all: { mock: { calls: unknown[][] } } }[] = [];
    vi.spyOn(db, 'prepare').mockImplementation((sql: string) => {
        const statement = prepare(sql);
        statements.push({ sql, all: vi.spyOn(statement, 'all') });
        return statement;
    });
    const pass = activityReads(
        () => db,
        () => activityFamilies(shells),
    );
    t.onTestFinished(() => pass.close());
    pass.read(atWork);
    pass.read({ ...atWork, id: 'impl', state: 'running' });
    const reads = statements.flatMap(({ sql, all }) => all.mock.calls.map(([id]) => `${String(id)} ${sql}`));
    expect(reads.some((read) => read.startsWith('impl '))).toBe(true);
    expect(new Set(reads).size).toBe(reads.length);
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

test("a thread's own family leaves out its parent, so a sibling never reads as its agent, and the parent's family holds both", () => {
    const running = (id: string) => ({
        id,
        status: 'running',
        updatedAt: AT,
        lineage: { parentThreadId: 'parent', rootThreadId: 'parent' },
    });
    const lookup = activityFamilies([{ id: 'parent', status: 'running', updatedAt: AT }, running('a'), running('b')]);
    expect([...lookup('a').threads]).toEqual(['a']);
    expect([...lookup('parent').threads]).toEqual(['parent', 'a', 'b']);
});

test('a thread with a family above a finished middle thread still finds its grandchild, by its root', () => {
    const lookup = activityFamilies([
        { id: 'root', status: 'completed', updatedAt: AT },
        {
            id: 'grandchild',
            status: 'running',
            updatedAt: AT,
            pendingBackgroundTasks: [{ kind: 'shell' }],
            lineage: { parentThreadId: 'gone', rootThreadId: 'root' },
        },
    ]);
    const family = lookup('root');
    expect([...family.threads]).toEqual(['root', 'grandchild', 'gone']);
    expect(family.commandRunning).toBe(true);
    expect(lookup('unrelated')).toMatchObject({ commandRunning: false });
});
