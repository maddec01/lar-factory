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
import { createAutoBuild } from './auto-build.ts';

const REPO = 'maddec01/lar-factory';
const OTHER = 'maddec01/lar-other';
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

    if (records.read(workId).status === 'Shaping') records.update(workId, at(records, workId), { status: 'Ready' });
}

/** A Ready build with a brief; `gated` false leaves its gate unpassed. */
function ready(records: WorkRecords, title: string, gated = true, repository = REPO): string {
    const { workId } = records.create({ title, repository, kind: 'build', status: 'Ready' });

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
        items: recordItems(records, [], [REPO, OTHER]),
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
        reread: () => board.applyRead(recordItems(records, [], [REPO, OTHER]), board.revision(), (items) => items),
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
            async startBuild(itemId, model, quiet) {
                assert.equal(quiet, true);
                assert.deepEqual(model, s.auto.model);
                s.started.push(itemId);

                const answer = s.answers.get(itemId) ?? OK;

                if (answer === OK) {
                    records.addThread(itemId, at(records, itemId), `build-${itemId}`, 'build');
                    records.update(itemId, at(records, itemId), { status: 'In progress' });
                }

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
    assert.deepEqual(s.started, [c, a], 'Status Done alone releases no reservation');
    records.setPullRequest(c, at(records, c), `${REPO}#99`);
    records.observe(c, at(records, c), { of: 'pr', state: 'merged' });
    s.reread();
    await s.pass();
    assert.deepEqual(s.started, [c, a, b]);
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
        status: 202,
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

test('successful access recheck ends a cached access hold before its retry delay', async () => {
    const s = await setUp();
    const id = ready(s.records, 'Access recovery');

    s.reread();
    s.answers.set(id, { status: 409, body: { hold: true, error: 'push-branch access is unchecked. Recheck access.' } });
    await s.pass();
    assert.match(pass(s)!.hold!, /unchecked/);
    s.answers.delete(id);
    s.board.update({
        repos: [
            { repo: REPO, setup: { access: { 'push-branch': 'allowed', 'open-pr': 'allowed' } } },
        ] as BoardData['repos'],
    });
    await s.pass();
    assert.equal(pass(s)!.hold, undefined);
    assert.equal(s.records.read(id).status, 'In progress');
    await s.stop();
});
