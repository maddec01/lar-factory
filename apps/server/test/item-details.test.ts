import type { BoardData, ItemDetails } from '@lar-factory/shared';
import { boardIssue } from '@lar-factory/shared/test/raw-items';
import assert from 'node:assert/strict';
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { test } from 'vite-plus/test';
import type { TestContext } from 'vite-plus/test';

import { onboarded, startBoard, until } from './server-support.ts';
import type { Board } from './server-support.ts';

const details = (board: Board, query: string) => fetch(`${board.url}/api/item-details${query}`);

test('an item the board does not hold is 404 and a request naming none is 400', async (t) => {
    const board = await startBoard(t, {}, true);
    const unknown = await details(board, '?itemId=I_nope');

    assert.deepEqual([unknown.status, await unknown.json()], [404, { error: 'That item is not on the board.' }]);
    for (const query of ['', '?itemId=']) {
        const missing = await details(board, query);

        assert.deepEqual(
            [missing.status, await missing.json()],
            [400, { error: 'Name the item whose details to read.' }],
            query,
        );
    }
});

const olderComments = (board: Board, query: string) => fetch(`${board.url}/api/item-comments${query}`);

test('older comments of an item the board does not hold are 404, and a request naming no item or cursor is 400', async (t) => {
    const board = await startBoard(t, {}, true);
    const unknown = await olderComments(board, '?itemId=I_nope&before=0');

    assert.deepEqual([unknown.status, await unknown.json()], [404, { error: 'That item is not on the board.' }]);
    for (const query of ['', '?itemId=', '?before=0']) {
        const missing = await olderComments(board, query);

        assert.deepEqual(
            [missing.status, await missing.json()],
            [400, { error: 'Name the item whose comments to read.' }],
            query,
        );
    }

    const noCursor = await olderComments(board, '?itemId=I_sample13');

    assert.deepEqual(
        [noCursor.status, await noCursor.json()],
        [400, { error: 'Name where the older comments start.' }],
    );
});

const save = (board: Board, body: object) => board.post(body, board.url, '/api/item-description');
const issueNode = {
    __typename: 'Issue',
    body: 'Old.',
    author: null,
    assignees: { nodes: [] },
    createdAt: null,
    subIssues: { nodes: [] },
    comments: { pageInfo: { hasPreviousPage: false, startCursor: null }, nodes: [] },
};

/** A home with verified or refused access to edit this repository's tickets. */
function editingHome(t: TestContext, allowed = true): Record<string, string> {
    const home = mkdtempSync(join(tmpdir(), 'lar-board-home-'));

    t.onTestFinished(() => rmSync(home, { recursive: true, force: true }));

    const dir = join(home, 'Library/Application Support/Lar Factory');

    mkdirSync(dir, { recursive: true });
    writeFileSync(
        join(dir, 'repository-settings.json'),
        JSON.stringify({
            repositories: [
                {
                    repo: 'maddec01/lar-factory',
                    settings: { access: { 'edit-ticket': allowed ? 'allowed' : 'refused' } },
                },
            ],
        }),
    );

    return { HOME: home };
}

test("saving a GitHub issue's description edits its body with gh, and its details then read the new text", async (t) => {
    const board = await startBoard(
        t,
        { items: [boardIssue(12, 'List')], details: { I_12: issueNode } },
        false,
        false,
        editingHome(t),
    );

    await onboarded(board);
    await until(board, (d) => d.items.length === 1);

    const response = await save(board, { itemId: board.id(12), body: '- a\n- b' });

    assert.deepEqual([response.status, await response.json()], [200, { error: null }]);
    assert.ok(
        (await board.calls()).some((args) => args[0] === 'issue' && args[1] === 'edit' && args.includes('--body-file')),
    );

    const read = await details(board, `?itemId=${board.id(12)}`);

    assert.equal(((await read.json()) as { details: ItemDetails }).details.body, '- a\n- b');
});

test('a save for an item the board does not hold is 404, and one naming no item or body is 400', async (t) => {
    const board = await startBoard(t, { items: [boardIssue(12, 'List')] });

    await until(board, (d) => d.items.length === 1);

    const unknown = await save(board, { itemId: 'I_nope', body: 'x' });

    assert.deepEqual([unknown.status, await unknown.json()], [404, { error: 'That item is not on the board.' }]);
    for (const body of [{ body: 'x' }, { itemId: board.id(12) }, { itemId: board.id(12), body: 5 }]) {
        const bad = await save(board, body);

        assert.deepEqual(
            [bad.status, await bad.json()],
            [400, { error: 'Name the item and send its description.' }],
            JSON.stringify(body),
        );
    }
});

const labelWrite = (board: Board, body: object) => board.post(body, board.url, '/api/item-labels');
const labelCalls = async (board: Board) =>
    (await board.calls()).filter(
        (args) => args[0] === 'api' && args[1] === '--method' && /\/issues\/12\/labels/.test(String(args[3])),
    );

/** A home with `tag-ticket` access `allowed` or refused on this repository. */
function taggingHome(t: TestContext, allowed = true): Record<string, string> {
    const home = mkdtempSync(join(tmpdir(), 'lar-board-home-'));

    t.onTestFinished(() => rmSync(home, { recursive: true, force: true }));

    const dir = join(home, 'Library/Application Support/Lar Factory');

    mkdirSync(dir, { recursive: true });
    writeFileSync(
        join(dir, 'repository-settings.json'),
        JSON.stringify({
            repositories: [
                {
                    repo: 'maddec01/lar-factory',
                    settings: { access: { 'tag-ticket': allowed ? 'allowed' : 'refused' } },
                },
            ],
        }),
    );

    return { HOME: home };
}

test("adding and removing a GitHub label each make one call, and the reply's row shows the change", async (t) => {
    const board = await startBoard(
        t,
        { items: [boardIssue(12, 'List', undefined, ['docs'])] },
        false,
        false,
        taggingHome(t),
    );

    await onboarded(board);
    await until(board, (d) => d.items.length === 1);

    const added = await labelWrite(board, { itemId: board.id(12), label: 'area-ui', action: 'add' });
    const afterAdd = (await added.json()) as { error: string | null; board: BoardData };

    assert.deepEqual(
        [added.status, afterAdd.error, afterAdd.board.items[0]!.labels],
        [200, null, ['docs', 'status-list', 'area-ui']],
    );

    const removed = await labelWrite(board, { itemId: board.id(12), label: 'docs', action: 'remove' });
    const afterRemove = (await removed.json()) as { board: BoardData };

    assert.deepEqual([removed.status, afterRemove.board.items[0]!.labels], [200, ['status-list', 'area-ui']]);
    assert.deepEqual(
        (await labelCalls(board)).map((args) => [args[2], args[3]]),
        [
            ['POST', 'repos/maddec01/lar-factory/issues/12/labels'],
            ['DELETE', 'repos/maddec01/lar-factory/issues/12/labels/docs'],
        ],
    );
    // Records refresh from the tickets the board last read, so the change holds through them and the read after it.
    await until(board, (d) => d.items[0]!.labels.join() === 'status-list,area-ui');
});

test('a label write refuses a managed label, an unknown item and a bad body', async (t) => {
    const board = await startBoard(t, { items: [boardIssue(12, 'List')] }, false, false, taggingHome(t));

    await until(board, (d) => d.items.length === 1);

    const managed = await labelWrite(board, { itemId: board.id(12), label: 'Linked-Work', action: 'add' });

    assert.deepEqual(
        [managed.status, await managed.json()],
        [422, { error: "The factory manages Linked-Work, so it can't be changed here." }],
    );

    const unknown = await labelWrite(board, { itemId: 'I_nope', label: 'docs', action: 'add' });

    assert.deepEqual([unknown.status, await unknown.json()], [404, { error: 'That item is not on the board.' }]);
    for (const body of [
        { label: 'docs', action: 'add' },
        { itemId: board.id(12), action: 'add' },
        { itemId: board.id(12), label: '', action: 'add' },
        { itemId: board.id(12), label: 'docs', action: 'set' },
    ]) {
        const bad = await labelWrite(board, body);

        assert.deepEqual(
            [bad.status, await bad.json()],
            [400, { error: 'Name the item, the label and whether to add or remove it.' }],
            JSON.stringify(body),
        );
    }
    assert.deepEqual(await labelCalls(board), []);
});

/** A home where this repository maps Bug and Feature, with `access` to label and type its tickets. */
function mappedHome(
    t: TestContext,
    access: object = { 'tag-ticket': 'allowed', 'type-ticket': 'allowed' },
): Record<string, string> {
    const home = taggingHome(t);

    writeFileSync(
        join(home.HOME!, 'Library/Application Support/Lar Factory/repository-settings.json'),
        JSON.stringify({
            repositories: [
                {
                    repo: 'maddec01/lar-factory',
                    settings: {
                        access,
                        overrides: {
                            vocabulary: {
                                bug: { type: 'Bug', labels: ['type: bug'] },
                                feature: { type: 'Feature', labels: ['type: feature'] },
                            },
                        },
                    },
                },
            ],
        }),
    );

    return home;
}

const kindWrite = (board: Board, body: object) => board.post(body, board.url, '/api/item-kind');
const kindItem = (board: BoardData, id: string) => board.items.find((i) => i.id === id)!;

test('changing a kind swaps the ticket through the tracker, and the reply and later reads keep the new kind', async (t) => {
    const board = await startBoard(
        t,
        { items: [boardIssue(12, 'List', undefined, ['type: bug', 'docs'])] },
        false,
        false,
        mappedHome(t),
    );

    await onboarded(board);
    await until(board, (d) => d.items.length === 1);

    const id = board.id(12);
    const reply = await kindWrite(board, { itemId: id, kind: 'feature' });
    const body = (await reply.json()) as { error: string | null; line: string; itemId: string; board: BoardData };

    assert.equal(reply.status, 200, body.error ?? '');
    assert.equal(body.line, '#12: added label type: feature; removed label type: bug; type none to Feature.');

    const shown = kindItem(body.board, body.itemId);

    assert.equal(shown.kind, 'feature');
    assert.deepEqual(shown.labels.filter((l) => l !== 'status-list').sort(), ['docs', 'type: feature']);
    await until(board, (d) => d.items[0]!.labels.includes('type: feature') && d.items[0]!.kind === 'feature');
    assert.ok(
        (await board.calls()).some((args) => args[2] === 'PATCH' && args[3] === 'repos/maddec01/lar-factory/issues/12'),
    );
});

test('without access the item keeps its new kind and the board shows the disagreement, until Keep answers it', async (t) => {
    const board = await startBoard(
        t,
        { items: [boardIssue(12, 'List', undefined, ['type: bug'])] },
        false,
        false,
        mappedHome(t, { 'tag-ticket': 'refused', 'type-ticket': 'allowed' }),
    );

    await onboarded(board);
    await until(board, (d) => d.items.length === 1);

    const changed = (await (await kindWrite(board, { itemId: board.id(12), kind: 'feature' })).json()) as {
        itemId: string;
        board: BoardData;
    };
    const { kindDisagreement } = kindItem(changed.board, changed.itemId);

    assert.deepEqual(kindDisagreement, {
        ticketKind: 'bug',
        changed: 'item',
        kept: false,
        swap: { add: ['type: feature'], remove: ['type: bug'], type: { from: null, to: 'Feature' } },
    });

    const kept = await board.post(
        { itemId: changed.itemId, answer: 'keep', ticketKind: 'bug' },
        board.url,
        '/api/item-kind-answer',
    );

    assert.equal(kept.status, 200);
    assert.equal(
        kindItem(((await kept.json()) as { board: BoardData }).board, changed.itemId).kindDisagreement?.kept,
        true,
    );
});

test('readiness refuses foreign origins and sample mode without running Azure', async (t) => {
    const board = await startBoard(t, {}, true);
    const input = { itemId: 'I_sample01', number: 1, organization: 'untrusted' };
    const foreign = await fetch(`${board.url}/api/pr-readiness`, {
        method: 'POST',
        headers: { Origin: 'https://foreign.example', 'Content-Type': 'application/json' },
        body: JSON.stringify(input),
    });

    assert.equal(foreign.status, 403);

    const sample = await fetch(`${board.url}/api/pr-readiness`, {
        method: 'POST',
        headers: { Origin: board.url, 'Content-Type': 'application/json' },
        body: JSON.stringify(input),
    });

    assert.equal(sample.status, 403);
    assert.equal((await board.calls()).length, 0);
});
