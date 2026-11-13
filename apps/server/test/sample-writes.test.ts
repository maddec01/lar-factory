import type { BoardData, Item } from '@lar-factory/shared';
import { openWorkRecords } from '@lar-factory/work-records';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { readFileSync, readdirSync, statSync, mkdtempSync, mkdirSync, writeFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { test } from 'vite-plus/test';

import { startBoard, until } from './server-support.ts';

const repo = 'lar-factory-sample/lar-server';
const tree = (dir: string) =>
    Object.fromEntries(
        readdirSync(dir, { recursive: true, encoding: 'utf8' }).flatMap((name) => {
            const path = join(dir, name);

            return statSync(path).isFile() ? [[name, readFileSync(path).toString('base64')]] : [];
        }),
    );

for (const t3 of [false, true])
    test(`sample fake writes and failures stay isolated (T3 reads: ${t3})`, async (t) => {
        const board = await startBoard(t, {}, true, false, t3 ? { BOARD_SAMPLE_T3: '1' } : {});
        const before = tree(board.dataDir);
        const post = async (path: string, body: object, status = 200) => {
            const response = await board.post(body, board.url, path);
            const json = await response.json();

            assert.equal(response.status, status, JSON.stringify(json));

            return json;
        };
        const labels = () => post('/api/repositories/labels', { repo, change: 'list' });

        await post('/api/repositories/labels', { repo, change: 'create', name: 'F02 label' });
        await post('/api/repositories/labels', {
            repo,
            change: 'update',
            name: 'F02 label',
            update: { name: 'F02 edited', color: '123abc', description: 'Saved' },
        });
        assert.ok(
            (await labels()).labels.some(
                (label: { name: string; color: string }) => label.name === 'F02 edited' && label.color === '123abc',
            ),
        );
        await post('/api/repositories/settings', {
            repo,
            change: 'vocabulary',
            key: 'bug',
            value: { type: null, labels: ['F02 edited'] },
        });

        const seed = ((await board.board()) as BoardData).items.find(
            (item) => item.repo === repo && item.kind === 'concept',
        )!;

        const labelled = await post('/api/item-labels', { itemId: seed.id, label: 'F02 edited', action: 'add' });

        assert.ok(
            labelled.board.items.some((item: Item) => item.id === seed.id && item.labels.includes('F02 edited')),
            'the write response keeps the item dialog open',
        );
        assert.ok(
            (
                await until(board, (data) =>
                    data.items.some((item) => item.id === seed.id && item.labels.includes('F02 edited')),
                )
            ).items.length,
        );
        await post('/api/sample', {
            action: 'failure',
            operation: 'issues.edit',
            rule: { fail: 'next', message: 'F02 refused edit' },
        });

        const edit = { itemId: seed.id, body: '## Destination\nA growing sample concept.\n\n## Next\n- Add a child' };

        await post('/api/item-description', edit, 502);

        const details = () => fetch(`${board.url}/api/item-details?itemId=${seed.id}`).then((r) => r.json());

        assert.ok(!(await details()).details.body.includes('A growing sample concept.'));
        await post('/api/item-description', edit);
        assert.ok((await details()).details.body.includes('A growing sample concept.'));

        const request = {
            requestId: randomUUID(),
            draft: {
                repo,
                kind: 'feature',
                title: 'F02 created issue',
                description: 'Real capture handler',
                createIssue: true,
                options: { newLabels: ['F02 inline'] },
            },
        };
        const created = (await post('/api/items', request)).item as Item;

        assert.ok(created.number > 0);
        assert.equal((await post('/api/items', request)).item.id, created.id);
        assert.equal(
            ((await board.board()) as BoardData).items.filter((item) => item.title === request.draft.title).length,
            1,
        );
        await post('/api/sample', {
            action: 'link',
            kind: 'parent',
            from: { repo, number: created.number },
            to: { repo, number: seed.number },
        });
        assert.ok((await details()).details.subTickets.some((item: Item) => item.number === created.number));
        assert.equal(
            ((await board.board()) as BoardData).items.find((item) => item.id === created.id)?.parentId,
            seed.id,
        );
        await post('/api/item-description', { itemId: created.id, body: 'Edited linked work' });
        await post('/api/item-kind', { itemId: created.id, kind: 'improvement' });
        for (const path of [
            'onboarding/projects',
            'onboarding/repositories',
            'onboarding/vocabulary',
            'onboarding/detect',
            'onboarding/setup',
            'start',
            'start-again',
            'start-build',
            'arm',
            'disarm',
            'queue',
            'back-to-list',
            'abandon',
            'abandon-and-close',
            'close-ticket',
            'restore',
            'item-export',
            'item-spec',
            'needs-you',
            'inspect-owned-cleanup',
            'execute-owned-cleanup',
            'inspect-recovery',
            'dismiss-start-error',
            'retention',
            'shaping-thread-cleanup',
            'heavy-command-limit',
            'build-limit',
            'auto-build',
            'dependency-met',
            'inspect-merge',
            'merge-pr',
            'pr-readiness',
            'recheck',
            't3/reauthorize',
        ]) {
            const response = await board.post({}, board.url, `/api/${path}`);

            assert.equal(response.status, 403, path);
        }
        await post('/api/repositories/settings', { repo, change: 'recheck' }, 403);
        for (const real of ['maddec01/lar-server', 'lar-factory-sample/unknown']) {
            await post('/api/repositories/labels', { repo: real, change: 'create', name: 'unsafe' }, 403);
            await post(
                '/api/items',
                { ...request, requestId: randomUUID(), draft: { ...request.draft, repo: real } },
                422,
            );
        }
        assert.equal(
            (await board.post({ action: 'clear-failures' }, 'https://foreign.test', '/api/sample')).status,
            403,
        );
        await post('/api/sample', { action: 'failure', operation: 'shell', rule: {} }, 400);
        assert.deepEqual(await board.calls(), []);
        assert.deepEqual(await board.t3Calls(), []);
        assert.deepEqual(tree(board.dataDir), before);
        await board.stop();

        const restarted = await startBoard(t, {}, true);
        const reset = await restarted.post({ repo, change: 'list' }, restarted.url, '/api/repositories/labels');

        assert.ok(!(await reset.json()).labels.some((label: { name: string }) => label.name.startsWith('F02')));
        assert.ok(!((await restarted.board()) as BoardData).items.some((item) => item.title === request.draft.title));
    });

test('sample controls require the app secret and are absent from live boards', async (t) => {
    const sample = await startBoard(t, {}, true, false, { BOARD_APP_SECRET: 'sample-test-secret' });

    assert.equal((await sample.post({ action: 'clear-failures' }, sample.url, '/api/sample')).status, 403);

    const live = await startBoard(t, { repositories: [] });

    assert.equal((await live.post({ action: 'clear-failures' }, live.url, '/api/sample')).status, 405);
});

test('sample startup ignores a supplied real data folder and never reads its settings', async (t) => {
    const home = mkdtempSync(join(tmpdir(), 'f02-sentinel-'));

    t.onTestFinished(() => rmSync(home, { recursive: true, force: true }));

    const dir = join(home, 'Library/Application Support/Lar Factory');

    mkdirSync(dir, { recursive: true });
    writeFileSync(join(dir, 'repository-settings.json'), 'unreadable sentinel settings');
    writeFileSync(join(dir, 'work-records.db'), 'not a database');

    const before = tree(home);
    const board = await startBoard(t, { repositories: null, recorded: false }, true, false, {
        HOME: home,
        LAR_FACTORY_DATA_DIR: dir,
    });

    assert.equal((await board.board()).error, null);
    assert.ok(!board.logs().includes('sentinel settings'));
    await board.stop();
    assert.deepEqual(tree(home), before);
});

test('writable sample reads local decision bodies and keeps the saved method after progress updates', async (t) => {
    const board = await startBoard(t, {}, true);
    const match = /sample data folder: ([^\n]+)/.exec(board.logs());

    assert.ok(match);

    const records = await openWorkRecords(join(match[1]!.trim(), 'work-records.db'));
    let task;

    try {
        task = records.create({ title: 'Activate sandbox', repository: repo, kind: 'decision', status: 'Queued' });
        task = records.setBody(task.workId, task.revision, 'decision', 'Method: task\nStage the release.');
        task = records.setBody(task.workId, task.revision, 'decision', 'Staged artifacts awaiting approval.');
    } finally {
        records.close();
    }

    const response = await board.post(
        { action: 'link', kind: 'related', from: { repo, number: 61 }, to: { repo, number: 114 }, present: false },
        board.url,
        '/api/sample',
    );

    assert.equal(response.status, 200);

    const item = ((await board.board()) as BoardData).items.find((item) => item.id === task.workId);

    assert.equal(item?.decisionMethod, 'task');

    const details = await fetch(`${board.url}/api/item-details?itemId=${task.workId}`).then((r) => r.json());

    assert.equal(details.details.record.body, 'Staged artifacts awaiting approval.');
});
