import assert from 'node:assert/strict';
import { mkdtempSync, rmSync } from 'node:fs';
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
