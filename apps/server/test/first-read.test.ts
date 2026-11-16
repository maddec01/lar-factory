import { boardIssue } from '@lar-factory/shared/test/raw-items';
import assert from 'node:assert/strict';
import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { test } from 'vite-plus/test';
import type { TestContext } from 'vite-plus/test';

import { startBoard, until } from './server-support.ts';

const settled = (board: Parameters<typeof until>[0]) => until(board, (d) => d.firstRead.settled);

/** A file whose existence holds every delayed repository's read, so a test knows which read lands first; removing it lets them finish. */
async function heldReads(t: TestContext): Promise<string> {
    const dir = await mkdtemp(join(tmpdir(), 'lar-first-read-hold-'));

    t.onTestFinished(() => rm(dir, { recursive: true, force: true }));

    const hold = join(dir, 'hold');

    await writeFile(hold, '');

    return hold;
}

test('the first read settles when the read fails', async (t) => {
    const board = await startBoard(t, { items: [boardIssue(1, 'List')], fail: 'read' });
    const data = await settled(board);

    assert.match(data.error ?? '', /502/);
    assert.equal(data.fetchedAt, null);
});

test("each repository's items show once its own read lands, while another repository's read still runs", async (t) => {
    const apple = 'maddec01/lar-apple';
    const hold = await heldReads(t);
    const board = await startBoard(t, {
        items: [boardIssue(1, 'List')],
        readHold: hold,
        localSetups: { [apple]: { role: 'Apple client', itemSource: { kind: 'issues' } } },
        repoIssues: { [apple]: [boardIssue(7, 'List', apple).content] },
    });
    const early = await until(board, (d) => d.items.length > 0);

    assert.deepEqual(
        early.items.map((i) => [i.repo, i.number]),
        [[apple, 7]],
        "the repository's read still sleeps",
    );
    assert.equal(early.firstRead.settled, false);
    assert.equal(early.firstRead.ready, true);
    assert.deepEqual(early.firstRead.waiting, ['maddec01/lar-server', 'maddec01/lar-factory']);
    assert.equal(early.fetchedAt, null, 'the whole read has yet to land');
    assert.equal(early.error, null);
    await rm(hold);

    const data = await settled(board);

    assert.deepEqual(
        data.items.map((i) => [i.repo, i.number]).sort((a, b) => String(a).localeCompare(String(b))),
        [
            [apple, 7],
            ['maddec01/lar-factory', 1],
        ],
    );
    assert.deepEqual(data.firstRead, { step: 'finishing', running: [], settled: true });
});
