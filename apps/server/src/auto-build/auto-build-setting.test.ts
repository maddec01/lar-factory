import type { ModelGroup } from '@lar-factory/shared';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, test } from 'vite-plus/test';

import { createAutoBuildSetting } from './auto-build-setting.ts';

const dirs: string[] = [];

afterEach(() => {
    for (const dir of dirs.splice(0)) rmSync(dir, { recursive: true, force: true });
});

const OPUS = { instanceId: 'claudeAgent', model: 'claude-opus-5-5' };
const OFFERED: ModelGroup[] = [
    { instanceId: 'claudeAgent', name: 'Claude', models: [{ slug: 'claude-opus-5-5', label: 'Opus 5.5' }] },
];

function setUp(dir = mkdtempSync(join(tmpdir(), 'auto-build-setting-'))) {
    dirs.push(dir);

    let changes = 0;
    const setting = createAutoBuildSetting({
        dir,
        offerModelChoices: () => OFFERED,
        changed: () => {
            changes += 1;
        },
    });

    return { dir, setting, changes: () => changes };
}

test('Auto-build starts off on T3 Project default, and a saved switch and model reach the board and outlast a restart', () => {
    const { dir, setting, changes } = setUp();

    assert.deepEqual(setting.state(), { on: false });
    assert.deepEqual(setting.save({ on: true }), { status: 200, body: { error: null } });
    assert.deepEqual(setting.save({ model: OPUS }), { status: 200, body: { error: null } });
    assert.deepEqual(setting.state(), { on: true, model: OPUS });
    assert.deepEqual(setUp(dir).setting.state(), { on: true, model: OPUS }, 'a restarted board');
    assert.deepEqual(setting.save({ on: false }), { status: 200, body: { error: null } });
    assert.deepEqual(setting.state(), { on: false, model: OPUS }, 'the switch keeps the model');
    assert.deepEqual(setting.save({ model: null }), { status: 200, body: { error: null } });
    assert.deepEqual(setting.state(), { on: false }, 'null is T3 Project default');
    assert.equal(changes(), 4);
});
