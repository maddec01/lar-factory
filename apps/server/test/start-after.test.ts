import type { BoardData, RawItem } from '@lar-factory/shared';
import { rawIssue } from '@lar-factory/shared/test/raw-items';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { test } from 'vite-plus/test';
import type { TestContext } from 'vite-plus/test';

import {
    approveReadyBuilds,
    SAMPLE_MODELS,
    changeRecords,
    recordBlockers,
    settleDecisions,
    startableEnv,
    startBoard,
    until,
} from './server-support.ts';
import type { Board } from './server-support.ts';

const OPUS = { instanceId: 'claudeAgent_personal', model: 'claude-opus-5-5' };

const build = rawIssue('I_12', 12, 'Ready', ['build']);
const CLOSED_DEPENDENCY = { ticketObservations: { 'maddec01/lar-server#40': { state: 'CLOSED', assignees: [] } } };

/** A board that can start lar-factory threads, offering the sample model choices, and its environment. */
async function armableBoard(
    t: TestContext,
    items: RawItem[],
    options: object = {},
    env: Record<string, string> = { ...startableEnv(t), ...SAMPLE_MODELS },
) {
    const board = await startBoard(
        t,
        { localSetups: { 'maddec01/lar-factory': { writeRefinedSpec: false } }, items, ...options },
        false,
        false,
        env,
    );

    await until(board, (d) => d.items.length === items.length);
    await approveReadyBuilds(board);

    return { board, env };
}

/** A board whose build #12 waits on two decisions, the first settled; returns the open one's work ID too. */
async function blockedBuildBoard(t: TestContext, options: object = {}) {
    const armable = await armableBoard(t, [build], options);
    const [settled, open] = await recordBlockers(armable.board, armable.board.id(12), ['Decision 5', 'Decision 6']);

    await settleDecisions(armable.board, armable.board.id(12), [settled!]);

    return { ...armable, open: open! };
}

const arm = (board: Board, itemId: string, model?: unknown) => board.postSession({ itemId, model }, '/api/arm');
const armedPath = (home: string) => join(home, 'Library/Application Support/Lar Factory/armed-starts.json');
const armedFile = (home: string) => JSON.parse(readFileSync(armedPath(home), 'utf8'));

test('with Auto-build off, a Ready build can be armed at capacity and starts once when a PR frees the slot', async (t) => {
    const { board } = await armableBoard(t, [build, rawIssue('I_13', 13, 'Ready', ['build'])]);

    assert.equal((await board.postSession({ limit: 1 }, '/api/build-limit')).status, 200);
    assert.equal((await board.postSession({ on: false }, '/api/auto-build')).status, 200);
    assert.equal((await board.postSession({ itemId: board.id(12) }, '/api/start-build')).status, 200);
    await until(board, (data) => !!data.items.find((item) => item.id === board.id(12))?.buildReserved);

    assert.equal((await arm(board, board.id(13), OPUS)).status, 200);

    const waiting = await read(board);

    assert.equal(waiting.autoBuild?.on, false);
    assert.deepEqual(waiting.armed?.[board.id(13)], { model: OPUS });
    assert.deepEqual(waiting.armedErrors, {});
    assert.equal((await board.t3Calls()).length, 1);

    await changeRecords(
        board,
        (records) => {
            const id = board.id(12);

            records.setPullRequest(id, records.read(id).revision, 'maddec01/lar-factory#90');
            records.observe(id, records.read(id).revision, { of: 'pr', state: 'open' });
        },
        board.id(12),
        (item) => !item.buildReserved,
    );

    const started = await until(board, (data) => !!data.startedBuilds?.[board.id(13)] && !data.armed?.[board.id(13)]);

    assert.deepEqual(started.armedErrors, {});
    await read(board);

    const calls = await board.t3Calls();

    assert.equal(calls.length, 2);
    assert.deepEqual(calls[1]![3], { ...OPUS, options: [] });
});

/** Asks for a read and waits until it lands. */
async function read(board: Board): Promise<BoardData> {
    const before = ((await board.board()) as BoardData).fetchedAt;

    await board.post({}, board.url, '/api/read');

    return until(board, (d) => d.fetchedAt !== before);
}

test('a refresh with a blocker incomplete starts nothing; once the last completes, the board starts the build once, on its armed model', async (t) => {
    const { board, env, open } = await blockedBuildBoard(t);

    assert.equal((await arm(board, board.id(12), OPUS)).status, 200);
    // An incomplete blocker preserves the armed authorization.
    assert.deepEqual((await read(board)).armed, { [board.id(12)]: { model: OPUS } });
    // No ticket read is asked for: the board sees the decision complete in the work records.
    await settleDecisions(board, board.id(12), [open]);

    const started = await until(board, (d) => !!d.startedBuilds?.[board.id(12)] && !d.armed?.[board.id(12)]);

    assert.deepEqual(started.armed, {});
    assert.deepEqual(armedFile(env.HOME!), {});
    await read(board);

    const calls = (await board.t3Calls()) as unknown as unknown[][];

    assert.deepEqual(
        calls.map(([kind, project, , selection]) => [kind, project, selection]),
        [['launch', 'project-factory', { instanceId: 'claudeAgent_personal', model: 'claude-opus-5-5', options: [] }]],
    );
    assert.equal((calls[0]![4] as { type: string }).type, 'worktree', 'a build starts in its own worktree');
});

/** Records a Dependency on the server team holding the board's build #12, its ticket read as closed; returns its ID. */
async function recordClosedDependency(board: Board): Promise<string> {
    let dependencyId = '';

    await changeRecords(
        board,
        (records) => {
            let dependency = records.addDependency(board.id(12), {
                need: 'An export endpoint',
                owner: 'server team',
                ticket: 'maddec01/lar-server#40',
            });

            dependency = records.addDependencyBlock(dependency.dependencyId, dependency.revision, board.id(12));
            dependency = records.observeDependency(dependency.dependencyId, dependency.revision, {
                subject: 'maddec01/lar-server#40',
                kind: 'closed',
            });
            dependencyId = dependency.dependencyId;
        },
        board.id(12),
        (item) => item.blockers.some((b) => b.dependency?.observation?.kind === 'closed'),
    );

    return dependencyId;
}

const markMet = async (board: Board, dependencyId: string, met: boolean) => {
    const hold = ((await board.board()) as BoardData).items
        .flatMap((i) => i.blockers)
        .find((b) => b.dependency?.dependencyId === dependencyId)!.dependency!;

    return board.postSession(
        { itemId: board.id(12), dependencyId, revision: hold.revision, met },
        '/api/dependency-met',
    );
};

test('a Dependency whose ticket closed still holds Start and Start after until the user marks it met, which fires the armed start', async (t) => {
    const { board } = await armableBoard(t, [build], CLOSED_DEPENDENCY);
    const dependencyId = await recordClosedDependency(board);
    const refused = await board.postSession({ itemId: board.id(12) }, '/api/start-build');

    assert.equal(refused.status, 409);
    assert.match((await refused.json()).error, /^Blocked by the Dependency on server team until you mark it met/);

    const armed = await arm(board, board.id(12), OPUS);

    assert.equal(armed.status, 200, JSON.stringify(await armed.json()));
    assert.deepEqual(
        (await read(board)).armed,
        { [board.id(12)]: { model: OPUS } },
        'the closed ticket alone starts nothing',
    );

    const marked = await markMet(board, dependencyId, true);

    assert.equal(marked.status, 200);

    const started = await until(board, (d) => !!d.startedBuilds?.[board.id(12)] && !d.armed?.[board.id(12)]);

    assert.deepEqual(started.armed, {});
});

test('Shape authorizes follow-on decisions on the concept model, including blocked decisions, with Auto-build off', async (t) => {
    const { board } = await armableBoard(t, [rawIssue('I_30', 30, 'Queued', ['feature'])]);
    const parent = board.id(30);
    const shaped = await board.postSession({ itemId: parent, model: OPUS }, '/api/start');

    assert.equal(shaped.status, 200, JSON.stringify(await shaped.json()));

    let first = '';
    let second = '';
    let research = '';

    await changeRecords(
        board,
        (records) => {
            records.update(parent, records.read(parent).revision, { kind: 'concept' });

            const part = (method: 'grill' | 'task' | 'research', blockerIds: string[] = []) =>
                records.createPart({
                    parentId: parent,
                    parentRevision: records.read(parent).revision,
                    title: `${method} decision`,
                    repository: 'maddec01/lar-factory',
                    kind: 'decision',
                    body: `Method: ${method}\nChoose the contract.`,
                    blockerIds,
                }).workId;

            first = part('grill');
            second = part('task', [first]);
            research = part('research');
        },
        parent,
        (item) => item.subIssues.total === 3,
    );

    const started = await until(board, (d) => !!d.started?.[first] && !!d.armed?.[second]);

    assert.equal(started.autoBuild?.on, false);
    assert.equal(started.started?.[second], undefined);
    assert.equal(started.started?.[research], undefined);
    assert.deepEqual(started.armed?.[second], { model: OPUS });

    await changeRecords(
        board,
        (records) => {
            records.setBody(first, records.read(first).revision, 'answer', 'Use the chosen contract.');
            records.setBody(first, records.read(first).revision, 'domain-drafts', 'none');
            records.setBody(parent, records.read(parent).revision, 'map', '## Destination\nSettled contract.');
        },
        second,
        (item) => item.blockers.every((blocker) => blocker.state === 'closed'),
    );
    await until(board, (d) => !!d.started?.[second] && !d.armed?.[second]);
    await read(board);

    const calls = (await board.t3Calls()) as unknown as unknown[][];

    assert.equal(calls.length, 3, 'one concept and two decisions, with no duplicate launches');
    assert.deepEqual(
        calls.map((call) => call[3]),
        Array(3).fill({ ...OPUS, options: [] }),
    );
});
