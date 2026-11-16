import { boardIssue } from '@lar-factory/shared/test/raw-items';
import { WorkRecordError } from '@lar-factory/work-records';
import assert from 'node:assert/strict';
import { test } from 'vite-plus/test';

import { changeRecords, startBoard, until } from './server-support.ts';
import type { Board } from './server-support.ts';

/** Waits for the board's first read to land and settle, so no read it asks for itself is still to come. */
const firstRead = (board: Board) => until(board, (d) => d.fetchedAt !== null && d.firstRead.settled);

test("a dossier's map and every item's blockers reach the page; only the bodies of concepts and items with sub-issues on the board are read", async (t) => {
    const body = '## Destination\nThere.\n\n## End-to-end check\nTry it\n1. Step\n';
    const concept = boardIssue(1, 'Shaping', 'maddec01/lar-server', ['concept']);
    const feature = boardIssue(2, 'List', 'maddec01/lar-server', ['feature']);
    const coupled = boardIssue(3, 'In progress', 'maddec01/lar-server', ['feature']);
    const part = boardIssue(4, 'Ready', 'maddec01/lar-server', ['build']);

    Object.assign(concept.content!, { id: 'I_1', body });
    // A ticket's provider blocker never reaches the page; the record's blocker does.
    Object.assign(feature.content!, {
        id: 'I_2',
        body,
        blockedBy: { nodes: [{ number: 3, state: 'OPEN', repository: { nameWithOwner: 'maddec01/lar-server' } }] },
    });
    Object.assign(coupled.content!, { id: 'I_3', body });
    Object.assign(part.content!, {
        id: 'I_4',
        body,
        parent: {
            number: 3,
            title: 'Issue 3',
            url: 'https://github.com/maddec01/lar-server/issues/3',
            state: 'OPEN',
            repository: { nameWithOwner: 'maddec01/lar-server' },
        },
    });

    const board = await startBoard(t, {
        repositories: ['maddec01/lar-server'],
        items: [concept, feature, coupled, part],
    });

    await firstRead(board);

    const [conceptId, featureId] = [board.id(1, 'maddec01/lar-server'), board.id(2, 'maddec01/lar-server')];
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
        { number: 1, repo: 'maddec01/lar-server', state: 'open', workId: conceptId, title: 'Issue 1' },
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
