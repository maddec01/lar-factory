import { boardIssue } from '@lar-factory/shared/test/raw-items';
import { openWorkRecords, WorkRecordError, workRecordsPath } from '@lar-factory/work-records';
import assert from 'node:assert/strict';
import { setTimeout as sleep } from 'node:timers/promises';
import { test } from 'vite-plus/test';

import { changeRecords, startBoard, until } from './server-support.ts';
import type { Board } from './server-support.ts';

/** Waits for the board's first read to land and settle, so no read it asks for itself is still to come. */
const firstRead = (board: Board) => until(board, (d) => d.fetchedAt !== null && d.firstRead.settled);

test("a dossier's map and every item's blockers reach the page; only the bodies of concepts and items with sub-issues on the board are read", async (t) => {
    const body = '## Destination\nThere.\n\n## End-to-end check\nTry it\n1. Step\n';
    const concept = boardIssue(1, 'Shaping', 'acme/api', ['concept']);
    const feature = boardIssue(2, 'List', 'acme/api', ['feature']);
    const coupled = boardIssue(3, 'In progress', 'acme/api', ['feature']);
    const part = boardIssue(4, 'Ready', 'acme/api', ['build']);

    Object.assign(concept.content!, { id: 'I_1', body });
    // A ticket's provider blocker never reaches the page; the record's blocker does.
    Object.assign(feature.content!, {
        id: 'I_2',
        body,
        blockedBy: { nodes: [{ number: 3, state: 'OPEN', repository: { nameWithOwner: 'acme/api' } }] },
    });
    Object.assign(coupled.content!, { id: 'I_3', body });
    Object.assign(part.content!, {
        id: 'I_4',
        body,
        parent: {
            number: 3,
            title: 'Issue 3',
            url: 'https://github.com/acme/api/issues/3',
            state: 'OPEN',
            repository: { nameWithOwner: 'acme/api' },
        },
    });

    const board = await startBoard(t, {
        repositories: ['acme/api'],
        items: [concept, feature, coupled, part],
    });

    await firstRead(board);

    const [conceptId, featureId] = [board.id(1, 'acme/api'), board.id(2, 'acme/api')];
    const shown = await changeRecords(
        board,
        (records) => {
            // The running board can record an observation between this read and write.
            for (let attempt = 0; ; attempt++) {
                try {
                    records.addBlocker(featureId, records.read(featureId).revision, conceptId);

                    return;
                } catch (error) {
                    if (!(error instanceof WorkRecordError) || error.code !== 'stale-revision' || attempt >= 4)
                        throw error;
                }
            }
        },
        featureId,
        (item) => item.blockers.length > 0,
    );
    const [map, plain, parent, child] = shown.items;
    const read = { destination: 'There.', decisions: [], fog: [], check: { title: 'Try it', steps: ['Step'] } };

    assert.deepEqual(map?.map, read);
    assert.deepEqual(parent?.map, read, 'an item with a sub-issue on the board is a dossier, with its map');
    assert.deepEqual(map?.blockers, []);
    assert.deepEqual(plain?.blockers, [
        { number: 1, repo: 'acme/api', state: 'open', workId: conceptId, title: 'Issue 1' },
    ]);
    assert.ok(!('map' in plain!) && !('body' in plain!), 'a feature gets no map and no body');
    assert.ok(!('map' in child!) && !('body' in child!), 'nor does a part');

    const bodyReads = (await board.calls()).filter((args) =>
        args.some((a) => a.includes('nodes(ids:') && a.includes('id body }')),
    );

    assert.equal(
        bodyReads.filter((args) => args.some((a) => a.includes('id body }'))).length,
        1,
        "one query reads the dossiers' bodies",
    );
    assert.deepEqual(
        bodyReads[0]!.filter((a) => a.startsWith('ids[]=')),
        ['ids[]=I_1', 'ids[]=I_3'],
        'it asks for the concept and the parent only',
    );
});

test("a provider pass reads each record's ticket once: its Spec read also gives the ticket's state and assignees", async (t) => {
    // A board process on the fast cadence, since only a running board runs provider passes.
    const board = await startBoard(
        t,
        { items: [boardIssue(12, 'Ready', 'maddec01/lar-factory', ['build'])] },
        false,
        true,
    );
    const records = await openWorkRecords(workRecordsPath(board.dataDir));

    t.onTestFinished(() => records.close());

    while (!records.observations(board.id(12)).some((o) => o.of === 'ticket')) await sleep(20);

    const reads = (await board.calls()).filter((args) =>
        args.some((arg) => arg === 'repos/maddec01/lar-factory/issues/12' || arg === '12'),
    );

    assert.ok(reads.length > 0);
    assert.deepEqual(
        new Set(reads.map((args) => args.slice(0, 2).join(' '))),
        new Set(['api repos/maddec01/lar-factory/issues/12']),
    );
    assert.equal(records.observations(board.id(12)).find((o) => o.of === 'ticket')?.state, 'open');
});
