import assert from 'node:assert/strict';
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, test } from 'vite-plus/test';

import { createLimitSettings } from './limit-setting.ts';

const dirs: string[] = [];

afterEach(() => {
    for (const dir of dirs.splice(0)) rmSync(dir, { recursive: true, force: true });
});

function setUp() {
    const dir = mkdtempSync(join(tmpdir(), 'limit-setting-'));

    dirs.push(dir);

    let changes = 0;
    const settings = createLimitSettings({
        dir,
        automatic: 2,
        changed: () => {
            changes += 1;
        },
    });

    return { dir, limit: settings.heavyCommandLimit, build: settings.buildLimit, changes: () => changes };
}

test('a saved limit shows in the state beside the automatic number and reaches the board', () => {
    const { limit, changes } = setUp();

    assert.deepEqual(limit.state(), { limit: 'automatic', automatic: 2 });
    assert.deepEqual(limit.save({ limit: 5 }), { status: 200, body: { error: null } });
    assert.deepEqual(limit.state(), { limit: 5, automatic: 2 });
    assert.deepEqual(limit.save({ limit: 'automatic' }), { status: 200, body: { error: null } });
    assert.deepEqual(limit.state(), { limit: 'automatic', automatic: 2 });
    assert.equal(changes(), 2);
});

test('an invalid limit is refused with a 400 and changes nothing', () => {
    const { limit, changes } = setUp();

    limit.save({ limit: 3 });
    for (const value of [0, -2, 1.5, '3', 'auto', null, undefined])
        assert.equal(limit.save({ limit: value }).status, 400, String(value));
    assert.deepEqual(limit.state(), { limit: 3, automatic: 2 });
    assert.equal(changes(), 1);
});

test('an invalid file shows as Automatic with why, and a save replaces it', () => {
    const { dir, limit } = setUp();

    writeFileSync(join(dir, 'heavy-command-limit.json'), '{ "limit": 0 }');

    const state = limit.state();

    assert.equal(state.limit, 'automatic');
    assert.match(state.problem ?? '', /needs a limit/);
    assert.equal(limit.save({ limit: 1 }).status, 200);
    assert.deepEqual(limit.state(), { limit: 1, automatic: 2 });
});

test("the build limit saves beside the heavy command limit, and its Automatic follows that limit's number", () => {
    const { limit, build, changes } = setUp();

    assert.deepEqual(build.state(), { limit: 'automatic', automatic: 2 });
    limit.save({ limit: 4 });
    assert.deepEqual(build.state(), { limit: 'automatic', automatic: 4 }, 'a saved heavy command limit');
    assert.deepEqual(build.save({ limit: 3 }), { status: 200, body: { error: null } });
    assert.deepEqual(build.state(), { limit: 3, automatic: 4 });
    assert.deepEqual(limit.state(), { limit: 4, automatic: 2 }, 'the heavy command limit stays as it was');
    limit.save({ limit: 'automatic' });
    assert.deepEqual(build.state(), { limit: 3, automatic: 2 });
    assert.equal(build.save({ limit: 0 }).status, 400);
    assert.equal(changes(), 3);
});

test('an invalid build limit file shows as Automatic with why', () => {
    const { dir, build } = setUp();

    writeFileSync(join(dir, 'build-limit.json'), 'null');

    const state = build.state();

    assert.equal(state.limit, 'automatic');
    assert.match(state.problem ?? '', /build limit setting .* needs a limit/);
    assert.equal(state.automatic, 2);
});
