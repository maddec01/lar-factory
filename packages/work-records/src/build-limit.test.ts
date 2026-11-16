import { mkdtempSync, readdirSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, expect, it } from 'vite-plus/test';

import { buildLimitSetting } from './build-limit.ts';
import { writeHeavyCommandLimit } from './heavy-command-limit.ts';

const dirs: string[] = [];
const tempDir = () => {
    const dir = mkdtempSync(join(tmpdir(), 'build-limit-'));

    dirs.push(dir);

    return dir;
};

afterEach(() => {
    for (const dir of dirs.splice(0)) rmSync(dir, { recursive: true, force: true });
});

it('is Automatic while no file is saved, and saves in its own file beside the heavy command limit', () => {
    const dir = tempDir();

    expect(buildLimitSetting.read(dir)).toEqual({ limit: 'automatic' });
    writeHeavyCommandLimit(1, dir);
    expect(buildLimitSetting.write(3, dir)).toBe(3);
    expect(buildLimitSetting.read(dir)).toEqual({ limit: 3 });
    expect(readdirSync(dir).sort()).toEqual(['build-limit.json', 'heavy-command-limit.json']);
});
