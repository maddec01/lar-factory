import { blockedText } from '@lar-factory/shared';
import type { BoardData } from '@lar-factory/shared';
import { openWorkRecords, type WorkRecords } from '@lar-factory/work-records';
import assert from 'node:assert/strict';
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { test } from 'vite-plus/test';

import { createBoardState } from '../board/board-state.ts';
import { recordItems } from '../items/record-items.ts';
import { armedWorkGone, createStartAfter } from './start-after.ts';

const REPO = 'maddec01/lar-factory';
const at = (records: WorkRecords, workId: string) => records.read(workId).revision;
/** Each kind of blocker with the local facts that complete it, the last fact left out until `finish`. */
const BLOCKERS: {
    kind: 'decision' | 'concept' | 'build';
    start: (records: WorkRecords, workId: string) => void;
    finish: (records: WorkRecords, workId: string) => void;
}[] = [
    {
        kind: 'decision',
        start(records, workId) {
            const concept = records.create({ title: 'Concept', repository: REPO, kind: 'concept', status: 'Shaping' });

            records.setParent(workId, at(records, workId), concept.workId);
            records.setBody(workId, at(records, workId), 'answer', 'Use SQLite.');
            records.setBody(workId, at(records, workId), 'domain-drafts', 'None.');
        },
        finish(records, workId) {
            const concept = records.read(workId).parentId!;

            records.setBody(concept, at(records, concept), 'map', '# Map\n\nSettled.');
        },
    },
    {
        kind: 'concept',
        start(records, workId) {
            const build = records.create({ title: 'Delivery', repository: REPO, kind: 'build' });

            records.setParent(build.workId, build.revision, workId);
            records.setPullRequest(build.workId, at(records, build.workId), `${REPO}#91`);
            records.observe(build.workId, at(records, build.workId), { of: 'pr', state: 'merged' });
        },
        finish: (records, workId) => void records.setFogGone(workId, at(records, workId), true),
    },
    {
        kind: 'build',
        start(records, workId) {
            records.setPullRequest(workId, at(records, workId), `${REPO}#90`);
            records.observe(workId, at(records, workId), { of: 'pr', state: 'open' });
        },
        finish: (records, workId) => void records.observe(workId, at(records, workId), { of: 'pr', state: 'merged' }),
    },
];

for (const { kind, start, finish } of BLOCKERS) {
    test(`Start after waits on a ${kind} blocker until its local facts complete it, never on its Status or thread`, async (t) => {
        const dir = mkdtempSync(join(tmpdir(), 'lar-start-after-'));
        const records = await openWorkRecords(join(dir, 'work-records.db'));

        t.onTestFinished(() => {
            records.close();
            rmSync(dir, { recursive: true, force: true });
        });

        const blocker = records.create({
            title: `The ${kind}`,
            repository: REPO,
            kind,
            status: kind === 'build' ? 'In progress' : 'Shaping',
        });
        const work = records.create({ title: 'Waiting work', repository: REPO, kind: 'feature', status: 'Queued' });

        records.addBlocker(work.workId, work.revision, blocker.workId);
        start(records, blocker.workId);
        records.update(blocker.workId, at(records, blocker.workId), { status: 'Done' });
        records.addThread(blocker.workId, at(records, blocker.workId), `thread-${kind}`, 'build');

        const board = createBoardState({ items: recordItems(records, [], [REPO]), repos: [] } as unknown as BoardData);
        const reread = () => board.applyRead(recordItems(records, [], [REPO]), board.revision(), (items) => items);
        const started: unknown[][] = [];
        const startAfter = createStartAfter({
            board,
            file: join(dir, 'armed.json'),
            offerModelChoices: () => [],
            gone: () => false,
            commands: {
                start: async (...args) => {
                    started.push(args);

                    return { status: 200, body: { error: null } };
                },
                startBuild: async () => ({ status: 200, body: { error: null } }),
            },
        });

        assert.equal(blockedText(board.find(work.workId)!), `Blocked by The ${kind} until it completes`);
        assert.equal(startAfter.arm(work.workId, undefined).status, 200);
        await startAfter.startUnblocked();
        assert.deepEqual(started, []);

        finish(records, blocker.workId);
        reread();
        await startAfter.startUnblocked();
        assert.deepEqual(started, [[work.workId, undefined, true]]);
    });
}

test('an armed start whose item the board does not show stays armed until the records or the onboarded list say it is gone', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'start-after-gone-'));
    const records = await openWorkRecords(join(dir, 'work-records.db'));

    try {
        const file = join(dir, 'armed.json');
        const work = records.create({ title: 'Ticketless', repository: REPO, kind: 'build', status: 'Ready' });
        let list: () => { repo: string }[] = () => [{ repo: REPO }];
        const board = createBoardState({ items: [], repos: [] } as unknown as BoardData);

        writeFileSync(file, JSON.stringify({ [work.workId]: {}, gone: {} }));

        const startAfter = createStartAfter({
            board,
            file,
            offerModelChoices: () => [],
            gone: armedWorkGone(records, () => list()),
            commands: {
                start: async () => ({ status: 200, body: { error: null } }),
                startBuild: async () => ({ status: 200, body: { error: null } }),
            },
        });

        await startAfter.startUnblocked();
        assert.deepEqual(
            board.snapshot().armed,
            { [work.workId]: {} },
            'an empty board proves nothing, and a work ID with no record is gone',
        );
        list = () => {
            throw new Error('unreadable');
        };
        await startAfter.startUnblocked();
        assert.deepEqual(board.snapshot().armed, { [work.workId]: {} }, 'an unreadable list proves nothing');
        list = () => [];
        await startAfter.startUnblocked();
        assert.deepEqual(board.snapshot().armed, {}, 'a repository off the list is gone');
        assert.deepEqual(JSON.parse(readFileSync(file, 'utf8')), {});

        list = () => [{ repo: REPO }];

        const gone = armedWorkGone(records, () => list());

        assert.equal(gone(work.workId), false);
        records.update(work.workId, records.read(work.workId).revision, { status: 'In progress' });
        assert.equal(gone(work.workId), true, 'it moved on from Ready');

        const aside = records.create({ title: 'Aside', repository: REPO, kind: 'build', status: 'Ready' });

        records.setAside(aside.workId, aside.revision);
        assert.equal(gone(aside.workId), true, 'set aside');
        assert.equal(armedWorkGone(null, () => list())(work.workId), false, 'unreadable records prove nothing');
    } finally {
        records.close();
        rmSync(dir, { recursive: true, force: true });
    }
});

test('Start after retains authorization across a capacity hold and launches once when room returns', async (t) => {
    const dir = mkdtempSync(join(tmpdir(), 'start-after-capacity-'));
    const records = await openWorkRecords(join(dir, 'work.db'));

    t.onTestFinished(() => {
        records.close();
        rmSync(dir, { recursive: true, force: true });
    });

    const build = records.create({ title: 'Waiting build', repository: REPO, kind: 'build', status: 'Ready' });
    const blocker = records.create({ title: 'Prerequisite', repository: REPO, kind: 'decision' });

    records.addBlocker(build.workId, at(records, build.workId), blocker.workId);

    const board = createBoardState({ items: recordItems(records, [], [REPO]), repos: [] } as unknown as BoardData);
    let attempts = 0;
    const startAfter = createStartAfter({
        board,
        file: join(dir, 'armed.json'),
        gone: () => false,
        offerModelChoices: () => [],
        commands: {
            start: async () => {
                throw Error('A build must use Start build.');
            },
            startBuild: async () =>
                ++attempts === 1
                    ? { status: 409, body: { error: 'Shared build capacity is full.', hold: true } }
                    : { status: 200, body: { error: null } },
        },
    });

    assert.equal(startAfter.arm(build.workId, undefined).status, 200);
    records.setBody(blocker.workId, at(records, blocker.workId), 'answer', 'Settled.');
    records.setBody(blocker.workId, at(records, blocker.workId), 'domain-drafts', 'None.');
    board.applyRead(recordItems(records, [], [REPO]), board.revision(), (items) => items);
    await startAfter.startUnblocked();
    assert.ok(board.snapshot().armed?.[build.workId]);
    await startAfter.startUnblocked();
    await startAfter.startUnblocked();
    assert.equal(attempts, 2);
    assert.equal(board.snapshot().armed?.[build.workId], undefined);
});
