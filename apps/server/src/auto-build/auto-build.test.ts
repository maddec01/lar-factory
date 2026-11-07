import type { AutoBuildState, BoardData, ModelGroup } from '@lar-factory/shared';
import { openWorkRecords, type WorkRecords } from '@lar-factory/work-records';
import assert from 'node:assert/strict';
import { mkdtempSync, readdirSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, test } from 'vite-plus/test';

import { createBoardState, type BoardState } from '../board/board-state.ts';
import type { Reply } from '../items/item-commands.ts';
import { recordItems } from '../items/record-items.ts';
import { HOLD_RETRY_MS, createAutoBuild } from './auto-build.ts';

const REPO = 'maddec01/lar-factory';
const OPUS = { instanceId: 'claudeAgent', model: 'claude-opus-5-5' };
const OFFERED: ModelGroup[] = [
    { instanceId: 'claudeAgent', name: 'Claude', models: [{ slug: 'claude-opus-5-5', label: 'Opus 5.5' }] },
];
const OK: Reply = { status: 200, body: { thread: { threadId: 't', title: 't' }, error: null } };

const cleanups: (() => void)[] = [];
afterEach(() => {
    for (const cleanup of cleanups.splice(0)) cleanup();
});

const at = (records: WorkRecords, workId: string) => records.read(workId).revision;

/** Passes the work's brief through its gate, a millisecond after the last one, so gate times order the builds. */
function gate(records: WorkRecords, workId: string): void {
    const now = Date.now();
    while (Date.now() === now) {
        /* the next millisecond */
    }
    records.recordGate(workId, at(records, workId), {
        briefDigest: records.gate(workId).briefDigest!,
        approvedBy: 'reviewer',
        evidence: 'Passed.',
    });
}

/** A Ready build with a brief; `gated` false leaves its gate unpassed. */
function ready(records: WorkRecords, title: string, gated = true): string {
    const { workId } = records.create({ title, repository: REPO, kind: 'build', status: 'Ready' });
    records.setBody(workId, at(records, workId), 'brief', `Build ${title}.`);
    if (gated) gate(records, workId);
    return workId;
}

interface SetUp {
    dir: string;
    records: WorkRecords;
    board: BoardState;
    started: string[];
    /** What the next Start build answers for a work ID; a success moves the build to In progress. */
    answers: Map<string, Reply>;
    auto: AutoBuildState;
    limit: number;
    choices: ModelGroup[];
    /** The clock Auto-build reads. */
    clock: number;
    /** Runs inside each Start build, before it answers. */
    during?: (itemId: string) => void;
    reread(): void;
    pass(): Promise<void>;
    /** Stops this board, as its process exiting would. */
    stop(): Promise<void>;
}

async function setUp(shared?: { dir: string; records: WorkRecords }): Promise<SetUp> {
    const dir = shared?.dir ?? mkdtempSync(join(tmpdir(), 'auto-build-'));
    const records = shared?.records ?? (await openWorkRecords(join(dir, 'work-records.db')));
    if (!shared)
        cleanups.push(() => {
            records.close();
            rmSync(dir, { recursive: true, force: true });
        });
    const board = createBoardState({
        items: recordItems(records, [], [REPO]),
        repos: [],
        t3Availability: { availability: 'available' },
    } as unknown as BoardData);
    const s: SetUp = {
        dir,
        records,
        board,
        started: [],
        answers: new Map(),
        auto: { on: true },
        limit: 10,
        choices: OFFERED,
        clock: 0,
        reread: () => board.applyRead(recordItems(records, [], [REPO]), board.revision(), (items) => items),
        pass: () => autoBuild.pass(),
        stop: () => autoBuild.release(),
    };
    const autoBuild = createAutoBuild({
        board,
        records,
        dir,
        now: () => s.clock,
        setting: () => s.auto,
        limit: () => s.limit,
        offerModelChoices: () => s.choices,
        commands: {
            async startBuild(itemId, model, drift, quiet) {
                assert.deepEqual([drift, quiet], [undefined, true]);
                assert.deepEqual(model, s.auto.model);
                s.started.push(itemId);
                s.during?.(itemId);
                const answer = s.answers.get(itemId) ?? OK;
                if (answer === OK) records.update(itemId, at(records, itemId), { status: 'In progress' });
                // A start T3 may have made leaves its launch intent unresolved.
                if ((answer.body as { uncertain?: boolean }).uncertain)
                    records.recordLaunchIntent(itemId, at(records, itemId), 'build');
                s.reread();
                return answer;
            },
        },
    });
    return s;
}

const pass = (s: SetUp) => s.board.snapshot().autoBuildPass;

test('Auto-build starts only a Ready build with a current passing gate that nothing holds back', async () => {
    const s = await setUp();
    const { records } = s;
    const eligible = ready(records, 'Eligible');
    ready(records, 'No gate', false);
    const edited = ready(records, 'Brief edited since its gate');
    records.setBody(edited, at(records, edited), 'brief', 'A changed brief.');
    const held = ready(records, 'Held Spec edit');
    const spec = records.specState(held);
    records.saveSpecState(held, spec.generation, {
        ...spec,
        held: { body: 'Edited', title: 'Held Spec edit', version: '2', digest: 'd' },
    });
    const blocked = ready(records, 'Waiting on a blocker');
    const blocker = records.create({ title: 'Blocker', repository: REPO, kind: 'build', status: 'In progress' });
    records.addBlocker(blocked, at(records, blocked), blocker.workId);
    const aside = ready(records, 'Set aside');
    records.setAside(aside, at(records, aside));
    const needsYou = ready(records, 'Needs you');
    records.setNeedsYouCauses(needsYou, at(records, needsYou), [{ type: 'no-thread' }]);
    const armed = ready(records, 'Armed with Start after');
    const concept = records.create({ title: 'Concept', repository: REPO, kind: 'concept', status: 'Shaping' });
    const refining = ready(records, 'Under a concept still refining');
    records.setParent(refining, at(records, refining), concept.workId);
    records.create({ title: 'Queued', repository: REPO, kind: 'feature', status: 'Queued' });
    s.reread();
    s.board.update({ armed: { [armed]: {} } });

    await s.pass();
    assert.deepEqual(s.started, [eligible]);
    assert.deepEqual(pass(s), { wouldStart: 0, paused: {}, waitsForRefinement: [refining] });

    records.setBody(concept.workId, at(records, concept.workId), 'map', '# Map\n\nSettled.');
    records.setFogGone(concept.workId, at(records, concept.workId), true);
    s.reread();
    await s.pass();
    assert.deepEqual(s.started, [eligible, refining], 'its concept’s Refinement is complete');
});

test('Auto-build starts the oldest passing gate first, up to the build limit, and starts the next once a build finishes', async () => {
    const s = await setUp();
    const { records } = s;
    const a = ready(records, 'A', false);
    const b = ready(records, 'B', false);
    const c = ready(records, 'C', false);
    for (const workId of [c, a, b]) gate(records, workId);
    // A later edit moves updatedAt, which never orders the builds.
    records.setBuildBranch(c, at(records, c), 'build/c');
    s.limit = 2;
    s.reread();
    await s.pass();
    assert.deepEqual(s.started, [c, a]);
    assert.equal(pass(s)?.wouldStart, 0);

    records.update(c, at(records, c), { status: 'Done' });
    s.reread();
    await s.pass();
    assert.deepEqual(s.started, [c, a, b]);
});

test('with the switch off nothing starts, and the tooltip count says how many would', async () => {
    const s = await setUp();
    ready(s.records, 'A');
    ready(s.records, 'B');
    ready(s.records, 'C');
    s.auto = { on: false };
    s.limit = 2;
    s.reread();
    await s.pass();
    assert.deepEqual(s.started, []);
    assert.equal(pass(s)?.wouldStart, 2);
});

test('each hold starts nothing, marks nothing on the build, says why, and the next pass retries', async () => {
    const holds: [string, (s: SetUp, workId: string) => void, string, boolean?][] = [
        [
            'T3 unreachable',
            (s) => s.board.update({ t3Availability: { availability: 'unavailable' } }),
            "Auto-build waits for T3, which the board can't reach.",
        ],
        [
            'model choices unreadable',
            (s) => {
                s.choices = [];
            },
            "Auto-build waits for T3's model choices, which the board can't read.",
        ],
        [
            'saved model no longer offered',
            (s) => {
                s.auto = { on: true, model: { instanceId: 'codex', model: 'gpt-5' } };
            },
            "Auto-build's model isn't offered now. Choose another in Settings.",
        ],
    ];
    // Start build's own temporary refusals, as it marks them.
    for (const error of [
        'Waits for onboarding to finish',
        'Skills drifted from the bundle.',
        'A shaping thread is still at work on this item.',
        'Push access is blocked.',
        'T3 has no project for this repository.',
        'Could not read the repository’s default branch.',
    ]) {
        holds.push([
            error,
            (s, workId) => s.answers.set(workId, { status: 409, body: { thread: null, error, hold: true } }),
            error,
            true,
        ]);
    }
    for (const [name, cause, reason, waits] of holds) {
        const s = await setUp();
        const workId = ready(s.records, 'Held');
        s.reread();
        cause(s, workId);
        await s.pass();
        assert.equal(pass(s)?.hold, reason, name);
        assert.deepEqual(pass(s)?.paused, {}, name);
        assert.equal(s.records.read(workId).status, 'Ready', name);

        s.board.update({ t3Availability: { availability: 'available' } });
        s.choices = OFFERED;
        s.auto = { on: true };
        s.answers.clear();
        s.started.length = 0;
        await s.pass();
        if (waits) {
            // Each try of Start build rereads the Spec, so its hold waits before it retries.
            assert.deepEqual([s.started, pass(s)?.hold], [[], reason], `${name}: waits`);
            s.clock += HOLD_RETRY_MS;
            await s.pass();
        }
        assert.deepEqual([s.started, pass(s)?.hold], [[workId], undefined], `${name}: retried`);
    }
});

test('Auto-build starts on the model Settings chose', async () => {
    const s = await setUp();
    const workId = ready(s.records, 'A');
    s.auto = { on: true, model: OPUS };
    s.reread();
    await s.pass();
    assert.deepEqual(s.started, [workId]);
});

test('a failed start pauses only that build, survives a restart, and ends when Start build succeeds or a new gate passes', async () => {
    const s = await setUp();
    const { records } = s;
    const failing = ready(records, 'Failing');
    const other = ready(records, 'Other');
    s.answers.set(failing, { status: 502, body: { thread: null, error: 'T3 started no thread.' } });
    s.reread();
    await s.pass();
    assert.deepEqual(s.started, [failing, other], 'other builds still start');
    assert.deepEqual(pass(s)?.paused, { [failing]: 'T3 started no thread.' });
    assert.equal(records.read(failing).status, 'Ready');

    await s.stop();
    const restarted = await setUp({ dir: s.dir, records });
    await restarted.pass();
    assert.deepEqual(restarted.started, [], 'the pause outlasts a restart');
    assert.deepEqual(pass(restarted)?.paused, { [failing]: 'T3 started no thread.' });
    assert.deepEqual(
        readdirSync(s.dir).filter((name) => name.endsWith('.tmp')),
        [],
        'the pauses file is replaced whole',
    );

    gate(records, failing);
    restarted.reread();
    await restarted.pass();
    assert.deepEqual(restarted.started, [failing], 'a new gate ends the pause');

    const person = ready(records, 'Started by hand later');
    restarted.answers.set(person, { status: 502, body: { thread: null, error: 'Boom.' } });
    restarted.reread();
    await restarted.pass();
    assert.deepEqual(pass(restarted)?.paused, { [person]: 'Boom.' });
    records.update(person, at(records, person), { status: 'In progress' });
    restarted.reread();
    await restarted.pass();
    assert.deepEqual(pass(restarted)?.paused, {}, 'a Start build that succeeded ends the pause');
});

test('a start T3 may have made keeps its place against the limit and is never started again', async () => {
    const s = await setUp();
    const { records } = s;
    const uncertain = ready(records, 'Uncertain');
    const next = ready(records, 'Next');
    s.limit = 1;
    s.answers.set(uncertain, {
        status: 502,
        body: { thread: null, error: 'T3 may have started it.', uncertain: true },
    });
    s.reread();
    await s.pass();
    await s.pass();
    assert.deepEqual(s.started, [uncertain]);
    assert.deepEqual(pass(s)?.paused, {});
    s.limit = 2;
    await s.pass();
    assert.deepEqual(s.started, [uncertain, next], 'a raised limit starts the next');
});

test('two boards sharing a data folder start a build once', async () => {
    const first = await setUp();
    const workId = ready(first.records, 'Shared');
    first.reread();
    const second = await setUp({ dir: first.dir, records: first.records });
    await Promise.all([first.pass(), second.pass()]);
    assert.deepEqual([...first.started, ...second.started], [workId]);

    const owner = first.started.length ? first : second;
    const other = owner === first ? second : first;
    const next = ready(first.records, 'Next');
    other.reread();
    await other.pass();
    assert.deepEqual(
        [other.started.includes(next), pass(other)?.hold],
        [false, 'Another board on this Mac starts the builds.'],
    );
    await owner.stop();
    await other.pass();
    assert.ok(other.started.includes(next), 'a board that stopped hands Auto-build over');
});

test('a Ready build a blocker held starts once the blocker completes', async () => {
    const s = await setUp();
    const { records } = s;
    const blocker = records.create({ title: 'Blocker', repository: REPO, kind: 'build', status: 'In progress' });
    records.setPullRequest(blocker.workId, at(records, blocker.workId), `${REPO}#90`);
    records.observe(blocker.workId, at(records, blocker.workId), { of: 'pr', state: 'open' });
    const blocked = ready(records, 'Blocked');
    records.addBlocker(blocked, at(records, blocked), blocker.workId);
    s.reread();
    await s.pass();
    assert.deepEqual(s.started, []);
    records.observe(blocker.workId, at(records, blocker.workId), { of: 'pr', state: 'merged' });
    records.update(blocker.workId, at(records, blocker.workId), { status: 'Done' });
    s.reread();
    await s.pass();
    assert.deepEqual(s.started, [blocked]);
});

test('a pause stays while its build is set aside, its brief lacks a passing gate or its record can’t be read', async () => {
    const s = await setUp();
    const { records } = s;
    const failing = ready(records, 'Failing');
    s.answers.set(failing, { status: 502, body: { thread: null, error: 'T3 started no thread.' } });
    s.reread();
    await s.pass();
    const paused = { [failing]: 'T3 started no thread.' };
    assert.deepEqual(pass(s)?.paused, paused);

    records.setAside(failing, at(records, failing));
    s.reread();
    await s.pass();
    records.restore(failing, at(records, failing));
    s.reread();
    await s.pass();
    assert.deepEqual([s.started, pass(s)?.paused], [[failing], paused], 'setting it aside and back keeps the pause');

    records.setBody(failing, at(records, failing), 'brief', 'A changed brief.');
    s.reread();
    await s.pass();
    assert.deepEqual(pass(s)?.paused, paused, 'an edited brief with no gate yet keeps the pause');

    await s.stop();
    let unreadable = true;
    const failingReads = new Proxy(records, {
        get: (target, key) =>
            key === 'read'
                ? (workId: string) => {
                      if (unreadable && workId === failing) throw new Error('database is locked');
                      return target.read(workId);
                  }
                : target[key as keyof WorkRecords],
    });
    const restarted = await setUp({ dir: s.dir, records: failingReads });
    await restarted.pass();
    assert.deepEqual(pass(restarted)?.paused, paused, 'a read that fails keeps the pause');
    unreadable = false;
    gate(records, failing);
    restarted.reread();
    await restarted.pass();
    assert.deepEqual([restarted.started, pass(restarted)?.paused], [[failing], {}], 'a new gate ends it');
});

test('a build the board shows blocked waits without a pause, even when its record lists no blocker', async () => {
    const s = await setUp();
    const { records } = s;
    const blocked = ready(records, 'Blocked');
    const blocker = records.create({ title: 'Blocker', repository: REPO, kind: 'build', status: 'In progress' });
    records.addBlocker(blocked, at(records, blocked), blocker.workId);
    s.reread();
    records.removeBlocker(blocked, at(records, blocked), blocker.workId);
    await s.pass();
    assert.deepEqual([s.started, pass(s)?.paused], [[], {}]);
    s.reread();
    await s.pass();
    assert.deepEqual(s.started, [blocked]);
});

test('Auto-build checks each build again just before it starts it', async () => {
    const s = await setUp();
    const { records } = s;
    const first = ready(records, 'First');
    const second = ready(records, 'Second');
    s.during = (itemId) => {
        if (itemId === first) records.setAside(second, at(records, second));
    };
    s.reread();
    await s.pass();
    assert.deepEqual([s.started, pass(s)?.wouldStart, pass(s)?.paused], [[first], 0, {}]);
});
