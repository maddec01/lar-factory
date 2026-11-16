import assert from 'node:assert/strict';
import { writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { test } from 'vite-plus/test';

import { t3Settings, tempDir } from '../../test/stats-db.ts';
import { readT3Settings, t3Running } from './t3-settings.ts';

test('T3 Code runs while its runtime file names a live process', (t) => {
    const dir = tempDir(t, 'lar-t3-runtime-');
    const runtime = (name: string, text: string) => {
        writeFileSync(join(dir, name), text);

        return join(dir, name);
    };
    const state = (pid: unknown) =>
        JSON.stringify({
            version: 1,
            pid,
            port: 3773,
            origin: 'http://127.0.0.1:3773',
            startedAt: '2026-10-25T09:04:46.754Z',
        });

    assert.equal(t3Running(runtime('live', state(process.pid))), true);
    // pid 1 belongs to root: signalling it fails with EPERM, which still means it runs.
    assert.equal(t3Running(runtime('root', state(1))), true);
    assert.equal(t3Running(join(dir, 'missing')), false, 'T3 removes the file when it stops');
    assert.equal(t3Running(runtime('blank', '\n')), false);
    assert.equal(t3Running(runtime('garbled', '{"pid":')), false);
    assert.equal(t3Running(runtime('no-pid', state('15454'))), false);
    // A pid past the system's largest belongs to no process, as after a crash that left the file.
    assert.equal(t3Running(runtime('stale', state(2 ** 30))), false);
});

test("an instance's homePath expands `~`, other drivers are left out, and only valid prices and aliases are kept", (t) => {
    const path = t3Settings(
        t,
        {
            work: '~/work-claude',
            box: { driver: 'codex', homePath: '/box/codex' },
            cursor: { driver: 'cursor', homePath: '/c' },
        },
        {
            usagePriceOverrides: {
                ' m ': { inputCostPerMillionTokens: 1, outputCostPerMillionTokens: 2 },
                bad: { inputCostPerMillionTokens: -1, outputCostPerMillionTokens: 2 },
            },
            usageModelAliases: { ' a ': ' b ', empty: ' ' },
        },
    );
    const settings = readT3Settings(path, '/home');

    assert.deepEqual(settings.instanceHomes.get('work'), { driver: 'claudeAgent', home: '/home/work-claude' });
    assert.deepEqual(settings.instanceHomes.get('box'), { driver: 'codex', home: '/box/codex' });
    assert.equal(settings.instanceHomes.has('cursor'), false);
    assert.deepEqual(settings.priceOverrides, { m: { inputCostPerMillionTokens: 1, outputCostPerMillionTokens: 2 } });
    assert.deepEqual(settings.modelAliases, { a: 'b' });
});
